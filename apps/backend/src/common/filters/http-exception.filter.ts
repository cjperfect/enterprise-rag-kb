import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { Response } from "express";
import { BusinessException } from "../exceptions/business.exception";
import { ErrorCode } from "@enterprise-rag-kb/shared";

/**
 * 全局异常过滤器 — 将所有异常包装为 { code, message, data }
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let code: number; // 响应体中的 code（ErrorCode）
    let message: string; // 响应体中的 message
    let httpStatus: number; // HTTP 状态码

    if (exception instanceof BusinessException) {
      httpStatus = exception.getStatus();
      code = httpStatus;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      httpStatus = exception.getStatus();
      code = httpStatus; // 非业务异常，code = HTTP 状态码
      const res = exception.getResponse();
      message = typeof res === "string" ? res : "message" in res && typeof res.message === "string" ? res.message : exception.message;
      if (Array.isArray(message)) {
        message = message[0]; // class-validator 错误取第一条
      }
    } else {
      // 未知异常
      httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
      code = ErrorCode.INTERNAL_ERROR;
      message = "服务器内部错误";
      this.logger.error("未捕获异常", exception instanceof Error ? exception.stack : exception);
    }

    response.status(httpStatus).json({
      code,
      message,
      data: null,
    });
  }
}
