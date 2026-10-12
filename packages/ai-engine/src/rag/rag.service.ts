import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { defaultEmbeddings } from "../embeddings";
import type { ChunkData, ChunkMetadata, RagMatchType, RagSearchResult } from "../interfaces/rag";
import { RAG_TABLE_NAME, RAG_EMBEDDING_DIMENSIONS } from "../constants/rag";
import { lexicalIndex } from "./bm25";
import { rewriteQuery } from "./query-rewrite";
import { emit, withTaskEvents, TaskEvent, TaskType } from "../events";
import { normalizeParsedText } from "../loaders/extract";

export type { ChunkData, RagSearchResult, RagMatchType };

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

    this.vectorStore = await PGVectorStore.initialize(this.embeddings, {
      ...config,
      dimensions: RAG_EMBEDDING_DIMENSIONS,
    });
    // 词法索引接 ES（倒排 + BM25 + IK 分词，见 bm25.ts）
    lexicalIndex.attach();
    return this.vectorStore;
  }

  /**
   * 索引文档：切片 + 向量化，返回切片数据供后端写 DB
   *
   * @param kbId 知识库 ID
   * @param documentId 文档 ID
   * @param content 文档全文
   * @param names 知识库名称 / 文档文件名（存入 vector metadata，检索时直接返回）
   * @param taskId 可选：外层任务已存在时复用其 taskId（跳过 started/completed 生命周期，
   *               只发 progress），避免「上传」外层任务与「索引」内层任务嵌套成两个 taskId、
   *               前端按第一个锚定后丢掉内层事件
   * @param stepOffset 步骤起始编号（外层任务已用掉 step1/2 时从 3 开始）
   * @returns 切片列表（含序号和 token 估算）
   */
  async indexDocument(
    kbId: number,
    documentId: number,
    content: string,
    names?: { kbName?: string; documentName?: string },
    taskId?: string,
    stepOffset = 1,
  ): Promise<ChunkData[]> {
    if (taskId) {
      return this.vectorize(kbId, documentId, content, names, taskId, stepOffset);
    }
    return withTaskEvents(TaskType.DOCUMENT_INDEX, { kbId, documentId, message: `索引文档 #${documentId}` }, (tid) =>
      this.vectorize(kbId, documentId, content, names, tid, stepOffset),
    );
  }

  /**
   * 重建索引（编辑保存专用）：删除旧向量 → 内容就绪 → 数据清洗 → 重新切片 → 重新向量化
   *
   * 事件序列与前端 5 步条（重建索引/数据清洗/切片/向量化/完成）一一对应：
   *   step(offset)     重建索引：删除旧向量
   *   step(offset+1)   数据清洗完成（CRLF / BOM 归一）
   *   step(offset+2)   切片完成（vectorize 发出）
   *   step(offset+3)   向量化完成（vectorize 发出）
   *
   * 编辑内容来自编辑器（非文件），无需「解析」步骤；与新建链路（createDocument）
   * 保持同一套步骤语义（数据清洗/切片/向量化/完成），仅多出「重建索引」第一步；
   * 编辑内容同样走 normalizeParsedText 统一清洗，保证进入切片前的格式一致。
   */
  async reindexDocument(
    documentId: number,
    kbId: number,
    content: string,
    names?: { kbName?: string; documentName?: string },
    taskId?: string,
    stepOffset = 1,
  ): Promise<ChunkData[]> {
    // 编辑内容统一清洗（幂等；若调用方已清洗则此处无副作用）
    const cleaned = normalizeParsedText(content, true);

    if (taskId) {
      await this.deleteByDocumentId(documentId);
      emit(TaskEvent.PROGRESS, { taskId, taskType: TaskType.DOCUMENT_INDEX, step: stepOffset, message: "重建索引：删除旧向量" });
      emit(TaskEvent.PROGRESS, { taskId, taskType: TaskType.DOCUMENT_INDEX, step: stepOffset + 1, message: "数据清洗完成（CRLF / BOM 归一），开始切片与向量化" });
      return this.vectorize(kbId, documentId, cleaned, names, taskId, stepOffset + 2);
    }
    return withTaskEvents(TaskType.DOCUMENT_INDEX, { kbId, documentId, message: `重建索引文档 #${documentId}` }, async (tid) => {
      await this.deleteByDocumentId(documentId);
      emit(TaskEvent.PROGRESS, { taskId: tid, taskType: TaskType.DOCUMENT_INDEX, step: 1, message: "重建索引：删除旧向量" });
      emit(TaskEvent.PROGRESS, { taskId: tid, taskType: TaskType.DOCUMENT_INDEX, step: 2, message: "数据清洗完成（CRLF / BOM 归一），开始切片与向量化" });
      return this.vectorize(kbId, documentId, cleaned, names, tid, 3);
    });
  }

  /**
   * 切片 + 向量化核心逻辑（不发 started/completed，由 withTaskEvents 统一发）
   *
   * @param taskId 任务 ID（用于发进度事件）
   * @param stepOffset 步骤偏移（重建索引时前面多了"删旧向量"一步）
   */
  private async vectorize(
    kbId: number,
    documentId: number,
    content: string,
    names: { kbName?: string; documentName?: string } | undefined,
    taskId: string,
    stepOffset = 1,
  ): Promise<ChunkData[]> {
    // preserveTables：解析产物里 [表格] 标记的 GFM 表格块整体保留为 1 片，
    // 不被 RecursiveCharacterTextSplitter 按行切断（否则表格行列结构被打散，检索/展示都失真）
    const texts = await splitTextToChunks(content, { preserveTables: true });
    if (texts.length === 0) return [];

    emit(TaskEvent.PROGRESS, { taskId, taskType: TaskType.DOCUMENT_INDEX, step: stepOffset, message: `切片完成（${texts.length} 片），开始向量化` });

    const store = await this.getStore();

    const docs = texts.map(
      (text, i) =>
        new Document({
          pageContent: text,
          metadata: {
            documentId,
            kbId,
            chunkIndex: i + 1,
            kbName: names?.kbName,
            documentName: names?.documentName,
          } satisfies ChunkMetadata,
        }),
    );

    await store.addDocuments(docs);

    // 向量与词法索引同步写入（rag_bm25_index 旁表，供 BM25 检索）
    await lexicalIndex.addChunks(
      kbId,
      documentId,
      { kbName: names?.kbName, documentName: names?.documentName },
      texts.map((text, i) => ({ content: text, index: i + 1 })),
    );

    emit(TaskEvent.PROGRESS, { taskId, taskType: TaskType.DOCUMENT_INDEX, step: stepOffset + 1, message: "向量化完成" });

    return texts.map((text, i) => ({
      content: text,
      index: i + 1,
      tokenCount: Math.ceil(text.length / 2),
    }));
  }

  /**
   * 检索（统一混合模式：向量语义 + ES BM25 词法，RRF 融合）
   *
   * 两路各取候选，用 RRF 融合排名 —— rank 求和不用原始分，
   * 天然规避"余弦分 0~1 与 BM25 分无上界"不可比的问题。
   * 语义路长于近似匹配（"如何请假" 命中 "休假申请流程"），
   * 词法路长于精确词（型号、错误码、人名等专有名词），两路互补。
   *
   * @param query 用户问题
   * @param options.kbIds 限制在指定知识库
   * @param options.k top-K
   */
  async search(query: string, options: { kbIds?: number[]; k?: number } = {}): Promise<RagSearchResult[]> {
    const { kbIds, k = 5 } = options;
    // 每路多召回一些候选再融合，比各路只取 top-k 融合效果好
    const fetchK = Math.max(k * 2, 10);

    return withTaskEvents(TaskType.RAG_SEARCH, { kbIds, message: `检索：${query.slice(0, 50)}` }, async () => {
      // 先确保 PGVectorStore 已初始化（词法索引也由它顺带 attach）
      await this.getStore();

      // Query 改写：把口语化问题优化成更适合检索的形式（开关 QUERY_REWRITE_ENABLED）
      // 失败/关闭时静默 fallback 原 query，不影响主流程
      const { rewritten } = await rewriteQuery(query);
      const searchQuery = rewritten;

      const lists: RagSearchResult[][] = [
        await this.semanticSearch(searchQuery, kbIds, fetchK),
        await lexicalIndex.search(searchQuery, { kbIds, k: fetchK }),
      ];
      return fuseRrf(lists, k);
    });
  }

  /** 向量相似度检索 */
  private async semanticSearch(query: string, kbIds: number[] | undefined, k: number): Promise<RagSearchResult[]> {
    const store = await this.getStore();

    const filter = kbIds && kbIds.length > 0 ? { kbId: { in: kbIds } } : undefined;

    // PGVectorStore 的 filter 类型对 { in: number[] } 形式不友好，沿用原作者的单层 as any 旁路
    const results = await store.similaritySearchWithScore(query, k, filter);

    return results.map(([doc, score]) => {
      const metadata = doc.metadata as unknown as ChunkMetadata;
      return {
        content: doc.pageContent,
        documentId: metadata.documentId,
        kbId: metadata.kbId,
        kbName: metadata.kbName,
        documentName: metadata.documentName,
        chunkIndex: metadata.chunkIndex,
        score,
        matchType: "semantic" as const,
      } satisfies RagSearchResult;
    });
  }

  /**
   * 删除某个文档的所有索引（向量 + BM25 词法）
   *
   * PGVectorStore 通过 metadata 过滤删除
   */
  async deleteByDocumentId(documentId: number): Promise<void> {
    const store = await this.getStore();
    // PGVectorStore 支持通过 metadata filter 删除
    await store.delete({ filter: { documentId } });
    await lexicalIndex.deleteByDocumentId(documentId);
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
function extractTableBlocks(text: string): { tableBlocks: string[]; textBlocks: string[] } {
  const lines = text.split("\n");
  const tableBlocks: string[] = [];
  const textBlocks: string[] = [];
  let current: string[] = [];
  let table: string[] = [];
  let inTable = false;

  const flushText = () => {
    if (current.length) {
      textBlocks.push(current.join("\n"));
      current = [];
    }
  };
  const flushTable = () => {
    if (table.length) {
      tableBlocks.push(table.join("\n"));
      table = [];
    }
  };

  // 行首是 |（允许前导空白）—— GFM 表格行的外观特征
  const isTableLine = (line: string) => /^\s*\|/.test(line);
  // GFM 分隔行：| --- | :---: | ---: | —— 去掉 |/空白/冒号/横杠/点后应为空
  const isTableSeparator = (line: string) =>
    isTableLine(line) && /-/.test(line) && line.trim().replace(/[|\s:.-]/g, "").length === 0;
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
  return { tableBlocks, textBlocks };
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
    const { tableBlocks, textBlocks } = extractTableBlocks(text);
    const chunks: string[] = [...tableBlocks];
    for (const block of textBlocks) {
      chunks.push(...(await splitTextInternal(block)));
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
  const chunkSize = Number(process.env.CHUNK_SIZE) || 350;
  const chunkOverlap = Number(process.env.CHUNK_OVERLAP) || 40;
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
