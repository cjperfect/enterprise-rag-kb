import { readFileSync } from "fs";
import { PDFParse } from "pdf-parse";
import type { Document } from "@langchain/core/documents";
import type { PdfLoadOptions } from "../../interfaces/loader";
import { PDF_DIRECT_LIMIT_BYTES, ocrPdfPage, pageToText } from "./baidu";
import { parsePdfWithUnstructured, elementsToPageTexts } from "./unstructured";
import { detectPdfImageBlocks, isImageSemanticEnabled, semanticizePdfFigures } from "./image-semantic";

/**
 * PDF 解析编排层（Unstructured 版面分析 + 百度 OCR 智能路由）。
 *
 * 职责：决定每一页走「Unstructured 版面分析」还是「百度 OCR」，并组装最终 Document。
 * 能力拆分（pdf/ 目录共 3 个文件，按职责划分）：
 *   - loader.ts：编排 + 逐页路由判定（needOcrPage，纯函数可单测）
 *   - unstructured.ts：调 Unstructured Transform v2 云 API（官方托管），元素打标 + 表格结构化
 *   - baidu.ts：百度认证、接口调用、OCR 结果的版面重组（表格/标题/页眉页脚）
 *
 * 流程：
 *   1. pdf-parse 逐页提取文本（用于逐页路由判定 + Unstructured 失败时的回退文本）；
 *   2. 文本层页 → Unstructured 版面分析（v2 自动平衡策略，等效 hi_res 级）：
 *      标题/段落/表格/列表元素打标，表格输出行列结构化文本（保留文档结构，提升 RAG 检索精度）；
 *   3. 空页/乱码页/扫描页 → 百度「办公文档识别 doc_analysis_office」（layout_analysis），
 *      输出版面（标题/表格/阅读顺序）并剔除页眉/页脚/页码/脚注；
 *   4. Unstructured 服务不可用/超时 → 回退 pdf-parse 原始文本，解析链路不中断；
 *   5. 纯文本 PDF 全程不调 OCR（mode=text-layer）；纯扫描件全 OCR（mode=baidu-doc-analysis）；
 *      混合文档逐页路由（mode=mixed）。
 *
 * 说明：不用 LangChain PDFLoader 的 splitPages:true 做逐页判定，是因为它会把
 * 无文本的图片页过滤掉，导致页号错位、扫描页丢失；pdf-parse 的 getText() 按真实
 * 页码返回每一页（空页保留空串），页号与 OCR 队列严格对齐。
 *
 * 限制：doc_analysis_office 的 pdf_file 要求 base64 编码并 urlencode 后 ≤4M
 *   （原始文件约 2.5MB 以内）；超出且含扫描页的文件会报错，建议压缩/拆分。
 *
 * 依赖环境变量（apps/backend/.env）：
 *   BAIDU_OCR_API_KEY       百度智能云应用的 API Key
 *   BAIDU_OCR_SECRET_KEY    百度智能云应用的 Secret Key
 *   UNSTRUCTURED_API_KEY    Unstructured Transform v2 云 API key（transform.unstructured.io 控制台获取）
 */

/** 超出直传上限时的统一报错（「无法解析」与「含扫描页」两种场景复用同一提示） */
function throwOversizeError(reason: "无法本地解析文本" | "包含无文本层页面"): never {
  throw new Error(`PDF 文件超过 ${PDF_DIRECT_LIMIT_BYTES / 1024 / 1024}MB 且${reason}，` + `超出百度文档解析 pdf_file 直传上限（编码后 4M），请压缩或拆分后重试`);
}

// ==========================================================================
// 逐页路由判定（纯函数、无副作用，可独立单测）
// ==========================================================================

/** 本地提取文本达到该字符数才视为「有文本层」，否则按扫描页走 OCR */
const MIN_TEXT_CHARS = 20;
/** 页面提取文本中至少出现该数量的中文字符，才判定为有效中文文本层 */
const MIN_CJK_CHARS = 5;

/**
 * 判定某页是否应走 OCR：
 *   - 文本太少（空页/纯扫描页）→ OCR；
 *   - 有足够中文字符 → 有效文本层，本地提取；
 *   - 无中文时检查乱码特征：出现大量替换字符 U+FFFD，或
 *     「可读字符（中日韩/全角标点/ASCII）」占比过低 → 疑似字体编码异常，走 OCR；
 *   - 反之（无中文但可读字符占比高，如纯英文页）→ 按文本页处理，避免误 OCR 英文文档。
 */
