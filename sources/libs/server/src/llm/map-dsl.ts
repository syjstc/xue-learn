import {
  decomposeResultBindingSchema,
  microUnitResultSchema,
  type DecomposeResult,
  type MicroUnitResult,
} from "./schemas.js";
import {
  DSL_FIELD_SEPARATOR,
  legacyPipeHint,
  matchLine,
  tokenizeDslLine,
  type DslLineSchema,
  type DslMatchResult,
} from "./dsl-lexer.js";
import { stripThinkingTags } from "./sanitize-response.js";

const MAP_DOMAIN_TAGS = new Set(["stem", "humanities", "general"]);
const UNIT_SCOPES = new Set(["session", "module", "branch", "unit"]);
const DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const MICRO_TOPIC_SCOPES = new Set(["focused", "overview"]);

/** First map gen always stores learnable session units; branch/module scope is coerced. */
function coerceMapUnitScope(_scope: string): "session" {
  return "session";
}

function parseIntField(value: string, label: string): number {
  const n = Number(value.trim());
  if (!Number.isInteger(n)) throw new Error(`${label} must be an integer`);
  return n;
}

function parseList(value: string): string[] {
  return value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

// ---------- Grammar schemas ----------

const D_SCHEMA: DslLineSchema = {
  tag: "D",
  fields: [
    {
      name: "domainTag",
      type: { kind: "enum-ci", values: MAP_DOMAIN_TAGS },
      required: true,
    },
  ],
};

const U_SCHEMA: DslLineSchema = {
  // Long form: scope|title|durationMin|difficulty|parentTitle|prerequisiteTitles|needsExpansion|contentSummary
  // (8 fields, last 4 are flexible — see parseUUnitFields for shape detection)
  tag: "U",
  fields: [
    {
      name: "scope",
      type: { kind: "enum-ci", values: UNIT_SCOPES },
      required: true,
    },
    { name: "title", type: { kind: "string" }, required: true },
    {
      name: "durationMin",
      type: { kind: "integer", min: 0 },
      required: true,
    },
    {
      name: "difficulty",
      type: { kind: "enum-ci", values: DIFFICULTIES },
      required: true,
    },
    {
      // Collect the trailing 4 (or 3, or 2) flexible sub-fields. Items may be
      // empty (e.g. an empty parentTitle), so we use a permissive string
      // variant that allows empty content.
      name: "tail",
      type: {
        kind: "varargs",
        item: { kind: "optional-string" },
        minItems: 1,
        maxItems: 4,
      },
      required: true,
    },
  ],
};

const RT_SCHEMA: DslLineSchema = {
  tag: "RT",
  fields: [{ name: "text", type: { kind: "string" }, required: true }],
};

const O_SCHEMA: DslLineSchema = {
  tag: "O",
  fields: [{ name: "text", type: { kind: "string" }, required: true }],
};

const T_SCHEMA: DslLineSchema = {
  tag: "T",
  fields: [{ name: "text", type: { kind: "string" }, required: true }],
};

const M_SCHEMA: DslLineSchema = {
  tag: "M",
  fields: [
    {
      name: "durationMin",
      type: { kind: "integer", min: 0 },
      required: true,
    },
    {
      name: "difficulty",
      type: { kind: "enum-ci", values: DIFFICULTIES },
      required: true,
    },
    { name: "contentSummary", type: { kind: "string" }, required: true },
  ],
};

const TS_SCHEMA: DslLineSchema = {
  tag: "TS",
  fields: [
    {
      name: "scope",
      type: { kind: "enum-ci", values: MICRO_TOPIC_SCOPES },
      required: true,
    },
  ],
};

const MAP_SCHEMAS: Record<string, DslLineSchema> = {
  D: D_SCHEMA,
  U: U_SCHEMA,
  RT: RT_SCHEMA,
  TS: TS_SCHEMA,
  O: O_SCHEMA,
  T: T_SCHEMA,
  M: M_SCHEMA,
};

// ---------- U line post-processing ----------
// The U grammar collects parentTitle/prerequisiteTitles/needsExpansion/contentSummary
// as a `tail` array of 1-4 trailing sub-fields. We dispatch on length.
function parseUUnitFields(
  value: Record<string, unknown>,
): DecomposeResult["units"][number] {
  const scope = String(value.scope ?? "").toLowerCase();
  const title = String(value.title ?? "");
  const durationMin = Number(value.durationMin);
  const difficulty = String(value.difficulty ?? "").toLowerCase();
  const tail = Array.isArray(value.tail)
    ? (value.tail as unknown[]).map((p) => String(p ?? "").trim())
    : [];

  let parentTitle: string | null = null;
  let prerequisiteTitles: string[] = [];
  let needsExpansion = false;
  let contentSummary = "";

  if (tail.length === 4) {
    // Long form: parentTitle, prerequisiteTitles, needsExpansion, contentSummary
    parentTitle = tail[0] || null;
    prerequisiteTitles = parseList(tail[1] ?? "");
    needsExpansion = ["true", "yes", "1"].includes(
      (tail[2] ?? "").toLowerCase(),
    );
    contentSummary = tail[3] ?? "";
  } else if (tail.length === 3) {
    parentTitle = tail[0] || null;
    prerequisiteTitles = parseList(tail[1] ?? "");
    contentSummary = tail[2] ?? "";
  } else if (tail.length === 2) {
    if (tail[0] === "") {
      contentSummary = tail[1] ?? "";
    } else {
      prerequisiteTitles = parseList(tail[0]);
      contentSummary = tail[1] ?? "";
    }
  } else if (tail.length === 1) {
    contentSummary = tail[0] ?? "";
  } else {
    throw new Error("U line missing content summary");
  }

  if (!contentSummary) throw new Error("content summary is empty");

  return {
    scope: coerceMapUnitScope(scope),
    title,
    difficulty: difficulty as "easy" | "medium" | "hard",
    parentTitle,
    prerequisiteTitles,
    contentSummary,
    ...(needsExpansion ? { needsExpansion: true as const } : {}),
  };
}

// ---------- Sanitize ----------

const MAP_KNOWN_TAGS = new Set(["D", "U", "RT", "O", "T", "M"]);

function lineLooksLikeMapDsl(line: string): boolean {
  // Accept both ‖ and | so legacy lines reach the parser and surface a hint.
  const tag = line.split(/[‖|]/, 1)[0]?.trim().toUpperCase();
  return MAP_KNOWN_TAGS.has(tag ?? "");
}

export function sanitizeMapDslText(text: string): string {
  return stripThinkingTags(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || line.startsWith("```")) return false;
      return lineLooksLikeMapDsl(line);
    })
    .join("\n");
}

