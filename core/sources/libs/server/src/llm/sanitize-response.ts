import { jsonrepair } from "jsonrepair";

/**
 * MiniMax and similar models may prepend reasoning blocks before JSON output.
 */

const THINKING_BLOCK_PATTERNS = [
  // MiniMax mismatched reasoning tags (redacted_thinking … think)
  /<think>[\s\S]*?<\/think>/gi,
  /<think>[\s\S]*?<\/redacted_thinking>/gi,
  /<thinking>[\s\S]*?<\/think>/gi,
  /<thinking>[\s\S]*?<\/thinking>/gi,
  /^[\s\S]*?<\/think>\s*/i,
];

/** Open reasoning blocks (stream ended before close tag). */
const UNCLOSED_THINKING_PATTERNS = [
  /<think>[\s\S]*$/gi,
  /<thinking>[\s\S]*$/gi,
];

const THINKING_OPEN = /<think>|<thinking>/i;
const THINKING_CLOSE = /<\/think>|<\/thinking>|<\/redacted_thinking>/i;

export function messageContentToString(
  content: string | Array<{ type?: string; text?: string }>,
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (isReasoningContentType(part.type)) return "";
      return part.text ?? "";
    })
    .join("");
}

type AssistantContentCarrier = {
  content?: unknown;
  additional_kwargs?: Record<string, unknown>;
  response_metadata?: Record<string, unknown>;
};

export type AssistantStreamChunk = {
  /** User-visible answer text. */
  delta: string;
  /** Provider emitted reasoning/thinking progress. */
  thinking: boolean;
  /** Plain-text provider reasoning, kept separate from the answer. */
  thinkingDelta?: string;
};

function isReasoningContentType(type: unknown): boolean {
  return (
    typeof type === "string" && /reason|thinking|thought|redacted/i.test(type)
  );
}

function unknownToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(unknownToText).join("");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.type === "string" && /redacted|encrypted/i.test(record.type)) return "";
    return unknownToText(record.text) || unknownToText(record.thinking) ||
      unknownToText(record.reasoning) || unknownToText(record.summary);
  }
  return "";
}

function reasoningTextFromRecord(record?: Record<string, unknown>): string {
  if (!record) return "";
  const directKeys = [
    "reasoning_content",
    "reasoning",
    "reasoningText",
    "reasoning_text",
    "thinking",
    "thinking_content",
    "thought",
    "reasoning_details",
  ];
  for (const key of directKeys) {
    const value = record[key];
    const text = unknownToText(value) ||
      (value && typeof value === "object" && "summary" in value
        ? unknownToText((value as { summary?: unknown }).summary)
        : "");
    if (text) return text;
  }
  return "";
}

function reasoningTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const typed = part as { type?: unknown };
      return isReasoningContentType(typed.type)
        ? unknownToText(part)
        : "";
    })
    .join("");
}

/** One streamed assistant chunk — answer and provider reasoning stay separate. */
export function extractAssistantStreamChunk(
  chunk: AssistantContentCarrier,
): AssistantStreamChunk {
  const content = messageContentToString(
    chunk.content as string | Array<{ type?: string; text?: string }>,
  );
  const reasoning =
    reasoningTextFromContent(chunk.content) ||
    reasoningTextFromRecord(chunk.additional_kwargs) ||
    reasoningTextFromRecord(chunk.response_metadata);
  const redacted = Array.isArray(chunk.content) && chunk.content.some(part =>
    part && typeof part === "object" && /redacted|encrypted/i.test(String(part.type)),
  );
  return {
    delta: content,
    thinking: reasoning.length > 0 || redacted,
    ...(reasoning ? { thinkingDelta: reasoning } : {}),
  };
}

/** One streamed assistant chunk — user-visible text only. */
export function extractAssistantStreamDelta(
  chunk: AssistantContentCarrier,
): string {
  return extractAssistantStreamChunk(chunk).delta;
}

/** Final assistant text — user-visible answer content only. */
export function extractAssistantText(chunk: AssistantContentCarrier): string {
  const content = messageContentToString(
    chunk.content as string | Array<{ type?: string; text?: string }>,
  );
  if (content.trim()) return content;
  return content;
}

