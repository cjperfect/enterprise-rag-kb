import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { TaskType } from "@enterprise-rag-kb/ai-engine";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { EventsController } from "../task/events.controller";
import { EventsGateway, type TaskStreamMessage } from "../task/events.gateway";
import { Subject, firstValueFrom, take } from "rxjs";

jest.mock("@nestjs/event-emitter", () => ({ OnEvent: () => () => {} }));

jest.mock("@enterprise-rag-kb/ai-engine", () => ({
  TaskType: { DOCUMENT_INDEX: "document_index" },
  TaskEvent: { STARTED: "task.started", PROGRESS: "task.progress", COMPLETED: "task.completed", FAILED: "task.failed" },
}));

test("公开标记只跳过显式声明为 public 的路由", () => {
  const reflector = new Reflector();
  const guard = new JwtAuthGuard(reflector);
  const handler = () => {};
  Reflect.defineMetadata("public", true, handler);
  const context = { getHandler: () => handler, getClass: () => class {} };
  expect(guard.canActivate(context as unknown as ExecutionContext)).toBe(true);
});

test("任务订阅只推送当前用户的事件，包括 progress 与完成结果", async () => {
  const events$ = new Subject<TaskStreamMessage>();
  const gateway = { events$: events$.asObservable() };
  const controller = new EventsController(gateway as EventsGateway);
  const response = firstValueFrom(controller.stream({ id: 1 }, "document_index").pipe(take(1)));
  events$.next({ name: "task.completed", payload: { userId: 2, taskId: "secret", taskType: TaskType.DOCUMENT_INDEX, result: "其他用户文档" } });
  events$.next({ name: "task.progress", payload: { userId: 1, taskId: "own", taskType: TaskType.DOCUMENT_INDEX } });
  expect((await response).data).toContain('"taskId":"own"');
});
