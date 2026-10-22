/**
 * 图片语义化模块：用豆包视觉（火山方舟 Ark API）识别 PDF 中的结构图
 * （流程图/架构图/时序图/信息图），生成结构化文字描述，供 RAG 检索。
 *
 * 为什么需要它：
 *   Unstructured / 百度 OCR / pdf-parse 三条通道对图片元素都只做「无文本 → 丢弃」，
 *   流程图/架构图承载的模块、层级、连接关系在向量库中完全不可检索。
 *   本模块把「图」翻译成「可检索的文字」。
 *
 * 图片来源（不依赖 Unstructured 坐标——Transform v2 实测不返回 coordinates）：
 *   mupdf DisplayList 设备回调探测页面内嵌图片块（fillImage → bbox）：
 *   - 覆盖 PPT/Visio/draw.io 导出等最常见的「嵌入位图」架构图/流程图形态；
 *   - 纯矢量绘制的图（无嵌入位图）探测不到，属已知边界（后续可用版面启发式补）。
 *
 * 处理链路：
 *   1. detectPdfImageBlocks：mupdf 探测每页图片块（page + bbox，过滤 logo/整页背景图）；
 *   2. 渲染对应 PDF 页（整页 PNG，144dpi）→ sharp 按 bbox 裁切 + 压缩；
 *   3. 豆包视觉一次调用：判断是否结构图 + 输出结构化描述（JSON）；
 *   4. type=structure → 描述插回该页；type=skip（装饰图/照片/纯文字图）→ 丢弃；
 *   5. 单图失败不阻塞整条解析（按 skip 处理），并发受限。
 *
 * 配置（apps/backend/.env）：
 *   IMAGE_VLM_PROVIDER   none（默认，关闭，行为=现状） | ark
 *   IMAGE_VLM_API_KEY    火山方舟 API Key
 *   IMAGE_VLM_MODEL      豆包视觉模型 ID（默认 doubao-seed-1.6-vision-250815）
 *   IMAGE_VLM_MAX_IMAGES 每文档处理图片上限（默认 20，超出丢弃并告警）
 *   IMAGE_VLM_CONCURRENCY 并发数（默认 3）
 *   IMAGE_VLM_TIMEOUT_MS 单图调用超时（默认 30s）
 */

import sharp from "sharp";

// ==========================================================================
// 配置
// ==========================================================================

/** 图片语义化配置（每次调用读取 env，便于热更新；provider=none 时整体关闭） */
function getConfig() {
  return {
    provider: (process.env.IMAGE_VLM_PROVIDER ?? "none").trim().toLowerCase(),
    apiKey: (process.env.IMAGE_VLM_API_KEY ?? "").trim(),
    model: process.env.IMAGE_VLM_MODEL ?? "doubao-seed-1.6-vision-250815",
    maxImages: Number(process.env.IMAGE_VLM_MAX_IMAGES ?? 20),
    concurrency: Math.max(1, Number(process.env.IMAGE_VLM_CONCURRENCY ?? 3)),
    timeoutMs: Number(process.env.IMAGE_VLM_TIMEOUT_MS ?? 30_000),
  };
}

/** 图片语义化开关：provider 为 ark 且有 API Key 时才生效，其余情况保持现状 */
export function isImageSemanticEnabled(): boolean {
  const cfg = getConfig();
  return cfg.provider === "ark" && cfg.apiKey.length > 0;
}

// ==========================================================================
// 类型
// ==========================================================================

/** 一张待语义化的图（由 mupdf 探测得到） */
export interface FigureBlock {
  /** 1-based 页码 */
  page: number;
  /** PDF 用户空间坐标（pt，原点左下、y 向上），来自图片块在页面上的变换矩阵 */
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** 图题 / 相关文字（帮助 VLM 理解图意；mupdf 探测不到图题，可为空） */
  caption?: string;
}

/** 单张图的语义化结果 */
export interface ImageSemanticResult {
  /** 1-based 页码（插回该页） */
  page: number;
  /** 图题（透传，用于拼接 [图片] 块） */
  caption?: string;
  /** VLM 判断的图类型（架构图/流程图/时序图…；skip 时为空） */
  imageType?: string;
  /** 结构化描述（markdown 列表，保留层级与连接关系；skip 时为空） */
  description?: string;
  /** true = 非结构图（装饰图/照片/纯文字图），丢弃 */
  skipped: boolean;
}

// ==========================================================================
// 图片块探测（mupdf DisplayList 设备回调）
// ==========================================================================

/** 图片块最小尺寸（pt）：小于此尺寸视为 logo/装饰小图，不浪费 VLM 调用 */
const MIN_IMAGE_PT = 60;
/** 图片块占页面面积上限：超过视为整页背景图/扫描页，跳过（文本层页的正常图片块不会这么大） */
const MAX_PAGE_RATIO = 0.85;

