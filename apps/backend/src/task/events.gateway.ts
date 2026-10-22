import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { Subject, type Observable } from "rxjs";
import { TaskEvent } from "@enterprise-rag-kb/ai-engine";
import type { TaskEventPayload } from "@enterprise-rag-kb/ai-engine";

/** 推送给前端的消息体：事件名 + 原始 payload */
export interface TaskStreamMessage {
  name: string;
  payload: TaskEventPayload;
}

/** 心跳消息名（前端忽略） */
export const PING_EVENT = "ping";

/** result 序列化截断，避免大对象刷屏 */
function brief(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/**
 * 任务事件推流网关
 *
 * 订阅 EventEmitter2 上的 task.* 事件，一份 emit 两种用途：
 *  1. 结构化日志（原 TaskListener 职责，合并至此，链路排障的源头证据）；
 *  2. subject.next() 多播给所有 SSE 连接。
 *
 * Subject 是热的多播流：每个 SSE 连接订阅的是同一个 Subject，
 * 客户端断开只会 unsubscribe 它自己，不影响其他连接与网关本身。
 */
@Injectable()
export class EventsGateway {
  private readonly subject = new Subject<TaskStreamMessage>();
  private readonly logger = new Logger("TaskEvents");

  /** 供 SSE 控制器订阅的只读流 */
  get events$(): Observable<TaskStreamMessage> {
    return this.subject.asObservable();
  }

  // 四个精确订阅 —— 拆开写是因为 @OnEvent 的数组形式拿不到触发的事件名
  @OnEvent(TaskEvent.STARTED)
  onStarted(p: TaskEventPayload) {
    this.logger.log(`任务开始 taskId=${p.taskId} type=${p.taskType}${p.message ? ` ${p.message}` : ""}`);
    this.subject.next({ name: TaskEvent.STARTED, payload: p });
  }

  @OnEvent(TaskEvent.PROGRESS)
  onProgress(p: TaskEventPayload) {
    this.logger.log(`任务进度 taskId=${p.taskId} type=${p.taskType} step=${p.step ?? "?"}${p.message ? ` ${p.message}` : ""}`);
    this.subject.next({ name: TaskEvent.PROGRESS, payload: p });
  }

  @OnEvent(TaskEvent.COMPLETED)
  onCompleted(p: TaskEventPayload) {
    this.logger.log(`任务完成 taskId=${p.taskId} type=${p.taskType} duration=${p.durationMs}ms${p.result != null ? ` result=${brief(p.result)}` : ""}`);
    this.subject.next({ name: TaskEvent.COMPLETED, payload: p });
  }

  @OnEvent(TaskEvent.FAILED)
  onFailed(p: TaskEventPayload) {
    this.logger.error(`任务失败 taskId=${p.taskId} type=${p.taskType} duration=${p.durationMs}ms error=${p.error}`, p.stack);
    this.subject.next({ name: TaskEvent.FAILED, payload: p });
  }
}
