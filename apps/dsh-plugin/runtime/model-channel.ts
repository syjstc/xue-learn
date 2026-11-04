import { randomUUID } from "node:crypto";
import type {HostLlmStreamRequest, HostLlmStreamDelta} from "@xue-learn/core/server/providers/llm";
type Pending = {chunks: HostLlmStreamDelta[]; done: boolean; error?: Error; wake: () => void};

/** Token streaming over private child-process IPC, including cancellation. */
export function modelChannel(send: (message: unknown) => void) {
  const pending = new Map<string, Pending>();
  let closed = false;
  return {
    receive(message: any) {
      if (!/^xuelearn\.dsh\.llm\.(chunk|tool|tool-delta|end|error)$/.test(message?.type ?? "")) return false;
      const entry = pending.get(message.id);
      if (!entry) return true;
      if (message.type.endsWith("chunk") && typeof message.text === "string") entry.chunks.push(message.text);
      if (message.type.endsWith("tool") && message.call?.type === "tool-call") entry.chunks.push(message.call);
      if (message.type.endsWith("tool-delta") && message.delta?.type === "tool-call-delta") entry.chunks.push(message.delta);
      if (message.type.endsWith("error")) entry.error = new Error(message.error || "DSH model call failed");
      if (message.type.endsWith("end") || message.type.endsWith("error")) entry.done = true;
      entry.wake();
      return true;
    },
    async *stream(request: HostLlmStreamRequest) {
      if (closed) throw new Error("DSH model host disconnected");
      request.signal?.throwIfAborted();
      const id = randomUUID();
      const entry: Pending = {chunks: [], done: false, wake: () => {}};
      pending.set(id, entry);
      const cancel = () => {
        entry.error ??= new Error("DSH model request cancelled");
        entry.done = true; entry.wake();
        send({type: "xuelearn.dsh.llm.cancel", id});
      };
      request.signal?.addEventListener("abort", cancel, {once: true});
      const timeout = setTimeout(() => {entry.error = new Error("DSH model request timed out"); cancel();}, 600_000);
      try {
        const {signal, ...payload} = request;
        send({type: "xuelearn.dsh.llm.request", id, ...payload});
        while (true) {
          if (entry.error) throw entry.error;
          if (entry.chunks.length) {yield entry.chunks.shift()!; continue;}
          if (entry.done) break;
          await new Promise<void>(resolve => {entry.wake = resolve;});
        }
      } finally {
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", cancel);
        pending.delete(id);
        if (!entry.done) send({type: "xuelearn.dsh.llm.cancel", id});
      }
    },
    close() {
      closed = true;
      for (const entry of pending.values()) {
        entry.error = new Error("DSH model host disconnected"); entry.done = true; entry.wake();
      }
    },
  };
}
