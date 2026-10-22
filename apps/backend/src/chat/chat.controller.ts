import { Controller, Body, Res, Post } from "@nestjs/common";
import { ChatService } from "./chat.service";
import type { ChatDto } from "./dto/chat.dto";
import { CurrentUser } from "../auth/current-user.decorator";
import type { Response } from "express";

@Controller("api")
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post("chat")
  async chat(@CurrentUser() user: { id: number }, @Body() chatDto: ChatDto, @Res() res: Response) {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    // no-transform：阻止 Next.js 代理层对 SSE 做 gzip 压缩（gzip 会缓冲整个流，导致前端一次性收到全部内容）
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // 立即发送响应头，让前端尽早建立流
    res.flushHeaders();

    try {
      const stream = this.chatService.streamChat(user.id, chatDto);

      // SSE 协议：event 行标识事件类型，data 行携带 JSON 负载
      for await (const { event, data } of stream) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }

      res.end();
    } catch (error) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: String(error) })}\n\n`);
      res.end();
    }
  }
}
