/** 已登录的账号 */
export interface AuthUser {
  /** 用户 ID */
  id: number;
  /** 邮箱 */
  email: string;
}

/** 登录表单和会话状态 */
export interface AuthState {
  /** 启动检查尚未完成 */
  checking: boolean;
  /** 当前用户 */
  user: AuthUser | null;
  /** 注册模式 */
  register: boolean;
  /** 正在提交 */
  busy: boolean;
  /** 表单错误 */
  error: string;
}
