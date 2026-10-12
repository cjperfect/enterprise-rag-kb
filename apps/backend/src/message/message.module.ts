import { Module } from "@nestjs/common";
import { MessageController } from "./message.controller";
import { PiSessionService } from "../chat/pi-session.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [MessageController],
  providers: [PiSessionService],
})
export class MessageModule {}
