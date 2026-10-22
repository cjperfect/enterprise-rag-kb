import type { Document } from "@langchain/core/documents";
import { loadPdf } from "./pdf/loader";
import { loadMarkdown } from "./markdown/loader";

/**
 * 文档解析结果统一清洗（对所有 Loader 的输出生效，md / pdf 文本层 / OCR 一视同仁）：
 *
 * 1. CRLF → LF：Windows 上产出的文档（用户手写的 .md、部分生成型 PDF 文本层）
 *    行尾常为 \r\n。RecursiveCharacterTextSplitter 的第一分隔符是 "\n\n"，
 *    对 \r\n\r\n 匹配不到，会回退到 "\n" 把段落切碎，\r 也会残留在切片内容里。
 *    统一成 \n 后段落边界、切片质量、前端渲染都一致。
 * 2. 去 BOM：UTF-8 BOM（\uFEFF）常出现在文件开头（Windows 记事本/部分编辑器导出），
 *    不处理会混进第一个切片，影响向量化与检索。只在文档首片去除。
 *
 * 幂等：CRLF→LF 与去 BOM 重复执行无副作用，编辑链路先清洗入库、reindexDocument 再清洗切片，不会二次污染。
 *
 * @param content 解析出的原始文本
 * @param isFirstPage 是否是该文档的第一片（只对首片去 BOM）
 */
export function normalizeParsedText(content: string, isFirstPage: boolean): string {
  let text = content.replace(/\r\n/g, "\n");
  if (isFirstPage) text = text.replace(/^\uFEFF/, "");
  return text;
}

/**
 * 文档解析统一入口：backend 只需传入文件路径，内部按扩展名路由到对应 Loader。
 *
 * 类型路由是 ai-engine 的领域知识（支持哪些类型、各类型怎么解析），
 * 不暴露给 backend —— 后端不再需要自己判断 pdf/md 并挑选 loader。
 * 解析完成后统一走 normalizeParsedText 清洗，保证进入切片前的文本格式一致。
 *
 * @param filePath 待解析文件路径（带扩展名）
 * @returns fileType（小写扩展名，供入库记录）+ 解析后的 Document 列表
 */
export async function parseDocument(filePath: string): Promise<{ fileType: string; docs: Document[] }> {
  const fileType = filePath.split(".").pop()?.toLowerCase() ?? "";

  let docs: Document[];
  switch (fileType) {
    case "pdf":
      docs = await loadPdf(filePath, { splitPages: false });
      break;
    case "txt":
    case "markdown":
    case "md":
      docs = await loadMarkdown(filePath);
      break;
    default:
      throw new Error(`暂不支持的文件类型：.${fileType}（当前支持 pdf / md）`);
  }

  // 统一清洗：CRLF→LF + 去 BOM（修改的是同一批 Document 对象，直接写回 pageContent）
  docs.forEach((doc, i) => {
    doc.pageContent = normalizeParsedText(doc.pageContent, i === 0);
  });

  return { fileType, docs };
}
