/** 切片数据（索引后返回给后端写 DB） */
export interface ChunkData {
  /** 切片文本内容 */
  content: string;
  /** 切片序号 */
  index: number;
  /** 估算 token 数 */
  tokenCount: number;
}

/** 结果的命中来源 */
export type RagMatchType = "semantic" | "keyword" | "both";

/** 检索结果 */
export interface RagSearchResult {
  /** chunk 文本内容 */
  content: string;
  /** 文档 ID */
  documentId: number;
  /** 知识库 ID */
  kbId: number;
  /** 知识库名称 */
  kbName?: string;
  /** 文档文件名 */
  documentName?: string;
  /** 切片在文档内的序号（用于混合检索时跨两路结果去重合并） */
  chunkIndex?: number;
  /**
   * 混合检索（统一模式）下是 RRF 融合分归一化到 0~1
   * （两路都排名第 1 ≈ 1.0，单路第一 ≈ 0.5）
   */
  score: number;
  /** 命中来源 */
  matchType: RagMatchType;
}

/** PGVectorStore 中存储的 metadata */
export interface ChunkMetadata {
  documentId: number;
  kbId: number;
  chunkIndex: number;
  /** 知识库名称（便于检索时直接返回，无需查 DB） */
  kbName?: string;
  /** 文档文件名 */
  documentName?: string;
}

/** 写入 ES 词法索引的切片（内部转换用） */
export interface LexicalChunk {
  index: number;
  content: string;
  kbId: number;
  documentId: number;
  kbName?: string;
  documentName?: string;
}

/** ES 文档行（_source 结构，字段用 snake_case 与索引 mapping 对应） */
export interface LexicalHit {
  document_id: number;
  kb_id: number;
  chunk_index: number;
  content: string;
  kb_name?: string | null;
  document_name?: string | null;
}
