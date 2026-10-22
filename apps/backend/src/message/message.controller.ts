import { CurrentUser } from "../auth/current-user.decorator";
import { Controller, Get, Post, Param, Body, Query, ParseIntPipe } from "@nestjs/common";
import { PiSessionService } from "../chat/pi-session.service";
import type { EditMessageDto, SwitchBranchDto } from "./dto/message.dto";

/**
 * 消息 / 分支操作 — 全部从 pi 会话（chat_conversation.session_data）派生。
 *
 * 消息 id 即 pi entry id（字符串）：
 *   - 列表：沿 leaf（或指定 entry）回溯 parentId 链
 *   - 编辑：分叉重放（在目标 entry 后开新分支 append 修改后消息）
 *   - 切分支：仅移动 leaf_entry_id 指针
 */
@Controller("api")
export class MessageController {
  constructor(private readonly piSessionService: PiSessionService) {}

  /** 获取某个分支的完整消息链（不传 rootId = 当前分支） */
  @Get("conversations/:convId/messages")
  async getBranchMessages(@Param("convId", ParseIntPipe) convId: number, @CurrentUser() user: { id: number }, @Query("rootId") rootId?: string) {
    return this.piSessionService.getMessages(convId, user.id, rootId || undefined);
  }

  /** 获取某条消息的所有分支子节点 */
  @Get("conversations/:convId/messages/:entryId/branches")
  async getBranches(@Param("convId", ParseIntPipe) convId: number, @CurrentUser() user: { id: number }, @Param("entryId") entryId: string) {
    return this.piSessionService.getBranches(convId, user.id, entryId);
  }

  /** 编辑消息（分叉重放：在目标 entry 后开新分支，返回新消息） */
  @Post("conversations/:convId/messages/:entryId/edit")
  async editMessage(@Param("convId", ParseIntPipe) convId: number, @CurrentUser() user: { id: number }, @Param("entryId") entryId: string, @Body() dto: EditMessageDto) {
    return this.piSessionService.editMessage(convId, user.id, entryId, dto.content);
  }

  /** 切换当前分支（移动 leaf 指针，下次对话从该 entry 恢复） */
  @Post("conversations/:convId/switch-branch")
  async switchBranch(@Param("convId", ParseIntPipe) convId: number, @CurrentUser() user: { id: number }, @Body() dto: SwitchBranchDto) {
    return this.piSessionService.switchBranch(convId, user.id, dto.entryId);
  }
}
