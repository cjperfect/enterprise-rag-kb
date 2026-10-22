import { CurrentUser } from "../auth/current-user.decorator";
import { Controller, Query, Sse } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { filter, interval, map, merge, type Observable } from "rxjs";
import { EventsGateway, PING_EVENT } from "./events.gateway";

/** 心跳间隔，防止反向代理掐断空闲长连接 */
const HEARTBEAT_MS = 15_000;

/**
 * 任务事件流控制器
 *
 * GET /api/events/stream?types=document_index,chat
 *   - types 省略 => 推送全部任务类型
 *
 * 每条消息统一为 `data: {"name":"task.started","payload":{...}}`，
 * 前端一个 onmessage 即可分流处理（心跳的 name 为 "ping"，忽略即可）。
 */
@Controller("api/events")
export class EventsController {
  constructor(private readonly gateway: EventsGateway) {}

  @Sse("stream")
  stream(@CurrentUser() user: { id: number }, @Query("types") types?: string): Observable<MessageEvent> {
    const wanted = types
      ? new Set(
          types
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        )
      : null;

    // 心跳：定期发一条空消息，维持连接不被中间层回收
    const heartbeat$: Observable<MessageEvent> = interval(HEARTBEAT_MS).pipe(map(() => ({ data: JSON.stringify({ name: PING_EVENT, payload: null }) })));

    // 业务事件：按 taskType 过滤后透传
    const tasks$: Observable<MessageEvent> = this.gateway.events$.pipe(
      filter((m) => m.payload.userId === user.id && (!wanted || wanted.has(m.payload.taskType))),
      map((m) => ({ data: JSON.stringify(m) })),
    );

    return merge(heartbeat$, tasks$);
  }
}
