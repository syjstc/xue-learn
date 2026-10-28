import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { BackendErrorCaptureInput } from "./backend-error-log.js";

export type RequestContextStore = {
  requestId: string;
  traceId: string;
  userId?: string;
  method?: string;
  route?: string;
  startedAt?: number;
  service?: string;
  error?: Omit<BackendErrorCaptureInput, "source" | "service">;
};

const storage = new AsyncLocalStorage<RequestContextStore>();

function firstHeader(value: unknown): string | undefined {
  if (Array.isArray(value))
    return typeof value[0] === "string" ? value[0] : undefined;
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function resolveIncomingRequestIds(headers?: Record<string, unknown>): {
  requestId: string;
  traceId: string;
} {
  const requestId =
    firstHeader(headers?.["x-request-id"]) ??
    firstHeader(headers?.["X-Request-ID"]) ??
    randomUUID();
  const traceId =
    firstHeader(headers?.["x-trace-id"]) ??
    firstHeader(headers?.["X-Trace-ID"]) ??
    requestId;
  return { requestId, traceId };
}

export function runWithRequestContext<T>(
  context: RequestContextStore,
  fn: () => T,
): T {
  const parent = storage.getStore();
  return storage.run({ ...parent, ...context }, fn);
}

export function getRequestContext(): RequestContextStore | undefined {
  return storage.getStore();
}

export function setRequestContextUserId(userId: string | undefined): void {
  const store = storage.getStore();
  if (store && userId) store.userId = userId;
}

export function setRequestContextError(
  error: Omit<BackendErrorCaptureInput, "source" | "service">,
): void {
  const store = storage.getStore();
  if (store) store.error = error;
}
