/**
 * 一次性存量迁移：PG 向量表 → Elasticsearch 词法索引
 *
 * 背景：BM25 词法路从「PG 手写 SQL」迁到 ES 后，ES 索引为空，
 * 老文档（向量表里已有）搜不到关键词。本脚本把 langchain_pg_embedding
 * 里的 content + metadata 按文档分组回填进 ES（复用 ai-engine 的
 * LexicalIndexService，分词/字段与运行时写入完全一致）。
 *
 * 用法（项目根目录）：
 *   pnpm --filter backend tsx scripts/es-backfill.mjs
 *   # 或直接 node scripts/es-backfill.mjs（需已构建 ai-engine dist）
 *
 * 依赖环境变量：DATABASE_URL、ES_URL（默认 http://localhost:9200）
 */
import { Pool } from "pg";
import { lexicalIndex } from "@langchain-rag/ai-engine";

/** 向量表名（PGVectorStore 默认，未从 ai-engine 导出，此处与 runtime 保持一致） */
const RAG_TABLE_NAME = "langchain_pg_embedding";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // 统计 ES 现状
  lexicalIndex.attach();
  const res = await pool.query(
    `SELECT content, metadata FROM ${RAG_TABLE_NAME} WHERE (metadata->>'documentId') IS NOT NULL`,
  );
  const rows = res.rows;
  console.log(`PG 向量表存量切片: ${rows.length} 条`);

  // 按 (documentId, kbId) 分组，保持 chunkIndex 顺序
  const docs = new Map();
  for (const row of rows) {
    const m = row.metadata;
    if (m.documentId == null || m.kbId == null || m.chunkIndex == null || !row.content) continue;
    const key = `${m.documentId}`;
    if (!docs.has(key)) {
      docs.set(key, {
        kbId: Number(m.kbId),
        documentId: Number(m.documentId),
        kbName: m.kbName,
        documentName: m.documentName,
        chunks: [],
      });
    }
    docs.get(key).chunks.push({ index: Number(m.chunkIndex), content: row.content });
  }

  let total = 0;
  for (const doc of docs.values()) {
    doc.chunks.sort((a, b) => a.index - b.index);
    await lexicalIndex.addChunks(doc.kbId, doc.documentId, {
      kbName: doc.kbName,
      documentName: doc.documentName,
    }, doc.chunks);
    total += doc.chunks.length;
    console.log(`  文档 #${doc.documentId}（kb #${doc.kbId}）写入 ${doc.chunks.length} 片`);
  }
  console.log(`回填完成，共写入 ${total} 片`);
  await pool.end();
}

main().catch((e) => {
  console.error("回填失败:", e.message ?? e);
  process.exit(1);
});
