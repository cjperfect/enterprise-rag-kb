/**
 * ragas 数据收集脚本
 *
 * 跑法：node eval/ragas/collect.cjs
 *
 * 对 golden/ 下每道题真实跑一遍 AiEngine.streamEvents，收集：
 *   - question   题目原文
 *   - answer     LLM 最终回答（token 累积）
 *   - contexts    本轮检索到的切片文本列表（最后一个 knowledge_search 事件的 docs）
 *   - ground_truth 标准答案（从 expect_keywords 拼出的粗糙版）
 *   - adversarial 是否陷阱题
 *
 * 输出：eval/ragas/dataset.jsonl，供 score.py 用 ragas 打分。
 *
 * 前置：
 *   - PG + ES 起着、Ollama 起着（见 apps/backend/.env）
 *   - packages/ai-engine 已 build（dist/ 存在）
 *   - 知识库 kbIds 里已有索引好的文档
 */
const fs = require("fs");
const path = require("path");

// 1) 加载 backend .env（与 runner.cjs / gen-eval.cjs 同一套）
const envPath = path.join(__dirname, "..", "..", "apps", "backend", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
} else {
  console.warn(`[warn] 找不到 ${envPath}，用环境变量现值跑`);
}

const { AiEngine } = require("../../packages/ai-engine/dist/index.js");
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf-8"));
const kbIds = config.kbIds ?? [1];

// 2) 加载 golden QA 集
function loadGolden() {
  const dir = path.join(__dirname, "..", "golden");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const all = [];
  for (const f of files) {
    const items = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
    all.push({ file: f, items });
  }
  return all;
}

// 3) 对单题跑一遍 streamEvents，收集 answer + contexts
async function runOne(ai, item) {
  let answer = "";
  let lastDocs = [];
  try {
    for await (const ev of ai.streamEvents(item.query, { kbIds })) {
      if (ev.type === "token") {
        answer += ev.content;
      } else if (ev.type === "knowledge_search" && Array.isArray(ev.docs) && ev.docs.length > 0) {
        // 模型可能多次检索，docs 是累计去重的；取最后一次事件里的完整列表
        lastDocs = ev.docs;
      }
    }
  } catch (e) {
    answer = `[调用失败] ${e.message}`;
  }

  const contexts = lastDocs.map((d) => d.content).filter(Boolean);

  // ground_truth：golden 集没有标准答案全文，用 expect_keywords 拼一个粗糙版
  let groundTruth;
  if (item.type === "adversarial") {
    groundTruth = "知识库中没有相关信息，应明确告知未找到并建议联系客服，不得编造具体参数或电话。";
  } else {
    const kws = item.expect_keywords ?? [];
    groundTruth = kws.length > 0
      ? `答案应包含关键信息：${kws.join("、")}。`
      : "答案应基于知识库内容准确回答。";
  }

  return {
    question: item.query,
    answer: answer.trim(),
    contexts,
    ground_truth: groundTruth,
    adversarial: item.type === "adversarial",
    id: item.id,
    type: item.type,
  };
}

async function main() {
  const golden = loadGolden();
  if (golden.length === 0) {
    console.error("golden/ 下没有 .json，先建 QA 集");
    process.exit(1);
  }

  const ai = new AiEngine();
  const rows = [];
  for (const { items } of golden) {
    for (const item of items) {
      process.stdout.write(`[${item.id}] ${item.query.slice(0, 30)}... `);
      const row = await runOne(ai, item);
      console.log(
        `answer=${row.answer.length}字, contexts=${row.contexts.length}片`
      );
      rows.push(row);
    }
  }

  const out = path.join(__dirname, "dataset.jsonl");
  fs.writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n"), "utf-8");
  console.log(`\n已写入 ${rows.length} 条到 ${out}`);

  // 陷阱题单独汇总一下召回情况，人工扫一眼
  const adv = rows.filter((r) => r.adversarial);
  if (adv.length > 0) {
    console.log("\n陷阱题召回情况（contexts 应为空或不含相关内容）：");
    for (const r of adv) {
      console.log(`  [${r.id}] contexts=${r.contexts.length}片  answer=${r.answer.slice(0, 60)}...`);
    }
  }
}

main().catch((e) => {
  console.error("collect 失败:", e);
  process.exit(1);
});
