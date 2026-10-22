import { randomUUID } from "node:crypto";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { defaultEmbeddings } from "../embeddings";
import type { ChunkData, ChunkMetadata, RagMatchType, RagSearchResult, PreparedIndex, ActiveDocument } from "../interfaces/rag";
import { RAG_TABLE_NAME, RAG_EMBEDDING_DIMENSIONS } from "../constants/rag";
import { lexicalIndex } from "./bm25";
import { rewriteQuery } from "./query-rewrite";
import { emit, withTaskEvents, TaskEvent, TaskType } from "../events";
import { normalizeParsedText } from "../loaders/extract";

export type { ChunkData, RagSearchResult, RagMatchType, PreparedIndex };

/** RRF（Reciprocal Rank Fusion）常数：弱化头部名次差距，业界惯用 60 */
const RRF_K = 60;

/**
 * RAG 服务 — 文档向量化 + 混合检索（语义向量 + BM25 词法，RRF 融合）
 *
 * 使用 pgvector 的 PGVectorStore，AI Engine 负责全部索引操作，
 * 后端仅调用 indexDocument / search / deleteByDocumentId。
 * BM25 词法索引在 Elasticsearch（见 bm25.ts），与向量表同步写入/删除。
 *
 * 每个耗时方法用 withTaskEvents 包一层，自动发送 started/completed/failed 事件，
 * 中间进度在回调里手动 emit PROGRESS。
 */
export class RagService {
  private vectorStore: PGVectorStore | null = null;
  private embeddings: EmbeddingsInterface;
  private storeReady?: Promise<PGVectorStore>;

  constructor(embeddings?: EmbeddingsInterface) {
    this.embeddings = embeddings ?? defaultEmbeddings;
  }

  /** 初始化 PGVectorStore（延迟初始化，避免模块加载时立即连接 DB） */
  private async getStore(): Promise<PGVectorStore> {
    if (this.vectorStore) return this.vectorStore;

    const config = {
      postgresConnectionOptions: {
        connectionString: process.env.DATABASE_URL,
      },
      tableName: RAG_TABLE_NAME,
      columns: {
        idColumnName: "id",
        contentColumnName: "content",
        metadataColumnName: "metadata",
        vectorColumnName: "embedding",
      },
      distanceStrategy: "cosine" as const,
      scoreNormalization: "similarity" as const,
    };

    this.storeReady ??= PGVectorStore.initialize(this.embeddings, {
      ...config,
      dimensions: RAG_EMBEDDING_DIMENSIONS,
    });
    try {
      this.vectorStore = await this.storeReady;
    } catch (error) {
      this.storeReady = undefined;
      throw error;
    }
    return this.vectorStore;
  }

  /** 暂存新索引；只有 DB 中的 index_revision 切换后才对检索可见。 */
  async prepareDocument(
    kbId: number,
    documentId: number,
    content: string,
    names?: { kbName?: string; documentName?: string },
    taskId?: string,
    stepOffset = 1,
  ): Promise<PreparedIndex> {
    const revision = randomUUID();
    const run = async (tid: string): Promise<PreparedIndex> => {
      const texts = await splitTextToChunks(normalizeParsedText(content, true), { preserveTables: true });
      if (texts.length === 0) throw new Error("文档没有可索引的文本");
      emit(TaskEvent.PROGRESS, { taskId: tid, taskType: TaskType.DOCUMENT_INDEX, step: stepOffset, message: `切片完成（${texts.length} 片），开始向量化` });
      try {
        const store = await this.getStore();
        await store.addDocuments(
          texts.map(
            (text, i) =>
              new Document({
                pageContent: text,
                metadata: { documentId, kbId, chunkIndex: i + 1, revision, ...names } satisfies ChunkMetadata,
              }),
          ),
        );
        await lexicalIndex.addChunks(
          kbId,
          documentId,
          { ...names, revision },
          texts.map((content, i) => ({ content, index: i + 1 })),
        );
        emit(TaskEvent.PROGRESS, { taskId: tid, taskType: TaskType.DOCUMENT_INDEX, step: stepOffset + 1, message: "向量化完成" });
        return { revision, chunks: texts.map((content, i) => ({ content, index: i + 1, tokenCount: Math.ceil(content.length / 2) })) };
      } catch (error) {
        await this.discardRevision(documentId, revision);
        throw error;
      }
    };
    return taskId ? run(taskId) : withTaskEvents(TaskType.DOCUMENT_INDEX, { kbId, documentId }, run);
  }

