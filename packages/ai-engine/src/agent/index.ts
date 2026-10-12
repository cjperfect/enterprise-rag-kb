import { createAgentSession, SessionManager, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { dirname } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ChatOptions, ContextMessage, PiSessionSaved } from "@langchain-rag/shared/interfaces";
import { systemPrompt } from "../prompts";
import { createEmptyScope, createKnowledgeSearchTool } from "../tools/knowledge-search";
import { getModelRuntime, resolveModel } from "./model";
import type { StreamEvent } from "../interfaces/message";
import { emit, newTaskId, TaskEvent, TaskType } from "../events";

/** pi 会话的工作目录：ai-engine 包目录（避免 pi 加载后端项目里的 AGENTS.md 等无关上下文） */
const PI_CWD = process.cwd();

/**
 * 同步回调 → 异步迭代 适配队列。
 *
 * pi 的 subscribe 是同步回调，而 async generator 必须用 yield 吐事件——
 * 回调只能 enqueue，消费者 dequeue 取事件（空队列自动挂起，有事件自动返回）。
 * close() 后 dequeue 返回 undefined，作为「事件流已结束」的终止信号。
 */
class AsyncEventQueue<T> {
  private items: T[] = [];
  private waiters: Array<(v: T | undefined) => void> = [];
  private closed = false;

  enqueue(e: T) {
    this.items.push(e);
    this.waiters.shift()?.(this.items.shift()!);
  }

  /** 关闭队列：唤醒所有挂起的等待者，令其 dequeue 返回 undefined */
  close() {
    this.closed = true;
    while (this.waiters.length) this.waiters.shift()!(undefined);
  }

