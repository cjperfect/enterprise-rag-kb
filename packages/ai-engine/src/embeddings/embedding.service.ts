import { OllamaEmbeddings } from "@langchain/ollama";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";

/**
 * Embedding 提供方切换（EMBEDDING_PROVIDER）：
 *   - ollama（默认）：本地 Ollama，baseUrl=http://localhost:11434，模型默认 qwen3-embedding:0.6b
 *   - ark：火山方舟 Doubao 多模态 embedding（POST /api/v3/embeddings/multimodal），
 *     模型默认 doubao-embedding-vision-251215，dimensions 默认 1024
 *     （与 pgvector 表维度一致，避免换模型导致维度不匹配需重建表）
 *
 * 配置（apps/backend/.env）：
 *   EMBEDDING_PROVIDER  ollama（默认）| ark
 *   EMBEDDING_BASE_URL  仅 ollama 用（默认 http://localhost:11434）
 *   EMBEDDING_MODEL     默认 qwen3-embedding:0.6b（ollama）/ doubao-embedding-vision-251215（ark）
 *   EMBEDDING_API_KEY   ark 必填（Ollama 无鉴权可不填）
 *   EMBEDDING_API_URL   ark 可选覆盖（默认 https://ark.cn-beijing.volces.com/api/v3，便于 mock 联调）
 *   EMBEDDING_DIMENSIONS 向量维度（默认 1024；改维度需同步重建 pgvector 表）
 */
const EMBEDDING_PROVIDER = (process.env.EMBEDDING_PROVIDER ?? "ollama").trim().toLowerCase();
const EMBEDDING_BASE_URL = process.env.EMBEDDING_BASE_URL ?? "http://localhost:11434";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "qwen3-embedding:0.6b";
const EMBEDDING_API_KEY = (process.env.EMBEDDING_API_KEY ?? "").trim();
const EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS ?? "1024");
const ARK_EMBEDDING_URL = "https://ark.cn-beijing.volces.com/api/v3";

// ==========================================================================
// 豆包多模态 embedding（火山方舟 /api/v3/embeddings/multimodal）
// ==========================================================================
//
// 与 OpenAI 标准 /embeddings 不同：
//   1. 端点不同：/api/v3/embeddings/multimodal
//   2. input 必须是对象数组（[{type:"text",text:...}]）
//   3. 关键差异：多条 input 会被合并成【一个】向量（多模态单元语义，
//      系统把整个 input 列表作为一个图文单元编码），因此不支持批量独立向量化，
//      必须每条文本单独请求，再按输入顺序组装结果。
// 响应：单条 input 时返回 data.embedding（number[]）。
class ArkMultimodalEmbeddings implements EmbeddingsInterface {
  private readonly model: string;
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly dimensions: number;
  private readonly concurrency: number;

  constructor(config: {
    model?: string;
    apiKey?: string;
    apiUrl?: string;
    dimensions?: number;
    concurrency?: number;
  }) {
    this.model = config.model ?? EMBEDDING_MODEL;
    this.apiKey = config.apiKey ?? EMBEDDING_API_KEY;
    this.apiUrl = config.apiUrl ?? EMBEDDING_API_URL();
    this.dimensions = config.dimensions ?? EMBEDDING_DIMENSIONS;
    // 多模态 embedding 每次请求只能向量化一条文本（多条会合并），
    // 用并发池补偿吞吐：默认 8 并发（RPM 上限 15000，远未触顶）。
    this.concurrency = config.concurrency ?? 8;
  }

  /** 批量向量化：逐条请求（每条独立向量）+ 固定并发池，按输入顺序返回 */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    let next = 0;

    const worker = async () => {
      while (next < texts.length) {
        const i = next++;
        results[i] = await this.requestOne(texts[i]);
      }
    };

    const workers = Array.from(
      { length: Math.min(this.concurrency, texts.length) },
      () => worker(),
    );
    await Promise.all(workers);
    return results;
  }

  /** 单条查询向量化 */
  async embedQuery(text: string): Promise<number[]> {
    return this.requestOne(text);
  }

  /** 发起单条多模态 embedding 请求（input 恒为单元素，保证返回独立向量） */
  private async requestOne(text: string): Promise<number[]> {
    const body = {
      model: this.model,
      encoding_format: "float",
      dimensions: this.dimensions,
      input: [{ type: "text", text }],
    };

    // 网络抖动 / 5xx / 429 自动重试 3 次（指数退避 500ms→1s→2s）；
    // 4xx 鉴权/参数错误和维度异常不重试（重试也不会成功）。
    const MAX_RETRY = 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      try {
        const res = await fetch(`${this.apiUrl}/embeddings/multimodal`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });

        if (!res.ok) {
          const status = res.status;
          const detail = (await res.text()).slice(0, 200);
          // 429 限流 / 5xx 服务端错误 → 可重试；4xx 其他 → 直接抛
          if (status !== 429 && status < 500) {
            throw new Error(`豆包 embedding 请求失败：HTTP ${status} ${detail}`);
          }
          throw new Error(`豆包 embedding 临时失败：HTTP ${status} ${detail}`);
        }

        const data = (await res.json()) as {
          data?: { embedding?: number[] } | Array<{ embedding?: number[] }>;
        };
        const item = Array.isArray(data.data) ? data.data[0] : data.data;
        const vector = item?.embedding ?? [];
        if (vector.length !== this.dimensions) {
          // 维度异常是确定性错误（模型/配置问题），不重试直接抛
          throw new Error(
            `豆包 embedding 维度异常：期望 ${this.dimensions}，实际 ${vector.length}`,
          );
        }
        return vector;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const retriable =
          msg.includes("临时失败") ||
          msg.includes("429") ||
          msg.includes("500") ||
          msg.includes("502") ||
          msg.includes("503") ||
          msg.includes("504") ||
          msg.includes("timeout") ||
          msg.includes("fetch") ||
          msg.includes("network");
        if (attempt < MAX_RETRY && retriable) {
          const waitMs = 500 * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

}

/** ark embedding endpoint（可用 EMBEDDING_API_URL 覆盖，便于本地 mock 联调；默认火山方舟） */
function EMBEDDING_API_URL(): string {
  return (process.env.EMBEDDING_API_URL ?? "").trim() || ARK_EMBEDDING_URL;
}

/** 按模型名创建 embedding 实例（provider 由 EMBEDDING_PROVIDER 决定） */
export function createEmbeddings(modelName?: string): EmbeddingsInterface {
  if (EMBEDDING_PROVIDER === "ark") {
    if (!EMBEDDING_API_KEY) {
      throw new Error(
        "缺少豆包 embedding 配置：请设置 EMBEDDING_API_KEY（EMBEDDING_PROVIDER=ark 时必填）",
      );
    }
    return new ArkMultimodalEmbeddings({ model: modelName ?? EMBEDDING_MODEL });
  }
  return new OllamaEmbeddings({
    model: modelName ?? EMBEDDING_MODEL,
    baseUrl: EMBEDDING_BASE_URL,
  });
}

/** 默认 embedding 模型单例 */
export const defaultEmbeddings: EmbeddingsInterface = createEmbeddings();
