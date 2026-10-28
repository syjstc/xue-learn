import { z } from "zod";
import { formatStructuredParseError } from "./parse-structured.js";

export type JsonArrayItemIssue = {
  index: number;
  message: string;
};

export type JsonArrayStreamItem<T> = {
  index: number;
  value: T;
};

export type JsonArrayStreamSnapshot<T> = {
  items: JsonArrayStreamItem<T>[];
  /** Parsed source values, including items that failed schema validation. */
  sourceItems: JsonArrayStreamItem<unknown>[];
  issues: JsonArrayItemIssue[];
  itemCount: number;
  placeholderCount: number;
  closed: boolean;
};

type ItemState = "none" | "container" | "string" | "primitive";

const LATEX_JSON_COMMANDS = new Set([
  "alpha",
  "approx",
  "bar",
  "begin",
  "beta",
  "cdot",
  "cos",
  "delta",
  "div",
  "end",
  "equiv",
  "frac",
  "gamma",
  "geq",
  "hat",
  "infty",
  "int",
  "lambda",
  "left",
  "leftarrow",
  "leftrightarrow",
  "leq",
  "lim",
  "ln",
  "log",
  "mapsto",
  "mathbb",
  "mathbf",
  "mathcal",
  "mathrm",
  "mu",
  "nabla",
  "neq",
  "operatorname",
  "overline",
  "partial",
  "pi",
  "pm",
  "prod",
  "rightarrow",
  "right",
  "sigma",
  "sin",
  "sqrt",
  "sum",
  "tan",
  "text",
  "theta",
  "times",
  "underline",
  "vec",
]);

/**
 * Compatibility edit for a common model JSON defect: LaTeX backslashes are
 * emitted literally inside JSON strings. Invalid escapes, math-delimited
 * alphabetic commands, and command-like control-escape prefixes are doubled;
 * ordinary JSON line breaks remain untouched.
 */
export function normalizeModelJsonStringEscapes(raw: string): string {
  let result = "";
  let inString = false;
  let dollarMath: "$" | "$$" | undefined;
  let bracketMath: "]" | ")" | undefined;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (char === '"') {
      let precedingBackslashes = 0;
      for (
        let cursor = index - 1;
        cursor >= 0 && raw[cursor] === "\\";
        cursor -= 1
      ) {
        precedingBackslashes += 1;
      }
      if (precedingBackslashes % 2 === 0) {
        inString = !inString;
        if (!inString) {
          dollarMath = undefined;
          bracketMath = undefined;
        }
      }
      result += char;
      continue;
    }
    if (inString && char === "$") {
      const double = raw[index + 1] === "$";
      if (!dollarMath) dollarMath = double ? "$$" : "$";
      else if (
        (dollarMath === "$$" && double) ||
        (dollarMath === "$" && !double)
      ) {
        dollarMath = undefined;
      }
      result += double ? "$$" : "$";
      if (double) index += 1;
      continue;
    }
    if (!inString || char !== "\\") {
      result += char;
      continue;
    }

    const suffix = raw.slice(index + 1);
    const next = raw[index + 1];
    if (next === '"' || next === "\\" || next === "/") {
      result += `${char}${next}`;
      index += 1;
      continue;
    }
    const command = /^[A-Za-z]+/.exec(suffix)?.[0];
    if (next === "[" || next === "(") {
      bracketMath = next === "[" ? "]" : ")";
      result += "\\\\";
      continue;
    }
    if (next === bracketMath) {
      bracketMath = undefined;
      result += "\\\\";
      continue;
    }
    const validUnicodeEscape =
      next === "u" && /^[0-9a-fA-F]{4}/.test(raw.slice(index + 2, index + 6));
    const isAlphabeticLatex = Boolean(
      command &&
      (dollarMath ||
        bracketMath ||
        LATEX_JSON_COMMANDS.has(command) ||
        (/^[bfrt]/.test(command) && command.length > 1)),
    );
    const isValidJsonEscape = next !== undefined && '"\\/bfnrt'.includes(next);
    if (isAlphabeticLatex || (!isValidJsonEscape && !validUnicodeEscape)) {
      result += "\\\\";
    } else {
      result += char;
    }
  }
  return result;
}

/**
 * Remove a provider repetition defect such as
 * `{"kind":"block","block","block":{...}}`.
 *
 * The edit is deliberately narrow: an orphan object key is removed only when
 * the immediately following, value-bearing key token is byte-for-byte
 * identical. No authored value is selected, rewritten, or invented.
 */
