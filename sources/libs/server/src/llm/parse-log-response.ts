import { type BaseMessage, isAIMessage } from "@langchain/core/messages";
import {
  extractAssistantText,
  extractJsonFromLlmText,
  stripThinkingTags,
} from "./sanitize-response.js";

export type LogToolCall = {
  id?: string;
  name: string;
  args: unknown;
};

export type ParsedChatLog = {
  raw: string;
  text: string;
  thinking?: string;
  toolCalls: LogToolCall[];
  jsonText?: string;
  jsonPreview?: unknown;
  jsonParseError?: string;
};

const THINKING_EXTRACT_PATTERNS = [
  /<think>([\s\S]*?)<\/think>/i,
  /<think>([\s\S]*?)<\/redacted_thinking>/i,
  /<thinking>([\s\S]*?)<\/think>/i,
  /<thinking>([\s\S]*?)<\/thinking>/i,
];

function extractThinkingBlock(raw: string): string | undefined {
  for (const pattern of THINKING_EXTRACT_PATTERNS) {
    const match = raw.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  const closeThink = raw.match(/^([\s\S]*?)<\/think>\s*/i);
  if (closeThink?.[1]?.trim()) return closeThink[1].trim();
  return undefined;
}

/** Skip expensive JSON mining on plain chat prose that merely contains `{` / `[`. */
function shouldTryJsonExtraction(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/```(?:json)?/i.test(trimmed)) return true;
  return /^[\[{]/.test(trimmed);
}

export type ChatLogMessage = {
  role: string;
  content: string;
  toolCalls?: LogToolCall[];
};

function messageContentForLog(message: BaseMessage): string {
  const { content } = message;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return String((part as { text?: string }).text ?? "");
      }
      return "";
    })
    .join("");
}

/** Serialize LangChain chat messages for LLM request logs. */
export function serializeChatMessagesForLog(
  messages: BaseMessage[],
): ChatLogMessage[] {
  return messages.map((message) => {
    const role =
      typeof message._getType === "function" ? message._getType() : "unknown";
    const toolCalls = toolCallsFromMessage(message);
    return {
      role,
      content: messageContentForLog(message),
      ...(toolCalls.length ? { toolCalls } : {}),
    };
  });
}

export function toolCallsFromMessage(msg: BaseMessage): LogToolCall[] {
  if (typeof msg?._getType !== "function") return [];
  if (!isAIMessage(msg)) return [];
  const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  return calls.map((tc: { id?: string; name: string; args: unknown }) => ({
    id: tc.id,
    name: tc.name,
    args: tc.args,
  }));
}

/** Normalize LLM output for logs and the dev viewer. */
export function parseChatLogResponse(
  raw: string,
  toolCalls: LogToolCall[] = []
): ParsedChatLog {
  const thinking = extractThinkingBlock(raw);
  const text = stripThinkingTags(raw);
  let jsonText: string | undefined;
  let jsonPreview: unknown;
  let jsonParseError: string | undefined;

  if (shouldTryJsonExtraction(text)) {
    try {
      jsonText = extractJsonFromLlmText(text);
      jsonPreview = JSON.parse(jsonText) as unknown;
    } catch (err) {
      jsonParseError =
        err instanceof Error ? err.message : "Failed to extract JSON";
    }
  }

  return {
    raw,
    text,
    thinking,
    toolCalls,
    jsonText,
    jsonPreview,
    jsonParseError,
  };
}

export function parseMessageForLog(msg: BaseMessage): ParsedChatLog {
  const raw = extractAssistantText(msg);
  return parseChatLogResponse(raw, toolCallsFromMessage(msg));
}

/**
 * Prefer provider text, then forced tool-call args, then the validated
 * structured value. Function-calling replies often have empty assistant text.
 */
export function structuredResponseRawForLog(
  rawLog: ParsedChatLog | undefined | null,
  fallback?: unknown,
): unknown {
  if (rawLog?.raw.trim()) return rawLog.raw;
  if (rawLog?.toolCalls.length) {
    return rawLog.toolCalls.map((call) => ({
      ...(call.id ? { id: call.id } : {}),
      name: call.name,
      args: call.args,
    }));
  }
  return fallback;
}

export function labelForOperation(operation: string, kind: string): string {
  if (operation.endsWith(".parse")) return "Parse JSON";
  if (kind === "search") {
    if (operation.includes("learning_path")) return "Web search · learning path";
    if (operation.includes("unit_context")) return "Web search · unit context";
    return "Web search";
  }
  if (kind === "rag") {
    if (operation.includes("ingest")) return "RAG · ingest";
    return "RAG · retrieve";
  }
  if (kind === "embedding") return "Embedding";
  if (kind === "audio") {
    if (operation.includes("deck")) return "TTS · deck";
    if (operation.includes("segment")) return "TTS · segments";
    return "TTS";
  }
  if (operation.startsWith("agent.tool.")) {
    const name = operation.slice("agent.tool.".length).replace(/_/g, " ");
    return `Tool · ${name}`;
  }
  if (operation.startsWith("agent.goal_creation.")) {
    const name = operation
      .slice("agent.goal_creation.".length)
      .replace(/_/g, " ");
    return `Goal creation · ${name}`;
  }
  const short = operation.split(".").pop() ?? operation;
  return short.replace(/_/g, " ");
}

export function toolNameFromOperation(operation: string): string | undefined {
  if (operation.startsWith("agent.tool.")) {
    return operation.slice("agent.tool.".length);
  }
  if (operation.startsWith("agent.goal_creation.")) {
    return "goal_creation";
  }
  if (operation.startsWith("tavily.")) return operation;
  if (operation.startsWith("doubao.")) return operation;
  if (operation.startsWith("rag.")) return operation;
  return undefined;
}
