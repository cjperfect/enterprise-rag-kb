/**
 * 生成层评测：真实跑 chat 链路，判定 LLM 回答质量
 *
 * 跑法：node eval/gen-eval.cjs
 *
 * 判定规则（不烧 LLM-judge，用关键词规则，结果稳定）：
 * - 正常题（type != adversarial）：回答里包含 expect_keywords 任一 → 答对；否则答错
 * - 陷阱题（adversarial）：回答含"暂不知晓"/"联系客服" → 正确拒答；
 *                          否则（给了具体保修年限/电话等）→ 幻觉硬编
 *
 * 前置：ollama 起着（LLM_PROVIDER=ollama，qwen3.5:0.8b）、PG 起着、.env 配好
 */
const fs = require("fs");
const path = require("path");

// 加载 backend .env
const envPath = path.join(__dirname, "..", "apps", "backend", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const { AiEngine } = require("../packages/ai-engine/dist/index.js");
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf-8"));

// 拒答话术关键词（prompt 里要求的固定回复）
const REFUSAL_PATTERNS = ["暂不知晓", "联系客服", "联系售后", "没有相关", "未提及", "知识库中没有"];

function judge(item, answer) {
  const ans = answer || "";
  // 归一化：去所有空白（全角/半角空格），避免"2.5 小时" vs "2.5小时"误判
  const norm = (s) => s.replace(/[\s\u3000]+/g, "");
  const ansNorm = norm(ans);
  if (item.type === "adversarial") {
    // 正确：拒答话术
    const refused = REFUSAL_PATTERNS.some((p) => ans.includes(p));
    // 幻觉特征：给了具体保修年限 / 电话号码
    const hallucinated =
      /保修[^。]{0,20}[一二三四五六七八九十\d]+\s*年/.test(ans) ||
      /\d{3,4}[--\s]?\d{7,8}/.test(ans);
    if (refused && !hallucinated) return { pass: true, label: "✅ 正确拒答" };
    if (hallucinated) return { pass: false, label: "🚨 幻觉硬编" };
    if (!refused) return { pass: false, label: "🚨 未拒答（直接答了）" };
    return { pass: false, label: "⚠️ 不确定" };
  }
  // 正常题：归一化后回答包含任一 expect_keywords
  const hit = (item.expect_keywords || []).some((kw) => ansNorm.includes(norm(kw)));
  return hit
    ? { pass: true, label: "✅ 答对" }
    : { pass: false, label: "❌ 未命中答案" };
}

async function main() {
  const goldenFile = path.join(__dirname, "golden", "n6mini.json");
  const items = JSON.parse(fs.readFileSync(goldenFile, "utf-8"));
  const ai = new AiEngine();

  const results = [];
  for (const item of items) {
    process.stdout.write(`[${item.id}] ${item.query.slice(0, 30)}... `);
    let answer = "";
    try {
      answer = await ai.chat(item.query, { kbIds: config.kbIds });
    } catch (e) {
      answer = `[调用失败] ${e.message}`;
    }
    const j = judge(item, answer);
    console.log(j.label);
    results.push({ item, answer, ...j });
  }

  // 汇总
  const normal = results.filter((r) => r.item.type !== "adversarial");
  const adv = results.filter((r) => r.item.type === "adversarial");
  const normalPass = normal.filter((r) => r.pass).length;
  const advPass = adv.filter((r) => r.pass).length;

  // 出报告
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push(`# 生成层评测报告 ${today}`);
  lines.push("");
  lines.push(`- 模型：${process.env.LLM_PROVIDER === "ollama" ? `ollama/${process.env.OLLAMA_MODEL}` : process.env.LLM_PROVIDER}`);
  lines.push(`- 正常题答对：${normalPass}/${normal.length}`);
  lines.push(`- 陷阱题正确拒答：${advPass}/${adv.length}`);
  lines.push("");
  lines.push("## 逐题结果");
  lines.push("");
  lines.push("| ID | 类型 | 问题 | 判定 | 回答摘要 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const r of results) {
    const summary = r.answer.replace(/\|/g, "∣").replace(/\n/g, " ").slice(0, 80);
    lines.push(`| ${r.item.id} | ${r.item.type} | ${r.item.query} | ${r.label} | ${summary} |`);
  }
  lines.push("");
  lines.push("## 答错 / 幻觉详情");
  lines.push("");
  for (const r of results.filter((x) => !x.pass)) {
    lines.push(`### ${r.item.id} [${r.item.type}] ${r.item.query}`);
    lines.push(`- 判定：${r.label}`);
    lines.push(`- 期望关键词：${(r.item.expect_keywords || []).join(", ") || "（应拒答）"}`);
    lines.push(`- 实际回答：`);
    lines.push("```");
    lines.push(r.answer);
    lines.push("```");
    lines.push("");
  }

  const out = path.join(__dirname, "reports", `gen-${today}.md`);
  fs.writeFileSync(out, lines.join("\n"), "utf-8");
  console.log(`\n正常题答对 ${normalPass}/${normal.length}，陷阱题正确拒答 ${advPass}/${adv.length}`);
  console.log(`报告：${out}`);
}

main().catch((e) => {
  console.error("生成层评测失败:", e);
  process.exit(1);
});
