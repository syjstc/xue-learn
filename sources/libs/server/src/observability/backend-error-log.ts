import { createHash } from "node:crypto";
import { getEnv } from "../env.js";
import type { ObservabilityRepository } from "../../../domain/src/index.js";
import { requireObservabilityPersistence } from "./observability-persistence.js";

export type BackendErrorSource = "api" | "worker" | "internal";

export type BackendErrorCaptureInput = {
  source: BackendErrorSource;
  service: string;
  error?: unknown;
  errorName?: string;
  errorCode?: string;
  message?: string;
  stack?: string;
  statusCode?: number;
  method?: string;
  route?: string;
  operation?: string;
};

export type PreparedBackendError = {
  fingerprint: string;
  source: BackendErrorSource;
  service: string;
  errorName?: string;
  errorCode?: string;
  message: string;
  stack?: string;
  statusCode?: number;
  method?: string;
  route?: string;
  operation?: string;
};

const MESSAGE_MAX_CHARS = 1_000;
const STACK_MAX_CHARS = 8_192;
const CAPTURED_API_STATUSES = new Set([409, 422, 429]);

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s)]+/gi,
      "[REDACTED_CONNECTION_URL]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(authorization|cookie|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\b(\s*[:=]\s*)([^\s,;}\]]+)/gi,
      "$1$2[REDACTED]",
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(
      /\b(?:sk|pk|key|token)[-_][A-Za-z0-9_-]{16,}\b/gi,
      "[REDACTED_TOKEN]",
    )
    .replace(/\b[A-Za-z0-9+/=_-]{48,}\b/g, "[REDACTED_TOKEN]")
    .replace(
      /([?&](?:token|key|secret|password|signature)=)[^&\s]+/gi,
      "$1[REDACTED]",
    );
}

export function sanitizeBackendErrorText(
  value: unknown,
  maxChars = MESSAGE_MAX_CHARS,
): string {
  const text =
    typeof value === "string"
      ? value
      : value instanceof Error
        ? value.message
        : String(value ?? "");
  return clip(redactSensitiveText(text), Math.max(0, maxChars));
}

function normalizeVolatileText(value: string): string {
  return value
    .replace(/\?.*?(?=\s|$)/g, "?[QUERY]")
    .replace(
      /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/gi,
      "[TIMESTAMP]",
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "[UUID]",
    )
    .replace(/\bc[a-z0-9]{20,}\b/gi, "[CUID]")
    .replace(/\b[0-9a-f]{18,}\b/gi, "[HEX_ID]")
    .replace(/\b\d{8,}\b/g, "[LONG_NUMBER]")
    .replace(/:\d+:\d+(?=\)?(?:\s|$))/g, ":[LINE]:[COL]")
    .replace(/\s+/g, " ")
    .trim();
}

function firstApplicationFrame(stack: string | undefined): string {
  if (!stack) return "";
  const frame = stack
    .split("\n")
    .map((line) => line.trim())
    .find(
      (line) =>
        line.startsWith("at ") &&
        !line.includes("node_modules") &&
        !line.includes("node:internal"),
    );
  return normalizeVolatileText(frame ?? "");
}

function errorCodeFrom(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number"
    ? String(code)
    : undefined;
}

export function shouldCaptureApiStatus(statusCode: number): boolean {
  return statusCode >= 500 || CAPTURED_API_STATUSES.has(statusCode);
}

export function prepareBackendError(
  input: BackendErrorCaptureInput,
): PreparedBackendError {
  const errorName =
    input.errorName ??
    (input.error instanceof Error ? input.error.name : undefined);
  const errorCode = input.errorCode ?? errorCodeFrom(input.error);
  const rawMessage =
    input.message ??
    (input.error instanceof Error
      ? input.error.message
      : input.error === undefined
        ? "Unknown backend error"
        : String(input.error));
  const rawStack =
    input.stack ??
    (input.error instanceof Error ? input.error.stack : undefined);
  const message =
    sanitizeBackendErrorText(rawMessage, MESSAGE_MAX_CHARS) ||
    "Unknown backend error";
  const stack = rawStack
    ? sanitizeBackendErrorText(rawStack, STACK_MAX_CHARS)
    : undefined;
  const service = sanitizeBackendErrorText(input.service, 80) || "unknown";
  const source = input.source;
  const normalized = JSON.stringify({
    source,
    service,
    errorName: normalizeVolatileText(errorName ?? ""),
    errorCode: normalizeVolatileText(errorCode ?? ""),
    message: normalizeVolatileText(message),
    frame: firstApplicationFrame(stack),
  });

  return {
    fingerprint: createHash("sha256").update(normalized).digest("hex"),
    source,
    service,
    errorName: errorName ? sanitizeBackendErrorText(errorName, 120) : undefined,
    errorCode: errorCode ? sanitizeBackendErrorText(errorCode, 120) : undefined,
    message,
    stack,
    statusCode: input.statusCode,
    method: input.method
      ? sanitizeBackendErrorText(input.method.toUpperCase(), 16)
      : undefined,
    route: input.route ? sanitizeBackendErrorText(input.route, 500) : undefined,
    operation: input.operation
      ? sanitizeBackendErrorText(input.operation, 240)
      : undefined,
  };
}

export async function recordBackendError(
  input: BackendErrorCaptureInput,
  repository: ObservabilityRepository = requireObservabilityPersistence(),
): Promise<string | undefined> {
  if (!getEnv().BACKEND_ERROR_LOG_ENABLED) return undefined;
  const prepared = prepareBackendError(input);
  try {
    await repository.upsertBackendError(prepared);
    return prepared.fingerprint;
  } catch (error) {
    const reason = sanitizeBackendErrorText(error, 300);
    console.error(`[Backend error log] failed to write database: ${reason}`);
    return undefined;
  }
}