export function needOcrPage(pageText: string): boolean {
  const text = pageText.trim();
  if (text.length < MIN_TEXT_CHARS) return true;

  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (cjkCount >= MIN_CJK_CHARS) return false;

  if ((text.match(/\uFFFD/g) ?? []).length / text.length > 0.1) return true;

  const usableRatio = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u3000-\u303f\uff00-\uffef\x20-\x7f]/g) ?? []).length / text.length;
  return usableRatio < 0.7;
}

// ==========================================================================
// 编排
// ==========================================================================

/** pdf-parse 逐页提取文本：按真实页码返回每一页（空页保留空串，页号与 OCR 队列对齐） */
async function extractLocalPageTexts(filePath: string): Promise<string[]> {
  const parser = new PDFParse({ data: new Uint8Array(readFileSync(filePath)) });
  try {
    const result = await parser.getText();
    return result.pages.map((p) => p.text.trim());
  } finally {
    await parser.destroy();
  }
}

/**
 * 本地表格探测：把 pdf-parse 回退文本里「Tab 对齐的连续行」识别为表格并转成 GFM。
 *
 * 背景：Unstructured 失败回退 pdf-parse 时，原始表格是 `项目 \t 参数` 这类 Tab 分隔文本，
 * 没有 `[表格]` 标记 → 切片层的表格豁免失效（表格仍会被按行切断）。
 * 这里在回退路径用轻量启发式补回标记：
 *   - 连续 ≥2 行含 Tab 分隔符 → 视为表格块；
 *   - 第一行当表头，输出 GFM（表头 + `| --- |` 分隔行 + 数据行），前置 `[表格]` 标记；
 *   - 不足 2 行或误判风险高的孤立 Tab 行保持原样（不强制转换）。
 * 启发式代价低（纯文本扫描），只在回退路径运行，不影响 Unstructured/OCR 的正常打标结果。
 */
export function markLocalTables(pageText: string): string {
  const lines = pageText.split("\n");
  const out: string[] = [];
  let table: string[] = [];

  const flushTable = () => {
    if (table.length >= 2) {
      // 转 GFM：第一行当表头，列数按最宽行补齐
      const rows = table.map((l) => l.split("\t").map((c) => c.trim()));
      const colCount = Math.max(...rows.map((r) => r.length));
      const fmt = (r: string[]) => "| " + Array.from({ length: colCount }, (_, i) => r[i] ?? "").join(" | ") + " |";
      out.push("[表格]");
      out.push(fmt(rows[0]));
      out.push("| " + Array.from({ length: colCount }, () => "---").join(" | ") + " |");
      for (const r of rows.slice(1)) out.push(fmt(r));
    } else {
      // 不足 2 行：保持原样，避免把正文里的孤立 Tab 行误转成表格
      for (const l of table) out.push(l);
    }
    table = [];
  };

  for (const line of lines) {
    if (line.includes("\t")) {
      table.push(line);
    } else {
      flushTable();
      out.push(line);
    }
  }
  flushTable();
  return out.join("\n");
}

/**
 * 标题层级规范化（清洗层，对三条 PDF 通道统一生效）：
 *
 * Unstructured/OCR 的 Title 输出都是扁平的 `## 标题`，且回退路径完全没有标题标记。
 * 这里按「编号 → 层级」规则把标题统一规范化，正文/表格/列表不受影响：
 *   - `一、安全须知`（或 `## 一、安全须知`）→ `## 安全须知`（章）
 *   - `1. 使用禁忌`            → `### 使用禁忌`（节）
 *   - `1.1 按键说明`           → `#### 按键说明`（小节）
 *   - 无编号的标题（`## 产品名称`）→ 保持原样
 *   - `（1）xxx` 序号段落 → 跳过（误判风险高）
 *   - 表格行 / 列表行 / 空行 → 跳过
 */
