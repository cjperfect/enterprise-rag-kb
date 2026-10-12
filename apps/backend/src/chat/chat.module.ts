import { Module } from "@nestjs/common";
import { ChatService } from "./chat.service";
import { ChatController } from "./chat.controller";
import { PiSessionService } from "./pi-session.service";
import { ConversationModule } from "../conversation/conversation.module";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [ConversationModule, PrismaModule],
  controllers: [ChatController],
  providers: [ChatService, PiSessionService],
  exports: [PiSessionService],
})
export class ChatModule {}