  /** 独立脚本兼容入口；后端应 prepareDocument 后在同一个事务内写切片与激活版本。 */
  async indexDocument(
    kbId: number,
    documentId: number,
    content: string,
    names?: { kbName?: string; documentName?: string },
    taskId?: string,
    stepOffset = 1,
  ): Promise<ChunkData[]> {
    const prepared = await this.prepareDocument(kbId, documentId, content, names, taskId, stepOffset);
    try {
      const store = await this.getStore();
      const result = await store.pool.query("UPDATE knowledge_document SET index_revision = $1 WHERE id = $2 AND status IN (1, 2)", [prepared.revision, documentId]);
      if (!result.rowCount) throw new Error("文档不存在或已删除");
      return prepared.chunks;
    } catch (error) {
      await this.discardRevision(documentId, prepared.revision);
      throw error;
    }
  }

  /** 保留旧版本直到新版本成功激活。 */
  async reindexDocument(
    documentId: number,
    kbId: number,
    content: string,
    names?: { kbName?: string; documentName?: string },
    taskId?: string,
    stepOffset = 1,
  ): Promise<ChunkData[]> {
    return this.indexDocument(kbId, documentId, content, names, taskId, stepOffset);
  }

  /** 清理失败的暂存版本；清理故障不会覆盖原始错误。 */
  async discardRevision(documentId: number, revision: string): Promise<void> {
    const results = await Promise.allSettled([this.deleteVectorRevision(documentId, revision), lexicalIndex.deleteByDocumentId(documentId, revision)]);
    for (const result of results) {
      if (result.status === "rejected") console.warn("暂存索引清理失败，版本仍不可检索", result.reason);
    }
  }

  private async deleteVectorRevision(documentId: number, revision?: string): Promise<void> {
    const store = await this.getStore();
    await store.delete({ filter: { documentId, ...(revision ? { revision } : {}) } });
  }

  /** 在召回之前过滤删除、失败文档和非活跃版本，避免旧切片挤占 top-k。 */
  private async activeDocuments(kbIds?: number[]): Promise<ActiveDocument[]> {
    const store = await this.getStore();
    const result = await store.pool.query<ActiveDocument>(
      `
      SELECT d.id, COALESCE(d.index_revision, '') AS revision
      FROM knowledge_document d JOIN knowledge_base kb ON kb.id = d.knowledge_base_id
      WHERE d.status IN (1, 2) AND kb.status IN (1, 2)
        AND ($1::int[] IS NULL OR kb.id = ANY($1::int[]))`,
      [kbIds ?? null],
    );
    return result.rows;
  }

  async search(query: string, options: { kbIds?: number[]; k?: number; mode?: "hybrid" | "semantic" | "keyword" } = {}): Promise<RagSearchResult[]> {
    const { kbIds, k = 5, mode = "hybrid" } = options;
    if (!query.trim() || (kbIds && !kbIds.length)) return [];
    if (!Number.isInteger(k) || k < 1 || k > 100) throw new Error("k 必须为 1~100 的整数");
    const fetchK = Math.max(k * 2, 10);
    return withTaskEvents(TaskType.RAG_SEARCH, { kbIds, message: `检索：${query.slice(0, 50)}` }, async () => {
      const active = await this.activeDocuments(kbIds);
      if (!active.length) return [];
      const { rewritten } = await rewriteQuery(query);
      const requests = [];
      if (mode !== "keyword") requests.push(this.semanticSearch(rewritten, active, fetchK));
      if (mode !== "semantic") requests.push(lexicalIndex.search(rewritten, { kbIds, k: fetchK, active }));
      const settled = await Promise.allSettled(requests);
      const lists: RagSearchResult[][] = [];
      for (const result of settled) {
        if (result.status === "fulfilled") lists.push(result.value);
        else console.warn("检索单路失败", result.reason);
      }
      if (!lists.length) throw new Error("向量与关键词检索均不可用，请稍后重试");
      return fuseRrf(lists, k);
    });
  }

