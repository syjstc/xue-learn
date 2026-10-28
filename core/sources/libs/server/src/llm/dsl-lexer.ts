/**
 * DSL lexer + grammar matcher.
 *
 * Field separator is the rare codepoint ‖ (U+2016 DOUBLE VERTICAL LINE).
 * Inside field values the following are honored:
 *   - \\‖   escaped literal ‖
 *   - \\|   escaped literal |
 *   - $...$ inline math (no splitting inside); $4.25 / $20 currency is literal,
 *     but $2x-style math variables still toggle math mode
 *   - "..." JSON-quoted at field start (string is JSON-parsed so content
 *     may contain ‖ or |)
 *
 * Hard cutover: | is NOT a field separator. A line containing | but no ‖
 * yields a single mega-field and fails downstream grammar validation
 * with a clear "expected N fields, got 1" error. The repair loop in
 * dsl-repair.ts surfaces this back to the LLM.
 */

export const DSL_FIELD_SEPARATOR = "‖"; // ‖
const DSL_FIELD_SEPARATOR_DISPLAY = "‖ (U+2016 DOUBLE VERTICAL LINE)";

import {
  normalizeEscapedMarkdownNewlines,
  normalizeHtmlLineBreaks,
} from "../../../common/src/index.js";

/** Turn literal \\n and HTML <br> sequences in DSL markdown fields into breaks. */
export function normalizeDslMarkdownText(text: string): string {
  return normalizeHtmlLineBreaks(normalizeEscapedMarkdownNewlines(text));
}

// ---------- Token types ----------

export type DslToken =
  | { kind: "tag"; value: string; line: number; col: number }
  | { kind: "sep"; line: number; col: number }
  | { kind: "field"; value: string; line: number; col: number };

export type DslLexerError = {
  tag: string;
  line: number;
  col: number;
  reason: string;
  suggestion?: string;
};

// ---------- Lexer ----------

export function tokenizeDslLine(line: string, lineNumber: number): DslToken[] {
  const tokens: DslToken[] = [];
  let i = 0;
  const n = line.length;

  // Quick detection: legacy | delimiters (lines with | but no ‖) should be
  // routed through a hint-producing path. We check after tokenizing whether
  // the line emitted only one field and that field contains |.

  // Phase 1: read tag (leading letters/digits/underscore, any case).
  // Tags are matched case-insensitively and normalized to uppercase.
  const tagStart = i;
  while (i < n && /[A-Za-z0-9_]/.test(line[i]!)) i += 1;
  if (i === tagStart) {
    // No valid tag — emit a single field containing the whole line so the
    // grammar matcher can produce a "unknown tag" error.
    tokens.push({
      kind: "field",
      value: line,
      line: lineNumber,
      col: 0,
    });
    return tokens;
  }
  tokens.push({
    kind: "tag",
    value: line.slice(tagStart, i).toUpperCase(),
    line: lineNumber,
    col: tagStart,
  });

  // Phase 2: read (sep field)* pairs.
  while (i < n) {
    // Skip optional whitespace before separator.
    while (i < n && (line[i] === " " || line[i] === "\t")) i += 1;
    if (i >= n) break;

    if (line[i] !== DSL_FIELD_SEPARATOR) {
      // Garbage between fields — emit the rest of the line as a single
      // field so grammar matcher can give a precise error.
      tokens.push({
        kind: "field",
        value: line.slice(i).trim(),
        line: lineNumber,
        col: i,
      });
      return tokens;
    }

    tokens.push({ kind: "sep", line: lineNumber, col: i });
    i += 1;

    const fieldStart = i;
    const { value, end } = readField(line, fieldStart);
    tokens.push({
      kind: "field",
      value,
      line: lineNumber,
      col: fieldStart,
    });
    i = end;
  }

  // Tag with no fields (e.g. just "P" or "P‖" trailing).
  if (tokens.at(-1)?.kind !== "field") {
    tokens.push({ kind: "field", value: "", line: lineNumber, col: i });
  }
  return tokens;
}

/**
 * Hint that the legacy `|` delimiter was used instead of `‖`.
 * Returns the hint message if the line looks like it was meant for ‖ but
 * used |, or undefined otherwise.
 */
