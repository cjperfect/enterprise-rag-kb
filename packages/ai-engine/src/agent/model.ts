/**
 * 模型注册与解析（pi 版 · 双 Provider）
 *
 * 注册两个互不影响的 provider，前端可在对话界面自由切换：
 *  - custom（火山方舟 / OpenAI 兼容端点，默认）：baseUrl 取 LLM_BASE_URL，key 取 OPENAI_API_KEY
 *  - ollama（本地 Ollama /v1 兼容端点）：baseUrl=http://localhost:11434/v1，无 key
 *
 * 模型归属规则：名字命中「ollama 模型集合」（OLLAMA_MODEL / OLLAMA_MODELS）走 ollama，
 * 其余一律走 ark。模型按需注册：前端每传一个新模型名，动态合并进对应 provider 的 models 列表。
 *
 * 配置（apps/backend/.env）：
 *   LLM_BASE_URL      ark 端点（默认 https://ark.cn-beijing.volces.com/api/v3）
 *   OPENAI_API_KEY    ark key（ollama 不需要）
 *   LLM_MODEL         ark 默认模型（默认 doubao-seed-2-0-mini-260428）
 *   OLLAMA_BASE_URL   本地 Ollama 地址（默认 http://localhost:11434/v1）
 *   OLLAMA_MODEL      本地默认模型（默认 qwen3.5:0.8b）
 *   OLLAMA_MODELS     可选：额外可选的 ollama 模型名，逗号分隔（默认仅 OLLAMA_MODEL）
 */
import { createProvider, type Model, type Api } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MODEL } from "@enterprise-rag-kb/shared/constants";

/** ark provider 标识 */
const ARK_PROVIDER = "custom";
/** ollama provider 标识 */
const OLLAMA_PROVIDER = "ollama";

const ARK_BASE_URL = process.env.LLM_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3.5:0.8b";
/** 额外 ollama 模型（逗号分隔），默认只挂 OLLAMA_MODEL */
const OLLAMA_MODELS = (process.env.OLLAMA_MODELS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** 归属判断：名字命中 ollama 集合走本地，其余走 ark */
function providerForModel(modelName: string): string {
  return modelName === OLLAMA_MODEL || OLLAMA_MODELS.includes(modelName) ? OLLAMA_PROVIDER : ARK_PROVIDER;
}

/** provider 级静态配置（baseUrl / key） */
function providerConfig(providerId: string): { baseUrl: string; apiKey: string | undefined } {
  if (providerId === OLLAMA_PROVIDER) {
    // Ollama /v1 兼容端点本身不做鉴权，但 pi 的认证检查要求 provider 有 key 才放行
    // （否则直接抛 "No API key found"）。给占位 key 仅用于通过 pi 的检查，
    // Ollama 收到 Authorization 头会忽略。
    return { baseUrl: OLLAMA_BASE_URL, apiKey: "ollama-local" };
  }
  return { baseUrl: ARK_BASE_URL, apiKey: process.env.OPENAI_API_KEY };
}

/** 已注册模型：providerId → modelName → Model */
const modelRegistry = new Map<string, Map<string, Model<Api>>>();

let runtimePromise: Promise<ModelRuntime> | null = null;

/**
 * 用当前注册表重建指定 provider 并注册到 runtime（幂等，同名覆盖）。
 * provider 的 api 实现与认证配置是静态的，模型列表动态合并。
 */
function registerProvider(rt: ModelRuntime, providerId: string): void {
  const { baseUrl, apiKey } = providerConfig(providerId);
  const provider = createProvider({
    id: providerId,
    name: providerId === OLLAMA_PROVIDER ? "Local Ollama" : "Custom LLM",
    baseUrl,
    auth: {
      apiKey: {
        name: `${providerId} API key`,
        resolve: () => Promise.resolve(apiKey ? { auth: { apiKey, baseUrl }, env: { OPENAI_API_KEY: apiKey }, source: "OPENAI_API_KEY" } : undefined),
      },
    },
    models: [...(modelRegistry.get(providerId) ?? new Map()).values()],
    api: openAICompletionsApi(),
  });
  rt.registerNativeProvider(provider);
}

/**
 * 获取 ModelRuntime 单例（懒加载）。
 * 初始化时创建 runtime + 注册 ark/ollama 默认模型 + 两个 provider。
 */
export function getModelRuntime(): Promise<ModelRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const rt = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
      const arkKey = process.env.OPENAI_API_KEY;
      if (arkKey) await rt.setRuntimeApiKey(ARK_PROVIDER, arkKey);

      // 默认模型：ollama 模式落到本地模型，否则走 .env 的 ark 模型
      const defName = process.env.LLM_PROVIDER === "ollama" ? OLLAMA_MODEL : (process.env.LLM_MODEL ?? DEFAULT_MODEL);
      const defProvider = providerForModel(defName);
      modelRegistry.set(defProvider, new Map([[defName, buildModel(defName, defProvider)]]));

      // 预注册 ollama 默认模型（保证 ollama provider 始终可用；与默认模型相同时覆盖）
      const ollamaProvider = OLLAMA_PROVIDER;
      const ollamaReg = modelRegistry.get(ollamaProvider) ?? new Map();
      if (!ollamaReg.has(OLLAMA_MODEL)) ollamaReg.set(OLLAMA_MODEL, buildModel(OLLAMA_MODEL, ollamaProvider));
      modelRegistry.set(ollamaProvider, ollamaReg);

      registerProvider(rt, ARK_PROVIDER);
      registerProvider(rt, OLLAMA_PROVIDER);
      return rt;
    })();
  }
  return runtimePromise;
}

/** 构造单个模型对象（openai-completions 兼容；费用/窗口参数不参与计费，取保守值） */
function buildModel(modelName: string, providerId: string): Model<Api> {
  const { baseUrl } = providerConfig(providerId);
  return {
    id: modelName,
    name: modelName,
    api: "openai-completions",
    provider: providerId,
    baseUrl,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

/**
 * 确保指定模型已注册（幂等）：未注册就加入所属 provider 的注册表并重建该 provider。
 *
 * 调用方可传任意模型名（DeepSeek、豆包、qwen…），不在注册表里就动态补进去——
 * OpenAI 兼容端点按名字请求即可。DEFAULT_MODEL（deepseek-v4-flash）视为「未指定」，
 * 落到环境配置的真实默认模型。
 */
export async function ensureModel(modelName?: string): Promise<Model<Api>> {
  const name = modelName && modelName !== DEFAULT_MODEL ? modelName : defaultModelName();
  const providerId = providerForModel(name);

  const reg = modelRegistry.get(providerId) ?? new Map();
  const existing = reg.get(name);
  if (existing) return existing;

  reg.set(name, buildModel(name, providerId));
  modelRegistry.set(providerId, reg);

  const rt = await getModelRuntime();
  registerProvider(rt, providerId);

  const model = rt.getModel(providerId, name);
  if (!model) throw new Error(`模型注册失败: ${name}`);
  return model;
}

/** 默认模型名：ollama 模式落到本地模型，否则用环境变量/项目默认 */
function defaultModelName(): string {
  if (process.env.LLM_PROVIDER === "ollama") return OLLAMA_MODEL;
  return process.env.LLM_MODEL ?? DEFAULT_MODEL;
}

/** 解析模型：与旧 getAgent(modelName) 语义一致，切换模型 = 取另一个已注册的模型 */
export function resolveModel(modelName?: string): Promise<Model<Api>> {
  return ensureModel(modelName);
}
