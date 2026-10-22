import { readFile } from "node:fs/promises";
import { Document } from "@langchain/core/documents";

/**
 * Markdown 解析：按 UTF-8 读取 .md 文件，返回单个 Document。
 *
 * 与纯文本解析行为一致（不做渲染/结构提取），RAG 切片阶段再由
 * RecursiveCharacterTextSplitter 按段落/标题切分，因此这里不需要
 * 额外的 Markdown 结构化处理。
 *
 * 注意：CRLF 行尾与 BOM 等编码脏数据不在此处理，由统一入口
 * parseDocument 的 normalizeParsedText 统一清洗（一处覆盖 md/pdf/OCR）。
 *
 * @param filePath Markdown 文件路径
 */
export async function loadMarkdown(filePath: string): Promise<Document[]> {
  const content = await readFile(filePath, "utf-8");
  return [
    new Document({
      pageContent: content,
      metadata: { source: filePath },
    }),
  ];
}
