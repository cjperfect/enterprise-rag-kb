import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PI_SESSION_DIR } from "@enterprise-rag-kb/shared/constants";
import type { PiMessage } from "@enterprise-rag-kb/shared/interfaces";

/**
 * 项目根目录（用 __dirname 锚定，不依赖进程 cwd）：
 *   src 模式：apps/backend/src/chat → ../../../../ = 项目根
 *   dist 模式：apps/backend/dist/chat → ../../../../ = 项目根
 * 保证 .pi-sessions 始终落在项目根，无论从哪里启动 backend。
 */
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..", "..");

/**
 * pi 会话操作服务（JSONL 文件模式）
 *
 * 会话本体由 pi 的 SessionManager 以 JSONL 文件持久化（ai-engine 管理，
 * append 即落盘）；PG 的 chat_conversation 只记录：
 *   - session_file：JSONL 会话文件路径（本服务生成绝对路径）
 *   - leaf_entry_id：当前分支尾 entry id（pi 从文件恢复时 leaf 总是文件
 *     最后一条 entry，切分支后必须单独存指针，ai-engine open 后 branch 定位）
 *
 * 本服务是「消息 / 分支操作唯一入口」：读 JSONL → 纯 JSON 派生（沿 parentId
 * 回溯），编辑 = append 新 entry（分叉重放），切分支 = 更新 leaf 指针。
 * 不依赖 pi 包——backend 保持零 pi 依赖，pi 只在 ai-engine 侧运行。
 */