export function legacyPipeHint(line: string): string | undefined {
  // Only flag if there's a | AND no ‖ — and the | appears in a position that
  // looks like field separation (i.e., surrounded by other chars, not deeply
  // embedded in math/quotes — we approximate by looking for | not adjacent
  // to whitespace alone).
  if (line.includes(DSL_FIELD_SEPARATOR)) return undefined;
  if (!line.includes("|")) return undefined;
  return `field separator is ${DSL_FIELD_SEPARATOR_DISPLAY}; use ‖ between fields, not |`;
}

/** `$4.25` / `$20` are currency literals; `$2x` / `$|k|$` toggle inline math. */
function isCurrencyDollar(line: string, index: number): boolean {
  const next = line[index + 1];
  if (next === undefined) return false;

  let i = index + 1;
  if (next === ".") {
    if (i + 1 >= line.length || !/\d/.test(line[i + 1]!)) return false;
    i += 1;
  } else if (!/\d/.test(next)) {
    return false;
  }

  while (i < line.length && /\d/.test(line[i]!)) i += 1;

  if (line[i] === ".") {
    const fracStart = i + 1;
    if (fracStart >= line.length || !/\d/.test(line[fracStart]!)) return false;
    i = fracStart;
    while (i < line.length && /\d/.test(line[i]!)) i += 1;
  }

  const after = line[i];
  // `$2x` is math, not a two-dollar amount.
  if (after !== undefined && /[a-zA-Z_]/.test(after)) return false;
  return true;
}

function readField(
  line: string,
  start: number,
): { value: string; end: number } {
  let i = start;
  let out = "";
  let inMath = false;
  let inQuote = false;
  // Whether a JSON-quote at this position would be treated as a field-level
  // JSON string (true at field start, false mid-field).
  const quoteStartedAtFieldStart = start === 0 || line[start - 1] === DSL_FIELD_SEPARATOR;

  const n = line.length;
  const rawStart = start;

  while (i < n) {
    const ch = line[i]!;

    if (ch === "\\" && i + 1 < n) {
      const next = line[i + 1]!;
      // Unescape only ‖ to allow literal ‖ in content. Leave \|, \\, \$
      // as-is (2-char sequences) to preserve LaTeX syntax like \|vec{v}\|.
      if (next === DSL_FIELD_SEPARATOR) {
        out += next;
      } else {
        out += ch + next;
      }
      i += 2;
      continue;
    }

    if (ch === '"' && !inMath) {
      if (!inQuote && quoteStartedAtFieldStart && (out.trim() === "")) {
        inQuote = true;
        out += ch;
        i += 1;
        continue;
      }
      if (inQuote) {
        inQuote = false;
        out += ch;
        i += 1;
        continue;
      }
    }

    if (ch === "$" && !inQuote) {
      if (!isCurrencyDollar(line, i)) {
        inMath = !inMath;
      }
      out += ch;
      i += 1;
      continue;
    }

    if (ch === DSL_FIELD_SEPARATOR && !inMath && !inQuote) {
      break;
    }

    out += ch;
    i += 1;
  }

  // Unwrap JSON-quoted field.
  const trimmed = out.trim();
  if (
    quoteStartedAtFieldStart &&
    !inQuote &&
    trimmed.startsWith('"') &&
    trimmed.endsWith('"')
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") {
        return { value: parsed.trim(), end: i };
      }
    } catch {
      // fall through
    }
  }

  // Trim leading/trailing whitespace from the raw content (but not from
  // inside math/quotes). We approximate by trimming the trimmed string
  // we've accumulated.
  return { value: trimmed, end: i };
}

// ---------- Grammar schema ----------

export type DslFieldType =
  | { kind: "string" }
  | { kind: "optional-string" } // string that may be empty (e.g. U line parentTitle slot)
  | { kind: "greedy-string" } // eats rest of line (for H2/H3)
  | { kind: "integer"; min?: number; max?: number }
  | { kind: "enum"; values: ReadonlySet<string> }
  | { kind: "enum-ci"; values: ReadonlySet<string> }
  | { kind: "list"; separator: ";" }
  | {
      kind: "varargs";
      item: Exclude<DslFieldType, { kind: "varargs" }>;
      minItems?: number;
      maxItems?: number;
    };

export type DslFieldSpec = {
  name: string;
  type: DslFieldType;
  required: boolean;
};

export type DslLineSchema = {
  tag: string;
  fields: readonly DslFieldSpec[];
};