export function normalizeHeadings(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      const isMdHeading = /^#+\s+/.test(t);
      const body = isMdHeading ? t.replace(/^#+\s+/, "") : t;
      // 表格 / [表格] / 列表 / (1) 序号段落 → 不处理
      if (/^(\||\[表格\]|[-•*]\s)/.test(body)) return line;
      if (/^[（(]\s*\d+\s*[)）]/.test(body)) return line;
      // 标题文本判定：短（≤25 字符）、不以句号结尾、无句中逗号 ——
      // 区分「1. 节标题」（转层级）与「1. 有序步骤」（如「1. 清洁颈部皮肤并略微湿润…」，保留原样）
      const looksLikeHeadingText = (s2: string) => s2.length <= 25 && !/[。！？]$/.test(s2) && !/[,，；;：]/.test(s2);

      // 小节 1.1
      let m = body.match(/^(\d+\.\d+)[.、]?\s*(.+)$/); // 1.1 与 1.1、 与 1.1 空格 均视为小节
      if (m && looksLikeHeadingText(m[2])) return `#### ${m[2]}`;
      // 节 1.
      m = body.match(/^(\d+)[.、]\s*(.+)$/);
      if (m && looksLikeHeadingText(m[2])) return `### ${m[2]}`;
      // 章 一、
      m = body.match(/^([一二三四五六七八九十百]+)、\s*(.+)$/);
      if (m && looksLikeHeadingText(m[2])) return `## ${m[2]}`;
      return line;
    })
    .join("\n");
}

/**
 * 断行重组（回退路径）：pdf-parse 文本流按绘制顺序分行，中文 PDF 的行尾常把词/句从中间切断
 * （实测「恢复期患\n者」）。按中文排版规则把被硬换行切断的行接回：
 *
 * 合并条件（满足其一）：
 *   a) 行尾以「-」结尾且下一行以字母开头 → 英文连字符断词，删连字符合并（contin-\nued → continued）
 *   b) 下一行以标点开头（。！？；：，、」』））》等）→ 标点被切到行首，合并
 *   c) 行尾为文字（中/英）且无结束标点，下一行以文字/左括号开头 → 中文断行，合并
 *
 * 保护规则（绝不合并）：
 *   表格行（Tab 开头 / | 开头 / [表格] 标记）、标题（# 开头）、列表（- • * 开头）、空行；
 *   行尾已是句末标点（。！？；）视为完整句，不合并。
 * 仅作用于 pdf-parse 回退路径的文本层页；按页内处理，不跨页合并（页边界可能是页眉页脚）。
 */
