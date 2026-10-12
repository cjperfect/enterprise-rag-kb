export interface ChatDto {
  /** 用户提示词 */
  prompt: string;
  /** 会话 ID（前端 initialize 已创建，必传） */
  chat_session_id: number;
  /** 模型（前端 ModelSelector 选择） */
  model?: string;
  /** 是否开启思考模式 */
  thinking_enabled?: boolean;
  /** 父级消息 entry id（pi entry id，字符串；不传 = 从当前分支尾继续） */
  parent_message_id?: string;
  /** @mention 选中的知识库 ID 列表 */
  knowledge_ids?: number[];
  /** 知识库内聊天的知识库 ID */
  knowledge_id?: number;
}

/**
 * SSE 流式事件
 */
export type ChatStreamEvent =
  | { event: "session"; data: { session_id: number } }
  | { event: "reasoning"; data: { content: string } }
  | { event: "tool_start"; data: { toolName?: string } }
  | { event: "tool_end"; data: { toolName?: string; result?: unknown } }
  | { event: "knowledge_search"; data: { query: string; kbIds?: number[]; results?: string; kbNames?: string[] } }
  | { event: "message"; data: { content: string } }
  | {
      event: "done";
      data: {
        request_message_id: string | null;
        response_message_id: string | null;
        rag_sources?: Array<{ kbId: number; kbName: string; documentId: number; documentName: string; score: number }>;
      };
    }
  | { event: "error"; data: { error: string } };