  private async semanticSearch(query: string, active: ActiveDocument[], k: number): Promise<RagSearchResult[]> {
    const store = await this.getStore();
    const vector = await this.embeddings.embedQuery(query);
    const result = await store.pool.query<{ content: string; metadata: ChunkMetadata; score: number }>(
      `
      SELECT v.content, v.metadata, 1 - (v.embedding <=> $1::vector) AS score
      FROM ${RAG_TABLE_NAME} v
      JOIN jsonb_to_recordset($2::jsonb) AS a(id int, revision text)
        ON v.metadata->>'documentId' = a.id::text
        AND COALESCE(v.metadata->>'revision', '') = a.revision
      ORDER BY v.embedding <=> $1::vector LIMIT $3`,
      [JSON.stringify(vector), JSON.stringify(active), k],
    );
    return result.rows.map(({ content, metadata, score }) => ({
      content,
      ...metadata,
      score,
      matchType: "semantic" as const,
    }));
  }

  /** 独立评测结束时释放连接。 */
  async close(): Promise<void> {
    await Promise.all([this.vectorStore?.end(), lexicalIndex.close()]);
    this.vectorStore = null;
    this.storeReady = undefined;
  }

  async deleteByDocumentId(documentId: number): Promise<void> {
    const results = await Promise.allSettled([this.deleteVectorRevision(documentId), lexicalIndex.deleteByDocumentId(documentId)]);
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length) throw new Error("部分索引清理失败，可重试清理");
  }
}

/**
 * RRF（Reciprocal Rank Fusion）融合多路检索结果
 *
 *   rrf(d) = Σ_lists 1 / (RRF_K + rank)
 *
 * 只用名次不用原始分，因此不需要给余弦相似度和 BM25 分做归一化对齐。
 * 同一个 chunk（documentId+chunkIndex 唯一）在两路里都出现时分数会累加，自然靠前。
 * 最终 score 除以理论最大值（两路都排第 1）归一化到 0~1，方便前端按百分比展示。
 */
function fuseRrf(lists: RagSearchResult[][], k: number): RagSearchResult[] {
  interface Fused {
    result: RagSearchResult;
    rrf: number;
    matched: Set<RagMatchType>;
  }
  const fused = new Map<string, Fused>();

  for (const list of lists) {
    list.forEach((result, rank) => {
      const key = `${result.documentId}#${result.chunkIndex ?? -1}`;
      const entry = fused.get(key) ?? { result, rrf: 0, matched: new Set<RagMatchType>() };
      entry.rrf += 1 / (RRF_K + rank + 1);
      entry.matched.add(result.matchType);
      fused.set(key, entry);
    });
  }

  const maxRrf = lists.length / (RRF_K + 1);

  return [...fused.values()]
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, k)
    .map(({ result, rrf, matched }) => ({
      ...result,
      score: rrf / maxRrf,
      matchType: matched.size > 1 ? "both" : [...matched][0],
    }));
}

/** 切片选项 */
export interface SplitOptions {
  /**
   * 表格豁免：GFM 表格块整体保留为 1 片，不被字符级切分器切断。
   *
   * 识别两种表格来源：
   * 1. PDF 路径：Unstructured / 本地回退清洗产出的表格带独立行 `[表格]` 前缀；
   * 2. Markdown 路径：.md 里本来就是裸 GFM 表格（`| 表头 |` + `| --- |` 分隔行），无标记。
   *
   * 表格被切断后行列结构（表头+分隔行+数据行）打散，检索命中碎片、前端渲染不出表格；
   * 整体保留则语义完整。表格块之间的普通正文仍按 350/40 正常切分。
   */
  preserveTables?: boolean;
}

/**
 * 提取 GFM 表格块，与其余普通文本分开。
 *
 * 两种入口都要认：
 * 1. PDF 路径：Unstructured / 本地回退清洗会把表格转成 GFM 并在前面加独立行 `[表格]`；
 * 2. Markdown 路径：.md 文件里本来就是裸 GFM 表格，没有 `[表格]` 标记 ——
 *    只认标记行的话 md 表格会被 RecursiveCharacterTextSplitter 从中间切断。
 *
 * 假阳性保护：连续 `|` 行收集到的候选块，只有至少含一行 GFM 分隔行时才确认为表格；
 * 否则（正文偶然一行带竖线）退回普通文本。
 */
