/**
 * Unstructured Transform v2 客户端（官方托管 API）：负责「版面分析 + 元素打标」。
 *
 * 只负责跟 Unstructured 云服务打交道：上传 PDF、接收元素列表、把元素按页重组为标准化文本。
 * 路由编排见 loader.ts（文本层页 → Unstructured，扫描页 → 百度 OCR）。
 *
 * 实现方式：官方 JS SDK `unstructured-transform-client`（内部封装 api/v2 的
 *   创建任务 → 轮询 → 下载结果 三步，输出结构化元素 JSON）。
 *
 * 依赖环境变量（apps/backend/.env）：
 *   UNSTRUCTURED_API_KEY   transform.unstructured.io 控制台「API Keys」里复制的 key（必填）
 *   UNSTRUCTURED_API_URL   可选，默认 https://transform.unstructured.io
 *
 * 注意：Transform v2 是「一个文档进去，结构化输出回来」的新一代接口，不再需要手动指定
 *   strategy（vlm/hi_res/fast），由服务端按 profile 自动平衡；中文自动识别，无需 languages 参数。
 *   与旧版 Partition Endpoint（api.unstructuredapp.io/general/v0/general）不兼容，key 也不通用。
 */

/** 轮询解析结果的总超时（v2 走异步任务，给足时间） */
const UNSTRUCTURED_TIMEOUT_MS = 120_000;
/** 轮询间隔 */
const UNSTRUCTURED_POLL_INTERVAL_MS = 2_000;

/** Unstructured 元素类型（常见子集） */
export type UnstructuredElementType = string;

export interface UnstructuredElement {
  element_id?: string;
  type?: UnstructuredElementType;
  text?: string;
  metadata?: {
    page_number?: number;
    /** Table 类型特有的 HTML 表格结构 */
    text_as_html?: string;
    /** Figure/Image 元素的版面坐标（points 为 PDF 用户空间 pt，用于裁剪图片语义化） */
    coordinates?: {
      layout_width?: number;
      layout_height?: number;
      points?: number[][];
    } | null;
  };
}

export interface UnstructuredParseOptions {
  /** 保留兼容位：v2 由服务端自动平衡（profile），不再需要手动选策略；此处仅文档说明 */
  strategy?: "hi_res" | "fast" | "auto" | "ocr_only";
  /** 保留兼容位：v2 自动识别语言，无需传参 */
  languages?: string[];
}

/** SDK 返回的 Element（见 unstructured-transform-client 类型定义） */
interface TransformElement {
  elementId: string;
  type: string;
  text: string | null;
  metadata: {
    pageNumber: number | null;
    textAsHtml: string | null;
    coordinates: { layout_width?: number; layout_height?: number; points?: number[][] } | null;
  };
}

/**
 * 调用 Unstructured 解析 PDF，返回元素列表（标题/段落/表格/列表已打标，表格带 text_as_html）
 *
 * 失败时抛错（由调用方决定降级策略——默认回退 pdf-parse 原始文本，不让解析链路挂掉）。
 * SDK 为 ESM-only，这里用动态 import 以兼容本包的双构建（CJS + ESM）。
 */