  async dequeue(): Promise<T | undefined> {
    if (this.items.length) return this.items.shift()!;
    if (this.closed) return undefined;
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

/** 最小 usage（历史 assistant 消息是回放数据，不参与计费） */
function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/** 通用消息 → pi-ai Message（历史回放；assistant/system 补齐必填元数据） */
function toPiMessage(m: ContextMessage): Message {
  switch (m.role) {
    case "user":
      return { role: "user", content: [{ type: "text", text: m.content }], timestamp: Date.now() };
    case "assistant":
      return {
        role: "assistant",
        content: [{ type: "text", text: m.content }],
        api: "openai-completions",
        provider: "custom",
        model: "history",
        usage: emptyUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      };
    case "system":
      return { role: "system", content: m.content, timestamp: Date.now() };
  }
}

/**
 * 建会话管理器（JSONL 文件模式）：
 * - SessionManager.open(sessionFile) 打开会话文件：存在则恢复完整分支树
 *   （含压缩摘要、分支结构），不存在则自动创建新会话（pi 内部 newSession，
 *   persist=true，首个 user 消息出现时整包写盘）。
 * - 有 pi.leafEntryId 且 entry 存在时 branch 定位（跨请求切分支）。
 * - 系统提示：恢复的树里无 system message 才注入（幂等，避免每轮重复累积）；
 *   新会话首次注入后随首个 user 消息一起落盘。
 */
function buildSessionManager(history: ContextMessage[] | undefined, pi: ChatOptions["pi"]): SessionManager {
  // 无 pi 会话文件（eval / 历史回放路径）：inMemory 兜底，不落盘
  if (!pi?.sessionFile) {
    const sm = SessionManager.inMemory(PI_CWD, { id: pi?.sessionId ?? `conv-${Date.now()}` });
    for (const m of history ?? []) {
      sm.appendMessage(toPiMessage(m));
    }
    sm.appendMessage({ role: "system", content: systemPrompt, timestamp: Date.now() });
    return sm;
  }

  // JSONL 文件模式：打开会话文件，存在则恢复完整分支树，不存在自动创建
  const sessionDir = dirname(pi.sessionFile);
  const sm = SessionManager.open(pi.sessionFile, sessionDir, PI_CWD);

  // 切过的分支：open 后 leaf 是文件最后一条 entry，需 branch 回到目标
  if (pi.leafEntryId && sm.getEntry(pi.leafEntryId)) {
    sm.branch(pi.leafEntryId);
  }

  // 历史回放（无 pi 会话的兼容路径：old 调用方仍传 history）
  for (const m of history ?? []) {
    sm.appendMessage(toPiMessage(m));
  }

  // 恢复/新建的会话：树里无 system 才补注入（幂等）
  const hasSystem = sm.getEntries().some((e) => e.type === "message" && (e as { message?: { role?: string } }).message?.role === "system");
  if (!hasSystem) {
    sm.appendMessage({ role: "system", content: systemPrompt, timestamp: Date.now() });
  }
  return sm;
}

/** 本轮新增 entry 摘要（供后端把 user/assistant 消息关联到 pi entry id） */
function diffAddedEntries(sm: SessionManager, priorIds: Set<string>): PiSessionSaved["added"] {
  return sm
    .getEntries()
    .filter((e) => !priorIds.has(e.id))
    .map((e) => ({
      id: e.id,
      type: e.type,
      role: e.type === "message" ? (e as { message?: { role?: string } }).message?.role : undefined,
    }));
}

/** 从工具执行结果里取格式化文本（AgentToolResult.content[0].text） */
function readToolResultText(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const first = content[0];
  if (typeof first === "object" && first !== null && "text" in first && typeof first.text === "string") {
    return first.text;
  }
  return undefined;
}

/** pi 会话事件 → 对外 StreamEvent（保持 chat.service.ts 消费的 5 种事件形状） */
function bridgeEvent(e: AgentSessionEvent, options: ChatOptions, scope: ReturnType<typeof createEmptyScope>): StreamEvent[] {
  switch (e.type) {
    case "message_update": {
      // assistantMessageEvent 是增量协议（text_delta / thinking_delta），
      // message.content 是累计 partial——直接用 content 会重复拼接。
      const out: StreamEvent[] = [];
      const delta = e.assistantMessageEvent;
      if (delta.type === "text_delta" && delta.delta) {
        out.push({ type: "token", content: delta.delta });
      } else if (delta.type === "thinking_delta" && delta.delta) {
        out.push({ type: "reasoning", content: delta.delta });
      }
      return out;
    }
    case "tool_execution_start":
      // 知识库检索 → 专用事件（前端据此先亮出检索状态）；其余工具走通用 tool_start
      if (e.toolName === "search_knowledge_base") {
        const args = e.args as { query?: unknown } | undefined;
        const query = typeof args?.query === "string" ? args.query : "";
        return [{ type: "knowledge_search", query, kbIds: options.kbIds ?? [] }];
      }
      return [{ type: "tool_start", name: e.toolName }];
    case "tool_execution_end":
      if (e.toolName === "search_knowledge_base") {
        // docs 是本次流**累计**的检索结果（模型可能并行/重试多次），
        // 每次调用结束时全量透出，后端据此汇总本轮知识来源。
        const docs = scope.results;
        const kbNames = [...new Set(docs.map((r) => r.kbName).filter((name): name is string => typeof name === "string"))];
        return [
          {
            type: "knowledge_search",
            query: "",
            kbIds: options.kbIds ?? [],
            kbNames,
            results: readToolResultText(e.result),
            docs,
          },
        ];
      }
      return [{ type: "tool_end", name: e.toolName, result: e.result }];
    default:
      return [];
  }
}

/** 从会话上下文里取最后一条 assistant 文本（chat/stream 用） */
function extractAssistantText(messages: readonly AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const parts: string[] = [];
    for (const block of m.content) {
      if (block.type === "text" && block.text) parts.push(block.text);
    }
    if (parts.length > 0) return parts.join("");
  }
  return "";
}

export class AiEngine {
  /**
   * 建一次会话（模型 + 会话管理器 + 带作用域的检索工具）。
   *
   * 每次调用都是全新闭包作用域：kbIds 与结果收集器互不共享，并发会话不会互相污染。
   */
  private async createPiSession(input: string, options: ChatOptions = {}) {
    const scope = createEmptyScope();
    const tool = createKnowledgeSearchTool(options.kbIds ?? [], scope);

    const model = await resolveModel(options.model);
    const sm = buildSessionManager(options.history, options.pi);
    // 记录进入前的 entry id 集合（跑完后 diff 出本轮新增，供后端关联消息）
    const priorIds = new Set(sm.getEntries().map((e) => e.id));

    const { session } = await createAgentSession({
      model,
      modelRuntime: await getModelRuntime(),
      sessionManager: sm,
      customTools: [tool],
      noTools: "builtin",
    });

    return { session, scope, priorIds };
  }

