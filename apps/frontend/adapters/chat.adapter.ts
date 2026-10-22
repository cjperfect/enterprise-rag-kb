import { ChatModelAdapter, type ChatModelRunResult, type ToolCallMessagePart, type ThreadAssistantMessagePart } from "@assistant-ui/react";
import { getConversationId } from "./remote-thread-list.adapter";
import { knowledgeBaseRegistry } from "@/lib/knowledge-base-registry";
import { atMentionFormatter } from "@/lib/directive-formatter";

async function* streamChat(body: Record<string, unknown>) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (response.status === 401) window.dispatchEvent(new Event("rag:unauthorized"));
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No reader available");

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let fullReasoning = "";
  const toolParts: ToolCallMessagePart[] = [];

  const buildParts = (): ChatModelRunResult["content"] => {
    const parts: ThreadAssistantMessagePart[] = [];
    if (fullReasoning) parts.push({ type: "reasoning", text: fullReasoning });
    if (fullText) parts.push({ type: "text", text: fullText });
    parts.push(...toolParts);
    return parts;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";

    for (const block of blocks) {
      let eventType = "message";
      let dataStr = "";

      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) eventType = line.slice(7).trim();
        else if (line.startsWith("data: ")) dataStr = line.slice(6);
      }

      if (!dataStr) continue;

      const d = JSON.parse(dataStr);

      switch (eventType) {
        case "error":
          throw new Error(d.error ?? "未知错误");
        case "reasoning":
          if (d.content) {
            fullReasoning += d.content;
            yield { content: buildParts() };
          }
          break;
        case "tool_start":
          toolParts.push({
            type: "tool-call",
            toolCallId: `tool_${toolParts.length}`,
            toolName: d.toolName ?? "unknown",
            args: {},
            argsText: "",
          });
          yield { content: buildParts() };
          break;
        case "tool_end": {
          const last = toolParts[toolParts.length - 1];
          if (last) toolParts[toolParts.length - 1] = { ...last, result: d.result };
          yield { content: buildParts() };
          break;
        }
        case "knowledge_search": {
          // 优先用后端下发的 kbNames，回退到本地 registry 查询
          const kbNames = (d.kbNames as string[])?.length
            ? (d.kbNames as string[])
            : ((d.kbIds ?? []) as number[]).map((id: number) => knowledgeBaseRegistry.getName(id)).filter(Boolean);
          // 在助手回复正文顶部显示知识来源（仅首次，避免重复插入）
          if (!fullText && kbNames.length > 0) {
            fullText = `> 📚 知识来源：**${kbNames.join("、")}**\n\n`;
          }
          yield { content: buildParts() };
          break;
        }
        case "message":
          if (d.content) {
            fullText += d.content;
            yield { content: buildParts() };
          }
          break;
        case "done":
          yield {
            content: buildParts(),
            metadata: {
              custom: {
                request_message_id: d.request_message_id,
                response_message_id: d.response_message_id,
                rag_sources: d.rag_sources ?? [],
              },
            },
          };
          break;
      }
    }
  }
}

export const chatAdapter: ChatModelAdapter = {
  async *run({ messages, context, unstable_threadId }) {
    const lastMessage = messages[messages.length - 1];
    const userMessage =
      lastMessage?.content
        ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n") ?? "";

    // 从当前会话的消息链中推导 parentMessageId，避免跨会话 ID 污染
    let parentMessageId: string | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        parentMessageId = messages[i].id || null;
        break;
      }
    }

    const conversationId = getConversationId(unstable_threadId);

    // Extract @mention labels and look up their KB IDs
    const mentions = atMentionFormatter
      .parse(userMessage)
      .filter((seg) => seg.kind === "mention")
      .map((seg) => seg.label);
    const kbIds = knowledgeBaseRegistry.getIds(mentions);

    const body: Record<string, unknown> = { prompt: userMessage };
    if (conversationId) body.chat_session_id = conversationId;
    if (parentMessageId) body.parent_message_id = parentMessageId;
    if (kbIds.length > 0) body.knowledge_ids = kbIds;
    if (context.config?.modelName) body.model = context.config.modelName;

    yield* streamChat(body);
  },
};

export function createKnowledgeChatAdapter(knowledgeBaseId: number): ChatModelAdapter {
  return {
    async *run({ messages, context, unstable_threadId }) {
      const conversationId = getConversationId(unstable_threadId);

      const lastMessage = messages[messages.length - 1];
      const userMessage =
        lastMessage?.content
          ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n") ?? "";

      // 从当前会话的消息链中推导 parentMessageId
      let parentMessageId: string | null = null;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
          parentMessageId = messages[i].id || null;
          break;
        }
      }

      const body: Record<string, unknown> = {
        prompt: userMessage,
        knowledge_ids: [knowledgeBaseId],
      };
      if (conversationId) body.chat_session_id = conversationId;
      if (parentMessageId) body.parent_message_id = parentMessageId;
      if (context.config?.modelName) body.model = context.config.modelName;

      yield* streamChat(body);
    },
  };
}