export async function parsePdfWithUnstructured(pdfBuffer: Buffer, options: UnstructuredParseOptions = {}): Promise<UnstructuredElement[]> {
  void options;
  const apiKey = process.env.UNSTRUCTURED_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 Unstructured 云 API 配置：请设置环境变量 UNSTRUCTURED_API_KEY（apps/backend/.env）");
  }

  // 动态加载官方 SDK（ESM-only）；CJS 构建下 node 22 支持动态 import ESM
  const { TransformClient, isAccepted } = await import("unstructured-transform-client");
  const client = new TransformClient({ apiKey });

  /** 单次提交 + 轮询解析 job（提交失败 / job 最终失败 / 轮询超时都会抛错） */
  const runOnce = async (): Promise<UnstructuredElement[]> => {
    const outcome = await client.parse.run({
      input: { data: pdfBuffer, filename: "document.pdf" },
      output: "elements",
      include: ["table_html", "coordinates"],
      waitSeconds: 0, // 不阻塞，拿 job handle 后自行轮询，便于统一超时控制
    });

    let elements: TransformElement[] = [];

    if (isAccepted(outcome)) {
      const jobId = outcome.body.id;
      const deadline = Date.now() + UNSTRUCTURED_TIMEOUT_MS;

      let job = await client.jobs.get(jobId, { output: "elements", include: ["table_html", "coordinates"] });
      while (job.status === "queued" || job.status === "processing") {
        if (Date.now() >= deadline) {
          throw new Error(`Unstructured 解析超时：job ${jobId} 在 ${UNSTRUCTURED_TIMEOUT_MS / 1000}s 内未完成（状态 ${job.status}）`);
        }
        await new Promise((resolve) => setTimeout(resolve, UNSTRUCTURED_POLL_INTERVAL_MS));
        job = await client.jobs.get(jobId, { output: "elements", include: ["table_html"] });
      }

      if (job.status !== "completed" || !job.result) {
        // job.error 可能是对象（如 { code: "could_not_parse", message: "..." }），
        // 直接模板拼接会输出 [object Object]，必须 JSON 序列化才可读
        const jobError = job.error ? `，错误：${typeof job.error === "string" ? job.error : JSON.stringify(job.error)}` : "";
        throw new Error(`Unstructured 解析失败：job ${jobId} 最终状态 ${job.status}${jobError}`);
      }
      elements = job.result.elements ?? [];
    } else {
      elements = outcome.body.elements ?? [];
    }

    return elements.map(toUnstructuredElement);
  };

  // 云服务存在间歇性 job failed（实测同文件 5 次请求约 3 败 2 成，
  // 错误 could_not_parse，服务端偶发解析失败，非限流），
  // 直接回退 pdf-parse 会丢失表格/标题结构，故失败重试（带递增退避），
  // 重试耗尽才把错误抛给编排层做整体回退。
  const MAX_ATTEMPTS = 5;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await runOnce();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[unstructured] 第 ${attempt} 次解析未成功，${2 * attempt}s 后重试：${err instanceof Error ? err.message : String(err)}`);
        await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
      }
    }
  }
  throw lastError;
}

/** SDK Element → 项目内部元素结构（对齐百度 OCR 页的版面语义） */
function toUnstructuredElement(el: TransformElement): UnstructuredElement {
  return {
    element_id: el.elementId,
    type: el.type,
    text: el.text ?? "",
    metadata: {
      page_number: el.metadata.pageNumber ?? 1,
      text_as_html: el.metadata.textAsHtml ?? undefined,
      coordinates: el.metadata.coordinates
        ? {
            layout_width: el.metadata.coordinates.layout_width,
            layout_height: el.metadata.coordinates.layout_height,
            points: el.metadata.coordinates.points,
          }
        : undefined,
    },
  };
}

/**
 * 把 `<table>` 转成 GFM（GitHub Flavored Markdown）表格文本。
 *
 * 输出带表头分隔行（`| --- | --- |`）：主流 markdown 渲染器（marked / markdown-it 等）
 * 只有看到表头 + 分隔行才会渲染成真正的表格；没有分隔行的 `|` 行会被当作普通文本段落
 * （内容在、格式无），这正是「表格没展示出来」的直接原因。
 * 第一行 `<th>` 视为表头，其余 `<td>` 为数据行，列数按最宽行补齐。
 */
export function htmlTableToText(html: string): string {
  // 按 <tr> 拆行、按 <td>/<th> 拆列，去掉单元格内其余标签
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRe.exec(html))) {
    const cells: string[] = [];
    const cellRe = /<t([dh])[^>]*>([\s\S]*?)<\/t\1>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(trMatch[1]))) {
      cells.push(
        cellMatch[2]
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      );
    }
    rows.push(cells);
  }

  // 兜底：没解析出结构时至少清掉标签，避免原始 HTML 混入正文
  if (rows.length === 0) {
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const colCount = Math.max(...rows.map((r) => r.length));
  const fmt = (cells: string[]) => Array.from({ length: colCount }, (_, i) => cells[i] ?? "").join(" | ");
  const sep = Array.from({ length: colCount }, () => "---").join(" | ");

  const lines = rows.map(fmt);
  return [`| ${lines[0]} |`, `| ${sep} |`, ...lines.slice(1).map((l) => `| ${l} |`)].join("\n");
}

/**
 * 把 Unstructured 元素列表按页码重组为「每页一段标准化文本」。
 *
 * 标准化规则（对齐现有知识库格式）：
 *   - Title        → `## 标题`（与百度 OCR 页的标题标记一致）
 *   - Table        → `[表格]\n行列文本`（与百度 OCR 页的表格标记一致）
 *   - ListItem     → `- 条目`
 *   - Header/Footer→ 丢弃（页眉页脚不产生内容）
 *   - 其余正文     → 原文
 * 每个元素之间用换行分隔，保持段落结构，方便后续切片。
 */
export function elementsToPageTexts(elements: UnstructuredElement[], totalPages: number): string[] {
  const pages: string[][] = Array.from({ length: totalPages }, () => []);

  for (const el of elements) {
    const type = el.type ?? "UncategorizedText";
    const text = (el.text ?? "").trim();
    if (!text) continue;
    if (type === "Header" || type === "Footer" || type === "PageBreak") continue;

    const page = el.metadata?.page_number ?? 1;
    const target = pages[page - 1] ?? pages[0];

    switch (type) {
      case "Title":
        target.push(`## ${text}`);
        break;
      case "Table":
        target.push(`[表格]\n${el.metadata?.text_as_html ? htmlTableToText(el.metadata.text_as_html) : text}`);
        break;
      case "ListItem":
        // Unstructured ListItem 文本自带项目符号（• 等），去掉后再统一加 "- "，避免「- • xxx」双符号
        target.push(`- ${text.replace(/^[•·]\s*/, "").trim()}`);
        break;
      default:
        // NarrativeText / UncategorizedText 等按正文输出，段落之间自然换行
        target.push(text);
    }
  }

  return pages.map((lines) => lines.join("\n"));
}
