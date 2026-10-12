/**
 * 词法检索（BM25）— Elasticsearch 实现
 *
 * 原实现是在 PostgreSQL 里用 GIN 数组索引 + 手写 BM25 打分 SQL（见 git 历史），
 * 打分公式、倒排、中文分词全部自建，代码量大且受限于 PG 无中文分析器。
 * 现改为 ES：倒排索引、BM25 打分、IK 中文分词全部交给 ES 引擎。
 *
 * 与向量路（PGVector）保持接口一致，仅替换内部实现：
 *   - attach()          连接 ES（惰性建索引，幂等）
 *   - addChunks()       批量写入词法索引（bulk + refresh）
 *   - search()          关键词检索（ES BM25 打分，支持 kbId 过滤）
 *   - deleteByDocumentId() 删除某文档的全部词法索引
 *
 * RRF 融合只看名次不看原始分，因此 ES 的 BM25 分（无上界）与
 * PGVector 的余弦分（0~1）可直接混用，无需归一化。
 *
 * 配置（apps/backend/.env）：
 *   ES_URL   Elasticsearch 地址（默认 http://localhost:9200）
 */
import { Client } from "@elastic/elasticsearch";
import type { ChunkData, LexicalChunk, LexicalHit, RagSearchResult } from "../interfaces/rag";
import { LEXICAL_INDEX_NAME } from "../constants/rag";

export class LexicalIndexService {
  private client: Client | null = null;
  private ready: Promise<void> | null = null;

  /** 连接 ES + 建索引（惰性、幂等） */
  attach(): void {
    if (this.ready) return;
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    const node = process.env.ES_URL ?? "http://localhost:9200";
    this.client = new Client({ node });

    // 索引不存在才建：中文用官方 smartcn 分析器（词典 + bigram 兜底，
    // 见 docker/es/Dockerfile；后续拿到 IK 插件可直接换成 ik_max_word/ik_smart）
    const exists = await this.client.indices.exists({ index: LEXICAL_INDEX_NAME });
    if (!exists) {
      await this.client.indices.create({
        index: LEXICAL_INDEX_NAME,
        mappings: {
          properties: {
            document_id: { type: "keyword" },
            kb_id: { type: "keyword" },
            chunk_index: { type: "integer" },
            content: { type: "text", analyzer: "smartcn" },
            kb_name: { type: "keyword" },
            document_name: { type: "keyword" },
          },
        },
      });
    }
  }

  private async waitReady(): Promise<void> {
    this.attach(); // 惰性自愈：调用方忘记 attach 时自动连接（幂等）
    if (this.ready) await this.ready;
  }

  /** 写入一批切片的词法索引（bulk，小数据量写完 refresh 立即可搜） */
  async addChunks(
    kbId: number,
    documentId: number,
    names: { kbName?: string; documentName?: string },
    chunks: Array<Pick<ChunkData, "index" | "content">>,
  ): Promise<void> {
    await this.waitReady();
    if (chunks.length === 0) return;
    await this.insertChunks(
      chunks.map((c) => ({
        index: c.index,
        content: c.content,
        kbId,
        documentId,
        kbName: names.kbName,
        documentName: names.documentName,
      })),
    );
  }

  private async insertChunks(chunks: LexicalChunk[]): Promise<void> {
    const client = this.client!;
    const BATCH = 500;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const operations = batch.flatMap((c) => [
        { index: { _index: LEXICAL_INDEX_NAME } },
        {
          document_id: c.documentId,
          kb_id: c.kbId,
          chunk_index: c.index,
          content: c.content,
          kb_name: c.kbName ?? null,
          document_name: c.documentName ?? null,
        },
      ]);
      const res = await client.bulk({ operations, refresh: true });
      if (res.errors) {
        const first = res.items.find((it) => it.index?.error)?.index?.error?.reason;
        throw new Error(`ES 写入失败: ${first ?? "未知错误"}`);
      }
    }
  }

  /** 删除某文档的全部词法索引 */
  async deleteByDocumentId(documentId: number): Promise<void> {
    await this.waitReady();
    await this.client!.deleteByQuery({
      index: LEXICAL_INDEX_NAME,
      query: { term: { document_id: documentId } },
      refresh: true,
    });
  }

  /** BM25 关键词检索（match 查询 = ES 默认 BM25 打分，kbId 过滤） */
  async search(query: string, options: { kbIds?: number[]; k?: number } = {}): Promise<RagSearchResult[]> {
    await this.waitReady();
    const { kbIds, k = 5 } = options;
    if (!query.trim()) return [];

    const res = await this.client!.search<LexicalHit>({
      index: LEXICAL_INDEX_NAME,
      size: k,
      track_scores: true,
      query: {
        bool: {
          filter: kbIds && kbIds.length > 0 ? [{ terms: { kb_id: kbIds } }] : [],
          must: [{ match: { content: query } }],
        },
      },
      _source: ["document_id", "kb_id", "chunk_index", "content", "kb_name", "document_name"],
    });

    return res.hits.hits.map((h) => {
      const s = h._source!;
      return {
        content: s.content,
        documentId: Number(s.document_id),
        kbId: Number(s.kb_id),
        kbName: s.kb_name ?? undefined,
        documentName: s.document_name ?? undefined,
        chunkIndex: Number(s.chunk_index),
        score: h._score ?? 0,
        matchType: "keyword" as const,
      };
    });
  }
}

/** 默认词法索引单例（与 ragService 共用） */
export const lexicalIndex = new LexicalIndexService();
