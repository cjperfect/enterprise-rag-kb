/**
 * RemoteThreadListAdapter — 将后端 /api/conversations 适配为 assistant-ui
 * useRemoteThreadListRuntime 所需的 RemoteThreadListAdapter 接口。
 *
 * - remoteId: 后端会话 ID 转为字符串
 * - status:   后端 1→"regular", 2→"archived"
 */
"use client";

import type { RemoteThreadListAdapter, ThreadHistoryAdapter } from "@assistant-ui/react";
import { RuntimeAdapterProvider, useAuiState } from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";
import type { ExportedMessageRepository, ThreadMessage } from "@assistant-ui/react";
import { get, post, patch, del } from "@/lib/api";
import { useMemo, type FC, type PropsWithChildren } from "react";
import type { RemoteThreadMetadata, RemoteThreadListResponse, ConversationItem, BackendMessage } from "@/interfaces/chat";

// ---------------------------------------------------------------------------
// HistoryProvider — 点击会话时从后端加载历史消息
// ---------------------------------------------------------------------------
const HistoryProvider: FC<PropsWithChildren> = ({ children }) => {
  const remoteId = useAuiState((s) => s.threadListItem.remoteId) ?? "";

  const history = useMemo<ThreadHistoryAdapter>(
    () => ({
      async load(): Promise<ExportedMessageRepository> {
        const convId = getConversationId(remoteId);
        if (!convId) return { messages: [] };

        try {
          const msgs = await get<BackendMessage[]>(`/conversations/${convId}/messages`);
          if (!msgs.length) return { messages: [] };

          const items = msgs.map((m) => ({
            parentId: m.parentId ? String(m.parentId) : null,
            message: {
              id: String(m.id),
              role: m.role,
              content: [{ type: "text" as const, text: m.content ?? "" }],
              metadata: { custom: {} },
              status: { type: "complete" as const, reason: "stop" as const },
              createdAt: new Date(m.createdAt),
            } as ThreadMessage,
          }));

          return {
            headId: String(msgs[msgs.length - 1].id),
            messages: items,
          };
        } catch {
          return { messages: [] };
        }
      },

      async append() {
        // 消息由 chat.adapter 的 SSE 流处理
      },
    }),
    [remoteId],
  );

  return <RuntimeAdapterProvider adapters={{ history }}>{children}</RuntimeAdapterProvider>;
};

// ---------------------------------------------------------------------------
// threadId → conversationId 映射
// initialize 是唯一创建入口，remoteId 始终是后端数字 ID
//
// 注意：initialize 后 React 尚未 re-render，useLocalRuntime 里的
// useAuiState(remoteId) 可能仍是旧值。用 lastCreatedId 兜底。
// ---------------------------------------------------------------------------
let lastCreatedId: number | null = null;

/** 根据 remoteId 解析会话 ID */
export function getConversationId(remoteId: string | undefined): number | null {
  if (remoteId) {
    const parsed = parseInt(remoteId, 10);
    if (!isNaN(parsed)) return parsed;
  }
  // fallback：initialize 刚创建但 React 还没 re-render
  return lastCreatedId;
}

// ---------------------------------------------------------------------------
// 格式转换
// ---------------------------------------------------------------------------
const toMetadata = (c: ConversationItem): RemoteThreadMetadata => ({
  remoteId: String(c.id),
  title: c.title ?? "新会话",
  status: c.status === 2 ? "archived" : "regular",
  lastMessageAt: c.lastMessageAt ? new Date(c.lastMessageAt) : undefined,
  custom: {
    messageCount: c.messageCount,
    totalTokens: c.totalTokens,
    branchCount: c.branchCount,
    knowledgeId: c.knowledgeId,
    knowledgeName: c.knowledge?.name ?? null,
  },
});

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

export function createRemoteThreadListAdapter(options?: { knowledgeId?: number; defaultTitle?: string }): RemoteThreadListAdapter {
  const knowledgeId = options?.knowledgeId;
  const defaultTitle = options?.defaultTitle ?? "新会话";

  return {
    /** 为每个活跃线程注入历史消息加载能力 */
    unstable_Provider: HistoryProvider,

    /** 获取会话列表 */
    async list(): Promise<RemoteThreadListResponse> {
      const url = knowledgeId != null ? `/conversations?knowledge_id=${knowledgeId}` : "/conversations";
      const data = await get<ConversationItem[]>(url);
      return { threads: data.map(toMetadata) };
    },

    /** 新建会话 → POST /api/conversations */
    async initialize(): Promise<{ remoteId: string; externalId: string | undefined }> {
      const body: Record<string, unknown> = { title: defaultTitle };
      if (knowledgeId && knowledgeId > 0) body.knowledgeId = knowledgeId;
      console.log("[initialize] body:", JSON.stringify(body), "knowledgeId:", knowledgeId);
      const conv = await post<ConversationItem>("/conversations", body);
      lastCreatedId = conv.id;
      return { remoteId: String(conv.id), externalId: undefined };
    },

    /** 获取单个会话元数据 */
    async fetch(threadId: string): Promise<RemoteThreadMetadata> {
      const id = parseInt(threadId, 10);
      const conv = await get<ConversationItem>(`/conversations/${id}`);
      return toMetadata(conv);
    },

    /** 重命名 */
    async rename(remoteId: string, newTitle: string): Promise<void> {
      await patch(`/conversations/${remoteId}`, { title: newTitle });
    },

    /** 删除 */
    async delete(remoteId: string): Promise<void> {
      await del(`/conversations/${remoteId}`);
    },

    async generateTitle(remoteId: string, _unstable_messages): Promise<import("assistant-stream").AssistantStream> {
      const messagesForBackend = _unstable_messages.map((m) => ({
        role: m.role,
        content: m.content
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join(" "),
      }));

      try {
        const { title } = await post<{ title: string }>(`/conversations/${remoteId}/generate-title`, {
          messages: messagesForBackend,
        });
        if (title) {
          return createAssistantStream((controller) => {
            controller.appendText(title);
          });
        }
      } catch {
        /* 后端已处理所有 fallback，这里忽略 */
      }

      return createAssistantStream(() => {});
    },

    /** 归档 — 暂不启用 */
    async archive(): Promise<void> {
      // no-op
    },

    /** 取消归档 */
    async unarchive(): Promise<void> {
      // no-op
    },
  };
}

/** 首页会话适配器（无筛选） */
export const remoteThreadListAdapter = createRemoteThreadListAdapter();
