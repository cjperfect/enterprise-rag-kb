// 临时验证：mupdf 探测 + Unstructured 云识别（key 从 .env 读取，不硬编码）
const { detectPdfImageBlocks, parsePdfWithUnstructured } = require("C:/Users/ChenJiang/Desktop/langchain-rag/packages/ai-engine/dist/index.js");
const fs = require("fs");

// 从 apps/backend/.env 读取 UNSTRUCTURED_API_KEY
const env = fs.readFileSync("C:/Users/ChenJiang/Desktop/langchain-rag/apps/backend/.env", "utf8");
const m = env.match(/^UNSTRUCTURED_API_KEY=(.+)$/m);
if (!m) { console.error("未找到 UNSTRUCTURED_API_KEY"); process.exit(1); }
process.env.UNSTRUCTURED_API_KEY = m[1].trim();

const buf = fs.readFileSync("C:/Users/ChenJiang/Desktop/langchain-rag/test-fixtures/测试PDF-表格与流程图.pdf");

(async () => {
  const figs = await detectPdfImageBlocks(buf);
  console.log("=== mupdf 探测图块 ===");
  for (const f of figs) {
    console.log(`页 ${f.page}: ${(f.bbox.x1 - f.bbox.x0).toFixed(0)}x${(f.bbox.y1 - f.bbox.y0).toFixed(0)} pt`);
  }
  if (figs.length === 0) console.log("（未探测到图块）");

  try {
    const els = await parsePdfWithUnstructured(buf, {});
    const byType = {};
    for (const e of els) byType[e.type] = (byType[e.type] ?? 0) + 1;
    console.log("\n=== Unstructured 元素类型分布 ===");
    console.log(JSON.stringify(byType, null, 2));
    console.log("\n=== 图片相关元素样本 ===");
    for (const e of els) {
      if (["Image", "Figure", "FigureCaption", "Table"].includes(e.type)) {
        console.log(`--- ${e.type} (p${e.metadata?.page_number ?? "?"}):`, (e.text ?? "").slice(0, 100) || "(无文本)");
      }
    }
  } catch (err) {
    console.error("\nUnstructured 调用失败:", err.message);
  }
})();