function extractTableBlocks(text: string): Array<{ text: string; table: boolean }> {
  const lines = text.split("\n");
  const blocks: Array<{ text: string; table: boolean }> = [];
  let current: string[] = [];
  let table: string[] = [];
  let inTable = false;

  const flushText = () => {
    if (current.length) {
      blocks.push({ text: current.join("\n"), table: false });
      current = [];
    }
  };
  const flushTable = () => {
    if (table.length) {
      blocks.push({ text: table.join("\n"), table: true });
      table = [];
    }
  };

  // 行首是 |（允许前导空白）—— GFM 表格行的外观特征
  const isTableLine = (line: string) => /^\s*\|/.test(line);
  // GFM 分隔行：| --- | :---: | ---: | —— 去掉 |/空白/冒号/横杠/点后应为空
  const isTableSeparator = (line: string) => isTableLine(line) && /-/.test(line) && line.trim().replace(/[|\s:.-]/g, "").length === 0;
  // 候选块是否真表格：至少 2 行且含分隔行
  const isRealTable = (block: string[]) => block.length >= 2 && block.some((l) => isTableSeparator(l));

  // 表格结束时校验真假：真表格入 tableBlocks，假表格退回文本流
  const closeTable = () => {
    if (isRealTable(table)) {
      flushTable();
    } else {
      current.push(...table);
      table = [];
    }
    inTable = false;
  };

  for (const line of lines) {
    if (inTable) {
      // 表格块内：连续的 `|` 行归表格；遇到普通行说明表格结束
      if (isTableLine(line)) {
        table.push(line);
        continue;
      }
      closeTable();
    }

    if (/^\[表格\]\s*$/.test(line.trim())) {
      // PDF 路径的显式标记行（保留它，便于检索时识别）
      flushText();
      inTable = true;
      table = [line];
      continue;
    }

    if (isTableLine(line)) {
      // 裸 GFM 表格的第一行（.md 常见）—— 开始收集候选块
      flushText();
      inTable = true;
      table = [line];
      continue;
    }

    current.push(line);
  }
  if (inTable) closeTable();
  flushText();
  return blocks;
}

/**
 * 将文本按语义切分为切片
 *
 * 使用 RecursiveCharacterTextSplitter，按段落 → 句子 → 逗号 → 字 优先级递归切分，
 * 每个切片最大 350 字符，相邻切片重叠 40 字符；
 * preserveTables 开启时 `[表格]` 块整体保留（见 SplitOptions）。
 */
export async function splitTextToChunks(text: string, options?: SplitOptions): Promise<string[]> {
  if (options?.preserveTables) {
    const chunks: string[] = [];
    for (const block of extractTableBlocks(text)) {
      chunks.push(...(block.table ? [block.text] : await splitTextInternal(block.text)));
    }
    return chunks.filter(Boolean);
  }
  return splitTextInternal(text);
}

/** 普通文本切分（表格豁免场景下只处理非表格块） */
async function splitTextInternal(text: string): Promise<string[]> {
  // 切片参数环境变量化：默认 350/40（中文 QA 场景实测最优）；
  // 评测时可通过 CHUNK_SIZE / CHUNK_OVERLAP 跑参数网格，不用改代码。
  // 注意：改这两个值需要重建索引（chunk 内容变了），旧向量不兼容。
  const chunkSize = Number(process.env.CHUNK_SIZE ?? 350);
  const chunkOverlap = Number(process.env.CHUNK_OVERLAP ?? 40);
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || !Number.isInteger(chunkOverlap) || chunkOverlap < 0 || chunkOverlap >= chunkSize)
    throw new Error("切片参数无效：须满足 0 <= CHUNK_OVERLAP < CHUNK_SIZE");
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: ["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""],
  });

  const docs = await splitter.createDocuments([text]);
  return docs.map((d) => d.pageContent).filter(Boolean);
}

/** 默认 RAG 服务单例 */
export const ragService = new RagService();