// Hold only an actual possible tag prefix, never ordinary JSON/text. Holding a
// fixed tail delays a completed item's closing brace until another chunk arrives.
const THINKING_OPEN_TAGS = ["<think>", "<thinking>"];
const THINKING_CLOSE_TAGS = ["</think>", "</thinking>", "</redacted_thinking>"];
function thinkingTagTailLength(text: string, tags: readonly string[]): number {
  const start = text.lastIndexOf("<");
  if (start < 0) return 0;
  const tail = text.slice(start).toLowerCase();
  return tags.some(tag => tag.startsWith(tail)) ? tail.length : 0;
}

export class ThinkingTagStreamFilter {
  private buffer = "";
  private inThinking = false;

  push(
    delta: string,
    handlers: {
      onVisible: (delta: string) => void | Promise<void>;
      onThinking?: (delta?: string) => void | Promise<void>;
    },
  ): Promise<void> | void {
    this.buffer += delta;
    return this.drain(false, handlers);
  }

  flush(handlers: {
    onVisible: (delta: string) => void | Promise<void>;
    onThinking?: (delta?: string) => void | Promise<void>;
  }): Promise<void> | void {
    return this.drain(true, handlers);
  }

  private async drain(
    flush: boolean,
    handlers: {
      onVisible: (delta: string) => void | Promise<void>;
      onThinking?: (delta?: string) => void | Promise<void>;
    },
  ): Promise<void> {
    while (this.buffer) {
      if (this.inThinking) {
        const close = this.buffer.match(THINKING_CLOSE);
        if (!close || close.index === undefined) {
          const emitLength = flush
            ? this.buffer.length
            : this.buffer.length - thinkingTagTailLength(this.buffer, THINKING_CLOSE_TAGS);
          if (emitLength > 0) {
            await handlers.onThinking?.(this.buffer.slice(0, emitLength));
            this.buffer = this.buffer.slice(emitLength);
            continue;
          }
          break;
        }
        if (close.index > 0) await handlers.onThinking?.(this.buffer.slice(0, close.index));
        this.buffer = this.buffer.slice(close.index + close[0].length);
        this.inThinking = false;
        continue;
      }

      const open = this.buffer.match(THINKING_OPEN);
      if (!open || open.index === undefined) {
        const emitLength = flush
          ? this.buffer.length
          : this.buffer.length - thinkingTagTailLength(this.buffer, THINKING_OPEN_TAGS);
        if (emitLength > 0) {
          await handlers.onVisible(this.buffer.slice(0, emitLength));
          this.buffer = this.buffer.slice(emitLength);
          continue;
        }
        break;
      }

      if (open.index > 0) {
        await handlers.onVisible(this.buffer.slice(0, open.index));
      }
      this.buffer = this.buffer.slice(open.index + open[0].length);
      this.inThinking = true;
    }
  }
}

/** Remove model reasoning wrappers from raw text. */
export function stripThinkingTags(text: string): string {
  let out = text;
  let prev: string;
  do {
    prev = out;
    for (const pattern of THINKING_BLOCK_PATTERNS) {
      out = out.replace(pattern, "");
    }
    for (const pattern of UNCLOSED_THINKING_PATTERNS) {
      out = out.replace(pattern, "");
    }
  } while (out !== prev);
  return out.trim();
}

function extractBalancedJson(s: string, start: number): string {
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === open) depth++;
    if (c === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  throw new Error("Unclosed JSON in LLM response");
}

function closeUnfinishedJson(s: string): string {
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (const c of s) {
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === "{" || c === "[") {
      stack.push(c);
    } else if (
      (c === "}" && stack.at(-1) === "{") ||
      (c === "]" && stack.at(-1) === "[")
    ) {
      stack.pop();
    }
  }
  let repaired = s.trim();
  if (inString) repaired += '"';
  repaired += stack
    .reverse()
    .map((open) => (open === "{" ? "}" : "]"))
    .join("");
  return repaired;
}

function extractLeadingJson(s: string): string | undefined {
  const start = s.search(/\S/);
  if (start < 0 || (s[start] !== "{" && s[start] !== "[")) return undefined;
  try {
    return extractBalancedJson(s, start);
  } catch {
    return closeUnfinishedJson(s.slice(start));
  }
}

/** Guard against pathological scans on prose with many `{` / `[` characters. */
const MAX_JSON_CANDIDATE_SCANS = 2_000;

