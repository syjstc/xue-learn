/**
 * Maps API / network failures to learner-facing copy.
 * Prefer domain messages from the API when they are already human-readable;
 * replace status codes and Nest/framework boilerplate.
 */

export type ApiErrorKind =
  | "network"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limit"
  | "payment"
  | "timeout"
  | "bad_request"
  | "server"
  | "unknown";

export type ResolvedUserFacingApiError = {
  kind: ApiErrorKind;
  message: string;
  /** True when a server/domain message was kept as-is. */
  isDomainMessage: boolean;
};

const TECHNICAL_MESSAGE_PATTERNS: RegExp[] = [
  /^请求失败(\s*\(\d+\))?$/u,
  /^Request failed(\s*\(\d+\))?$/iu,
  /^Internal server error$/iu,
  /^Internal Server Error$/u,
  /^服务器内部错误$/u,
  /^伺服器內部錯誤$/u,
  /^Unknown error$/iu,
  /^未知错误$/u,
  /^未知錯誤$/u,
  /^HTTP_\d+$/u,
  /^INTERNAL_SERVER_ERROR$/u,
  /^NOT_FOUND$/u,
  /^BAD_REQUEST$/u,
  /^UNAUTHORIZED$/u,
  /^FORBIDDEN$/u,
  /^CONFLICT$/u,
  /^TOO_MANY_REQUESTS$/u,
  /^PAYMENT_REQUIRED$/u,
  /^Not Found$/iu,
  /^Bad Request$/iu,
  /^Bad Gateway$/iu,
  /^Service Unavailable$/iu,
  /^Gateway Timeout$/iu,
  /^Failed to fetch$/iu,
  /^Load failed$/iu,
  /^NetworkError( when attempting to fetch resource)?\.?$/iu,
  /^Network request failed$/iu,
  /^The network connection was lost\.?$/iu,
  /^timeout$/iu,
  /^AbortError$/iu,
  /^cancelled$/iu,
  /^canceled$/iu,
  /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET/iu,
];

function readStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.statusCode === "number") return candidate.statusCode;
  return undefined;
}

/**
 * If a client accidentally surfaces the raw API JSON envelope
 * (`{"code":"NOT_FOUND","error":"NOT_FOUND","message":"..."}`), pull out the
 * nested domain message so learners never see protocol fields.
 */
function unwrapApiErrorMessage(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as {
      message?: unknown;
      error?: unknown;
    };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim();
    }
  } catch {
    // Not a JSON envelope — keep the original text.
  }
  return trimmed;
}

function readRawMessage(error: unknown): string | undefined {
  if (typeof error === "string" && error.trim()) {
    return unwrapApiErrorMessage(error);
  }
  if (error instanceof Error && error.message.trim()) {
    return unwrapApiErrorMessage(error.message);
  }
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown };
    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return unwrapApiErrorMessage(candidate.message);
    }
  }
  return undefined;
}

export function isTechnicalApiErrorMessage(message: string): boolean {
  const trimmed = unwrapApiErrorMessage(message);
  if (!trimmed) return true;
  if (/^<!DOCTYPE|^<html/i.test(trimmed)) return true;
  if (/^\d{3}\s+[A-Za-z]/.test(trimmed) && trimmed.length < 40) return true;
  // Unparseable leftover that still looks like an API envelope.
  if (
    trimmed.startsWith("{") &&
    /"(code|error|statusCode|message)"\s*:/.test(trimmed)
  ) {
    return true;
  }
  return TECHNICAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function classifyApiError(error: unknown): ApiErrorKind {
  const status = readStatus(error);
  const raw = readRawMessage(error) ?? "";

  if (
    status === undefined &&
    (isTechnicalApiErrorMessage(raw) ||
      /network|fetch|offline|连接|網路|网络/i.test(raw))
  ) {
    return "network";
  }

  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 402) return "payment";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limit";
  if (status === 408 || status === 504) return "timeout";
  if (status !== undefined && status >= 500) return "server";
  if (status !== undefined && status >= 400) return "bad_request";
  return "unknown";
}

/** Default zh-Hans copy used by non-React API helpers. */
export function messageForApiErrorKind(kind: ApiErrorKind): string {
  switch (kind) {
    case "network":
      return "网络连接异常，请检查网络后重试。";
    case "unauthorized":
      return "登录已过期，请重新登录。";
    case "forbidden":
      return "没有权限执行此操作。";
    case "not_found":
      return "找不到相关内容。";
    case "conflict":
      return "操作冲突，请刷新后重试。";
    case "rate_limit":
      return "操作太频繁，请稍后再试。";
    case "payment":
      return "积分不足，请充值后再试。";
    case "timeout":
      return "请求超时，请稍后再试。";
    case "bad_request":
      return "请求无效，请检查后重试。";
    case "server":
      return "服务暂时出了点问题，请稍后再试。";
    case "unknown":
      return "暂时无法完成请求，请稍后再试。";
  }
}

export function messageForApiErrorStatus(status: number): string {
  return messageForApiErrorKind(classifyApiError({ status }));
}

export function resolveUserFacingApiError(
  error: unknown,
  fallback?: string,
): ResolvedUserFacingApiError {
  const kind = classifyApiError(error);
  const kindDefault = messageForApiErrorKind(kind);
  const raw = readRawMessage(error);
  if (
    raw &&
    !isTechnicalApiErrorMessage(raw) &&
    raw !== kindDefault
  ) {
    return { kind, message: raw, isDomainMessage: true };
  }
  if (
    fallback &&
    !isTechnicalApiErrorMessage(fallback) &&
    fallback !== kindDefault
  ) {
    return { kind, message: fallback, isDomainMessage: true };
  }
  return {
    kind,
    message: kindDefault,
    isDomainMessage: false,
  };
}

export function getUserFacingApiErrorMessage(
  error: unknown,
  fallback?: string,
): string {
  return resolveUserFacingApiError(error, fallback).message;
}
