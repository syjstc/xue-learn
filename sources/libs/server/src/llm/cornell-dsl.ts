import { cornellSchema } from "./schemas.js";
import type { z } from "zod";
import {
  legacyPipeHint,
  matchLine,
  tokenizeDslLine,
  type DslLineSchema,
  type DslMatchResult,
} from "./dsl-lexer.js";
import { stripThinkingTags } from "./sanitize-response.js";

type CornellNotes = z.infer<typeof cornellSchema>;
type CornellDslTag = "N" | "CU" | "SM";

const CORNELL_DSL_TAGS = new Set(["N", "CU", "SM"]);

const TEXT_FIELD_SCHEMA: DslLineSchema["fields"] = [
  { name: "text", type: { kind: "string" }, required: true },
];

const CORNELL_SCHEMAS: Record<string, DslLineSchema> = {
  N: { tag: "N", fields: TEXT_FIELD_SCHEMA },
  CU: { tag: "CU", fields: TEXT_FIELD_SCHEMA },
  SM: { tag: "SM", fields: TEXT_FIELD_SCHEMA },
};

export type CornellDslInvalidLine = {
  lineNumber: number;
  line: string;
  reason: string;
};

type ParseMode = "preview" | "final";

function cornellDslTag(line: string): CornellDslTag | undefined {
  const tag = line
    .split(/[‖|]/, 1)[0]
    ?.trim()
    .toUpperCase();
  return tag && CORNELL_DSL_TAGS.has(tag) ? (tag as CornellDslTag) : undefined;
}

function lineLooksLikeDsl(line: string): boolean {
  return cornellDslTag(line) !== undefined;
}

function appendMultilineContinuation(
  tag: CornellDslTag,
  context: {
    noteLines: string[];
    cueLines: string[];
    summary: string;
  },
  line: string,
): void {
  const piece = line.trimEnd();
  const append = (prev: string) =>
    piece.length > 0 ? `${prev}\n${piece}` : `${prev}\n`;

  if (tag === "N") {
    const lastIndex = context.noteLines.length - 1;
    if (lastIndex < 0) return;
    context.noteLines[lastIndex] = append(context.noteLines[lastIndex]!);
    return;
  }
  if (tag === "CU") {
    const lastIndex = context.cueLines.length - 1;
    if (lastIndex < 0) return;
    context.cueLines[lastIndex] = append(context.cueLines[lastIndex]!);
    return;
  }
  context.summary = append(context.summary);
}

export function sanitizeCornellDslText(text: string): string {
  const lines = stripThinkingTags(text).split(/\r?\n/);
  const sanitized: string[] = [];
  let inMultilineContinuation = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (inMultilineContinuation) {
        sanitized.push("");
        continue;
      }
      if (sanitized.length > 0) sanitized.push("");
      inMultilineContinuation = false;
      continue;
    }
    if (line.startsWith("```")) {
      if (inMultilineContinuation) {
        sanitized.push(rawLine.trim());
      }
      continue;
    }
    if (lineLooksLikeDsl(line)) {
      sanitized.push(rawLine.trim());
      inMultilineContinuation = true;
      continue;
    }
    if (inMultilineContinuation) {
      sanitized.push(rawLine);
      continue;
    }
    if (sanitized.length > 0) {
      sanitized.push(rawLine.trim());
    }
  }

  return sanitized.join("\n").trim();
}

function parseLine(
  line: string,
  lineNumber: number,
): { tag: string; text: string } | CornellDslInvalidLine {
  const legacyHint = legacyPipeHint(line);
  if (legacyHint) {
    return {
      lineNumber,
      line,
      reason: `field separator is ‖ (U+2016); use ‖ between fields, not |`,
    };
  }

  const tokens = tokenizeDslLine(line, lineNumber);
  const tagToken = tokens.find((t) => t.kind === "tag");
  if (!tagToken || tagToken.kind !== "tag") {
    return { lineNumber, line, reason: "line has no tag" };
  }
  const tag = tagToken.value;
  const schema = CORNELL_SCHEMAS[tag];
  if (!schema) {
    return { lineNumber, line, reason: `unknown tag ${tag}` };
  }
  const matched: DslMatchResult = matchLine(tokens, schema);
  if (!matched.ok) {
    return {
      lineNumber,
      line,
      reason:
        matched.error.reason +
        (matched.error.suggestion ? `. ${matched.error.suggestion}` : ""),
    };
  }
  return { tag, text: String(matched.value.text ?? "") };
}

function joinNoteLines(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n\n");
}