function collectBalancedJsonCandidates(s: string): string[] {
  const candidates: string[] = [];
  let scans = 0;
  for (let pos = 0; pos < s.length;) {
    if (++scans > MAX_JSON_CANDIDATE_SCANS) break;
    const offset = s.slice(pos).search(/[\[{]/);
    if (offset === -1) break;
    const start = pos + offset;
    try {
      const chunk = extractBalancedJson(s, start);
      candidates.push(chunk);
      pos = start + chunk.length;
    } catch {
      pos = start + 1;
    }
  }
  return candidates;
}

/** Extract a JSON object/array string from messy model output. */
export function extractJsonFromLlmText(text: string): string {
  let s = stripThinkingTags(text).replace(/^\uFEFF/, "");

  // A JSON string may legitimately contain Markdown code fences. When the
  // response itself starts with JSON, balance that root before looking for an
  // optional outer fence; otherwise an embedded ```python block is mistaken
  // for the response wrapper and the surrounding object is discarded.
  const leading = extractLeadingJson(s);
  if (leading) return leading;

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    s = fence[1].trim();
  } else if (s.includes("```")) {
    throw new Error("Malformed JSON code fence in LLM response");
  }

  const fencedLeading = extractLeadingJson(s);
  if (fencedLeading) return fencedLeading;

  // A common truncation drops only the root opening brace while leaving a
  // sequence of object fields and the closing brace intact.
  if (/^\s*"[^"\\]+"\s*:/.test(s)) {
    const objectBody = extractLeadingJson(`{${s}`);
    if (objectBody) return objectBody;
  }

  const candidates = collectBalancedJsonCandidates(s);
  if (candidates.length === 0) {
    throw new Error("No JSON found in LLM response");
  }
  // Prefer the last complete object — models often emit schema examples before the answer.
  return candidates[candidates.length - 1]!;
}

/**
 * Remove trailing commas before `}` or `]` in occasionally malformed LLM JSON.
 */
export function repairTrailingCommasInJson(text: string): string {
  let result = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;

    if (!inString) {
      if (c === '"') {
        inString = true;
        result += c;
        continue;
      }
      if (c === ",") {
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j]!)) j++;
        const next = text[j];
        if (next === "}" || next === "]") continue;
      }
      result += c;
      continue;
    }

    if (escape) {
      result += c;
      escape = false;
      continue;
    }
    if (c === "\\") {
      result += c;
      escape = true;
      continue;
    }
    if (c === '"') inString = false;
    result += c;
  }

  return result;
}

export function repairUnescapedQuotesInJson(text: string): string {
  let result = "";
  let inString = false;
  let escape = false;
  let stringRole: "key" | "value" = "value";
  const stack: Array<"object" | "array"> = [];
  let expectKey = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;

    if (!inString) {
      result += c;
      if (c === '"') {
        inString = true;
        stringRole =
          stack[stack.length - 1] === "object" && expectKey ? "key" : "value";
        continue;
      }
      if (c === "{") {
        stack.push("object");
        expectKey = true;
      } else if (c === "[") {
        stack.push("array");
        expectKey = false;
      } else if (c === "}" || c === "]") {
        stack.pop();
        expectKey = false;
      } else if (c === ":") {
        expectKey = false;
      } else if (c === ",") {
        expectKey = stack[stack.length - 1] === "object";
      }
      continue;
    }

    if (escape) {
      result += c;
      escape = false;
      continue;
    }

    if (c === "\\") {
      result += c;
      escape = true;
      continue;
    }

    if (c === '"') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      const next = text[j];
      const endsKey = stringRole === "key" && next === ":";
      const endsValue =
        stringRole === "value" &&
        (next === undefined || next === "," || next === "}" || next === "]");
      if (endsKey || endsValue) {
        result += c;
        inString = false;
        expectKey = false;
      } else {
        result += '\\"';
      }
      continue;
    }

    result += c;
  }

  return result;
}

function extractBalancedJsonValue(
  text: string,
  start: number,
): number | undefined {
  const opener = text[start];
  if (opener !== "{" && opener !== "[") return undefined;
  const closers: string[] = [opener === "{" ? "}" : "]"];
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === "{") {
      closers.push("}");
      continue;
    }
    if (char === "[") {
      closers.push("]");
      continue;
    }
    if (char !== "}" && char !== "]") continue;
    if (closers[closers.length - 1] !== char) return undefined;
    closers.pop();
    if (closers.length === 0) return index + 1;
  }
  return undefined;
}

