/**
 * Query 改写（单 query 优化版）
 *
 * 把用户口语化问题改写成更适合向量检索的形式：
 *   - 提取核心实体/型号/参数
 *   - 补同义词与书面表达（"充电多久" → "充电时间 充满电 几小时"）
 *   - 去掉语气词、客套话
 *
 * 设计取舍：
 *   - 只生成 1 个改写版本（不做 multi-query），避免检索次数 ×N 带来的延迟和成本
 *   - 失败/超时/非法输出时静默 fallback 原 query，不阻塞主检索
 *   - 环境变量 QUERY_REWRITE_ENABLED 控制开关，默认关闭
 *
 * 配置（apps/backend/.env）：
 *   QUERY_REWRITE_ENABLED=true   开关
 *   QUERY_REWRITE_TIMEOUT_MS    超时（默认 3s，比正常 LLM 调用短，改写快）
 */

import { defaultModel } from "../agent/model";

const QUERY_REWRITE_ENABLED =
  (process.env.QUERY_REWRITE_ENABLED ?? "false").trim().toLowerCase() === "true";
const TIMEOUT_MS = Number(process.env.QUERY_REWRITE_TIMEOUT_MS ?? "3000");

const REWRITE_PROMPT = `你是检索查询优化助手。把用户问题改写成更适合在产品说明书知识库中检索的形式。

要求：
1. 提取核心实体、型号、参数（如 N6 mini、电池、充电）
2. 补充同义词和书面表达（口语 → 书面）
3. 去掉语气词、客套话、疑问助词
4. 保持原意，不要新增问题里没有的信息
5. 只输出改写后的查询本身，不要解释，不要引号

例子：
用户："这个梳子充一次电能用多久啊"
改写："N6 mini 充电时间 续航 一次充电使用时长"

用户："红灯一直闪是怎么回事"
改写："充电指示灯 红色闪烁 故障 异常状态"

用户问题：`;

/**
 * 改写 query；失败时返回原 query（不抛错、不阻塞主流程）
 */
export async function rewriteQuery(original: string): Promise<{ rewritten: string; used: boolean }> {
  if (!QUERY_REWRITE_ENABLED) return { rewritten: original, used: false };

  // 太短的 query 不用改（"充电"这种已经很精炼）
  if (original.trim().length < 6) return { rewritten: original, used: false };

  try {
    const model = defaultModel.bind({ maxTokens: 60, temperature: 0 });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await model.invoke(`${REWRITE_PROMPT}${original}`, {
      signal: controller.signal as AbortSignal,
    });
    clearTimeout(timer);

    const text = (res.content?.toString() ?? "").trim().replace(/^["'"]|["'"]$/g, "").trim();

    // 校验：改写结果不能为空、不能和原 query 完全一样（不然白调）、不能过长
    if (!text || text === original || text.length > 200) {
      return { rewritten: original, used: false };
    }

    return { rewritten: text, used: true };
  } catch (err) {
    console.warn(
      `[query-rewrite] 改写失败：${err instanceof Error ? err.message : String(err)}，fallback 原 query`,
    );
    return { rewritten: original, used: false };
  }
}