export type MapDslInvalidLine = {
  lineNumber: number;
  line: string;
  reason: string;
};

type MapParseMode = "preview" | "final";

function parseMapLine(
  line: string,
  lineNumber: number,
):
  | { tag: "D"; domainTag: string }
  | { tag: "U"; unit: DecomposeResult["units"][number] }
  | { invalid: MapDslInvalidLine } {
  const legacyHint = legacyPipeHint(line);
  if (legacyHint) {
    return {
      invalid: {
        lineNumber,
        line,
        reason: `field separator is ‖ (U+2016); use ‖ between fields, not |`,
      },
    };
  }

  const tokens = tokenizeDslLine(line, lineNumber);
  const tagToken = tokens.find((t) => t.kind === "tag");
  if (!tagToken || tagToken.kind !== "tag") {
    return { invalid: { lineNumber, line, reason: "line has no tag" } };
  }
  const tag = tagToken.value;
  const schema = MAP_SCHEMAS[tag];
  if (!schema) {
    return { invalid: { lineNumber, line, reason: `unknown tag ${tag}` } };
  }
  const matched: DslMatchResult = matchLine(tokens, schema);
  if (!matched.ok) {
    return {
      invalid: {
        lineNumber,
        line,
        reason:
          matched.error.reason +
          (matched.error.suggestion ? `. ${matched.error.suggestion}` : ""),
      },
    };
  }

  if (tag === "D") {
    return {
      tag: "D",
      domainTag: String(matched.value.domainTag ?? "").toLowerCase(),
    };
  }
  if (tag === "U") {
    try {
      return { tag: "U", unit: parseUUnitFields(matched.value) };
    } catch (e) {
      return {
        invalid: {
          lineNumber,
          line,
          reason: e instanceof Error ? e.message : String(e),
        },
      };
    }
  }
  // Other tags (RT/O/T/M) are micro-unit concerns; map parsing ignores them.
  return {
    invalid: { lineNumber, line, reason: `tag ${tag} not part of map DSL` },
  };
}