function repairInnerJsonDocument(text: string): string {
  const trailingCommasRepaired = repairTrailingCommasInJson(text);
  const quotesRepaired = repairUnescapedQuotesInJson(trailingCommasRepaired);
  const escapesRepaired = repairInvalidEscapesInJson(quotesRepaired);
  const separatorsRepaired = repairMissingSeparatorsInJson(escapesRepaired);
  const closersRepaired =
    repairUnexpectedClosingDelimitersInJson(separatorsRepaired);
  try {
    JSON.parse(closersRepaired);
    return closersRepaired;
  } catch {
    try {
      return jsonrepair(closersRepaired);
    } catch {
      return text;
    }
  }
}

/**
 * DeepSeek often emits material envelope items as `"json": "{"type":..."}"` —
 * a string that starts a JSON object without escaping inner quotes. Re-encode
 * those values as real JSON strings so the outer document can parse.
 */
export function repairUnescapedEmbeddedJsonStrings(text: string): string {
  let result = "";
  let index = 0;
  let inString = false;
  let escape = false;
  let stringRole: "key" | "value" = "value";
  const stack: Array<"object" | "array"> = [];
  let expectKey = false;

  while (index < text.length) {
    const char = text[index]!;
    if (inString) {
      result += char;
      if (escape) {
        escape = false;
        index += 1;
        continue;
      }
      if (char === "\\") {
        escape = true;
        index += 1;
        continue;
      }
      if (char === '"') {
        let lookahead = index + 1;
        while (lookahead < text.length && /\s/.test(text[lookahead]!)) {
          lookahead += 1;
        }
        const next = text[lookahead];
        const endsKey = stringRole === "key" && next === ":";
        const endsValue =
          stringRole === "value" &&
          (next === undefined || next === "," || next === "}" || next === "]");
        if (endsKey || endsValue) {
          inString = false;
          expectKey = false;
        }
      }
      index += 1;
      continue;
    }
    if (char === '"') {
      const role =
        stack[stack.length - 1] === "object" && expectKey ? "key" : "value";
      const next = text[index + 1];
      if (role === "value" && (next === "{" || next === "[")) {
        const innerEnd = extractBalancedJsonValue(text, index + 1);
        if (innerEnd != null) {
          let closer = innerEnd;
          while (closer < text.length && /\s/.test(text[closer]!)) closer += 1;
          const repairedInner = repairInnerJsonDocument(
            text.slice(index + 1, innerEnd),
          );
          try {
            JSON.parse(repairedInner);
            result += JSON.stringify(repairedInner);
            index = text[closer] === '"' ? closer + 1 : innerEnd;
            expectKey = false;
            continue;
          } catch {
            // Fall through and treat this as an ordinary string.
          }
        }
      }
      inString = true;
      escape = false;
      stringRole = role;
      result += char;
      if (role === "key") expectKey = false;
      index += 1;
      continue;
    }
    result += char;
    if (char === "{") {
      stack.push("object");
      expectKey = true;
    } else if (char === "[") {
      stack.push("array");
      expectKey = false;
    } else if (char === "}" || char === "]") {
      stack.pop();
      expectKey = false;
    } else if (char === ":") {
      expectKey = false;
    } else if (char === ",") {
      expectKey = stack[stack.length - 1] === "object";
    }
    index += 1;
  }
  return result;
}

/**
 * Preserve model-authored backslashes inside JSON strings when they are not
 * valid JSON escapes. This commonly occurs with LaTeX such as `\det` or
 * `\sigma`; doubling only the invalid slash keeps the intended text while
 * leaving valid JSON escapes unchanged.
 */
export function repairInvalidEscapesInJson(text: string): string {
  let result = "";
  let inString = false;
  let inInlineMath = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (!inString) {
      result += c;
      if (c === '"') {
        inString = true;
        inInlineMath = false;
      }
      continue;
    }
    if (c === '"') {
      result += c;
      inString = false;
      inInlineMath = false;
      continue;
    }
    if (c === "$" && text[i - 1] !== "\\") {
      result += c;
      inInlineMath = !inInlineMath;
      continue;
    }
    if (c !== "\\") {
      result += c;
      continue;
    }

    const next = text[i + 1];
    const isRawMathCommand =
      inInlineMath && next != null && /^[A-Za-z]$/.test(next);
    const isSimpleEscape =
      next != null && ['"', "\\", "/", "b", "f", "n", "r", "t"].includes(next);
    const isUnicodeEscape =
      next === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6));
    if (!isRawMathCommand && (isSimpleEscape || isUnicodeEscape)) {
      result += `\\${next}`;
      i += 1;
      continue;
    }

    result += "\\\\";
  }

  return result;
}

