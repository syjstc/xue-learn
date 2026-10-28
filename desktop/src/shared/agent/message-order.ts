import type { AgentMessageRecord } from "./types.ts";

/** Repairs legacy follow-up turns that were persisted with identical timestamps. */
export function orderAgentMessagesForDisplay(
  messages: AgentMessageRecord[],
): AgentMessageRecord[] {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const timeDelta =
        new Date(a.message.createdAt).getTime() -
        new Date(b.message.createdAt).getTime();
      if (timeDelta !== 0) return timeDelta;
      if (a.message.role === "assistant" && b.message.role === "user") return 1;
      if (a.message.role === "user" && b.message.role === "assistant") return -1;
      return a.index - b.index;
    })
    .map(({ message }) => message);
}
