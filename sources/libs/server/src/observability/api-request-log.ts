import { createHash } from "node:crypto";
import { getEnv } from "../env.js";
import {
  prepareBackendError,
  shouldCaptureApiStatus,
  type BackendErrorCaptureInput,
} from "./backend-error-log.js";
import { requireObservabilityPersistence } from "./observability-persistence.js";

export type ApiRequestLogInput = {
  requestId: string;
  traceId: string;
  userId?: string;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  requestBytes?: number;
  responseBytes?: number;
  platform?: string;
  ip?: string;
  userAgent?: string;
  errorCode?: string;
  errorMessage?: string;
  service?: string;
  error?: Omit<BackendErrorCaptureInput, "source" | "service">;
};

function hash(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function clip(value: string | undefined, max = 300): string | undefined {
  if (!value) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

export function shouldSkipApiLog(method: string, route: string): boolean {
  if (method === "OPTIONS") return true;
  return (
    route === "/health" ||
    route.startsWith("/api/local/personal-sync/transport/") ||
    route.startsWith("/api/docs") ||
    route.startsWith("/favicon") ||
    route.startsWith("/assets/")
  );
}

export function logApiRequest(input: ApiRequestLogInput): void {
  const env = getEnv();
  if (shouldSkipApiLog(input.method.toUpperCase(), input.route)) return;
  const repository = requireObservabilityPersistence();

  const capturedError = shouldCaptureApiStatus(input.statusCode)
    ? prepareBackendError({
        ...input.error,
        source: "api",
        service: input.service ?? "api-gateway",
        statusCode: input.statusCode,
        method: input.method,
        route: input.route,
        errorCode: input.errorCode,
        message:
          input.errorMessage ??
          input.error?.message ??
          `HTTP ${input.statusCode} response`,
      })
    : undefined;
  const request = env.API_LOG_DB_ENABLED
    ? {
          requestId: input.requestId,
          traceId: input.traceId,
          userId: input.userId,
          method: input.method.toUpperCase(),
          route: input.route,
          statusCode: input.statusCode,
          durationMs: Math.max(0, Math.round(input.durationMs)),
          requestBytes: input.requestBytes,
          responseBytes: input.responseBytes,
          platform: clip(input.platform, 80),
          ipHash: hash(input.ip),
          userAgentHash: hash(input.userAgent),
          errorCode: clip(capturedError?.errorCode ?? input.errorCode, 80),
          errorMessage: clip(capturedError?.message ?? input.errorMessage),
          errorFingerprint: capturedError?.fingerprint,
      }
    : undefined;
  const error = env.BACKEND_ERROR_LOG_ENABLED ? capturedError : undefined;
  if (!request && !error) return;
  void repository.recordApiRequest(request, error).catch((error: unknown) => {
    const reason = error instanceof Error ? error.name : "unknown error";
    console.error(`[API log] failed to write database: ${reason}`);
  });
}