const MAX_MISSING_JSON_SEPARATOR_REPAIRS = 8;
const MAX_UNEXPECTED_JSON_CLOSER_REPAIRS = 8;
const MISSING_JSON_SEPARATOR_ERROR =
  /^Expected ',' or '([}\]])' after (array element|property value) in JSON at position (\d+)/;

function isOutsideJsonString(text: string, position: number): boolean {
  let inString = false;
  let escape = false;
  for (let index = 0; index < position; index += 1) {
    const char = text[index]!;
    if (!inString) {
      if (char === '"') inString = true;
      continue;
    }
    if (escape) {
      escape = false;
    } else if (char === "\\") {
      escape = true;
    } else if (char === '"') {
      inString = false;
    }
  }
  return !inString;
}

/**
 * Insert only parser-requested commas between otherwise complete JSON values.
 *
 * This intentionally does not guess about arbitrary broken JSON. V8 must
 * identify the exact missing separator, the edit must be outside a string,
 * and the fully repaired candidate must still pass the caller's authoritative
 * schema and business validation.
 */
export function repairMissingSeparatorsInJson(text: string): string {
  let repaired = text;
  for (
    let repairCount = 0;
    repairCount < MAX_MISSING_JSON_SEPARATOR_REPAIRS;
    repairCount += 1
  ) {
    try {
      JSON.parse(repaired);
      return repaired;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const match = message.match(MISSING_JSON_SEPARATOR_ERROR);
      if (!match) return text;
      const position = Number(match[3]);
      if (
        !Number.isInteger(position) ||
        position <= 0 ||
        position >= repaired.length ||
        !isOutsideJsonString(repaired, position)
      ) {
        return text;
      }
      const next = repaired[position]!;
      if (next === "]" || next === "}") return text;
      repaired = `${repaired.slice(0, position)},${repaired.slice(position)}`;
    }
  }
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return text;
  }
}

/**
 * Remove parser-identified stray closing delimiters from an otherwise complete
 * JSON document.
 *
 * Long tool-call payloads occasionally contain `}},` after a flat array item.
 * V8 identifies the second `}` as the exact position where only a separator or
 * the array closer is legal. Only delete such a delimiter when another
 * structural delimiter immediately follows it, and keep the edit only when the
 * complete document subsequently parses. This preserves later array items
 * instead of accepting an earlier incremental prefix as the final document.
 */
export function repairUnexpectedClosingDelimitersInJson(text: string): string {
  let repaired = text;
  for (
    let repairCount = 0;
    repairCount < MAX_UNEXPECTED_JSON_CLOSER_REPAIRS;
    repairCount += 1
  ) {
    try {
      JSON.parse(repaired);
      return repaired;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const match = message.match(MISSING_JSON_SEPARATOR_ERROR);
      if (!match) return text;
      const position = Number(match[3]);
      if (
        !Number.isInteger(position) ||
        position <= 0 ||
        position >= repaired.length ||
        !isOutsideJsonString(repaired, position) ||
        (repaired[position] !== "}" && repaired[position] !== "]")
      ) {
        return text;
      }
      let next = position + 1;
      while (next < repaired.length && /\s/.test(repaired[next]!)) next += 1;
      if (![",", "}", "]"].includes(repaired[next] ?? "")) return text;
      repaired = `${repaired.slice(0, position)}${repaired.slice(position + 1)}`;
    }
  }
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return text;
  }
}

/**
 * Parse one complete bare JSON tool-argument buffer with deterministic syntax
 * repairs applied before any balanced-root extraction can truncate its suffix.
 */
