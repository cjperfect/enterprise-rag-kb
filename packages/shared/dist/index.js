// src/enums/status.ts
var CommonStatus = /* @__PURE__ */ ((CommonStatus2) => {
  CommonStatus2[CommonStatus2["NORMAL"] = 1] = "NORMAL";
  CommonStatus2[CommonStatus2["ARCHIVED"] = 2] = "ARCHIVED";
  CommonStatus2[CommonStatus2["DELETED"] = 3] = "DELETED";
  CommonStatus2[CommonStatus2["FAILED"] = 4] = "FAILED";
  return CommonStatus2;
})(CommonStatus || {});
var ErrorCode = /* @__PURE__ */ ((ErrorCode2) => {
  ErrorCode2[ErrorCode2["SUCCESS"] = 200] = "SUCCESS";
  ErrorCode2[ErrorCode2["BAD_REQUEST"] = 400] = "BAD_REQUEST";
  ErrorCode2[ErrorCode2["UNAUTHORIZED"] = 401] = "UNAUTHORIZED";
  ErrorCode2[ErrorCode2["FORBIDDEN"] = 403] = "FORBIDDEN";
  ErrorCode2[ErrorCode2["NOT_FOUND"] = 404] = "NOT_FOUND";
  ErrorCode2[ErrorCode2["CONFLICT"] = 409] = "CONFLICT";
  ErrorCode2[ErrorCode2["TOO_MANY_REQUESTS"] = 429] = "TOO_MANY_REQUESTS";
  ErrorCode2[ErrorCode2["INTERNAL_ERROR"] = 500] = "INTERNAL_ERROR";
  ErrorCode2[ErrorCode2["EMAIL_ALREADY_EXISTS"] = 10001] = "EMAIL_ALREADY_EXISTS";
  ErrorCode2[ErrorCode2["INVALID_CREDENTIALS"] = 10002] = "INVALID_CREDENTIALS";
  ErrorCode2[ErrorCode2["TOKEN_EXPIRED"] = 10003] = "TOKEN_EXPIRED";
  ErrorCode2[ErrorCode2["USER_NOT_FOUND"] = 10004] = "USER_NOT_FOUND";
  ErrorCode2[ErrorCode2["WEAK_PASSWORD"] = 10005] = "WEAK_PASSWORD";
  ErrorCode2[ErrorCode2["CONVERSATION_NOT_FOUND"] = 20001] = "CONVERSATION_NOT_FOUND";
  ErrorCode2[ErrorCode2["CONVERSATION_ACCESS_DENIED"] = 20002] = "CONVERSATION_ACCESS_DENIED";
  ErrorCode2[ErrorCode2["CONVERSATION_ARCHIVED"] = 20003] = "CONVERSATION_ARCHIVED";
  ErrorCode2[ErrorCode2["MESSAGE_NOT_FOUND"] = 30001] = "MESSAGE_NOT_FOUND";
  ErrorCode2[ErrorCode2["MESSAGE_NOT_IN_CONVERSATION"] = 30002] = "MESSAGE_NOT_IN_CONVERSATION";
  ErrorCode2[ErrorCode2["MESSAGE_GENERATION_FAILED"] = 30003] = "MESSAGE_GENERATION_FAILED";
  ErrorCode2[ErrorCode2["UNSUPPORTED_MESSAGE_TYPE"] = 30004] = "UNSUPPORTED_MESSAGE_TYPE";
  ErrorCode2[ErrorCode2["FILE_NOT_FOUND"] = 40001] = "FILE_NOT_FOUND";
  ErrorCode2[ErrorCode2["FILE_TOO_LARGE"] = 40002] = "FILE_TOO_LARGE";
  ErrorCode2[ErrorCode2["UNSUPPORTED_FILE_TYPE"] = 40003] = "UNSUPPORTED_FILE_TYPE";
  ErrorCode2[ErrorCode2["TOOL_EXECUTION_FAILED"] = 50001] = "TOOL_EXECUTION_FAILED";
  ErrorCode2[ErrorCode2["TOOL_EXECUTION_TIMEOUT"] = 50002] = "TOOL_EXECUTION_TIMEOUT";
  ErrorCode2[ErrorCode2["AGENT_EXECUTION_FAILED"] = 50003] = "AGENT_EXECUTION_FAILED";
  ErrorCode2[ErrorCode2["DOCUMENT_NOT_FOUND"] = 60001] = "DOCUMENT_NOT_FOUND";
  ErrorCode2[ErrorCode2["DOCUMENT_PARSE_FAILED"] = 60002] = "DOCUMENT_PARSE_FAILED";
  ErrorCode2[ErrorCode2["RAG_RETRIEVAL_FAILED"] = 60003] = "RAG_RETRIEVAL_FAILED";
  ErrorCode2[ErrorCode2["KNOWLEDGE_BASE_NOT_FOUND"] = 60004] = "KNOWLEDGE_BASE_NOT_FOUND";
  return ErrorCode2;
})(ErrorCode || {});
export {
  CommonStatus,
  ErrorCode
};
