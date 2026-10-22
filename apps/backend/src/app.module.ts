import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { TaskContextInterceptor } from "./auth/task-context.interceptor";
import { Module } from "@nestjs/common";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AuthModule } from "./auth/auth.module";
import { ChatModule } from "./chat/chat.module";
import { ConversationModule } from "./conversation/conversation.module";
import { MessageModule } from "./message/message.module";
import { KnowledgeModule } from "./knowledge/knowledge.module";
import { DocumentModule } from "./document/document.module";
import { PrismaModule } from "./prisma/prisma.module";
import { EventsController } from "./task/events.controller";
import { EventsGateway } from "./task/events.gateway";

@Module({
  imports: [
    // 事件总线：创建全局 EventEmitter2 实例，@OnEvent 监听器绑定到它
    // （main.ts 会把 ai-engine 内建 taskBus 桥接到该实例，供 emit 转发）
    EventEmitterModule.forRoot({ global: true }),
    PrismaModule,
    AuthModule,
    ConversationModule,
    MessageModule,
    ChatModule,
    KnowledgeModule,
    DocumentModule,
  ],
  controllers: [AppController, EventsController],
  // EventsGateway 同时承担结构化日志 + SSE 多播（原 TaskListener 职责已合并）
  providers: [AppService, EventsGateway, { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_INTERCEPTOR, useClass: TaskContextInterceptor }],
})
export class AppModule {}