export function removeRepeatedOrphanObjectKeys(raw: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length; ) {
    const char = raw[index]!;
    if (!inString && (char === "{" || char === ",")) {
      const match = /^([,{]\s*)("(?:[^"\\]|\\.)*")\s*,\s*\2\s*:/.exec(
        raw.slice(index),
      );
      if (match) {
        result += `${match[1]}${match[2]}:`;
        index += match[0].length;
        continue;
      }
    }
    result += char;
    index += 1;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    }
  }
  return result;
}

/**
 * Removes one exact outer JSON code fence. Bare JSON is returned trimmed.
 * Arbitrary markdown, prose, and trailing content deliberately return null.
 */
export function unwrapExactJsonCodeFence(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const match = /^```(?:json)?\r?\n([\s\S]*?)\r?\n?```$/.exec(trimmed);
  return match?.[1]?.trim() ?? null;
}

/**
 * Incrementally parses a single root JSON array. Only complete, schema-valid
 * top-level items are exposed. The parser deliberately does not repair JSON:
 * invalid items remain placeholders for the bounded structured repair pass.
 */
export class JsonArrayStreamAccumulator<T> {
  private text = "";
  private cursor = 0;
  private rootStarted = false;
  private rootClosed = false;
  private fenced = false;
  private fenceClosed = false;
  private expectingItem = true;
  private afterComma = false;
  private state: ItemState = "none";
  private itemStart = -1;
  private depth = 0;
  private inString = false;
  private escaped = false;
  private itemIndex = 0;
  private readonly validItems = new Map<number, T>();
  private readonly sourceItems = new Map<number, unknown>();
  private readonly invalidItems = new Map<number, string>();
  private fatalIssue: string | undefined;

  constructor(private readonly itemSchema: z.ZodType<T>) {}

  append(delta: string): JsonArrayStreamSnapshot<T> {
    if (delta) this.text += delta;
    this.scan(false);
    return this.snapshot();
  }

  finish(): JsonArrayStreamSnapshot<T> {
    this.scan(true);
    if (!this.fatalIssue) {
      if (!this.rootStarted) this.fatalIssue = "response must be a JSON array";
      else if (!this.rootClosed) {
        if (this.state !== "none" && this.itemStart >= 0) {
          this.invalidItems.set(this.itemIndex, "incomplete JSON array item");
        }
        this.fatalIssue = "JSON array was not closed";
      } else if (this.fenced && !this.fenceClosed)
        this.fatalIssue = "JSON code fence was not closed";
    }
    return this.snapshot();
  }

  rawText(): string {
    return this.text;
  }

  private scan(final: boolean): void {
    while (this.cursor < this.text.length && !this.fatalIssue) {
      const char = this.text[this.cursor]!;

      if (!this.rootStarted) {
        if (/\s/.test(char)) {
          this.cursor += 1;
          continue;
        }
        if (char === "`") {
          const fenceLength = this.openingFenceLength(final);
          if (fenceLength === null) return;
          if (fenceLength < 0) {
            this.fatalIssue =
              "response must contain one bare or exactly fenced root JSON array";
            return;
          }
          this.fenced = true;
          this.cursor += fenceLength;
          continue;
        }
        if (char !== "[") {
          this.fatalIssue =
            "response must contain one bare or exactly fenced root JSON array";
          return;
        }
        this.rootStarted = true;
        this.expectingItem = true;
        this.cursor += 1;
        continue;
      }

      if (this.rootClosed) {
        if (this.fenced && !this.fenceClosed) {
          if (/\s/.test(char)) {
            this.cursor += 1;
            continue;
          }
          const remaining = this.text.slice(this.cursor);
          if ("```".startsWith(remaining) && remaining.length < 3) {
            if (final) this.fatalIssue = "JSON code fence was not closed";
            return;
          }
          if (!remaining.startsWith("```")) {
            this.fatalIssue = "unexpected content after root JSON array";
            return;
          }
          this.fenceClosed = true;
          this.cursor += 3;
          continue;
        }
        if (!/\s/.test(char)) {
          this.fatalIssue = "unexpected content after root JSON array";
          return;
        }
        this.cursor += 1;
        continue;
      }

      if (this.state === "none") {
        if (/\s/.test(char)) {
          this.cursor += 1;
          continue;
        }
        if (this.expectingItem) {
          if (char === "]") {
            if (this.afterComma) {
              this.fatalIssue = "trailing comma in root JSON array";
              return;
            }
            this.rootClosed = true;
            this.cursor += 1;
            continue;
          }
          if (char === ",") {
            this.fatalIssue = "empty JSON array item";
            return;
          }
          this.itemStart = this.cursor;
          this.expectingItem = false;
          this.afterComma = false;
          if (char === "{" || char === "[") {
            this.state = "container";
            this.depth = 1;
            this.inString = false;
            this.escaped = false;
            this.cursor += 1;
            continue;
          }
          if (char === '"') {
            this.state = "string";
            this.inString = true;
            this.escaped = false;
            this.cursor += 1;
            continue;
          }
          this.state = "primitive";
          this.cursor += 1;
          continue;
        }
        if (char === ",") {
          this.expectingItem = true;
          this.afterComma = true;
          this.cursor += 1;
          continue;
        }
        if (char === "]") {
          this.rootClosed = true;
          this.cursor += 1;
          continue;
        }
        this.fatalIssue =
          "expected comma or closing bracket after JSON array item";
        return;
      }

      if (this.state === "container") {
        if (this.inString) {
          if (this.escaped) this.escaped = false;
          else if (char === "\\") this.escaped = true;
          else if (char === '"') this.inString = false;
          this.cursor += 1;
          continue;
        }
        if (char === '"') this.inString = true;
        else if (char === "{" || char === "[") this.depth += 1;
        else if (char === "}" || char === "]") {
          this.depth -= 1;
          if (this.depth === 0) {
            this.cursor += 1;
            this.completeItem(this.cursor);
            continue;
          }
        }
        this.cursor += 1;
        continue;
      }

      if (this.state === "string") {
        if (this.escaped) this.escaped = false;
        else if (char === "\\") this.escaped = true;
        else if (char === '"') {
          this.cursor += 1;
          this.completeItem(this.cursor);
          continue;
        }
        this.cursor += 1;
        continue;
      }

      if (this.state === "primitive") {
        if (char === "," || char === "]" || /\s/.test(char)) {
          this.completeItem(this.cursor);
          continue;
        }
        this.cursor += 1;
      }
    }

    if (final && this.state === "primitive" && this.itemStart >= 0) {
      this.completeItem(this.cursor);
    }
  }

