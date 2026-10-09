import {
  learningTargetLabels,
  normalizeLearningTargetId,
  parseLearningTargetIdList,
  type SqGuidingQuestion,
  type UnitLearningTarget,
} from "../domain/learning-targets.js";
import { sqPreviewSchema, type SqPreview } from "./schemas.js";
import {
  DSL_FIELD_SEPARATOR,
  legacyPipeHint,
  matchLine,
  tokenizeDslLine,
  type DslLineSchema,
  type DslMatchResult,
} from "./dsl-lexer.js";
import { stripThinkingTags } from "./sanitize-response.js";

const SQ_DSL_TAGS = new Set(["O", "LT", "Q"]);

// O‖text
// LT‖id‖label‖explanation‖objective‖criteria
// Q‖learningTargetIds‖text
const O_SCHEMA: DslLineSchema = {
  tag: "O",
  fields: [{ name: "text", type: { kind: "string" }, required: true }],
};
const LT_SCHEMA: DslLineSchema = {
  tag: "LT",
  fields: [
    { name: "idOrLabel", type: { kind: "string" }, required: true },
    { name: "label", type: { kind: "string" }, required: true },
    { name: "explanation", type: { kind: "string" }, required: true },
    { name: "learningObjective", type: { kind: "string" }, required: true },
    { name: "assessmentCriteria", type: { kind: "string" }, required: true },
  ],
};
const Q_SCHEMA: DslLineSchema = {
  tag: "Q",
  fields: [
    { name: "idsOrText", type: { kind: "string" }, required: true },
    { name: "text", type: { kind: "string" }, required: true },
  ],
};

const SQ_SCHEMAS: Record<string, DslLineSchema> = {
  O: O_SCHEMA,
  LT: LT_SCHEMA,
  Q: Q_SCHEMA,
};

export type SqPreviewDslInvalidLine = {
  lineNumber: number;
  line: string;
  reason: string;
};

type ParseMode = "preview" | "final";

type ParsedTargetLine = {
  idHint: string;
  label: string;
  explanation?: string;
  learningObjective?: string;
  assessmentCriteria?: string[];
};
type ParsedQLine = { learningTargetIds: string[]; text: string };

function lineLooksLikeDsl(line: string): boolean {
  const tag = line
    .split(/[‖|]/, 1)[0]
    ?.trim()
    .toUpperCase();
  return SQ_DSL_TAGS.has(tag ?? "");
}

export function sanitizeSqPreviewDslText(text: string): string {
  return stripThinkingTags(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || line.startsWith("```")) return false;
      return lineLooksLikeDsl(line);
    })
    .join("\n");
}

function parseTargetFields(
  idOrLabel: string,
  labelField: string,
  index: number,
  explanation = "",
  learningObjective = "",
  assessmentCriteria = "",
): ParsedTargetLine {
  const first = idOrLabel.trim();
  const second = labelField.trim();
  return {
    idHint: normalizeLearningTargetId(first, index),
    label: second,
    explanation: explanation.trim() || undefined,
    learningObjective: learningObjective.trim() || undefined,
    assessmentCriteria: assessmentCriteria.trim()
      ? assessmentCriteria.split(/[;；]/).map((value) => value.trim()).filter(Boolean)
      : undefined,
  };
}

function parseQFields(idsOrText: string, textField: string): ParsedQLine {
  const first = idsOrText.trim();
  const second = textField.trim();
  return {
    learningTargetIds: parseLearningTargetIdList(first),
    text: second,
  };
}

function parseLine(
  line: string,
  lineNumber: number,
):
  | { tag: "O"; text: string }
  | {
      tag: "LT";
      idOrLabel: string;
      label: string;
      explanation: string;
      learningObjective: string;
      assessmentCriteria: string;
    }
  | { tag: "Q"; idsOrText: string; text: string }
  | SqPreviewDslInvalidLine {
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
  const schema = SQ_SCHEMAS[tag];
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
  if (tag === "O") {
    return { tag: "O", text: String(matched.value.text ?? "") };
  }
  if (tag === "LT") {
    return {
      tag: "LT",
      idOrLabel: String(matched.value.idOrLabel ?? ""),
      label: String(matched.value.label ?? ""),
      explanation: String(matched.value.explanation ?? ""),
      learningObjective: String(matched.value.learningObjective ?? ""),
      assessmentCriteria: String(matched.value.assessmentCriteria ?? ""),
    };
  }
  return {
    tag: "Q",
    idsOrText: String(matched.value.idsOrText ?? ""),
    text: String(matched.value.text ?? ""),
  };
}