/**
 * 探测 PDF 内嵌图片块：mupdf DisplayList 设备回调（fillImage）收集每页
 * 图片的包围盒（PDF 用户空间 pt，原点左下、y 向上）。
 *
 * @param onlyPages 只探测这些页（1-based）；传空 Set/不传 = 全量探测。
 *   典型用法：由 Unstructured 的 Image/Figure 元素页码驱动（它负责"哪里可能有图"，
 *   mupdf 负责"精确定位坐标"）；若 Unstructured 一页都没标则全量探测兜底，防漏无文本图。
 *
 * 过滤规则：
 *   - 尺寸 < MIN_IMAGE_PT（logo/小图标）→ 跳过；
 *   - 面积 > 页面 MAX_PAGE_RATIO（整页背景图/扫描页）→ 跳过。
 * 同一页可能有多张图；不同页各自返回。
 */
export async function detectPdfImageBlocks(pdfBuffer: Buffer, onlyPages?: Set<number>): Promise<FigureBlock[]> {
  const { Document, Device, Matrix } = await import("mupdf");
  const doc = Document.openDocument(pdfBuffer, "application/pdf");
  try {
    const pages = doc.countPages();
    const blocks: FigureBlock[] = [];
    const filterByPage = onlyPages && onlyPages.size > 0;

    for (let i = 0; i < pages; i++) {
      if (filterByPage && !onlyPages.has(i + 1)) continue; // 只探测 Unstructured 判定的图页
      const page = doc.loadPage(i);
      // 页面尺寸（MediaBox，pt）：用于过滤整页图与 clamp 坐标
      const [pageX0, pageY0, pageX1, pageY1] = page.getBounds();
      const pageW = pageX1 - pageX0;
      const pageH = pageY1 - pageY0;

      const displayList = page.toDisplayList();
      const device = new Device({
        fillImage(image, ctm) {
          // ctm = [a,b,c,d,e,f]：a/d 是图片绘制后的宽/高（pt）、e/f 是平移（PDF 坐标 y 向上）。
          // 注意：a/d 已包含「图像素宽 × 缩放」，不要再乘 image.getWidth()，否则双重缩放。
          const m = Array.from(ctm);
          const x0 = m[4];
          const y0 = m[5];
          // 无旋转/倾斜时 b=c=0；此处用包围盒近似（旋转图边界会略偏大，极少见）
          const w = Math.abs(m[0]);
          const h = Math.abs(m[3]);
          if (w < MIN_IMAGE_PT || h < MIN_IMAGE_PT) return; // logo/小图标
          if (pageW > 0 && pageH > 0 && (w * h) / (pageW * pageH) > MAX_PAGE_RATIO) return; // 整页背景图

          blocks.push({
            page: i + 1,
            bbox: {
              x0: Math.max(pageX0, Math.min(x0, x0 + w)),
              y0: Math.max(pageY0, Math.min(y0, y0 + h)),
              x1: Math.min(pageX1, Math.max(x0, x0 + w)),
              y1: Math.min(pageY1, Math.max(y0, y0 + h)),
            },
          });
        },
      });
      displayList.run(device, Matrix.identity);
    }

    return blocks;
  } finally {
    doc.destroy?.();
  }
}

// ==========================================================================
// 豆包视觉调用（火山方舟 Ark API，OpenAI 兼容格式）
// ==========================================================================

const ARK_CHAT_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";

/** 实际调用的 endpoint（可用 IMAGE_VLM_API_URL 覆盖，便于本地 mock 联调；默认火山方舟） */
function apiUrl(): string {
  return (process.env.IMAGE_VLM_API_URL ?? "").trim() || ARK_CHAT_URL;
}

/** 识别 prompt：一次调用同时完成「是否结构图」判断 + 结构化描述（JSON 输出） */
const VLM_PROMPT = `你是文档版面分析助手。以下是 PDF 中提取的一张图片。
请判断它是否属于「结构图」（流程图、架构图、时序图、组织架构图、信息图等表达模块/层级/连接关系的图）：
- 是结构图 → 用中文结构化描述：图的类型、主要节点/模块与层级、节点之间的连接关系（用「→」「依赖」「包含」「共享」等词表达）。
- 不是结构图（装饰图、照片、logo、纯文字截图）→ 输出 {"type":"skip"}。
只描述图中可见内容，不得推测或编造。
严格输出 JSON：{"type":"structure|skip","image_type":"架构图/流程图/…","description":"结构化描述，使用 - 列表保留层级"}`;

