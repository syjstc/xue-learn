import {
  parseMessageForLog,
  type ParsedChatLog,
} from "./parse-log-response.js";
import { parseLlmJson } from "./sanitize-response.js";

type RawStructuredResult = {
  raw?: unknown;
  parsed?: unknown;
};

function isRawStructuredResult(value: unknown): value is RawStructuredResult {
  return typeof value === "object" && value !== null && "parsed" in value;
}

function rawMessageForLog(raw: unknown) {
  if (typeof raw !== "object" || raw === null) return undefined;
  return parseMessageForLog(raw as Parameters<typeof parseMessageForLog>[0]);
}

function normalizeToolCallArgs(args: unknown): unknown {
  if (typeof args === "string") {
    try {
      return parseLlmJson(args);
    } catch {
      return args;
    }
  }
  return args;
}

function candidateFromRawLog(rawLog: ParsedChatLog): unknown {
  for (const toolCall of rawLog.toolCalls) {
    const args = normalizeToolCallArgs(toolCall.args);
    if (args != null && typeof args === "object") return args;
  }

  if (rawLog.jsonPreview != null) return rawLog.jsonPreview;

  for (const text of [rawLog.text, rawLog.raw]) {
    if (!text.trim()) continue;
    try {
      return parseLlmJson(text);
    } catch {
      // try next source
    }
  }

  return null;
}

/** Recover structured payload when LangChain native parse returns null. */
export function resolveNativeStructuredPayload(result: unknown): {
  candidate: unknown;
  rawLog?: ParsedChatLog;
} {
  const raw = isRawStructuredResult(result) ? result.raw : undefined;
  const rawLog = rawMessageForLog(raw);
  const direct = isRawStructuredResult(result) ? result.parsed : result;
  if (direct != null) {
    return { candidate: direct, rawLog };
  }
  if (!rawLog) {
    return { candidate: null };
  }
  return { candidate: candidateFromRawLog(rawLog), rawLog };
}
