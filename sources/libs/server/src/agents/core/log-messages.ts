import type { LlmMessageRecord } from "./types.js";

export type AgentLogMessage = {
  role: string;
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
};

/** Serialize agent transcript for LLM request logs. */
export function serializeAgentMessagesForLog(
  messages: LlmMessageRecord[],
): AgentLogMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.toolCalls?.length ? { toolCalls: message.toolCalls } : {}),
  }));
}
