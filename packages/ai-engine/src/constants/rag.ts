/** PGVectorStore 表名 */
export const RAG_TABLE_NAME = "langchain_pg_embedding";

/** ES 词法索引名（BM25 路已从 PG 旁表迁到 Elasticsearch，见 bm25.ts） */
export const LEXICAL_INDEX_NAME = "rag_bm25_index";

/** 向量维度（qwen3-embedding:0.6b 默认 1024） */
export const RAG_EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS ?? "1024");