function parseLines(
  text: string,
  mode: ParseMode = "preview",
): {
  outline: string[];
  learningTargets: UnitLearningTarget[];
  questions: SqGuidingQuestion[];
  validLineCount: number;
  invalidLines: SqPreviewDslInvalidLine[];
} {
  const outline: string[] = [];
  const learningTargets: UnitLearningTarget[] = [];
  const questions: SqGuidingQuestion[] = [];
  const invalidLines: SqPreviewDslInvalidLine[] = [];
  let validLineCount = 0;
  const seenTargetRefs = new Set<string>();

  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parsed = parseLine(trimmed, index + 1);
    if ("tag" in parsed) {
      if (parsed.tag === "O") {
        if (parsed.text || mode === "preview") {
          outline.push(parsed.text);
          validLineCount += 1;
        }
        return;
      }
      if (parsed.tag === "LT") {
        const target = parseTargetFields(
          parsed.idOrLabel,
          parsed.label,
          learningTargets.length,
          parsed.explanation,
          parsed.learningObjective,
          parsed.assessmentCriteria,
        );
        if (!target.label || seenTargetRefs.has(target.idHint)) return;
        const id = target.idHint;
        seenTargetRefs.add(id);
        learningTargets.push({
          id,
          label: target.label,
          ...(target.explanation ? { explanation: target.explanation } : {}),
          ...(target.learningObjective
            ? { learningObjective: target.learningObjective }
            : {}),
          ...(target.assessmentCriteria?.length
            ? { assessmentCriteria: target.assessmentCriteria }
            : {}),
        });
        validLineCount += 1;
        return;
      }
      const q = parseQFields(parsed.idsOrText, parsed.text);
      if (!q.text && mode !== "preview") return;
      questions.push({
        text: q.text,
        learningTargetIds: q.learningTargetIds,
      });
      validLineCount += 1;
    } else if (mode === "final") {
      invalidLines.push(parsed);
    }
  });

  const validIds = new Set(learningTargets.map((p) => p.id));
  const boundQuestions = questions.flatMap((q) => {
    const ids = q.learningTargetIds.filter((id) => validIds.has(id));
    if (ids.length === 0) return [];
    return [{
      text: q.text,
      learningTargetIds: ids,
    }];
  });

  return {
    outline,
    learningTargets,
    questions: boundQuestions,
    validLineCount,
    invalidLines,
  };
}

function toSqPreview(parsed: ReturnType<typeof parseLines>): SqPreview {
  const learningTargets = parsed.learningTargets;
  const questions = parsed.questions;

  return {
    survey: {
      outline: parsed.outline,
      learningTargetLabels: learningTargetLabels(learningTargets),
    },
    learningTargets,
    questions,
  };
}

export function withSqComponentSelection(
  sq: SqPreview,
  componentSelection: NonNullable<SqPreview["componentSelection"]>,
): SqPreview {
  return { ...sq, componentSelection };
}

export function parseSqPreviewDslPreview(text: string): {
  sq: SqPreview;
  completeLineCount: number;
  validLineCount: number;
} | null {
  const parsed = parseLines(sanitizeSqPreviewDslText(text));
  if (
    parsed.outline.length === 0 &&
    parsed.learningTargets.length === 0 &&
    parsed.questions.length === 0
  ) {
    return null;
  }
  // Preview may be incomplete (no questions yet) — avoid forcing placeholder Q
  // into streaming UI until we have real content or final parse.
  const previewSq: SqPreview = {
    survey: {
      outline: parsed.outline,
      learningTargetLabels: learningTargetLabels(parsed.learningTargets),
    },
    learningTargets: parsed.learningTargets,
    questions: parsed.questions,
  };
  return {
    sq: previewSq,
    completeLineCount:
      parsed.outline.length +
      parsed.learningTargets.length +
      parsed.questions.length,
    validLineCount: parsed.validLineCount,
  };
}

