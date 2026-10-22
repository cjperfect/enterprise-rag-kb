import { randomBytes } from "node:crypto";

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) throw new Error("生产环境必须配置 JWT_SECRET");
/** 本地未配置时使用进程级随机密钥，重启后需重新登录。 */
export const JWT_SECRET = process.env.JWT_SECRET ?? randomBytes(32).toString("hex");
export const AUTH_COOKIE = "rag_session";
export const COOKIE_OPTIONS = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/api", maxAge: 7 * 24 * 60 * 60 * 1000 } as const;
