/**
 * RAG 评测主管道（独立脚本，不依赖 backend/frontend 起着）
 *
 * 跑法：
 *   node eval/runner.cjs                # 跑 config.json 里所有组合
 *   node eval/runner.cjs hybrid-k5      # 只跑指定名字的组合
 *
 * 前置：
 *   - PG 容器起着（DATABASE_URL 指向的库）
 *   - apps/backend/.env 配好（embedding key / PG 连接）
 *   - 目标知识库（config.kbIds）里已有已索引的文档
 *
 * 流程：读 golden/*.json → 按 config.runs 逐组调 ragService.search → scorer 打分 → 出 markdown 报告
 */
const fs = require("fs");
const path = require("path");

// 1) 手动加载 backend 的 .env（不依赖 dotenv 包）
const envPath = path.join(__dirname, "..", "apps", "backend", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

// 2) 引入 ai-engine 的 ragService（复用现有检索，不重造）
const { ragService } = require("../packages/ai-engine/dist/index.js");
const { scoreItem, aggregate } = require("./scorer.cjs");

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf-8"));

// 3) 加载 golden QA 集（golden/ 下所有 .json）
function loadGolden() {
  const dir = path.join(__dirname, "golden");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const all = [];
  for (const f of files) {
    const items = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
    all.push({ file: f, items });
  }
  return all;
}

// 4) 跑一组配置
async function runOne(run, golden) {
  // 每个 run 只算自己 k 的 Recall —— 它物理上就只检索了 top-k，
  // 不存在"第 k+1 名"，横向合并 @3/@5/@8 会造成误导（hybrid-k3 显示 Recall@5）
  const ks = [run.k];
  const scored = [];
  for (const { items } of golden) {
    for (const item of items) {
      const results = await ragService.search(item.query, {
        kbIds: config.kbIds,
        k: run.k,
      });
      scored.push(scoreItem(item, results, ks));
    }
  }
  return { run, scored, ks };
}

// 5) 出 markdown 报告
function renderReport(results, golden) {
  const today = new Date().toISOString().slice(0, 10);
  const totalQ = golden.reduce((s, g) => s + g.items.length, 0);
  const advTotal = golden.reduce(
    (s, g) => s + g.items.filter((i) => i.type === "adversarial").length,
    0,
  );
  const lines = [];
  lines.push(`# RAG 评测报告 ${today}`);
  lines.push("");
  lines.push(`- 语料：${golden.map((g) => g.file).join(", ")}`);
  lines.push(`- 题目数：${totalQ}（含 ${advTotal} 道陷阱题）`);
  lines.push(`- 知识库：kbIds = ${JSON.stringify(config.kbIds)}`);
  lines.push("");

  // 汇总表：每行只展示该配置自己 k 的 Recall
  lines.push("## 汇总");
  lines.push("");
  const header = ["配置", "Recall", "MRR", "nDCG", "命中数", "陷阱题防护"];
  lines.push("| " + header.join(" | ") + " |");
  lines.push("| " + header.map(() => "---").join(" | ") + " |");
  for (const { run, scored, ks } of results) {
    const agg = aggregate(scored, ks);
    const advPassed = scored.filter((s) => s.type === "adversarial" && s.hit).length;
    const advCount = scored.filter((s) => s.type === "adversarial").length;
    const row = [
      `${run.name} (${run.mode})`,
      `@${run.k} = ${agg[`recall@${run.k}`]}`,
      agg.mrr,
      agg.ndcg,
      `${agg.hitCount}/${agg.questions}`,
      advCount ? `${advPassed}/${advCount}` : "-",
    ];
    lines.push("| " + row.join(" | ") + " |");
  }
  lines.push("");

  // 真未命中/弱命中（排除陷阱题 —— 陷阱题未命中反而是正确的）
  lines.push("## 真未命中题 / 弱命中题（不含陷阱题）");
  lines.push("");
  for (const { run, scored } of results) {
    const real = scored.filter((s) => s.type !== "adversarial");
    const misses = real.filter((s) => !s.hit);
    const weak = real.filter((s) => s.hit && s.hitRank >= 2);
    lines.push(`### ${run.name}`);
    if (misses.length === 0 && weak.length === 0) {
      lines.push("- 全部命中且排名靠前");
    }
    for (const s of misses) {
      lines.push(`- ❌ 未命中 [${s.type}] ${s.query}`);
    }
    for (const s of weak) {
      lines.push(`- ⚠️ 排名靠后（#${s.hitRank + 1}）[${s.type}] ${s.query}`);
    }
    lines.push("");
  }

  // 幻觉防护：陷阱题单独看
  lines.push("## 幻觉防护（陷阱题：文档里没有答案）");
  lines.push("");
  lines.push("正确表现 = 未召回同文档切片；被误导召回 = 幻觉，需关注。");
  lines.push("");
  for (const { run, scored } of results) {
    const advs = scored.filter((s) => s.type === "adversarial");
    lines.push(`### ${run.name}`);
    if (advs.length === 0) {
      lines.push("- 无题");
    }
    for (const s of advs) {
      lines.push(s.hit
        ? `- ✅ 通过（未被误导）：${s.query}`
        : `- 🚨 被误导召回：${s.query}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  const onlyName = process.argv[2];
  const golden = loadGolden();
  if (golden.length === 0) {
    console.error("golden/ 下没有 .json，先建 QA 集");
    process.exit(1);
  }

  const runs = onlyName ? config.runs.filter((r) => r.name === onlyName) : config.runs;
  if (runs.length === 0) {
    console.error(`config.runs 里找不到 ${onlyName}`);
    process.exit(1);
  }

  const results = [];
  for (const run of runs) {
    console.log(`▶ 跑 ${run.name} (${run.mode}, k=${run.k}) ...`);
    const r = await runOne(run, golden);
    const agg = aggregate(r.scored, r.ks);
    console.log(`  Recall@${run.k}=${agg[`recall@${run.k}`]} MRR=${agg.mrr} 命中 ${agg.hitCount}/${agg.questions}`);
    results.push(r);
  }

  const report = renderReport(results, golden);
  const reportDir = path.join(__dirname, "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const out = path.join(reportDir, `${new Date().toISOString().slice(0, 10)}.md`);
  fs.writeFileSync(out, report, "utf-8");
  console.log(`\n报告已写入: ${out}`);
}

main().catch((e) => {
  console.error("评测失败:", e);
  process.exit(1);
});