  /**
   * 普通对话：pi 跑完整一轮后取最后一条 assistant 文本。
   */
  async chat(input: string, options: ChatOptions = {}): Promise<string> {
    const { session } = await this.createPiSession(input, options);
    await session.prompt(input, { source: "rpc" });
    const ctx = session.sessionManager.buildSessionContext();
    return extractAssistantText(ctx.messages);
  }

  /**
   * 流式对话 + 观察整个执行过程（token + reasoning + tool）。
   *
   * pi 的 subscribe 是同步回调，不能直接 yield——事件经 AsyncEventQueue
   * 适配为异步迭代（回调 enqueue，主循环 dequeue 消费），直到 agent_end。
   * 生命周期事件（started / completed / failed）照旧发给 taskBus。
   * 会话持久化由 pi 自动完成（JSONL 文件 append）；结束后仅把本轮新增
   * entry 摘要回传（done 事件关联 user/assistant 消息用）。
   */
  async *streamEvents(input: string, options: ChatOptions = {}): AsyncGenerator<StreamEvent> {
    const taskId = newTaskId(TaskType.CHAT);
    const startedAt = Date.now();
    emit(TaskEvent.STARTED, { taskId, taskType: TaskType.CHAT, message: `对话：${input.slice(0, 50)}` });

    try {
      const { session, scope, priorIds } = await this.createPiSession(input, options);

      // 事件队列适配：订阅回调只 enqueue，主循环 dequeue 消费；prompt 结束后关闭队列
      const queue = new AsyncEventQueue<AgentSessionEvent>();
      session.subscribe((e) => queue.enqueue(e));
      const runPromise = session.prompt(input, { source: "rpc" });
      runPromise.finally(() => queue.close());

      // 主循环：消费事件直到 agent_end；队列耗尽且已关闭则终止
      let ended = false;
      while (!ended) {
        const e = await queue.dequeue();
        if (!e) break;
        for (const ev of bridgeEvent(e, options, scope)) {
          yield ev;
        }
        if (e.type === "agent_end") ended = true;
      }

      // prompt 的结果/异常在此浮出（reject 会传播给调用方）
      await runPromise;

      // 会话持久化：pi 已自动 append 到 JSONL 文件，无需后端回写。
      // 回传本轮新增 entry 摘要（done 事件关联消息）+ 分支尾指针（写 PG leaf）。
      if (options.onPiSessionSaved) {
        try {
          options.onPiSessionSaved({
            added: diffAddedEntries(session.sessionManager, priorIds),
            leafEntryId: session.sessionManager.getLeafId(),
          });
        } catch (saveErr) {
          console.error("[AiEngine] pi 会话增量回传失败:", saveErr);
        }
      }

      emit(TaskEvent.COMPLETED, { taskId, taskType: TaskType.CHAT, durationMs: Date.now() - startedAt });
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      emit(TaskEvent.FAILED, { taskId, taskType: TaskType.CHAT, durationMs: Date.now() - startedAt, error: e.message, stack: e.stack });
      throw err;
    }
  }
}
