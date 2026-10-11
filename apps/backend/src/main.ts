import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { AppModule } from "./app.module";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { taskBus, TaskEvent } from "@langchain-rag/ai-engine";
import { pino } from "pino";
import { pinoHttp } from "pino-http";

// 结构化日志根 logger：生产环境输出 JSON（接 ELK/Datadog 可检索），
// 开发环境用 pino-pretty 输出彩色可读日志（pino-pretty 需装为 devDependency）
const pinoRoot = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } }
      : undefined,
});

// 把 pino 适配成 Nest LoggerService（Nest 要求 log/error/warn/verbose 方法）
class PinoNestLogger {
  constructor(private readonly base: typeof pinoRoot) {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  log(msg: any, ...args: any[]) { this.base.info(String(msg), ...args); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info(msg: any, ...args: any[]) { this.base.info(String(msg), ...args); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn(msg: any, ...args: any[]) { this.base.warn(String(msg), ...args); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error(msg: any, ...args: any[]) { this.base.error(String(msg), ...args); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug(msg: any, ...args: any[]) { this.base.debug(String(msg), ...args); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  verbose(msg: any, ...args: any[]) { this.base.debug(String(msg), ...args); }
}

// Prisma Pg adapter 返回原生 bigint，JSON.stringify 默认不支持序列化。
// 添加全局 toJSON 将 BigInt 转为 Number（PRISMA 的 id 在安全范围内）。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

/** 允许的前端源（逗号分隔），默认覆盖 localhost 与 127.0.0.1 两种写法 */
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ?? "http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * 是否为本机/局域网源
 *
 * 开发期前端可能从 127.0.0.1 或 Next 打印的局域网地址（如 192.168.x.x:3000）访问，
 * 硬编码单个 origin 会让这些访问被 CORS 拦掉 —— 表现为 SSE 连不上、进度不推送。
 * 生产环境（NODE_ENV=production）不放开这条宽松规则。
 */
function isPrivateNetworkOrigin(origin: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }

  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;

  // RFC1918 私有网段：10.0.0.0/8、172.16.0.0/12、192.168.0.0/16
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: new PinoNestLogger(pinoRoot) });

  // pino-http：每个请求自动输出 JSON 日志（method/path/status/耗时/user-agent），
  // 生产环境接日志系统可按 requestId 串联一次请求的全部日志
  app.use(pinoHttp({ logger: pinoRoot, autoLogging: { ignore: (req) => req.url === "/health" } }));

  // 全局响应拦截器 — 统一返回 { code, message, data }
  app.useGlobalInterceptors(new TransformInterceptor());

  // 全局异常过滤器 — 统一返回 { code, message, data: null }
  app.useGlobalFilters(new HttpExceptionFilter());

  const isProd = process.env.NODE_ENV === "production";

  app.enableCors({
    origin: (origin, callback) => {
      // 无 Origin 头的请求（curl、同源、SSE 直连）一律放行
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      if (!isProd && isPrivateNetworkOrigin(origin)) return callback(null, true);
      callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
    credentials: true,
  });

  // 桥接：ai-engine 内建 taskBus → NestJS EventEmitter2（@OnEvent 监听器绑定在它上面）。
  // ai-engine 的 emit(...) 发到 taskBus，这里转发到 nestBus，同一个注册表，事件不丢。
  const nestBus = app.get(EventEmitter2);
  for (const ev of [TaskEvent.STARTED, TaskEvent.PROGRESS, TaskEvent.COMPLETED, TaskEvent.FAILED]) {
    taskBus.on(ev, (payload) => nestBus.emit(ev, payload));
  }

  pinoRoot.info(`Server is running on port: ${process.env.PORT ?? 3001}`);
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