  /**
   * Returns the exact opening-fence length, null while a split token may still
   * complete it, and -1 when the prefix is not an allowed fence.
   */
  private openingFenceLength(final: boolean): number | null {
    const remaining = this.text.slice(this.cursor);
    if (!remaining.startsWith("```")) {
      if (!final && "```".startsWith(remaining)) return null;
      return -1;
    }

    const suffix = remaining.slice(3);
    if (suffix.length === 0) return final ? -1 : null;
    if (suffix.startsWith("\n")) return 4;
    if (suffix.startsWith("\r")) {
      if (suffix.length === 1) return final ? -1 : null;
      return suffix[1] === "\n" ? 5 : -1;
    }
    if ("json".startsWith(suffix)) return final ? -1 : null;
    if (!suffix.startsWith("json")) return -1;

    const afterLanguage = suffix.slice(4);
    if (afterLanguage.length === 0) return final ? -1 : null;
    if (afterLanguage.startsWith("\n")) return 8;
    if (afterLanguage.startsWith("\r")) {
      if (afterLanguage.length === 1) return final ? -1 : null;
      return afterLanguage[1] === "\n" ? 9 : -1;
    }
    return -1;
  }

  private completeItem(end: number): void {
    const raw = this.text.slice(this.itemStart, end);
    const index = this.itemIndex;
    try {
      const value = JSON.parse(normalizeModelJsonStringEscapes(raw)) as unknown;
      this.sourceItems.set(index, value);
      const parsed = this.itemSchema.safeParse(value);
      if (parsed.success) this.validItems.set(index, parsed.data);
      else
        this.invalidItems.set(index, formatStructuredParseError(parsed.error));
    } catch (error) {
      this.invalidItems.set(
        index,
        error instanceof Error ? error.message : "invalid JSON array item",
      );
    }
    this.itemIndex += 1;
    this.state = "none";
    this.itemStart = -1;
    this.depth = 0;
    this.inString = false;
    this.escaped = false;
  }

  private snapshot(): JsonArrayStreamSnapshot<T> {
    const issues: JsonArrayItemIssue[] = [...this.invalidItems.entries()].map(
      ([index, message]) => ({ index, message }),
    );
    if (this.fatalIssue) issues.push({ index: -1, message: this.fatalIssue });
    const items = [...this.validItems.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, value]) => ({ index, value }));
    const sourceItems = [...this.sourceItems.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, value]) => ({ index, value }));
    const inProgress =
      !this.rootClosed && this.rootStarted && this.state !== "none" ? 1 : 0;
    return {
      items,
      sourceItems,
      issues,
      itemCount: this.itemIndex + inProgress,
      placeholderCount:
        issues.filter((issue) => issue.index >= 0).length + inProgress,
      closed:
        this.rootClosed &&
        (!this.fenced || this.fenceClosed) &&
        !this.fatalIssue,
    };
  }
}
