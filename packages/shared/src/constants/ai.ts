export const DEFAULT_MODEL = "deepseek-v4-flash";

/**
 * pi 会话 JSONL 文件目录（相对进程启动目录 = 项目根）。
 *
 * pi 的 SessionManager 以 JSONL 文件持久化会话：每个会话一个文件，
 * 路径约定 `<PI_SESSION_DIR>/conv-<conversationId>.jsonl`（sessionId 约定
 * `conv-<conversationId>`，两者同源）。backend（PiSessionService）与
 * ai-engine 共用此常量保证路径一致；PG 的 chat_conversation.session_file
 * 记录实际文件路径，读取时以 PG 为准。
 */
export const PI_SESSION_DIR = ".pi-sessions";

/** 按会话 id 生成 JSONL 文件路径（相对项目根） */
export function piSessionFilePath(sessionId: string): string {
  return `${PI_SESSION_DIR}/${sessionId}.jsonl`;
}
