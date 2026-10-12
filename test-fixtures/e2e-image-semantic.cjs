// 端到端验证：loadPdf 全链路（Unstructured 云 + mupdf 探测 + 豆包视觉语义化）
// 配置从 apps/backend/.env 读取，避免硬编码密钥。
const fs = require("fs");
const path = require("path");

// 加载 .env 到 process.env（简单解析，不覆盖已存在的环境变量）
const envFile = path.resolve("C:/Users/ChenJiang/Desktop/langchain-rag/apps/backend/.env");
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}

const { loadPdf } = require("C:/Users/ChenJiang/Desktop/langchain-rag/packages/ai-engine/dist/index.js");

const pdf = "C:/Users/ChenJiang/Desktop/langchain-rag/test-fixtures/测试PDF-表格与流程图.pdf";

(async () => {
  console.log("IMAGE_VLM_PROVIDER:", process.env.IMAGE_VLM_PROVIDER);
  console.log("IMAGE_VLM_MODEL:", process.env.IMAGE_VLM_MODEL);
  console.log("IMAGE_VLM_API_URL:", process.env.IMAGE_VLM_API_URL || "(默认 ark)");
  console.log("API Key:", process.env.IMAGE_VLM_API_KEY ? `已配置 (${process.env.IMAGE_VLM_API_KEY.slice(0, 8)}...)` : "未配置");
  console.log("---\n解析中...\n");

  const docs = await loadPdf(pdf);
  const doc = docs[0];
  console.log("=== metadata ===");
  console.log(JSON.stringify(doc.metadata, null, 2));

  console.log("\n=== 含 [图片] 块的页面内容 ===");
  const lines = doc.pageContent.split("\n");
  let inBlock = false;
  for (const line of lines) {
    if (line.startsWith("[图片]")) inBlock = true;
    if (inBlock) console.log(line);
    if (inBlock && line.trim() === "") { inBlock = false; console.log("---"); }
  }
})();