function parseMapDslLines(
  text: string,
  mode: MapParseMode = "preview",
): {
  domainTag: "stem" | "humanities" | "general";
  units: DecomposeResult["units"];
  invalidLines: MapDslInvalidLine[];
  sawDomainLine: boolean;
  invalidLineCount: number;
} {
  let domainTag: "stem" | "humanities" | "general" = "general";
  let sawDomainLine = false;
  const units: DecomposeResult["units"] = [];
  const invalidLines: MapDslInvalidLine[] = [];
  let invalidLineCount = 0;

  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parsed = parseMapLine(trimmed, index + 1);
    if ("invalid" in parsed) {
      if (mode === "final") invalidLines.push(parsed.invalid);
      invalidLineCount += 1;
      return;
    }
    if (parsed.tag === "D") {
      sawDomainLine = true;
      if (MAP_DOMAIN_TAGS.has(parsed.domainTag)) {
        domainTag = parsed.domainTag as typeof domainTag;
      }
    } else if (parsed.tag === "U") {
      units.push(parsed.unit);
    }
  });

  return { domainTag, units, invalidLines, sawDomainLine, invalidLineCount };
}

export type MapDslPreview = {
  map: DecomposeResult;
  placeholderUnitCount: number;
};

export function parseMapDslPreview(text: string): MapDslPreview | null {
  const sanitized = sanitizeMapDslText(text);
  if (!sanitized) return null;
  const parsed = parseMapDslLines(sanitized, "preview");
  if (
    !parsed.sawDomainLine &&
    parsed.units.length === 0 &&
    parsed.invalidLineCount === 0
  ) {
    return null;
  }
  return {
    map: { domainTag: parsed.domainTag, units: parsed.units },
    placeholderUnitCount: parsed.invalidLineCount,
  };
}

export class MapDslParseError extends Error {
  constructor(public readonly invalidLines: MapDslInvalidLine[]) {
    const detail = invalidLines
      .slice(0, 5)
      .map((item) => `line ${item.lineNumber}: ${item.reason}`)
      .join("; ");
    super(`Map DSL contains invalid lines: ${detail}`);
    this.name = "MapDslParseError";
  }
}

export function getMapDslInvalidLines(text: string): MapDslInvalidLine[] {
  return parseMapDslLines(sanitizeMapDslText(text), "final").invalidLines;
}

export function applyMapDslLineReplacements(
  text: string,
  replacements: { lineNumber: number; line: string }[],
): string {
  const lines = sanitizeMapDslText(text).split(/\r?\n/);
  for (const replacement of replacements) {
    const index = replacement.lineNumber - 1;
    if (index < 0 || index >= lines.length) continue;
    lines[index] = replacement.line.trim();
  }
  return lines.join("\n");
}

export function parseMapDsl(text: string): DecomposeResult {
  const sanitized = sanitizeMapDslText(text);
  const parsed = parseMapDslLines(sanitized, "final");
  if (parsed.invalidLines.length > 0) {
    throw new MapDslParseError(parsed.invalidLines);
  }
  if (!parsed.sawDomainLine && parsed.units.length === 0) {
    throw new Error("Map DSL is empty");
  }
  return decomposeResultBindingSchema.parse({
    domainTag: parsed.domainTag,
    units: parsed.units,
  });
}

export type MapDslPartial = {
  map: DecomposeResult;
  unitCount: number;
  placeholderUnitCount: number;
};

export class MapDslStreamAccumulator {
  private completeText = "";
  private pending = "";
  private lastSnapshot = "";

  append(delta: string): MapDslPartial | null {
    this.pending += delta;
    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop() ?? "";
    if (lines.length > 0) {
      this.completeText += lines.join("\n") + "\n";
    }
    const draft = this.pending
      ? this.completeText + this.pending
      : this.completeText;
    const preview = parseMapDslPreview(draft);
    if (!preview) return null;
    const snapshot = JSON.stringify({
      map: preview.map,
      placeholderUnitCount: preview.placeholderUnitCount,
    });
    if (snapshot === this.lastSnapshot) return null;
    this.lastSnapshot = snapshot;
    return {
      map: preview.map,
      unitCount: preview.map.units.length,
      placeholderUnitCount: preview.placeholderUnitCount,
    };
  }

