import { HttpException } from "@nestjs/common";
import { ErrorCode } from "@enterprise-rag-kb/shared";

export class BusinessException extends HttpException {
  constructor(code: ErrorCode, message: string) {
    super(message, code);
  }
}

export const Exceptions = {
  /** 400 */
  badRequest: (message: string) => new BusinessException(ErrorCode.BAD_REQUEST, message),

  /** 401 */
  unauthorized: (message = "请先登录") => new BusinessException(ErrorCode.UNAUTHORIZED, message),

  /** 403 */
  forbidden: (message = "无权操作") => new BusinessException(ErrorCode.FORBIDDEN, message),

  /** 404 */
  notFound: (message = "资源不存在") => new BusinessException(ErrorCode.NOT_FOUND, message),

  /** 500 */
  internal: (message = "服务器内部错误") => new BusinessException(ErrorCode.INTERNAL_ERROR, message),
};