export function reflowBrokenLines(text: string): string {
  // 先统一行尾：pdf-parse 可能输出 CRLF/CR，行尾残留 \r 会让行尾字符判定失效
  text = text.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const out: string[] = [];
  const protectedLine = /^\s*(#+\s|[-•*]\s|\||\[表格\])/;
  // 中文/数字章节标题行（一、二、… / 1. 2. …）——纯文本标题没有 # 前缀，但绝不能与正文合并，
  // 否则标题+首行会被拼成一行，导致后续断行配对错位（实测「患\n者」反而保留）
  const headingLine = /^\s*([一二三四五六七八九十百]+、|\d+[.、])/;

  for (let i = 0; i < lines.length; i++) {
    const prev = lines[i].trimEnd();
    const nextRaw = lines[i + 1];
    if (!nextRaw || nextRaw.trim() === "" || protectedLine.test(prev) || protectedLine.test(nextRaw) || headingLine.test(prev) || headingLine.test(nextRaw)) {
      out.push(lines[i]); // 保护行 / 无下一行 / 空行 → 原样保留
      continue;
    }
    const next = nextRaw.trimStart();
    const prevEnd = prev.slice(-1);
    const nextStart = next.slice(0, 1);

    // a) 英文连字符断词：删连字符合并
    if (prevEnd === "-" && /^[a-zA-Z]/.test(nextStart)) {
      out.push(prev.slice(0, -1) + next);
      i++; // 消费掉下一行
      continue;
    }
    // b) 行首标点（标点被切到下一行开头）
    if (/^[。！？；：，、」』））》]/.test(nextStart)) {
      out.push(prev + next);
      i++;
      continue;
    }
    // c) 中文/英文断行：行尾无结束标点且为文字，下一行以文字或左括号开头
    const isSentenceEnd = /[。！？；]$/.test(prevEnd);
    // 可接续：文字或非句末标点（逗号/顿号/冒号/闭合括号等，行尾出现这些说明句子未结束）
    const prevIsText = /[a-zA-Z\u4e00-\u9fa5」』））》：，、]$/.test(prevEnd);
    const nextIsText = /^[a-zA-Z\u4e00-\u9fa5(（《"“]/.test(nextStart);
    if (!isSentenceEnd && prevIsText && nextIsText) {
      out.push(prev + next);
      i++;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

/** 页码行特征：纯页码 / 第X页 / Page N / 短横包围数字 */
export function isPageNumberLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 12) return false;
  // 支持半角 - 与全角 — –（常见页码写法：- 2 - / — 2 — / – 3 –）
  return /^(第\s*[0-9一二三四五六七八九十百]+\s*页|Page\s*\d+|[-—–]\s*\d+\s*[-—–]|\d{1,4})$/i.test(t);
}

/**
 * 回退路径页眉页脚清理。
 *
 * 背景：Unstructured/百度 OCR 路径都按版面属性剔除了页眉页脚/页码，
 * 但 pdf-parse 回退文本没有版面信息，品牌页眉（如「breo · 倍轻松」）、
 * 页码会逐页混入正文。这里用两个轻量启发式：
 *   1. 跨页重复行（trim 后相同且出现 ≥2 页）且位于页首前 3 行 / 页尾后 3 行 → 页眉/页脚，剔除；
 *   2. 页边位置的页码行（纯数字 / 第X页 / Page N）→ 剔除。
 * 只在回退路径运行；不跨页重复的短行（如单页出现的「·使用说明书×1」）不会误伤。
 */
export function cleanFallbackPageTexts(pageTexts: string[]): string[] {
  if (pageTexts.length < 2) {
    return pageTexts.map((t) =>
      t
        .split("\n")
        .filter((l) => !isPageNumberLine(l))
        .join("\n"),
    );
  }

  // 跨页重复行统计（每页只计一次，避免页内重复行干扰）
  const lineCount = new Map<string, number>();
  for (const page of pageTexts) {
    const seen = new Set<string>();
    for (const line of page.split("\n")) {
      const k = line.trim();
      if (k && !seen.has(k)) {
        seen.add(k);
        lineCount.set(k, (lineCount.get(k) ?? 0) + 1);
      }
    }
  }
  const repeated = new Set([...lineCount].filter(([, n]) => n >= 2).map(([k]) => k));

  return pageTexts.map((page) => {
    const lines = page.split("\n");
    const keep: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const k = lines[i].trim();
      const atEdge = i <= 2 || i >= lines.length - 3; // 页首前 3 行 / 页尾后 3 行
      if (atEdge && repeated.has(k)) continue; // 跨页重复且位于页边 → 页眉/页脚
      if (atEdge && isPageNumberLine(k)) continue; // 页码
      keep.push(lines[i]);
    }
    return keep.join("\n");
  });
}

/**
 * 文本层页 → Unstructured 版面分析（v2 自动平衡策略：标题/段落/表格元素打标，表格行列结构化）。
 *
 * 只替换路由判定为「无需 OCR」的页；扫描页保留 pdf-parse 占位文本，稍后由百度 OCR 覆盖。
 * Unstructured 服务不可用/超时/异常时整体回退 pdf-parse 原始文本，保证解析链路不中断。
 *
 * 图片语义化（豆包视觉，见 image-semantic.ts）：Unstructured 返回的 Figure/Image 元素
 * 默认无文本会被丢弃；启用 IMAGE_VLM_PROVIDER=ark 后，按坐标从 PDF 裁剪出图 → 视觉模型
 * 判断是否结构图（流程图/架构图）→ 描述插回对应页末尾（页内精确位置属后续增强项）。
 */
async function applyUnstructuredToTextPages(
  filePath: string,
  buffer: Buffer,
  localPages: string[],
  scanPageNums: number[],
): Promise<{ pageTexts: string[]; images: { total: number; semanticized: number; skipped: number } }> {
  const pageTexts = localPages.slice();
  const scanPageSet = new Set(scanPageNums);
  let images = { total: 0, semanticized: 0, skipped: 0 };

  try {
    const elements = await parsePdfWithUnstructured(buffer, {
      strategy: "hi_res",
      languages: ["chi_sim"],
    });
    const structured = elementsToPageTexts(elements, localPages.length);

    // 图片语义化：仅启用（provider=ark）且有可裁剪图块时执行；失败不影响主线。
    // 图片来源 = mupdf DisplayList 探测内嵌图片块（Unstructured Transform v2 不返回 coordinates，
    // 无法用它定位裁剪；且其 Figure/Image 元素文本为空时会被丢弃，故独立探测）。
    if (isImageSemanticEnabled()) {
      try {
        // Unstructured 主判：收集它标出的图片元素页码（"哪里可能有图"）。
        // FigureCaption 图注不算图本身，不参与页码筛选（但仍参与下方 caption 关联）。
        const figurePages = new Set<number>();
        const captionsByPage = new Map<number, string[]>();
        for (const el of elements) {
          const elType = el.type ?? "";
          const figText = (el.text ?? "").trim();
          const p = el.metadata?.page_number ?? 1;
          if (elType === "Image" || elType === "Figure") {
            figurePages.add(p);
            if (figText) captionsByPage.set(p, [...(captionsByPage.get(p) ?? []), figText]);
          } else if (elType === "FigureCaption" && figText) {
            // 图注（图片正下方的独立文字元素）不在图片像素内，裁剪区不含它，必须显式关联；
            // 图注是作者写的图意说明，语义信号最强，优先放在最前。
            captionsByPage.set(p, [figText, ...(captionsByPage.get(p) ?? [])]);
          }
        }
        // mupdf 精确定位：只探测 Unstructured 判定的图页；一页都没标则全量兜底（防漏无文本纯符号图）
        const figures = await detectPdfImageBlocks(buffer, figurePages);
        if (figures.length > 0) {
          for (const f of figures) {
            const caps = captionsByPage.get(f.page);
            if (caps?.length) f.caption = caps.join(" / ");
          }

          const results = await semanticizePdfFigures(buffer, figures);
          images = { total: figures.length, semanticized: 0, skipped: 0 };
          for (const r of results) {
            if (r.skipped) {
              images.skipped++;
              continue;
            }
            // 扫描页最终由百度 OCR 覆盖（整页图内文字已可检索），不插回，避免语义化结果被丢弃
            if (scanPageSet.has(r.page)) continue;
            images.semanticized++;
            const caption = r.caption ? `：${r.caption}` : "";
            const block = `[图片]${r.imageType ? ` ${r.imageType}` : ""}${caption}\n${r.description}`.trim();
            if (!block) continue;
            const pageIdx = r.page - 1;
            structured[pageIdx] = structured[pageIdx] ? `${structured[pageIdx]}\n\n${block}` : block;
          }
        }
      } catch (err) {
        // 语义化整体意外失败（探测/渲染异常）：忽略，保持 Unstructured 原始结果
        console.warn(`[loadPdf] 图片语义化整体失败（已忽略）：${err instanceof Error ? err.message : String(err)}`);
      }
    }

    structured.forEach((text, i) => {
      // 扫描页最终由百度 OCR 覆盖，不采用 Unstructured 输出（其内置 OCR 中文质量不如百度）
      if (!scanPageSet.has(i + 1)) pageTexts[i] = text;
    });
  } catch (err) {
    console.warn(`[loadPdf] Unstructured 版面分析失败，文本层页回退本地提取：${err instanceof Error ? err.message : String(err)}`);
    // 回退 pdf-parse 的后处理（仅文本层页；扫描页保持百度 OCR 结果）：
    //   a) 本地探测 Tab 对齐表格并打标 → 表格豁免在回退路径生效
    //   b) 跨页页眉页脚/页码清理 → 品牌页眉、页码不再逐页混入正文
    for (let i = 0; i < pageTexts.length; i++) {
      if (!scanPageSet.has(i + 1)) {
        pageTexts[i] = markLocalTables(pageTexts[i]); // 表格探测（需 Tab 原文）
        pageTexts[i] = reflowBrokenLines(pageTexts[i]); // 断行重组（跳过表格/标题/列表）
      }
    }
    const cleaned = cleanFallbackPageTexts(pageTexts); // 页眉页脚/页码（在重组后，避免页眉行被接进正文）
    cleaned.forEach((t, i) => (pageTexts[i] = t));
  }
  return { pageTexts, images };
}

/** 本地文本层探测失败（无法解析）时的整份文档 OCR 通道 */
async function routeWholeOcr(filePath: string, buffer: Buffer, options?: PdfLoadOptions): Promise<Document[]> {
  if (buffer.byteLength > PDF_DIRECT_LIMIT_BYTES) {
    throwOversizeError("无法本地解析文本");
  }

  // 第一页调用同时返回 pdf_file_size 总页数，再逐页结构化识别
  const first = await ocrPdfPage(buffer);
  const pages = first.pdf_file_size ?? 1;
  const pageTexts = [pageToText(first)];
  for (let page = 2; page <= pages; page++) {
    pageTexts.push(pageToText(await ocrPdfPage(buffer, page)));
  }
  return buildDocument(filePath, pageTexts, { pages, ocrPages: pages, options });
}

/**
 * 智能路由解析 PDF：文本层页 → Unstructured 版面分析，扫描页 → 百度 OCR。
 * 纯文本 PDF 全程不调 OCR；纯扫描件全 OCR；混合文档逐页路由。
 *
 * @param filePath PDF 文件路径
 * @param options  可选：splitPages（语义对齐，当前统一返回单文档）、parsedItemSeparator
 */
export async function loadPdf(filePath: string, options?: PdfLoadOptions): Promise<Document[]> {
  const buffer = readFileSync(filePath);

  // 1) pdf-parse 逐页提取（路由判定 + Unstructured 失败回退都用它）
  let localPages: string[] = [];
  try {
    localPages = await extractLocalPageTexts(filePath);
  } catch (err) {
    // 解析失败时整份文档走 OCR（百度服务端自己栅格化，容错更强）
    console.warn(`[loadPdf] 本地文本层探测失败，整份文档走 OCR：${err instanceof Error ? err.message : String(err)}`);
  }

  if (localPages.length === 0) {
    return routeWholeOcr(filePath, buffer, options);
  }

  // 2) 逐页判断：有文本层的页保留本地文本，空页/乱码页/扫描页进入 OCR 队列
  const scanPageNums: number[] = [];
  localPages.forEach((text, i) => {
    if (needOcrPage(text)) scanPageNums.push(i + 1);
  });

  // 3) 文本层页 → Unstructured 版面分析（元素打标/表格结构化；失败回退本地文本）
  const { pageTexts, images } = await applyUnstructuredToTextPages(filePath, buffer, localPages, scanPageNums);

  if (scanPageNums.length === 0) {
    // 3a) 纯文本 PDF：不调 OCR，直接入库
    return buildDocument(filePath, pageTexts, { pages: localPages.length, ocrPages: 0, images, options });
  }

  // 3b) 存在扫描页：文件需在 doc_analysis_office 直传上限内
  if (buffer.byteLength > PDF_DIRECT_LIMIT_BYTES) {
    throwOversizeError("包含无文本层页面");
  }

  // 4) 扫描页逐页走 doc_analysis_office（结构化识别），其余页保留 Unstructured 结果
  for (const page of scanPageNums) {
    pageTexts[page - 1] = pageToText(await ocrPdfPage(buffer, page));
  }
  return buildDocument(filePath, pageTexts, {
    pages: localPages.length,
    ocrPages: scanPageNums.length,
    images,
    options,
  });
}

/** 组装最终 Document：多页加页码分隔，元数据记录路由模式与 OCR 页数 */
function buildDocument(
  filePath: string,
  pageTexts: string[],
  info: { pages: number; ocrPages: number; images?: { total: number; semanticized: number; skipped: number }; options?: PdfLoadOptions },
): Document[] {
  const { pages, ocrPages, images, options } = info;
  const mode = ocrPages === 0 ? "text-layer" : ocrPages === pages ? "baidu-doc-analysis" : "mixed";

  // 清洗统一出口：标题层级规范化（三条通道——Unstructured / 百度 OCR / pdf-parse 回退——都经过这里）
  const normalizedPages = pageTexts.map((t) => normalizeHeadings(t));
  const content = normalizedPages
    .map((text, i) => (pages > 1 ? `===== 第 ${i + 1} 页 =====\n${text}` : text))
    .filter((t) => t.trim().length > 0)
    .join("\n\n");

  return [
    {
      pageContent: content,
      metadata: {
        source: filePath,
        mode,
        pages,
        ocrPages,
        images, // 图片语义化统计：{total, semanticized, skipped}；未启用时为 {0,0,0}
        splitPages: options?.splitPages ?? false,
      },
    },
  ];
}
