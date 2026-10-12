/** 后端传入的上下文消息格式（与 LangChain 解耦） */
export interface ContextMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * pi 会话定位载荷（会话本体存 JSONL 文件，PG 记录文件位置 + 分支指针）
 *
 * pi 的 SessionManager 以 JSONL 文件持久化（append 即落盘）。backend 从
 * chat_conversation 读出 session_file / leaf_entry_id 传入 ai-engine：
 *   ai-engine 用 SessionManager.open(sessionFile) 恢复分支树，
 *   有 leafEntryId 则 branch 定位到切过的分支；新会话文件不存在时自动创建。
 */
export interface PiSessionLoad {
  /** pi 会话 header.id（`conv-<conversationId>`，无则新会话自动生成） */
  sessionId?: string;
  /** JSONL 会话文件路径（backend 从 chat_conversation.session_file 读出） */
  sessionFile: string;
  /** 恢复后要定位的分支尾 entry id（chat_conversation.leaf_entry_id，可空） */
  leafEntryId?: string | null;
}

/** 一轮对话结束后的 pi 会话增量（pi 已自动写盘，只需新增 entry 摘要 + 分支指针） */
export interface PiSessionSaved {
  /** 本轮新增 entry 摘要（把 user/assistant 消息关联到 pi entry id，供 done 事件） */
  added: { id: string; type: string; role?: string }[];
  /** 当前分支尾 entry id（写回 chat_conversation.leaf_entry_id，下次对话 branch 定位） */
  leafEntryId: string | null;
}

/**
 * 派生消息（PiSessionService 从 pi 会话 entry 树回溯生成，id = pi entry id）。
 * 结构对齐旧 BackendMessage，前端可平滑切换。
 */
export interface PiMessage {
  /** pi entry id（字符串，取代旧自增数字 id） */
  id: string;
  role: "user" | "assistant" | "system";
  /** 正文（仅 text 部分；空则 null） */
  content: string | null;
  /** 推理过程内容（thinking 部分，深度思考模型专用） */
  reasoningContent?: string | null;
  /** 父消息 entry id（构建对话树） */
  parentId: string | null;
  messageType: string;
  status: number;
  createdAt: string;
  model?: string;
}

export interface ChatOptions {
  history?: ContextMessage[];
  model?: string;
  /**
   * 本次请求允许检索的知识库范围。
   *
   * 由调用方（后端）从会话配置得出，经 `configurable` 下传给 agent 的检索工具，
   * **不从模型输入取**——作用域是 harness 的职责，模型无权扩大检索范围。
   * 为空 / 未传表示「未指定知识库」，检索工具会 fail-closed 拒绝检索。
   */
  kbIds?: number[];
  /** pi 会话恢复数据（后端从 pi_session_entry 读出传入；缺省 = 新会话） */
  pi?: PiSessionLoad;
  /** 对话结束回调（ai-engine 返回最新会话状态，后端据此写回 PG） */
  onPiSessionSaved?: (saved: PiSessionSaved) => void;
}
