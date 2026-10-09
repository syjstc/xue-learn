import { z } from "zod";
import {
  JsonArrayStreamAccumulator,
  normalizeModelJsonStringEscapes,
  removeRepeatedOrphanObjectKeys,
  type JsonArrayStreamSnapshot,
} from "./json-array-stream.js";
import { formatStructuredParseError } from "./parse-structured.js";

type StreamMode = "array" | "lines";

/**
 * Recover only the common JSONL truncation where a complete object line is
 * missing its final outer `}`. Do not balance arbitrary JSON or repair field
 * content: the amended line must still parse normally afterward.
 */
function appendSingleMissingObjectBrace(raw: string): string | null {
  let inString = false;
  let escaped = false;
  let objectDepth = 0;
  let arrayDepth = 0;

  for (const char of raw) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") objectDepth += 1;
    else if (char === "}") objectDepth -= 1;
    else if (char === "[") arrayDepth += 1;
    else if (char === "]") arrayDepth -= 1;
    if (objectDepth < 0 || arrayDepth < 0) return null;
  }

  if (inString || escaped || objectDepth !== 1 || arrayDepth !== 0) return null;
  return `${raw.trimEnd()}}`;
}

function parseJsonLine(raw: string): unknown {
  const normalized = removeRepeatedOrphanObjectKeys(
    normalizeModelJsonStringEscapes(raw),
  );
  try {
    return JSON.parse(normalized) as unknown;
  } catch (originalError) {
    const recovered = appendSingleMissingObjectBrace(normalized);
    if (recovered == null) throw originalError;
    return JSON.parse(recovered) as unknown;
  }
}

/**
 * Streams one complete JSON item per physical line. A bare root array is also
 * accepted as a compatibility fallback, but JSON Lines is the reliable path
 * for long provider outputs because one malformed delimiter cannot swallow
 * every following item.
 */
export class JsonLinesStreamAccumulator<T> {
  private readonly arrayAccumulator: JsonArrayStreamAccumulator<T>;
  private mode: StreamMode | undefined;
  private text = "";
  private undecided = "";
  private lineBuffer = "";
  private nextIndex = 0;
  private readonly validItems = new Map<number, T>();
  private readonly sourceItems = new Map<number, unknown>();
  private readonly invalidItems = new Map<number, string>();
  private fatalIssue: string | undefined;
  private fenced = false;
  private fenceClosed = false;
  private sawData = false;
  private finished = false;

  constructor(private readonly itemSchema: z.ZodType<T>) {
    this.arrayAccumulator = new JsonArrayStreamAccumulator(itemSchema);
  }

  append(delta: string): JsonArrayStreamSnapshot<T> {
    if (delta) this.text += delta;
    if (this.mode === "array") return this.arrayAccumulator.append(delta);
    if (this.mode === "lines") {
      this.lineBuffer += delta;
      this.drainCompleteLines();
      return this.snapshot();
    }

    this.undecided += delta;
    const first = this.undecided.trimStart()[0];
    if (!first) return this.snapshot();
    if (first === "[") {
      this.mode = "array";
      return this.arrayAccumulator.append(this.undecided);
    }
    this.mode = "lines";
    this.lineBuffer = this.undecided;
    this.drainCompleteLines();
    return this.snapshot();
  }

  finish(): JsonArrayStreamSnapshot<T> {
    if (this.mode === "array") return this.arrayAccumulator.finish();
    if (!this.mode) {
      const first = this.undecided.trimStart()[0];
      if (first === "[") {
        this.mode = "array";
        this.arrayAccumulator.append(this.undecided);
        return this.arrayAccumulator.finish();
      }
      this.mode = "lines";
      this.lineBuffer = this.undecided;
    }
    this.drainCompleteLines();
    if (this.lineBuffer.trim()) this.processLine(this.lineBuffer);
    this.lineBuffer = "";
    this.finished = true;
    if (!this.sawData && !this.fatalIssue) {
      this.fatalIssue = "response must contain JSON Lines items";
    } else if (this.fenced && !this.fenceClosed && !this.fatalIssue) {
      this.fatalIssue = "JSON Lines code fence was not closed";
    }
    return this.snapshot();
  }

  rawText(): string {
    return this.text;
  }

  private drainCompleteLines(): void {
    while (!this.fatalIssue) {
      const newline = this.lineBuffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.lineBuffer.slice(0, newline).replace(/\r$/, "");
      this.lineBuffer = this.lineBuffer.slice(newline + 1);
      this.processLine(line);
    }
  }

  private processLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (
      !this.sawData &&
      !this.fenced &&
      /^```(?:jsonl|ndjson|json)?$/i.test(trimmed)
    ) {
      this.fenced = true;
      return;
    }
    if (this.fenced && trimmed === "```") {
      this.fenceClosed = true;
      return;
    }
    if (this.fenceClosed) {
      this.fatalIssue = "unexpected content after JSON Lines code fence";
      return;
    }
    if (trimmed.startsWith("```")) {
      this.fatalIssue = "unexpected JSON Lines code fence";
      return;
    }

    const index = this.nextIndex;
    this.nextIndex += 1;
    this.sawData = true;
    try {
      const value = parseJsonLine(trimmed);
      this.sourceItems.set(index, value);
      const parsed = this.itemSchema.safeParse(value);
      if (parsed.success) this.validItems.set(index, parsed.data);
      else
        this.invalidItems.set(index, formatStructuredParseError(parsed.error));
    } catch (error) {
      this.invalidItems.set(
        index,
        error instanceof Error ? error.message : "invalid JSON Lines item",
      );
    }
  }

  private snapshot(): JsonArrayStreamSnapshot<T> {
    const issues = [...this.invalidItems.entries()].map(([index, message]) => ({
      index,
      message,
    }));
    if (this.fatalIssue) issues.push({ index: -1, message: this.fatalIssue });
    const items = [...this.validItems.entries()].map(([index, value]) => ({
      index,
      value,
    }));
    const sourceItems = [...this.sourceItems.entries()].map(
      ([index, value]) => ({
        index,
        value,
      }),
    );
    const pendingLine =
      !this.finished &&
      !this.fenceClosed &&
      Boolean(this.lineBuffer.trim()) &&
      !/^```(?:jsonl|ndjson|json)?$/i.test(this.lineBuffer.trim())
        ? 1
        : 0;
    return {
      items,
      sourceItems,
      issues,
      itemCount: this.nextIndex + pendingLine,
      placeholderCount: this.invalidItems.size + pendingLine,
      closed:
        this.finished && (!this.fenced || this.fenceClosed) && !this.fatalIssue,
    };
  }
}