function joinCueLines(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function parseLines(
  text: string,
  mode: ParseMode = "preview",
): {
  noteLines: string[];
  cueLines: string[];
  summary: string;
  validLineCount: number;
  invalidLines: CornellDslInvalidLine[];
} {
  const context = {
    noteLines: [] as string[],
    cueLines: [] as string[],
    summary: "",
  };
  const invalidLines: CornellDslInvalidLine[] = [];
  let validLineCount = 0;
  let multilineTag: CornellDslTag | null = null;

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmed = line.trim();

    if (!trimmed) {
      if (multilineTag) {
        appendMultilineContinuation(multilineTag, context, "");
        validLineCount += 1;
      }
      continue;
    }

    if (multilineTag && !lineLooksLikeDsl(trimmed)) {
      appendMultilineContinuation(multilineTag, context, line);
      validLineCount += 1;
      continue;
    }

    multilineTag = null;

    const parsed = parseLine(trimmed, index + 1);
    if ("tag" in parsed) {
      const value = parsed.text;
      if (parsed.tag === "N") {
        if (value || mode === "preview") {
          context.noteLines.push(value);
          validLineCount += 1;
        }
        multilineTag = "N";
      } else if (parsed.tag === "CU") {
        if (value || mode === "preview") {
          context.cueLines.push(value);
          validLineCount += 1;
        }
        multilineTag = "CU";
      } else if (parsed.tag === "SM") {
        if (value || mode === "preview") {
          context.summary = value;
          validLineCount += 1;
        }
        multilineTag = "SM";
      }
    } else if (mode === "final") {
      invalidLines.push(parsed);
    }
  }

  return {
    noteLines: context.noteLines,
    cueLines: context.cueLines,
    summary: context.summary,
    validLineCount,
    invalidLines,
  };
}

function toCornell(parsed: ReturnType<typeof parseLines>): CornellNotes {
  return {
    notes: joinNoteLines(parsed.noteLines),
    cues: joinCueLines(parsed.cueLines),
    summary: parsed.summary.trim(),
  };
}

export function parseCornellDslPreview(text: string): {
  cornell: CornellNotes;
  completeLineCount: number;
  validLineCount: number;
} | null {
  const parsed = parseLines(sanitizeCornellDslText(text));
  const cornell = toCornell(parsed);
  if (!cornell.notes && !cornell.cues && !cornell.summary) {
    return null;
  }
  return {
    cornell,
    completeLineCount: parsed.validLineCount,
    validLineCount: parsed.validLineCount,
  };
}

export class CornellDslParseError extends Error {
  constructor(public readonly invalidLines: CornellDslInvalidLine[]) {
    const detail = invalidLines
      .slice(0, 5)
      .map((item) => `line ${item.lineNumber}: ${item.reason}`)
      .join("; ");
    super(`Cornell notes DSL contains invalid lines: ${detail}`);
    this.name = "CornellDslParseError";
  }
}

export function getCornellDslInvalidLines(text: string): CornellDslInvalidLine[] {
  return parseLines(sanitizeCornellDslText(text), "final").invalidLines;
}

export function applyCornellDslLineReplacements(
  text: string,
  replacements: { lineNumber: number; line: string }[],
): string {
  const lines = sanitizeCornellDslText(text).split(/\r?\n/);
  for (const replacement of replacements) {
    const index = replacement.lineNumber - 1;
    if (index < 0 || index >= lines.length) continue;
    lines[index] = replacement.line.trim();
  }
  return lines.join("\n");
}

export function parseCornellDsl(text: string): CornellNotes {
  const sanitized = sanitizeCornellDslText(text);
  const parsed = parseLines(sanitized, "final");
  if (parsed.invalidLines.length > 0) {
    throw new CornellDslParseError(parsed.invalidLines);
  }
  const cornell = toCornell(parsed);
  if (!cornell.notes.trim()) {
    throw new Error("Cornell notes DSL requires at least one N line");
  }
  if (!cornell.summary.trim()) {
    throw new Error("Cornell notes DSL requires an SM line");
  }
  return cornellSchema.parse(cornell);
}

export type CornellDslPartial = {
  cornell: CornellNotes;
  completeLineCount: number;
};

export class CornellDslStreamAccumulator {
  private completeText = "";
  private pending = "";
  private lastValidLineCount = 0;

  append(delta: string): CornellDslPartial | null {
    this.pending += delta;
    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop() ?? "";
    if (lines.length === 0) return null;
    this.completeText += lines.join("\n") + "\n";
    const preview = parseCornellDslPreview(this.completeText);
    if (!preview || preview.validLineCount === this.lastValidLineCount) {
      return null;
    }
    this.lastValidLineCount = preview.validLineCount;
    return {
      cornell: preview.cornell,
      completeLineCount: preview.completeLineCount,
    };
  }
}

export const CORNELL_DSL_CONTRACT = `Output ONLY CornellNotes DSL lines. No JSON, markdown fences, or commentary.
Use "‖" (U+2016 DOUBLE VERTICAL LINE) as the field separator. Do not use "|".
If a text field must contain "‖", wrap that field as a JSON string.
LaTeX \\| and $...$ inline math may contain pipes and other characters.
Line types:
N‖note paragraph or bullet (1+ lines; distilled study notes, not the full textbook)
CU‖recall cue or keyword prompt (1+ lines)
SM‖2-4 sentence synthesis summary (exactly one required line, last)
Untagged lines after a tagged line continue the previous field (lists, code fences, multi-paragraph notes).`;
