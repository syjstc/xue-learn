import type { SseEvent } from "@/shared/llm/sse";

export type AgentSseEvent =
  | SseEvent
  | { type: "message"; delta: string; role?: "assistant" }
  | {
      type: "tool_ui";
      toolCallId: string;
      toolName: string;
      uiKind: string;
      args: Record<string, unknown>;
    }
  | { type: "interrupt"; toolCallId: string; toolName: string }
  | {
      type: "phase";
      phase: string;
      subagent?: string;
    }
  | { type: "subagent"; name: string }
  | {
      type: "tool_call";
      toolCallId: string;
      toolName: string;
      status: "started" | "completed" | "error";
      args?: Record<string, unknown>;
      resultPreview?: string;
      error?: string;
    };