  /**
   * Reset the buffer with a complete text (e.g. final repaired DSL after
   * `repairAndParseDsl`) and re-emit the resulting partial. Used so the
   * frontend can swap loading placeholders for real data once the LLM has
   * fixed errored lines.
   */
  appendFromText(text: string): MapDslPartial | null {
    // Re-feed the full text through `append` rather than setting the buffer
    // directly, so the line-splitting logic stays in one place. Append a
    // trailing newline so the final line gets flushed into completeText
    // instead of being parked in `pending`.
    this.completeText = "";
    this.pending = "";
    this.lastSnapshot = "";
    return this.append(text.endsWith("\n") ? text : `${text}\n`);
  }
}

export type MicroUnitDslInvalidLine = {
  lineNumber: number;
  line: string;
  reason: string;
};

function parseMicroUnitLine(
  line: string,
  lineNumber: number,
):
  | { tag: "RT" | "TS" | "O" | "T" | "M"; value: unknown }
  | { invalid: MicroUnitDslInvalidLine } {
  const legacyHint = legacyPipeHint(line);
  if (legacyHint) {
    return {
      invalid: {
        lineNumber,
        line,
        reason: `field separator is ‖ (U+2016); use ‖ between fields, not |`,
      },
    };
  }
  const tokens = tokenizeDslLine(line, lineNumber);
  const tagToken = tokens.find((t) => t.kind === "tag");
  if (!tagToken || tagToken.kind !== "tag") {
    return { invalid: { lineNumber, line, reason: "line has no tag" } };
  }
  const tag = tagToken.value;
  const schema = MAP_SCHEMAS[tag];
  if (!schema) {
    return { invalid: { lineNumber, line, reason: `unknown tag ${tag}` } };
  }
  const matched: DslMatchResult = matchLine(tokens, schema);
  if (!matched.ok) {
    return {
      invalid: {
        lineNumber,
        line,
        reason:
          matched.error.reason +
          (matched.error.suggestion ? `. ${matched.error.suggestion}` : ""),
      },
    };
  }
  return { tag, value: matched.value } as {
    tag: "RT" | "TS" | "O" | "T" | "M";
    value: unknown;
  };
}

function parseMicroUnitDslLines(
  text: string,
  mode: MapParseMode = "preview",
): {
  refinedTitle?: string;
  topicScope: "focused" | "overview";
  topicOverview: string;
  title: string;
  durationMin: number;
  difficulty: "easy" | "medium" | "hard";
  contentSummary: string;
  invalidLines: MicroUnitDslInvalidLine[];
  invalidLineCount: number;
  sawMLine: boolean;
} {
  let refinedTitle: string | undefined;
  let topicScope: "focused" | "overview" = "focused";
  let topicOverview = "";
  let title = "";
  let durationMin = 0;
  let difficulty: "easy" | "medium" | "hard" = "medium";
  let contentSummary = "";
  const invalidLines: MicroUnitDslInvalidLine[] = [];
  let invalidLineCount = 0;
  let sawMLine = false;

  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parsed = parseMicroUnitLine(trimmed, index + 1);
    if ("invalid" in parsed) {
      if (mode === "final") invalidLines.push(parsed.invalid);
      invalidLineCount += 1;
      return;
    }
    const value = parsed.value as Record<string, unknown>;
    if (parsed.tag === "RT") {
      refinedTitle = String(value.text ?? "").trim() || undefined;
    } else if (parsed.tag === "TS") {
      const scope = String(value.scope ?? "").toLowerCase();
      if (scope === "overview" || scope === "focused") {
        topicScope = scope;
      }
    } else if (parsed.tag === "O") {
      topicOverview = String(value.text ?? "").trim();
    } else if (parsed.tag === "T") {
      title = String(value.text ?? "").trim();
    } else if (parsed.tag === "M") {
      durationMin = Number(value.durationMin);
      difficulty = String(
        value.difficulty ?? "",
      ).toLowerCase() as typeof difficulty;
      contentSummary = String(value.contentSummary ?? "").trim();
      sawMLine = true;
    }
  });

  return {
    refinedTitle,
    topicScope,
    topicOverview,
    title,
    durationMin,
    difficulty,
    contentSummary,
    invalidLines,
    invalidLineCount,
    sawMLine,
  };
}

export class MicroUnitDslParseError extends Error {
  constructor(public readonly invalidLines: MicroUnitDslInvalidLine[]) {
    const detail = invalidLines
      .slice(0, 5)
      .map((item) => `line ${item.lineNumber}: ${item.reason}`)
      .join("; ");
    super(`Micro unit DSL contains invalid lines: ${detail}`);
    this.name = "MicroUnitDslParseError";
  }
}

