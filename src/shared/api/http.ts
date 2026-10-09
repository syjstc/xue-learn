import { apiFetch } from "@/shared/api-client";
import {
  isTechnicalApiErrorMessage,
  messageForApiErrorStatus,
} from "@/shared/api/user-facing-error";


/**
 * Typed JSON helpers on top of apiFetch.
 *
 * All non-streaming client API calls should go through these so that:
 * - responses are parsed and typed in one place
 * - server errors ({ error } or NestJS { message }) become ApiError consistently
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown = undefined,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

function extractErrorDetails(
  body: unknown,
  status: number,
): { message: string; code?: string } {
  if (body && typeof body === "object") {
    const { error, message, code } = body as {
      error?: unknown;
      message?: unknown;
      code?: unknown;
    };
    const resolvedMessage =
      typeof message === "string" && message
        ? message
        : Array.isArray(message) && typeof message[0] === "string"
          ? message[0]
          : typeof error === "string" && error
            ? error
            : undefined;
    const resolvedCode = typeof code === "string" ? code : undefined;
    if (resolvedMessage && !isTechnicalApiErrorMessage(resolvedMessage)) {
      return { message: resolvedMessage, code: resolvedCode };
    }
    if (resolvedMessage) {
      return {
        message: messageForApiErrorStatus(status),
        code: resolvedCode,
      };
    }
  }
  if (typeof body === "string" && body && !isTechnicalApiErrorMessage(body)) {
    return { message: body.slice(0, 200) };
  }
  return { message: messageForApiErrorStatus(status) };
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await apiFetch(path, init);
  const body = await parseBody(res);
  if (!res.ok) {
    const { message, code } = extractErrorDetails(body, res.status);
    const apiError = new ApiError(message, res.status, body, code);
    throw apiError;
  }
  return body as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: "PATCH",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: "DELETE" });
}
