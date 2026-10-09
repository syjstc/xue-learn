import { apiFetch } from "@/shared/api-client";
import type { SseEvent } from "@/shared/llm/sse";
import {
  consumeSseResponse,
  type SseEventHandler,
} from "@/shared/client/sse-parser";

export { consumeSseResponse, type SseEventHandler };

export async function consumeSsePost(
  url: string,
  body: Record<string, unknown>,
  onEvent: SseEventHandler,
  signal?: AbortSignal
): Promise<SseEvent | null> {
  const res = await apiFetch(url, {
    method: "POST",
    headers: { Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  return consumeSseResponse(res, onEvent);
}

export async function consumeSseGet(
  url: string,
  onEvent: SseEventHandler,
  signal?: AbortSignal
): Promise<SseEvent | null> {
  const res = await apiFetch(url, {
    headers: { Accept: "text/event-stream" },
    signal,
  });
  return consumeSseResponse(res, onEvent);
}