export type DslMatchOk = {
  ok: true;
  value: Record<string, unknown>;
  raw: Record<string, string>;
};

export type DslMatchErr = {
  ok: false;
  error: DslLexerError;
};

export type DslMatchResult = DslMatchOk | DslMatchErr;

// ---------- Grammar matcher ----------

export function matchLine(
  tokens: readonly DslToken[],
  schema: DslLineSchema,
): DslMatchResult {
  // Drop leading tag and trailing empty field (lexer pads with "" for tag-only
  // lines, but most schemas start with non-empty fields so we'll strip it
  // only if it's the last token).
  let fieldTokens = tokens.filter((t) => t.kind === "field");
  // Drop trailing empty field if it came from a line ending with ‖.
  if (fieldTokens.length > 1 && fieldTokens.at(-1)?.value === "") {
    fieldTokens = fieldTokens.slice(0, -1);
  }
  const sepTokens = tokens.filter((t) => t.kind === "sep");

  const raw: Record<string, string> = {};
  const out: Record<string, unknown> = {};
  const fieldSpecs = schema.fields;

  let cursor = 0;
  let i = 0;

  // For schemas that end with a tail varargs (collect all remaining fields
  // before the last required spec), we handle that in a special branch below.
  const lastSpec = fieldSpecs.at(-1);
  const secondLastSpec = fieldSpecs.at(-2);

  for (; i < fieldSpecs.length; i += 1) {
    const spec = fieldSpecs[i]!;

    if (spec.type.kind === "varargs") {
      const trailingSpecCount = fieldSpecs.length - i - 1;
      const availableForVarargs = fieldTokens.length - cursor - trailingSpecCount;
      const minItems = spec.type.minItems ?? 1;
      const maxItems = spec.type.maxItems ?? availableForVarargs;

      if (availableForVarargs < minItems) {
        return errFromSpec(
          spec,
          `expected at least ${minItems} ${spec.name}, got ${availableForVarargs}`,
          fieldTokens[cursor]?.line ?? 1,
          fieldTokens[cursor]?.col ?? 0,
          `Got ${availableForVarargs} field(s) for "${spec.name}", need ${minItems}-${
            spec.type.maxItems ?? "many"
          }.`,
        );
      }
      if (availableForVarargs > maxItems) {
        return errFromSpec(
          spec,
          `expected at most ${maxItems} ${spec.name}, got ${availableForVarargs}`,
          fieldTokens[cursor]?.line ?? 1,
          fieldTokens[cursor]?.col ?? 0,
          `Got ${availableForVarargs} field(s) for "${spec.name}", need ${minItems}-${
            spec.type.maxItems ?? "many"
          }.`,
        );
      }

      const collected: unknown[] = [];
      while (cursor < fieldTokens.length - trailingSpecCount) {
        const tok = fieldTokens[cursor]!;
        const value = tok.value;
        const coerced = coerceValue(value, spec.type.item, spec.name, tok);
        if (!coerced.ok) return { ok: false, error: coerced.error };
        collected.push(coerced.value);
        cursor += 1;
      }
      out[spec.name] = collected;
      raw[spec.name] = collected
        .map((c) => (typeof c === "string" ? c : String(c)))
        .join("|");
      continue;
    }

    if (cursor >= fieldTokens.length) {
      if (spec.required) {
        return errFromSpec(
          spec,
          `missing required field "${spec.name}"`,
          tokens.at(-1)?.line ?? 1,
          tokens.at(-1)?.col ?? 0,
          `Expected ${fieldSpecs.length} field(s): ${fieldSpecs
            .map((f) => f.name)
            .join(", ")}.`,
        );
      }
      out[spec.name] = undefined;
      continue;
    }

    const tok = fieldTokens[cursor]!;
    const value =
      spec.type.kind === "greedy-string"
        ? // Greedy: join this field and any remaining field values with " "
          // (rare; used by H2/H3 to preserve original parseHeadingText behavior
          // where the heading text may have been split by ‖).
          joinGreedyFields(fieldTokens.slice(cursor))
        : tok.value;

    const coerced = coerceValue(value, spec.type, spec.name, tok);
    if (!coerced.ok) {
      return { ok: false, error: coerced.error };
    }

    out[spec.name] = coerced.value;
    raw[spec.name] = value;
    cursor += 1;
  }

  if (cursor < fieldTokens.length) {
    return {
      ok: false,
      error: {
        tag: schema.tag,
        line: fieldTokens[cursor]!.line,
        col: fieldTokens[cursor]!.col,
        reason: `expected ${fieldSpecs.length} field(s), got ${fieldTokens.length}`,
        suggestion: `Got ${fieldTokens.length} field(s) after the tag "${
          schema.tag
        }". Expected: ${fieldSpecs.map((f) => f.name).join(", ")}.${maybeSeparatorHint(
          fieldTokens.slice(cursor).map((t) => (t.kind === "field" ? t.value : "")).join("|"),
        )}`,
      },
    };
  }

  return { ok: true, value: out, raw };
}

