import { AsyncLocalStorage } from "node:async_hooks";

/** 单次请求的事件归属，避免并发用户任务串流。 */
export const taskContext = new AsyncLocalStorage<{ userId?: number }>();
/**
 * 任务事件定义 + 事件总线（ai-engine 内建）
 *
 * 原实现把事件定义与 holder 放在 shared 包（setEventBus 注入 Nest 实例），
 * 现改为 ai-engine 自带一个 Node 原生 EventEmitter 实例（taskBus）：
 *  - ai-engine 内部 emit(...) 直接发到 taskBus，零依赖、可独立运行/单测；
 *  - backend bootstrap 时把 taskBus 桥接到 NestJS EventEmitter2
 *    （taskBus.on(...) → nestBus.emit(...)），@OnEvent 监听器照常工作；
 *  - 去掉 shared 的 events 部分后，backend 不再依赖 shared/events。
 */

import { EventEmitter } from "node:events";

/**
 * 任务类型枚举
 *
 * - DOCUMENT_INDEX：文档切片 + 向量化（RagService）
 * - RAG_SEARCH：向量检索（RagService.search）
 * - CHAT：Agent 流式对话（AiEngine.streamEvents）
 */
export enum TaskType {
  /** 文档索引 */
  DOCUMENT_INDEX = "document_index",
  /** RAG 检索 */
  RAG_SEARCH = "rag_search",
  /** 对话流式 */
  CHAT = "chat",
}

/** 任务事件名常量（as const 保留字面量类型，供 @OnEvent 精确匹配） */
export const TaskEvent = {
  /** 任务开始 */
  STARTED: "task.started",
  /** 任务进度更新 */
  PROGRESS: "task.progress",
  /** 任务成功完成 */
  COMPLETED: "task.completed",
  /** 任务失败 */
  FAILED: "task.failed",
} as const;

/** 任务事件载荷（各阶段字段可选，四种事件共用） */
export interface TaskEventPayload {
  /** 任务所属用户；后台独立任务可为空 */
  userId?: number;
  /** 任务唯一 ID */
  taskId: string;
  /** 任务类型 */
  taskType: TaskType;
  /** 人类可读描述（便于日志展示） */
  message?: string;
  /** 关联知识库 ID（索引/检索任务） */
  kbId?: number;
  /** 关联文档 ID（索引任务） */
  documentId?: number;
  /** 关联知识库 ID 列表（检索任务） */
  kbIds?: number[];
  /** 当前步骤序号（progress 事件，从 1 开始） */
  step?: number;
  /** 总步骤数（progress 事件，可省略） */
  total?: number;
  /** 任务耗时毫秒（completed/failed 事件） */
  durationMs?: number;
  /** 任务产出（completed 事件；监听方注意截断展示，避免大对象刷屏） */
  result?: unknown;
  /** 错误信息（failed 事件） */
  error?: string;
  /** 错误堆栈（failed 事件） */
  stack?: string;
}

/** 生成任务唯一 ID（格式：taskType-uuid） */
export function newTaskId(taskType: TaskType): string {
  return `${taskType}-${globalThis.crypto.randomUUID()}`;
}

/**
 * 事件总线（ai-engine 内建实例）
 *
 * backend 启动时桥接：taskBus.on(event, payload => nestBus.emit(event, payload))，
 * 之后 backend 的 @OnEvent 订阅者照常收到事件。ai-engine 未桥接时独立运行也安全
 * （事件没有监听者只是没人接收，不影响业务）。
 */
export const taskBus = new EventEmitter();

/** 触发事件（ai-engine 内部统一走这里） */
export function emit(event: string, ...args: unknown[]): boolean {
  const payload = args[0];
  if (typeof payload === "object" && payload !== null) {
    return taskBus.emit(event, { ...payload, userId: taskContext.getStore()?.userId }, ...args.slice(1));
  }
  return taskBus.emit(event, ...args);
}

/**
 * 包揽任务生命周期事件：started → run() → completed / failed
 *
 * Promise 型任务直接包；AsyncGenerator（如流式对话）包不了，请手动 emit 三段。
 *
 * @param taskType 任务类型
 * @param context started 事件的附加上下文（kbId / documentId / message 等）
 * @param run 业务逻辑，入参 taskId 可用于 emit PROGRESS
 */
export async function withTaskEvents<T>(
  taskType: TaskType,
  context: { kbId?: number; documentId?: number; kbIds?: number[]; message?: string },
  run: (taskId: string) => Promise<T>,
): Promise<T> {
  const taskId = newTaskId(taskType);
  const startedAt = Date.now();

  emit(TaskEvent.STARTED, { taskId, taskType, ...context });

  try {
    const result = await run(taskId);
    emit(TaskEvent.COMPLETED, { taskId, taskType, durationMs: Date.now() - startedAt, result });
    return result;
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    emit(TaskEvent.FAILED, { taskId, taskType, durationMs: Date.now() - startedAt, error: e.message, stack: e.stack });
    throw err;
  }
}
