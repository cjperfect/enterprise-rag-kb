import { Injectable } from "@nestjs/common";
import { ConversationService } from "../conversation/conversation.service";
import { PrismaService } from "../prisma/prisma.service";
import { PiSessionService } from "./pi-session.service";
import { AiEngine } from "@langchain-rag/ai-engine";
import type { RagSearchResult } from "@langchain-rag/ai-engine";
import { BusinessException } from "../common/exceptions/business.exception";
import { ErrorCode } from "@langchain-rag/shared";
import type { ChatDto, ChatStreamEvent } from "./dto/chat.dto";
import type { PiSessionLoad, PiSessionSaved } from "@langchain-rag/shared/interfaces";

/**
 * AI Chat 服务 — 组合操作
 *
 * 一次 POST /api/chat = 复用会话 + 恢复 pi 会话 + 调用模型 SSE 流式 + 整包落库。
 *
 * 会话状态（上下文/压缩/分支摘要）完全由 pi 管理：历史不再由后端拼接，
 * 不再维护自研消息树；对话结束把 pi 的内存态整包存进 pi_session 一行。
 * 消息列表 / 分支 / 编辑 / 切分支由 PiSessionService 从 pi_session 派生。
 */
@Injectable()
export class ChatService {
  private readonly aiEngine = new AiEngine();

  constructor(
    private readonly conversationService: ConversationService,
    private readonly prisma: PrismaService,
    private readonly piSessionService: PiSessionService,
  ) {}

  async *streamChat(userId: number, chatDto: ChatDto): AsyncGenerator<ChatStreamEvent> {
    // 1. 获取会话（前端 initialize 已创建）
    const conversationId = chatDto.chat_session_id;
    if (conversationId == null) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, "未初始化会话");
    }

    const conv = await this.conversationService.get(conversationId);
    // 会话id传给前端，后续对话带过来
    yield { event: "session", data: { session_id: conversationId } };

    // 2. 定位 pi 会话（JSONL 文件）：生成/复用会话文件路径，leaf 指针来自 PG。
    //    对话全程由 pi 管理上下文（文件 append 即落盘，无需后端回写）。
    const sessionFile = await this.piSessionService.ensureSessionFile(conversationId);
    const piLoad: PiSessionLoad = {
      sessionId: PiSessionService.makeSessionId(conversationId),
      sessionFile,
      leafEntryId: conv.leafEntryId,
    };
    // 前端传了 parent_message_id（编辑后重新生成 / 从某条消息继续对话）
    // 则覆盖 leaf 指针，pi 从该 entry 开分支继续（entry 不存在时 ai-engine 自动忽略）
    if (chatDto.parent_message_id) {
      piLoad.leafEntryId = chatDto.parent_message_id;
    }

    // 3. 检索作用域：是否检索、检索几次都由 agent 决定，这里只声明「允许检索哪些库」
    const kbIds = chatDto.knowledge_ids?.length ? chatDto.knowledge_ids : chatDto.knowledge_id != null ? [chatDto.knowledge_id] : [];

    // 4. 调用 AI 引擎，流式输出。pi 会话从 PG 恢复 → ai-engine 内部
    //    SessionManager.inMemory(entries) 重建分支树，跑完回调返回最新状态。
    const startTime = Date.now();
    let fullContent = "";
    let fullReasoning = "";
    let inputTokens = 0;
    let outputTokens = 0;
    // agent 可能多次调用检索工具（改写重试），累计去重后作为本轮的知识来源
    const docMap = new Map<string, RagSearchResult>();

    let savedPayload: PiSessionSaved | null = null;

    try {
      const stream = this.aiEngine.streamEvents(chatDto.prompt, {
        history: [],
        model: chatDto.model,
        kbIds,
        pi: piLoad,
        onPiSessionSaved: (saved) => {
          savedPayload = saved;
        },
      });

      for await (const event of stream) {
        switch (event.type) {
          case "reasoning":
            fullReasoning += event.content;
            yield { event: "reasoning", data: { content: event.content } };
            break;
          case "tool_start":
            yield { event: "tool_start", data: { toolName: event.name } };
            break;
          case "tool_end":
            yield {
              event: "tool_end",
              data: { toolName: event.name, result: event.result },
            };
            break;
          case "knowledge_search":
            for (const doc of event.docs ?? []) {
              docMap.set(`${doc.kbId}:${doc.documentId}:${doc.chunkIndex ?? ""}:${doc.content}`, doc);
            }
            yield {
              event: "knowledge_search",
              data: { query: event.query, kbIds: event.kbIds, kbNames: event.kbNames, results: event.results },
            };
            break;
          case "token":
            fullContent += event.content;
            yield { event: "message", data: { content: event.content } };
            break;
        }
      }

      inputTokens = Math.ceil(chatDto.prompt.length / 4);
      outputTokens = Math.ceil((fullContent + fullReasoning).length / 4);
    } catch (error) {
      yield { event: "error", data: { error: String(error) } };
      return;
    }

    const latency = Date.now() - startTime;

    // 5. 汇总知识来源：从数据库补名称（向量 metadata 可能没有，旧数据兼容）
    const retrievedDocs = [...docMap.values()];
    const uniqueKbIds = [...new Set(retrievedDocs.map((d) => d.kbId))];
    const kbs =
      uniqueKbIds.length > 0
        ? await this.prisma.knowledgeBase.findMany({
            where: { id: { in: uniqueKbIds } },
            select: { id: true, name: true },
          })
        : [];
    const idToName = new Map(kbs.map((k) => [k.id, k.name]));

    // 6. 会话已由 pi 自动落盘（JSONL 文件 append），无需后端回写。
    //    added 里第一个 role=user 是本轮用户消息 entry、最后一个 role=assistant
    //    是本轮回复 entry（中间可能有 tool_result / thinking 等）。
    let userEntryId: string | null = null;
    let assistantEntryId: string | null = null;
    if (savedPayload) {
      const payload: PiSessionSaved = savedPayload as PiSessionSaved;
      const userEntry = payload.added.find((a) => a.type === "message" && a.role === "user");
      const assistantEntries = payload.added.filter((a) => a.type === "message" && a.role === "assistant");
      const assistantEntry = assistantEntries[assistantEntries.length - 1];
      userEntryId = userEntry?.id ?? null;
      assistantEntryId = assistantEntry?.id ?? null;
    }

    // 7. 更新会话统计 + 分支指针（leaf 优先用 pi 的 getLeafId，兜底用最后一条 assistant）+ 首次对话自动生成标题
    await this.conversationService.touch(conversationId, inputTokens + outputTokens);
    const leafId = (savedPayload as PiSessionSaved | null)?.leafEntryId ?? assistantEntryId;
    if (leafId) {
      await this.prisma.chatConversation.update({
        where: { id: conversationId },
        data: { leafEntryId: leafId },
      });
    }
    if (!conv.title) {
      await this.conversationService.update(conversationId, {
        title: chatDto.prompt.slice(0, 50),
      });
    }

    // 8. 结束事件：返回本轮问答的 entry id（pi entry id，字符串）+ RAG 来源，
    //    前端用于编辑/重新生成定位 + 展示知识来源。
    yield {
      event: "done",
      data: {
        request_message_id: userEntryId,
        response_message_id: assistantEntryId,
        rag_sources: retrievedDocs.map((d) => ({
          kbId: d.kbId,
          kbName: idToName.get(d.kbId) ?? d.kbName ?? `知识库#${d.kbId}`,
          documentId: d.documentId,
          documentName: d.documentName ?? `文档#${d.documentId}`,
          score: d.score,
        })),
      },
    };
  }

}