export function parseCompleteLlmJsonDetailed<T>(text: string): ParsedLlmJson<T> {
  const stripped = stripThinkingTags(text).replace(/^\uFEFF/, "").trim();
  if (!stripped.startsWith("{") && !stripped.startsWith("[")) {
    throw new Error("Complete structured output must be a bare JSON value");
  }
  const trailingCommasRepaired = repairTrailingCommasInJson(stripped);
  const earlySeparatorsRepaired = repairMissingSeparatorsInJson(
    trailingCommasRepaired,
  );
  const embeddedRepaired = repairUnescapedEmbeddedJsonStrings(
    earlySeparatorsRepaired,
  );
  const quotesRepaired = repairUnescapedQuotesInJson(embeddedRepaired);
  const escapesRepaired = repairInvalidEscapesInJson(quotesRepaired);
  const separatorsRepaired = repairMissingSeparatorsInJson(escapesRepaired);
  const closersRepaired = repairUnexpectedClosingDelimitersInJson(
    separatorsRepaired,
  );
  const parsed = parseJsonWithLibraryFallback(closersRepaired);
  return {
    value: parsed.value as T,
    syntaxRepaired:
      stripped !== text ||
      trailingCommasRepaired !== stripped ||
      earlySeparatorsRepaired !== trailingCommasRepaired ||
      embeddedRepaired !== earlySeparatorsRepaired ||
      quotesRepaired !== embeddedRepaired ||
      escapesRepaired !== quotesRepaired ||
      separatorsRepaired !== escapesRepaired ||
      closersRepaired !== separatorsRepaired ||
      parsed.libraryRepaired,
  };
}

function parseJsonWithLibraryFallback(text: string): {
  value: unknown;
  libraryRepaired: boolean;
} {
  try {
    return { value: JSON.parse(text), libraryRepaired: false };
  } catch (error) {
    try {
      return { value: JSON.parse(jsonrepair(text)), libraryRepaired: true };
    } catch {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}

/**
 * Decode a model-authored JSON string that may still be escaped, truncated, or
 * wrapped in an extra JSON string layer (`"{\"type\":...}"`).
 */
export function parseEncodedLlmJson(text: string): unknown {
  let current: unknown = text;
  for (let hop = 0; hop < 3; hop += 1) {
    if (typeof current !== "string") return current;
    const trimmed = current.trim();
    if (!trimmed) return current;
    try {
      current =
        trimmed.startsWith("{") || trimmed.startsWith("[")
          ? parseCompleteLlmJsonDetailed(trimmed).value
          : JSON.parse(trimmed);
    } catch {
      if (hop > 0) return current;
      current = parseLlmJson(trimmed);
    }
  }
  return current;
}

/**
 * Prefix continuation sometimes returns `{items:[...]}` or a JSON string
 * instead of the requested array. Unwrap only those obvious envelopes.
 */
export function unwrapStructuredArrayCandidate(value: unknown): unknown {
  const decoded =
    typeof value === "string" ? parseEncodedLlmJson(value) : value;
  if (Array.isArray(decoded)) return decoded;
  if (!decoded || typeof decoded !== "object") return decoded;
  const record = decoded as Record<string, unknown>;
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.values)) {
    return record.values.length === 1 && Array.isArray(record.values[0])
      ? record.values[0]
      : record.values;
  }
  return decoded;
}

function collectStringArrayPropertyNames(
  value: unknown,
  names = new Set<string>(),
  seen = new Set<object>(),
): Set<string> {
  if (!value || typeof value !== "object") return names;
  if (seen.has(value)) return names;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringArrayPropertyNames(item, names, seen);
    }
    return names;
  }

  const node = value as Record<string, unknown>;
  const properties =
    node.properties &&
    typeof node.properties === "object" &&
    !Array.isArray(node.properties)
      ? (node.properties as Record<string, unknown>)
      : undefined;
  for (const [name, property] of Object.entries(properties ?? {})) {
    if (property && typeof property === "object" && !Array.isArray(property)) {
      const propertyNode = property as Record<string, unknown>;
      const itemNode =
        propertyNode.items &&
        typeof propertyNode.items === "object" &&
        !Array.isArray(propertyNode.items)
          ? (propertyNode.items as Record<string, unknown>)
          : undefined;
      if (propertyNode.type === "array" && itemNode?.type === "string") {
        names.add(name);
      }
    }
    collectStringArrayPropertyNames(property, names, seen);
  }
  for (const child of Object.values(node)) {
    collectStringArrayPropertyNames(child, names, seen);
  }
  return names;
}

function jsonStringEnd(text: string, start: number): number | undefined {
  if (text[start] !== '"') return undefined;
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') return index + 1;
  }
  return undefined;
}

function skipJsonWhitespace(text: string, start: number): number {
  let index = start;
  while (index < text.length && /\s/.test(text[index]!)) index += 1;
  return index;
}

