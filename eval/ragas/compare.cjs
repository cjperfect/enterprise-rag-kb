/**
 * 对比评测：纯向量检索 vs 混合检索（向量 + BM25 RRF）
 *
 * 跑法：node eval/ragas/compare.cjs
 *
 * 对 golden/all-products.json 每题：
 *   - pure-vector：直接查 pgvector 表（embedding 余弦距离）
 *   - hybrid：ragService.search（向量 + ES BM25 + RRF）
 * 用同一套 scorer 打分，输出 Recall@5 / MRR / nDCG 对比表。
 */
const fs = require("fs");
const path = require("path");

// 加载 .env
const envPath = path.join(__dirname, "..", "..", "apps", "backend", ".env");
for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { ragService } = require("../../packages/ai-engine/dist/index.js");
const { scoreItem, aggregate } = require("../scorer.cjs");

const KB_IDS = [1];
const K = 5;

async function pureVectorSearch(query, k) {
  // 复用 ragService 的 PGVectorStore，直接做纯向量相似度检索（不走 RRF、不走 ES）
  const store = await ragService.getStore();
  const filter = { kbId: { in: KB_IDS } };
  const results = await store.similaritySearchWithScore(query, k, filter);
  return results.map(([doc, score]) => ({
    content: doc.pageContent,
    documentName: doc.metadata?.documentName ?? "",
    documentId: doc.metadata?.documentId,
    kbId: doc.metadata?.kbId,
    chunkIndex: doc.metadata?.chunkIndex,
    score,
  }));
}

async function hybridSearch(query, k) {
  return await ragService.search(query, { kbIds: KB_IDS, k });
}

async function runMode(modeFn, items) {
  const scored = [];
  for (const item of items) {
    const results = await modeFn(item.query, K);
    scored.push(scoreItem(item, results, [K]));
  }
  return scored;
}

function fmt(s) {
  return {
    recall: s[`recall@${K}`],
    mrr: s.mrr,
    ndcg: s.ndcg,
    hits: `${s.hitCount}/${s.questions}`,
  };
}

async function main() {
  const items = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "golden", "all-products.json"), "utf-8")
  );
  // 排除陷阱题（它们的"命中"定义相反，单独算）
  const normal = items.filter((i) => i.type !== "adversarial");
  const adv = items.filter((i) => i.type === "adversarial");

  console.log(`▶ 共 ${items.length} 题（正常 ${normal.length}，陷阱 ${adv.length}）\n`);

  console.log("▶ 跑纯向量检索...");
  const pureScored = await runMode(pureVectorSearch, normal);
  const pureAgg = aggregate(pureScored, [K]);
  console.log(`  Recall@${K}=${pureAgg[`recall@${K}`]}  MRR=${pureAgg.mrr}  nDCG=${pureAgg.ndcg}  命中 ${pureAgg.hitCount}/${pureAgg.questions}`);

  console.log("\n▶ 跑混合检索（向量 + BM25 RRF）...");
  const hybridScored = await runMode(hybridSearch, normal);
  const hybridAgg = aggregate(hybridScored, [K]);
  console.log(`  Recall@${K}=${hybridAgg[`recall@${K}`]}  MRR=${hybridAgg.mrr}  nDCG=${hybridAgg.ndcg}  命中 ${hybridAgg.hitCount}/${hybridAgg.questions}`);

  // 陷阱题防护率
  console.log("\n▶ 跑陷阱题防护（混合检索）...");
  let advPass = 0;
  for (const item of adv) {
    const results = await hybridSearch(item.query, K);
    // 陷阱题正确表现 = 没有命中 expect_doc 的切片
    const hit = results.some(
      (r) => r.documentName && item.expect_doc && r.documentName.includes(item.expect_doc)
    );
    if (!hit) advPass++;
    console.log(`  [${item.id}] ${hit ? "🚨 被误导" : "✅ 未被误导"}: ${item.query}`);
  }

  // 汇总
  const delta = (hybridAgg[`recall@${K}`] - pureAgg[`recall@${K}`]).toFixed(3);
  const deltaPct = (delta * 100).toFixed(1);
  console.log("\n" + "=".repeat(60));
  console.log("对比结果（正常题，n=" + normal.length + "）");
  console.log("=".repeat(60));
  console.log(`{"纯向量 Recall@${K}"   : ${pureAgg[`recall@${K}`]}`);
  console.log(`  混合 Recall@${K}"   : ${hybridAgg[`recall@${K}`]}`);
  console.log(`  提升              : ${delta}（+${deltaPct}个百分点）`);
  console.log(`  纯向量 MRR        : ${pureAgg.mrr}`);
  console.log(`  混合 MRR          : ${hybridAgg.mrr}`);
  console.log(`  纯向量 nDCG       : ${pureAgg.ndcg}`);
  console.log(`  混合 nDCG         : ${hybridAgg.ndcg}`);
  console.log(`  陷阱题防护        : ${advPass}/${adv.length}`);

  // 写到报告
  const today = new Date().toISOString().slice(0, 10);
  const reportDir = path.join(__dirname, "..", "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const out = path.join(reportDir, `retrieval-compare-${today}.md`);
  const lines = [
    `# 检索方式对比报告 ${today}`,
    "",
    `- 题目数：正常 ${normal.length} 题 + 陷阱 ${adv.length} 题`,
    `- k = ${K}`,
    "",
    "## 汇总",
    "",
    "| 指标 | 纯向量 | 混合（向量+BM25 RRF） | 提升 |",
    "| --- | --- | --- | --- |",
    `| Recall@${K} | ${pureAgg[`recall@${K}`]} | ${hybridAgg[`recall@${K}`]} | +${deltaPct}% |`,
    `| MRR | ${pureAgg.mrr} | ${hybridAgg.mrr} | |`,
    `| nDCG | ${pureAgg.ndcg} | ${hybridAgg.ndcg} | |`,
    `| 命中 | ${pureAgg.hitCount}/${pureAgg.questions} | ${hybridAgg.hitCount}/${hybridAgg.questions} | |`,
    `| 陷阱题防护 | - | ${advPass}/${adv.length} | |`,
  ];
  fs.writeFileSync(out, lines.join("\n"), "utf-8");
  console.log(`\n报告已写入: ${out}`);
}

main().catch((e) => {
  console.error("对比评测失败:", e);
  process.exit(1);
});