/** 调用豆包视觉，返回解析后的 JSON（失败抛错，由调用方决定降级） */
async function callDoubaoVision(pngBuffer: Buffer, caption: string | undefined, cfg: ReturnType<typeof getConfig>): Promise<unknown> {
  const imageB64 = pngBuffer.toString("base64");
  const captionLine = caption ? `（图题/相关文字：${caption}）` : "";

  const res = await fetch(apiUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageB64}` } },
            { type: "text", text: `${VLM_PROMPT}${captionLine}` },
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`豆包视觉请求失败：HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("豆包视觉返回为空");

  // 去掉可能的 ```json 围栏后解析
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

// ==========================================================================
// PDF 渲染与裁剪（mupdf 渲染整页 → sharp 按 bbox 裁切压缩）
// ==========================================================================

/** 渲染缩放（2x = 144dpi，足够 VLM 识别图内文字） */
const RENDER_ZOOM = 2;

/** 交给 VLM 的图片长边上限（超出按比例缩小，控制 token 与请求体积） */
const MAX_IMAGE_SIDE = 2048;

/** 渲染整页为 PNG（按页缓存：同一页多张图只渲染一次） */
async function renderPagePng(pdfBuffer: Buffer, pageIndex: number): Promise<Buffer> {
  const { Document, Matrix, ColorSpace } = await import("mupdf");
  const doc = Document.openDocument(pdfBuffer, "application/pdf");
  try {
    const page = doc.loadPage(pageIndex);
    const pix = page.toPixmap(Matrix.scale(RENDER_ZOOM, RENDER_ZOOM), ColorSpace.DeviceRGB, false);
    return Buffer.from(pix.asPNG());
  } finally {
    doc.destroy?.();
  }
}

/** 图块 bbox（pt）→ 像素区域。注意：mupdf DisplayList 设备回调的 y 已是 top-down
 *  （与 Pixmap 像素一致，实测无需翻转；若按 PDF bottom-up 翻转会裁到错误位置） */
function bboxToPixels(bbox: FigureBlock["bbox"], pageWidthPx: number, pageHeightPx: number): { left: number; top: number; width: number; height: number } {
  const x0 = Math.max(0, Math.round(bbox.x0 * RENDER_ZOOM));
  const x1 = Math.min(pageWidthPx, Math.round(bbox.x1 * RENDER_ZOOM));
  const y0 = Math.max(0, Math.round(bbox.y0 * RENDER_ZOOM));
  const y1 = Math.min(pageHeightPx, Math.round(bbox.y1 * RENDER_ZOOM));
  return { left: x0, top: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

/** 从整页 PNG 裁出 bbox 区域，压缩为 JPEG（长边 ≤ MAX_IMAGE_SIDE） */
async function cropAndCompress(pagePng: Buffer, bbox: FigureBlock["bbox"]): Promise<Buffer> {
  const meta = await sharp(pagePng).metadata();
  const region = bboxToPixels(bbox, meta.width ?? 1, meta.height ?? 1);
  return sharp(pagePng)
    .extract({ left: region.left, top: region.top, width: region.width, height: region.height })
    .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

// ==========================================================================
// 编排：并发受限地语义化一批图
// ==========================================================================

/**
 * 语义化 PDF 中的结构图。
 *
 * @param pdfBuffer  PDF 原始字节（用于 mupdf 渲染裁剪）
 * @param figures    待处理的图块（page + bbox + caption）
 * @returns          每个图的结果；关闭（provider≠ark）或失败降级时，图按 skipped 处理
 */
export async function semanticizePdfFigures(pdfBuffer: Buffer, figures: FigureBlock[]): Promise<ImageSemanticResult[]> {
  if (figures.length === 0) return [];
  const cfg = getConfig();
  if (!isImageSemanticEnabled()) return [];

  // 每文档上限：超出部分直接按 skip 处理（并告警，避免图多的 PDF 成本失控）
  const limited = figures.slice(0, cfg.maxImages);
  if (limited.length < figures.length) {
    console.warn(`[image-semantic] 图片数量 ${figures.length} 超过上限 ${cfg.maxImages}，超出部分跳过`);
  }

  const results: ImageSemanticResult[] = [];
  let cursor = 0;
  const pagePngCache = new Map<number, Buffer>();

  /** 简单信号量：最多 cfg.concurrency 个任务并发跑 */
  async function worker(): Promise<void> {
    while (cursor < limited.length) {
      const fig = limited[cursor++];
      try {
        // 1) 渲染所在页（缓存复用）
        let pagePng = pagePngCache.get(fig.page);
        if (!pagePng) {
          pagePng = await renderPagePng(pdfBuffer, fig.page - 1);
          pagePngCache.set(fig.page, pagePng);
        }
        // 2) 裁剪 + 压缩
        const jpeg = await cropAndCompress(pagePng, fig.bbox);
        // 3) 豆包视觉识别 + 描述
        const parsed = (await callDoubaoVision(jpeg, fig.caption, cfg)) as {
          type?: string;
          image_type?: string;
          description?: string;
        };
        const type = (parsed.type ?? "").toLowerCase();
        if (type === "structure") {
          results.push({
            page: fig.page,
            caption: fig.caption,
            imageType: parsed.image_type,
            description: parsed.description ?? "",
            skipped: false,
          });
        } else {
          results.push({ page: fig.page, caption: fig.caption, skipped: true });
        }
      } catch (err) {
        // 单图失败（网络/超时/JSON 解析/上游报错）→ 按 skip 处理，不阻塞整条解析
        console.warn(`[image-semantic] 第 ${fig.page} 页图片语义化失败（已跳过）：${err instanceof Error ? err.message : String(err)}`);
        results.push({ page: fig.page, caption: fig.caption, skipped: true });
      }
    }
  }

  const workers = Array.from({ length: Math.min(cfg.concurrency, limited.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
