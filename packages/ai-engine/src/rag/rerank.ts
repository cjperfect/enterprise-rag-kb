/**
 * Rerank 精排客户端（火山方舟 doubao-seed-1.6-rerank）
 *
 * 两段式检索：hybrid 粗排 top-20 → cross-encoder 精排 top-5。
 * 粗排用 RRF 融合（快、便宜），精排让 rerank 模型对 query-document 对打相关性分，
 * 解决单路检索对专有名词/型号召回弱的问题。
 *
 * 配置（apps/backend/.env）：
 *   RERANK_ENABLED=true           开关（默认 false，不影响现有 hybrid 流程）
 *   RERANK_API_KEY               默认可复用 EMBEDDING_API_KEY（同一个 ARK key）
 *   RERANK_MODEL                 doubao-seed-1.6-rerank（开通后替换成实际 endpoint 模型名）
 *   RERANK_API_URL               默认 https://ark.cn-beijing.volces.com/api/v3
 *   RERANK_CANDIDATES            粗排召回多少候选送精排（默认 20）
 */

const RERANK_ENABLED = (process.env.RERANK_ENABLED ?? "false").trim() === "true";
const RERANK_API_KEY = process.env.RERANK_API_KEY ?? process.env.EMBEDDING_API_KEY ?? "";
const RERANK_MODEL = process.env.RERANK_MODEL ?? "doubao-seed-1.6-rerank";
const RERANK_API_URL = process.env.RERANK_API_URL?.trim() || "https://ark.cn-beijing.volces.com/api/v3";
export const RERANK_CANDIDATES = Number(process.env.RERANK_CANDIDATES ?? "20");

export interface RerankCandidate {
  content: string;
  [key: string]: unknown;
}

export interface RerankResult {
  index: number;
  relevanceScore: number;
}

/**
 * 调火山方舟 rerank 接口，返回按相关性降序的原数组下标
 *
 * 失败时静默返回 null（不阻塞主流程），调用方 fallback 用粗排顺序。
 */
export async function rerank(
  query: string,
  candidates: RerankCandidate[],
  topN: number,
): Promise<RerankResult[] | null> {
  if (!RERANK_ENABLED || !RERANK_API_KEY || candidates.length <= topN) return null;

  try {
    const res = await fetch(`${RERANK_API_URL}/rerank`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RERANK_API_KEY}`,
      },
      body: JSON.stringify({
        model: RERANK_MODEL,
        query,
        documents: candidates.map((c) => c.content),
        top_n: Math.min(topN, candidates.length),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      console.warn(`[rerank] 请求失败 HTTP ${res.status}: ${detail}，fallback 粗排`);
      return null;
    }

    const data = (await res.json()) as {
      results?: Array<{ index: number; relevance_score: number }>;
    };

    return (data.results ?? []).map((r) => ({
      index: r.index,
      relevanceScore: r.relevance_score,
    }));
  } catch (err) {
    console.warn(`[rerank] 异常：${err instanceof Error ? err.message : String(err)}，fallback 粗排`);
    return null;
  }
}