function joinGreedyFields(fields: readonly DslToken[]): string {
  if (fields.length === 0) return "";
  const parts: string[] = [];
  for (const f of fields) {
    if (f.kind === "field") parts.push(f.value);
  }
  return parts.join(" ").trim();
}

type CoerceResult =
  | { ok: true; value: unknown }
  | { ok: false; error: DslLexerError };

function coerceValue(
  value: string,
  type: Exclude<DslFieldType, { kind: "varargs" }>,
  fieldName: string,
  tok: DslToken,
): CoerceResult {
  switch (type.kind) {
    case "string":
    case "greedy-string":
      if (!value.trim()) {
        return {
          ok: false,
          error: {
            tag: "",
            line: tok.line,
            col: tok.col,
            reason: `${fieldName} is empty`,
          },
        };
      }
      return { ok: true, value: value.trim() };

    case "optional-string":
      return { ok: true, value: value.trim() };

    case "integer": {
      const n = Number(value.trim());
      if (!Number.isInteger(n)) {
        return {
          ok: false,
          error: {
            tag: "",
            line: tok.line,
            col: tok.col,
            reason: `${fieldName} must be an integer, got "${value}"`,
            suggestion: maybeSeparatorHint(value),
          },
        };
      }
      if (type.min !== undefined && n < type.min) {
        return {
          ok: false,
          error: {
            tag: "",
            line: tok.line,
            col: tok.col,
            reason: `${fieldName} must be >= ${type.min}, got ${n}`,
          },
        };
      }
      if (type.max !== undefined && n > type.max) {
        return {
          ok: false,
          error: {
            tag: "",
            line: tok.line,
            col: tok.col,
            reason: `${fieldName} must be <= ${type.max}, got ${n}`,
          },
        };
      }
      return { ok: true, value: n };
    }

    case "enum": {
      if (!type.values.has(value)) {
        return {
          ok: false,
          error: {
            tag: "",
            line: tok.line,
            col: tok.col,
            reason: `${fieldName} must be one of [${[...type.values].join(", ")}], got "${value}"`,
          },
        };
      }
      return { ok: true, value };
    }

    case "enum-ci": {
      const lower = value.toLowerCase();
      for (const v of type.values) {
        if (v.toLowerCase() === lower) {
          return { ok: true, value: v };
        }
      }
      return {
        ok: false,
        error: {
          tag: "",
          line: tok.line,
          col: tok.col,
          reason: `${fieldName} must be one of [${[...type.values].join(", ")}], got "${value}"`,
        },
      };
    }

    case "list": {
      const items = value
        .split(type.separator)
        .map((s) => s.trim())
        .filter(Boolean);
      return { ok: true, value: items };
    }

    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      return {
        ok: false,
        error: {
          tag: "",
          line: tok.line,
          col: tok.col,
          reason: `unsupported field type`,
        },
      };
    }
  }
}

function errFromSpec(
  spec: DslFieldSpec,
  reason: string,
  line: number,
  col: number,
  suggestion?: string,
): DslMatchErr {
  return {
    ok: false,
    error: {
      tag: "",
      line,
      col,
      reason,
      suggestion,
    },
  };
}

function maybeSeparatorHint(value: string): string | undefined {
  if (value.includes("|") && !value.includes("‖")) {
    return ` Field separator is ${DSL_FIELD_SEPARATOR_DISPLAY}; did you mean ‖?`;
  }
  return undefined;
}

// ---------- Helpers ----------

export function formatError(err: DslLexerError): string {
  return err.suggestion ? `${err.reason}.${err.suggestion}` : err.reason;
}