export function getMicroUnitDslInvalidLines(
  text: string,
): MicroUnitDslInvalidLine[] {
  return parseMicroUnitDslLines(sanitizeMapDslText(text), "final").invalidLines;
}

export function applyMicroUnitDslLineReplacements(
  text: string,
  replacements: { lineNumber: number; line: string }[],
): string {
  const lines = sanitizeMapDslText(text).split(/\r?\n/);
  for (const replacement of replacements) {
    const index = replacement.lineNumber - 1;
    if (index < 0 || index >= lines.length) continue;
    lines[index] = replacement.line.trim();
  }
  return lines.join("\n");
}

export function parseMicroUnitDsl(text: string): MicroUnitResult {
  const parsed = parseMicroUnitDslLines(sanitizeMapDslText(text), "final");
  if (parsed.invalidLines.length > 0) {
    throw new MicroUnitDslParseError(parsed.invalidLines);
  }
  return microUnitResultSchema.parse({
    refinedTitle: parsed.refinedTitle,
    topicScope: parsed.topicScope,
    topicOverview: parsed.topicOverview,
    title: parsed.title,
    difficulty: parsed.difficulty,
    contentSummary: parsed.contentSummary,
  });
}

export type MicroUnitDslPreview = {
  microUnit: Partial<MicroUnitResult>;
  pendingFields: string[];
};

export function parseMicroUnitDslPreview(
  text: string,
): MicroUnitDslPreview | null {
  const parsed = parseMicroUnitDslLines(sanitizeMapDslText(text), "preview");
  const partial: Partial<MicroUnitResult> = {};
  if (parsed.refinedTitle) partial.refinedTitle = parsed.refinedTitle;
  if (parsed.topicScope) partial.topicScope = parsed.topicScope;
  if (parsed.topicOverview) partial.topicOverview = parsed.topicOverview;
  if (parsed.title) partial.title = parsed.title;
  if (parsed.difficulty) partial.difficulty = parsed.difficulty;
  if (parsed.contentSummary) partial.contentSummary = parsed.contentSummary;
  const pendingFields = computeMicroUnitPendingFields(parsed);
  if (Object.keys(partial).length === 0 && pendingFields.length === 0) {
    return null;
  }
  return { microUnit: partial, pendingFields };
}

function computeMicroUnitPendingFields(parsed: {
  refinedTitle?: string;
  topicScope: "focused" | "overview";
  topicOverview: string;
  title: string;
  durationMin: number;
  difficulty: string;
  contentSummary: string;
  sawMLine: boolean;
}): string[] {
  const pending: string[] = [];
  if (!parsed.refinedTitle) pending.push("refinedTitle");
  if (!parsed.topicOverview) pending.push("topicOverview");
  if (!parsed.title) pending.push("title");
  // durationMin and difficulty come from the M line; use sawMLine to know
  // whether they were actually populated or just defaulted.
  if (!parsed.sawMLine) {
    pending.push("durationMin");
    pending.push("difficulty");
  }
  if (!parsed.contentSummary) pending.push("contentSummary");
  return pending;
}

export class MicroUnitDslStreamAccumulator {
  private completeText = "";
  private pending = "";
  private lastKey = "";

  append(delta: string): MicroUnitDslPreview | null {
    this.pending += delta;
    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop() ?? "";
    if (lines.length === 0) return null;
    this.completeText += lines.join("\n") + "\n";
    const preview = parseMicroUnitDslPreview(this.completeText);
    const key = JSON.stringify(preview);
    if (!preview || key === this.lastKey) return null;
    this.lastKey = key;
    return preview;
  }

  /**
   * Reset the buffer with a complete text (e.g. final repaired DSL after
   * `repairAndParseDsl`) and re-emit the resulting preview. Used so the
   * frontend can swap loading placeholders for real data once the LLM has
   * fixed errored lines.
   */
  appendFromText(text: string): MicroUnitDslPreview | null {
    // Re-feed the full text through `append` rather than setting the buffer
    // directly, so the line-splitting logic stays in one place. Append a
    // trailing newline so the final line gets flushed into completeText
    // instead of being parked in `pending`.
    this.completeText = "";
    this.pending = "";
    this.lastKey = "";
    return this.append(text.endsWith("\n") ? text : `${text}\n`);
  }
}
