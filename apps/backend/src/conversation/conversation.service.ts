import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma } from "@prisma/client";
import { Exceptions } from "../common/exceptions/business.exception";
import { CommonStatus } from "@enterprise-rag-kb/shared";
import { AiEngine } from "@enterprise-rag-kb/ai-engine";
import type { CreateConversationDto, UpdateConversationDto, GenerateTitleDto } from "./dto/conversation.dto";

@Injectable()
export class ConversationService {
  private readonly aiEngine = new AiEngine();

  constructor(private readonly prisma: PrismaService) {}

  /** 创建新会话 */
  async create(userId: number, dto: CreateConversationDto) {
    if (dto.knowledgeId != null) {
      const kb = await this.prisma.knowledgeBase.findFirst({ where: { id: dto.knowledgeId, userId, status: { in: [1, 2] } } });
      if (!kb) throw Exceptions.notFound("知识库不存在");
    }
    return this.prisma.chatConversation.create({
      data: {
        userId,
        title: dto.title,
        systemPrompt: dto.systemPrompt,
        knowledgeId: dto.knowledgeId,
      },
    });
  }

  /** 获取用户会话列表（可按知识库筛选） */
  async list(userId: number, knowledgeId?: number) {
    const where: Prisma.ChatConversationWhereInput = {
      userId,
      status: { in: [CommonStatus.NORMAL, CommonStatus.ARCHIVED] },
    };
    if (knowledgeId !== undefined) {
      where.knowledgeId = knowledgeId;
    }

    return this.prisma.chatConversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        messageCount: true,
        totalTokens: true,
        branchCount: true,
        lastMessageAt: true,
        createdAt: true,
        knowledgeId: true,
        knowledge: {
          select: { name: true },
        },
      },
    });
  }

  /** 获取单个会话 */
  async get(conversationId: number, userId: number) {
    const conv = await this.prisma.chatConversation.findFirst({
      where: { id: Number(conversationId), userId, status: { in: [1, 2] } },
    });
    if (!conv) throw Exceptions.notFound("会话不存在");
    return conv;
  }

  /** 更新会话 */
  async update(conversationId: number, userId: number, dto: UpdateConversationDto) {
    await this.get(conversationId, userId); // 确保存在，否则抛异常
    return this.prisma.chatConversation.update({
      where: { id: conversationId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.systemPrompt !== undefined && { systemPrompt: dto.systemPrompt }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  /** 更新会话的最后消息时间和统计 */
  async touch(conversationId: number, tokens: number) {
    return this.prisma.chatConversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        messageCount: { increment: 2 }, // user + assistant
        totalTokens: { increment: tokens },
      },
    });
  }

  /** 软删除会话 */
  async delete(conversationId: number, userId: number) {
    await this.get(conversationId, userId); // 确保存在
    return this.prisma.chatConversation.update({
      where: { id: conversationId },
      data: { status: CommonStatus.DELETED },
    });
  }

  /** AI 生成会话标题 */
  async generateTitle(conversationId: number, userId: number, dto: GenerateTitleDto) {
    const conv = await this.get(conversationId, userId);

    // 已有非默认标题则跳过
    const isDefaultTitle = !conv.title || conv.title === "新会话" || conv.title.startsWith("知识库 - ");
    if (!isDefaultTitle) {
      return { title: conv.title };
    }

    // 取第一条用户消息内容
    const firstUserMsg = dto.messages.find((m) => m.role === "user");
    if (!firstUserMsg) {
      return { title: conv.title ?? "新会话" };
    }

    try {
      const title = await this.aiEngine.chat(
        `Generate a concise title (max 20 characters, prefer Chinese) for a conversation that starts with: "${firstUserMsg.content}". Output ONLY the title, no quotes, no explanation.`,
      );

      const cleanTitle = title.trim().slice(0, 50);
      await this.update(conversationId, userId, { title: cleanTitle });
      return { title: cleanTitle };
    } catch {
      // AI 生成失败，用首条消息前 50 字作为 fallback
      const fallback = firstUserMsg.content.slice(0, 50);
      await this.update(conversationId, userId, { title: fallback });
      return { title: fallback };
    }
  }
}
