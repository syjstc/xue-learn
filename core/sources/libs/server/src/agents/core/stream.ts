import {
  formatApiException,
  localizeBackendPayload,
  safeJsonStringify,
  tBackend,
} from "../../../../common/src/index.js";
import type { AgentSseEvent } from "./types.js";

export function encodeAgentSseEvent(event: AgentSseEvent): string {
  return `data: ${safeJsonStringify(localizeBackendPayload(event))}\n\n`;
}

export function agentSseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function agentErrorMessage(error: unknown): { message: string; code?: string } {
  const raw = error instanceof Error ? error.message : String(error);
  if (
    /tool call/i.test(raw) ||
    /tool_calls/i.test(raw) ||
    /invalid params/i.test(raw) ||
    /\b2013\b/.test(raw)
  ) {
    return {
      message: tBackend("error.agent.stateOutOfSync"),
    };
  }
  const formatted = formatApiException(error);
  return {
    message: formatted.message || raw || tBackend("error.unknown"),
    ...(formatted.code ? { code: formatted.code } : {}),
  };
}

export function createAgentSseStream(
  run: (send: (event: AgentSseEvent) => void) => Promise<void>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  let terminalSent = false;
  const isClosedStreamError = (error: unknown) =>
    error instanceof TypeError &&
    /Controller is already closed|Invalid state/i.test(error.message);

  return new ReadableStream({
    async start(controller) {
      const send = (event: AgentSseEvent) => {
        if (closed) return;
        if (
          event.type === "done" ||
          event.type === "interrupt" ||
          event.type === "error" ||
          event.type === "cancelled"
        ) {
          terminalSent = true;
        }
        try {
          controller.enqueue(encoder.encode(encodeAgentSseEvent(event)));
        } catch (error) {
          if (isClosedStreamError(error)) {
            closed = true;
            return;
          }
          throw error;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      try {
        await run(send);
        if (!terminalSent) {
          send({ type: "done" });
        }
      } catch (e) {
        const formatted = agentErrorMessage(e);
        send({
          type: "error",
          message: formatted.message,
          ...(formatted.code ? { code: formatted.code } : {}),
        });
      } finally {
        close();
      }
    },
    cancel() {
      closed = true;
    },
  });
}