@Injectable()
export class PiSessionService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertOwner(conversationId: number, userId: number) {
    const conv = await this.prisma.chatConversation.findFirst({ where: { id: conversationId, userId, status: { in: [1, 2] } } });
    if (!conv) throw new NotFoundException("会话不存在");
  }

  /** 生成稳定 pi 会话 id（pi header.id，满足 [A-Za-z0-9._-]+ 规则） */
  static makeSessionId(conversationId: number): string {
    return `conv-${conversationId}`;
  }

  /** 会话 JSONL 文件绝对路径（项目根/.pi-sessions/conv-<id>.jsonl） */
  static sessionFilePath(conversationId: number): string {
    return join(PROJECT_ROOT, PI_SESSION_DIR, `${PiSessionService.makeSessionId(conversationId)}.jsonl`);
  }

  /** 生成 entry id（16 位 hex，与 pi 的短 id 风格一致，保证唯一即可） */
  private static genEntryId(): string {
    return randomUUID().replaceAll("-", "").slice(0, 16);
  }

  /**
   * 确保会话有 session_file 记录（首次对话前生成路径并落 PG）。
   * 返回会话文件绝对路径。
   */
  async ensureSessionFile(conversationId: number, userId: number): Promise<string> {
    await this.assertOwner(conversationId, userId);
    const file = PiSessionService.sessionFilePath(conversationId);
    const conv = await this.prisma.chatConversation.findUnique({
      where: { id: conversationId },
      select: { sessionFile: true },
    });
    if (!conv?.sessionFile) {
      await this.prisma.chatConversation.update({
        where: { id: conversationId },
        data: { sessionFile: file },
      });
    }
    return file;
  }

  // ========================================================================
  // JSONL 读取（文件不存在 / 坏行容错）
  // ========================================================================

  /** 读会话文件，解析为 entry 数组（跳过空行/坏行） */
  private readEntries(conversationId: number): PiEntry[] {
    const file = PiSessionService.sessionFilePath(conversationId);
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    const entries: PiEntry[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as PiEntry);
      } catch {
        // 坏行跳过（pi 只 append，正常不会出现；防御性容错）
      }
    }
    return entries;
  }

  // ========================================================================
  // 消息派生
  // ========================================================================

  /** 获取某条消息的所有分支子节点（entry 的直接子消息，新→旧） */
  async getBranches(conversationId: number, userId: number, entryId: string): Promise<PiMessage[]> {
    await this.assertOwner(conversationId, userId);
    const list = this.readEntries(conversationId)
      .filter((e) => e.type === "message" && e.parentId === entryId)
      .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
    return list.map(toPiMessage);
  }

  /**
   * 获取某条分支的完整消息链。
   *
   * 从 rootId（或当前 leaf）沿 parentId 回溯到根，取 message 类型 entry。
   * 不传 rootId 时返回当前分支（leaf 回溯链）。
   */
  async getMessages(conversationId: number, userId: number, rootId?: string): Promise<PiMessage[]> {
    await this.assertOwner(conversationId, userId);
    const entries = this.readEntries(conversationId);
    if (entries.length === 0) return [];

    const conv = await this.prisma.chatConversation.findUnique({
      where: { id: conversationId },
      select: { leafEntryId: true },
    });
    const byId = new Map(entries.map((e) => [e.id, e]));
    let start = rootId && byId.has(rootId) ? rootId : (conv?.leafEntryId ?? null);
    if (!start || !byId.has(start)) {
      // 无有效 leaf（新会话尚未对话）：取最后一条 entry 作为分支尾
      start = entries[entries.length - 1].id;
    }

    // 回溯 parentId 链 → 根到叶顺序
    const path: PiEntry[] = [];
    let cur: string | null = start;
    while (cur && byId.has(cur)) {
      const e = byId.get(cur)!;
      path.unshift(e);
      cur = e.parentId ?? null;
    }

    return path.filter((e) => e.type === "message").map(toPiMessage);
  }

  // ========================================================================
  // 编辑 / 切分支
  // ========================================================================

  /**
   * 编辑消息（分叉重放）：在目标 entry 后 append 修改后的 user 消息，
   * leaf 指向新 entry。原消息保留在树上（可回溯），下次对话从新分支继续。
   */
  async editMessage(conversationId: number, userId: number, entryId: string, content: string): Promise<PiMessage> {
    await this.assertOwner(conversationId, userId);
    const entries = this.readEntries(conversationId);
    if (!entries.some((e) => e.id === entryId)) {
      throw new NotFoundException("消息不存在");
    }

    const newEntry: PiEntry = {
      type: "message",
      id: PiSessionService.genEntryId(),
      parentId: entryId,
      timestamp: new Date().toISOString(),
      message: { role: "user", content: [{ type: "text", text: content }] },
    };

    const file = PiSessionService.sessionFilePath(conversationId);
    mkdirSync(join(PROJECT_ROOT, PI_SESSION_DIR), { recursive: true });
    appendFileSync(file, `${JSON.stringify(newEntry)}\n`, "utf8");
    await this.prisma.chatConversation.update({
      where: { id: conversationId },
      data: { leafEntryId: newEntry.id },
    });
    return toPiMessage(newEntry);
  }

  /** 切换当前分支：仅移动 leaf 指针（pi 的 branch 语义），下次对话从该 entry 恢复 */
  async switchBranch(conversationId: number, userId: number, entryId: string): Promise<void> {
    await this.assertOwner(conversationId, userId);
    const entries = this.readEntries(conversationId);
    if (!entries.some((e) => e.id === entryId)) {
      throw new NotFoundException("消息不存在");
    }
    await this.prisma.chatConversation.update({
      where: { id: conversationId },
      data: { leafEntryId: entryId },
    });
  }
}

// ============================================================================
// 类型与转换（pi entry JSON 形状）
// ============================================================================

interface PiEntry {
  type: string;
  id: string;
  parentId?: string | null;
  timestamp?: string;
  message?: {
    role: "user" | "assistant" | "system";
    content?: string | Array<{ type?: string; text?: string }>;
    model?: string;
  };
  [key: string]: unknown;
}

/** entry.message → 前端可展示的消息对象（文本/推理分离，工具调用不进正文） */
function toPiMessage(entry: PiEntry): PiMessage {
  const msg = entry.message;
  const parts = Array.isArray(msg?.content) ? msg.content : msg?.content ? [{ type: "text", text: String(msg.content) }] : [];

  const text = parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
  const reasoning = parts
    .filter((p) => p.type === "thinking")
    .map((p) => p.text ?? "")
    .join("");

  return {
    id: entry.id,
    role: msg?.role ?? "assistant",
    content: text || null,
    reasoningContent: reasoning || null,
    parentId: entry.parentId ?? null,
    messageType: "text",
    status: 1,
    createdAt: entry.timestamp ?? new Date().toISOString(),
    model: msg?.model ?? undefined,
  };
}