/**
 * Repair a narrow provider serialization defect using the binding schema:
 *
 *   "points": "first", "second", "third"
 *   -> "points": ["first", "second", "third"]
 *
 * The rewrite is allowed only for properties whose provider schema declares
 * `array<string>`, and only when at least two adjacent string values make the
 * original text invalid JSON. Valid scalar values are left untouched for Zod
 * to reject, so this never changes valid-but-schema-wrong model intent.
 */
export function repairCollapsedStringArraysInJson(
  text: string,
  bindingSchema: unknown,
): string {
  const arrayPropertyNames = collectStringArrayPropertyNames(bindingSchema);
  if (arrayPropertyNames.size === 0) return text;

  let result = text;
  let index = 0;
  let inString = false;
  let escaped = false;
  while (index < result.length) {
    const char = result[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      index += 1;
      continue;
    }
    if (char !== '"') {
      index += 1;
      continue;
    }

    const keyEnd = jsonStringEnd(result, index);
    if (keyEnd == null) return result;
    let key: unknown;
    try {
      key = JSON.parse(result.slice(index, keyEnd));
    } catch {
      index = keyEnd;
      continue;
    }
    let cursor = skipJsonWhitespace(result, keyEnd);
    if (
      typeof key !== "string" ||
      !arrayPropertyNames.has(key) ||
      result[cursor] !== ":"
    ) {
      index = keyEnd;
      continue;
    }
    cursor = skipJsonWhitespace(result, cursor + 1);
    const firstEnd = jsonStringEnd(result, cursor);
    if (firstEnd == null) {
      index = keyEnd;
      continue;
    }

    const values = [result.slice(cursor, firstEnd)];
    let valueEnd = firstEnd;
    let scan = skipJsonWhitespace(result, firstEnd);
    while (result[scan] === ",") {
      const nextStart = skipJsonWhitespace(result, scan + 1);
      const nextEnd = jsonStringEnd(result, nextStart);
      if (nextEnd == null) break;
      const afterNext = skipJsonWhitespace(result, nextEnd);
      // A colon means this string is the next object property, not another
      // collapsed array value.
      if (result[afterNext] === ":") break;
      if (
        result[afterNext] !== "," &&
        result[afterNext] !== "}" &&
        result[afterNext] !== "]"
      ) {
        break;
      }
      values.push(result.slice(nextStart, nextEnd));
      valueEnd = nextEnd;
      scan = afterNext;
    }
    if (values.length < 2) {
      index = firstEnd;
      continue;
    }

    const replacement = `[${values.join(",")}]`;
    result = `${result.slice(0, cursor)}${replacement}${result.slice(valueEnd)}`;
    index = cursor + replacement.length;
  }
  return result;
}

export type ParsedLlmJson<T> = {
  value: T;
  syntaxRepaired: boolean;
};

export function parseLlmJsonDetailed<T>(text: string): ParsedLlmJson<T> {
  const stripped = stripThinkingTags(text);
  const rawExtracted = extractJsonFromLlmText(text);
  const extracted = repairTrailingCommasInJson(rawExtracted);
  // Repair parser-identified missing structural commas before the quote
  // heuristic. Otherwise a missing comma between object properties makes the
  // closing quote of the previous value look like an embedded prose quote.
  const earlySeparatorsRepaired = repairMissingSeparatorsInJson(extracted);
  const embeddedRepaired = repairUnescapedEmbeddedJsonStrings(
    earlySeparatorsRepaired,
  );
  const quotesRepaired = repairUnescapedQuotesInJson(embeddedRepaired);
  const escapesRepaired = repairInvalidEscapesInJson(quotesRepaired);
  const separatorsRepaired = repairMissingSeparatorsInJson(escapesRepaired);
  const extractionRepaired =
    rawExtracted !== stripped || /^\s*\uFEFF/.test(text);
  const parsed = parseJsonWithLibraryFallback(separatorsRepaired);
  return {
    value: parsed.value as T,
    syntaxRepaired:
      extractionRepaired ||
      extracted !== rawExtracted ||
      earlySeparatorsRepaired !== extracted ||
      embeddedRepaired !== earlySeparatorsRepaired ||
      quotesRepaired !== embeddedRepaired ||
      escapesRepaired !== quotesRepaired ||
      separatorsRepaired !== escapesRepaired ||
      parsed.libraryRepaired,
  };
}

export function parseLlmJson<T>(text: string): T {
  return parseLlmJsonDetailed<T>(text).value;
}
