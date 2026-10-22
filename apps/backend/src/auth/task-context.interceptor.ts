import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from "@nestjs/common";
import { Observable } from "rxjs";
import { taskContext } from "@enterprise-rag-kb/ai-engine";

@Injectable()
export class TaskContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const { user } = context.switchToHttp().getRequest<{ user?: { id: number } }>();
    return new Observable<unknown>((subscriber) => taskContext.run({ userId: user?.id }, () => next.handle().subscribe(subscriber)));
  }
}