export class SqPreviewDslParseError extends Error {
  constructor(public readonly invalidLines: SqPreviewDslInvalidLine[]) {
    const detail = invalidLines
      .slice(0, 5)
      .map((item) => `line ${item.lineNumber}: ${item.reason}`)
      .join("; ");
    super(`SQ preview DSL contains invalid lines: ${detail}`);
    this.name = "SqPreviewDslParseError";
  }
}

export function getSqPreviewDslInvalidLines(
  text: string,
): SqPreviewDslInvalidLine[] {
  return parseLines(sanitizeSqPreviewDslText(text), "final").invalidLines;
}

export function applySqPreviewDslLineReplacements(
  text: string,
  replacements: { lineNumber: number; line: string }[],
): string {
  const lines = sanitizeSqPreviewDslText(text).split(/\r?\n/);
  for (const replacement of replacements) {
    const index = replacement.lineNumber - 1;
    if (index < 0 || index >= lines.length) continue;
    lines[index] = replacement.line.trim();
  }
  return lines.join("\n");
}

export function parseSqPreviewDsl(text: string): SqPreview {
  const sanitized = sanitizeSqPreviewDslText(text);
  const parsed = parseLines(sanitized, "final");
  if (parsed.invalidLines.length > 0) {
    throw new SqPreviewDslParseError(parsed.invalidLines);
  }
  if (
    parsed.outline.length === 0 &&
    parsed.learningTargets.length === 0 &&
    parsed.questions.length === 0
  ) {
    throw new Error("SQ preview DSL is empty");
  }
  if (parsed.questions.length === 0) {
    throw new Error("SQ preview DSL requires at least one Q line");
  }
  if (parsed.learningTargets.length === 0) {
    throw new Error("SQ preview DSL requires at least one LT line");
  }
  return sqPreviewSchema.parse(toSqPreview(parsed));
}

export type SqPreviewDslPartial = {
  sq: SqPreview;
  completeLineCount: number;
};

export class SqPreviewDslStreamAccumulator {
  private completeText = "";
  private pending = "";
  private lastValidLineCount = 0;

  append(delta: string): SqPreviewDslPartial | null {
    this.pending += delta;
    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop() ?? "";
    if (lines.length === 0) return null;
    this.completeText += lines.join("\n") + "\n";
    const preview = parseSqPreviewDslPreview(this.completeText);
    if (!preview || preview.validLineCount === this.lastValidLineCount) {
      return null;
    }
    this.lastValidLineCount = preview.validLineCount;
    return {
      sq: preview.sq,
      completeLineCount: preview.completeLineCount,
    };
  }
}

export const SQ_PREVIEW_DSL_CONTRACT = `Output ONLY SQPreview DSL lines. No JSON, markdown, or code fences.
Use "‖" (U+2016 DOUBLE VERTICAL LINE) as the field separator. Do not use "|".
If a text field must contain "‖", wrap that field as a JSON string, e.g. "text with ‖ symbol".
LaTeX \\| and $...$ inline math may contain pipes and other characters.
Line types:
LT‖id‖label‖explanation‖learningObjective‖criterion 1; criterion 2 — published unit learning target. id must be lt_1, lt_2, ... Example: LT‖lt_1‖memory trigger conditions‖Which signals should trigger long-term memory storage?‖Can decide whether a new scenario requires long-term memory‖Explain trigger conditions; judge a new example
O‖survey outline bullet (1-6 lines)
Q‖learningTargetIds‖guiding question — learningTargetIds is comma-separated learning-target refs this question targets (1-6 lines; at least one required). Example: Q‖lt_1,lt_2‖What should the system do when a learner says, "Choose 30% sugar for me next time"?`;
