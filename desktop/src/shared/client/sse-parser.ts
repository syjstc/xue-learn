import { GenerationCancelledError } from "@/shared/generation/errors";
import type { SseEvent } from "@/shared/llm/sse";
import { getUserFacingApiErrorMessage } from "@/shared/api/user-facing-error";

const MAX_SSE_EVENT_BYTES = 1024 * 1024;
const MAX_SSE_BUFFER_BYTES = 2 * 1024 * 1024;

export type SseEventHandler = (event: SseEvent, id?: number) => void;

export async function consumeSseResponse(
  res: Response,
  onEvent: SseEventHandler,
): Promise<SseEvent | null> {
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      code?: string;
    };
    const message = getUserFacingApiErrorMessage({
      status: res.status,
      message: err.message ?? err.error,
    });
    throw new Error(message);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error(translateCurrent("desktop.i18n.streamMissing"));

  const decoder = new TextDecoder();
  let buffer = "";
  let lastDone: SseEvent | null = null;
  let reachedTerminalEvent = false;

  const consumeBlock = (block: string) => {
    if (!block || block.startsWith(":")) return;
    if (block.length > MAX_SSE_EVENT_BYTES) {
      throw new Error(translateCurrent("desktop.i18n.streamEventTooLarge"));
    }
    const data: string[] = [];
    let id: number | undefined;
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const separator = line.indexOf(":");
      const field = separator < 0 ? line : line.slice(0, separator);
      let value = separator < 0 ? "" : line.slice(separator + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "data") data.push(value);
      if (field === "id") {
        const parsed = Number.parseInt(value, 10);
        if (Number.isSafeInteger(parsed) && parsed >= 0) id = parsed;
      }
    }
    if (data.length === 0) return;
    const raw = data.join("\n");
    let event: SseEvent;
    try {
      event = JSON.parse(raw) as SseEvent;
    } catch {
      throw new Error(translateCurrent("desktop.i18n.streamInvalid"));
    }
    onEvent(event, id);
    if (event.type === "cancelled") {
      throw new GenerationCancelledError(event.message);
    }
    if (event.type === "error") {
      throw new Error(event.message);
    }
    if (event.type === "done") {
      lastDone = event;
      reachedTerminalEvent = true;
    }
    // Human-in-the-loop agent streams intentionally stop after yielding an
    // interrupt. The next request resumes the pending tool call.
    if ((event as { type: string }).type === "interrupt") {
      reachedTerminalEvent = true;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      if (buffer.length > MAX_SSE_BUFFER_BYTES) {
        throw new Error(translateCurrent("desktop.i18n.streamBufferTooLarge"));
      }
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) consumeBlock(block);
    }
    buffer += decoder.decode().replace(/\r\n/g, "\n");
    if (buffer.trim()) consumeBlock(buffer);
  } finally {
    reader.releaseLock();
  }
  if (!reachedTerminalEvent) {
    throw new Error(translateCurrent("desktop.i18n.streamInterrupted"));
  }
  return lastDone;
}
import { translateCurrent } from "@xue-learn/core/i18n";
