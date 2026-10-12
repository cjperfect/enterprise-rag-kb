/** 知识库检索工具（pi 版） — Agent 可调用此工具搜索企业内部知识库 */
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { ragService } from "../rag";
import type { RagSearchResult } from "../interfaces/rag";

/**
 * 一次对话流（一次 streamEvents 调用）的检索收集器。
 *
 * 由 AiEngine.streamEvents 每次调用时新建、经闭包传给工具实例；
 * 工具把结果并入，事件处理器从同一个对象读。
 * 数据跟着单次流走，取代 LangChain 时代的 configurable 传递——
 * 并发会话各自持有独立闭包，不会互相污染。
 *
 * 语义是**累计**而非覆盖：模型可能并行发起或改写重试多次检索，
 * 若每次覆盖，先发起那次的结果会被后一次顶掉，最终汇总的知识来源会丢。
 */
export interface RetrievalScope {
  results: RagSearchResult[];
}

/** 去重键：同一文档的同一切片只保留一份 */
function chunkKey(r: RagSearchResult): string {
  return `${r.kbId}:${r.documentId}:${r.chunkIndex ?? ""}:${r.content}`;
}

/** 把本次检索结果并入作用域（按切片去重），供事件处理器汇总知识来源 */
export function appendScopedResults(scope: RetrievalScope | undefined, results: RagSearchResult[]): void {
  if (!scope) return;
  const seen = new Set(scope.results.map(chunkKey));
  for (const r of results) {
    const key = chunkKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    scope.results.push(r);
  }
}

/** 匹配方式的可读标签（混合检索结果标注命中来源，便于用户理解排序） */
const MATCH_LABELS: Record<string, string> = {
  both: "语义+关键词",
  semantic: "语义",
  keyword: "关键词",
};

/** 检索结果 → 返回给模型的文本 */
function formatResults(results: RagSearchResult[]): string {
  return results
    .map(
      (r, i) =>
        `[文档片段 ${i + 1}] 来源: ${r.kbName ?? `知识库#${r.kbId}`}` +
        `${r.documentName ? `/${r.documentName}` : ""}` +
        ` (匹配: ${MATCH_LABELS[r.matchType] ?? r.matchType}, 得分: ${(r.score * 100).toFixed(1)}%)\n${r.content}`,
    )
    .join("\n\n");
}

/**
 * 创建带作用域的知识库检索工具（pi defineTool）。
 *
 * 作用域（kbIds / RetrievalScope）由工厂闭包捕获，**不从模型输入取**——
 * 模型无从得知会话勾选了哪些库，让它填只会填出 undefined，进而把范围静默扩大到全库。
 * fail-closed：kbIds 为空就拒绝检索，绝不降级为「检索全部知识库」。
 */
export function createKnowledgeSearchTool(kbIds: number[], scope: RetrievalScope): ToolDefinition {
  return defineTool({
    name: "search_knowledge_base",
    label: "知识库检索",
    description: `在本次会话指定的知识库中检索相关文档内容（向量语义 + BM25 关键词混合检索）。
适用场景：
- 用户询问公司政策、流程、规范、产品文档等内部资料
- 需要查找特定业务知识或操作指南
- 用户的问题需要基于公司文档或产品说明书来回答

注意：
- 检索范围由会话设定：你只能决定「查什么」，无法改变「能查哪些库」。未指定知识库时工具会直接返回提示。
- 检索结果按混合相关性排序，可能不完全精确。
- 一次不理想时改写查询词（设备型号、故障码、功能关键词）再试，最多重试两次。
- 检索无结果时请明确告知用户知识库中没有相关信息，不要凭记忆补全。`,
    promptSnippet: "search_knowledge_base - 在会话指定的知识库中检索文档",
    parameters: Type.Object({
      query: Type.String({ description: "检索查询语句；建议使用问题中的关键词，首次不理想时可换用型号、故障码等功能关键词" }),
    }),
    execute: async (_toolCallId, params) => {
      // fail-closed：作用域缺失就拒绝检索
      if (kbIds.length === 0) {
        return {
          content: [{ type: "text", text: "当前会话未指定知识库，无法检索。请提示用户先选择要查询的知识库。" }],
          details: null,
        };
      }

      const results = await ragService.search(params.query, { kbIds, k: 5 });

      // 并入本次流的作用域（累计去重），事件处理器据此汇总知识来源
      appendScopedResults(scope, results);

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "未找到相关文档。请告知用户当前知识库中没有匹配的信息。" }],
          details: null,
        };
      }

      return {
        content: [{ type: "text", text: formatResults(results) }],
        details: results,
        structuredContent: results,
      };
    },
  });
}

/** 空知识库作用域（未指定库时工具会 fail-closed） */
export function createEmptyScope(): RetrievalScope {
  return { results: [] };
}
