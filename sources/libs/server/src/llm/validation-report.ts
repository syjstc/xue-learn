import { z, ZodError } from "zod";

export type ValidationIssue = {
  code: string;
  path: string;
  message: string;
  expected?: string;
  received?: string;
  fix?: string;
};

export type ValidationReport = {
  summary: string;
  issues: ValidationIssue[];
};

export type ValidationHint = {
  path: string;
  fix: string;
  expected?: string;
};

const MAX_ISSUES = 20;
const MAX_RECEIVED_CHARS = 180;
const MAX_REPORT_CHARS = 1_500;

export function normalizeIssuePath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "response";
  return path
    .map((segment) =>
      typeof segment === "number" || /^\d+$/.test(String(segment))
        ? "*"
        : String(segment),
    )
    .join(".");
}

export function issuePathString(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "response";
  return path.map(String).join(".");
}

function valueAtPath(root: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return current;
}

function truncateReceived(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length <= MAX_RECEIVED_CHARS
    ? compact
    : `${compact.slice(0, MAX_RECEIVED_CHARS)}…`;
}

function matchHint(
  path: string,
  hints: readonly ValidationHint[],
): ValidationHint | undefined {
  return hints.find((hint) => {
    if (hint.path === path) return true;
    if (hint.path.endsWith(".**")) {
      const prefix = hint.path.slice(0, -3);
      return path === prefix || path.startsWith(`${prefix}.`);
    }
    return false;
  });
}

export function zodIssueCode(issue: z.core.$ZodIssue): string {
  return typeof issue.code === "string" ? issue.code : "custom";
}

export function buildValidationReport(
  error: ZodError | readonly ValidationIssue[],
  candidate?: unknown,
  hints: readonly ValidationHint[] = [],
): ValidationReport {
  const issues: ValidationIssue[] = Array.isArray(error)
    ? [...error]
    : error.issues.slice(0, MAX_ISSUES).map((issue) => {
        const path = normalizeIssuePath(issue.path);
        const hint = matchHint(path, hints);
        const received =
          candidate !== undefined
            ? truncateReceived(valueAtPath(candidate, issue.path))
            : undefined;
        return {
          code: zodIssueCode(issue),
          path,
          message: issue.message,
          expected: hint?.expected,
          received,
          fix: hint?.fix,
        };
      });
  const summary =
    issues.length === 0
      ? "Validation failed."
      : issues
          .slice(0, 3)
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join("; ");
  return { summary, issues: issues.slice(0, MAX_ISSUES) };
}

export function formatValidationReportForModel(report: ValidationReport): string {
  const lines = report.issues.map((issue, index) => {
    const parts = [`${index + 1}. ${issue.path} (${issue.code}): ${issue.message}`];
    if (issue.expected) parts.push(`expected ${issue.expected}`);
    if (issue.received) parts.push(`received ${issue.received}`);
    if (issue.fix) parts.push(`fix: ${issue.fix}`);
    return parts.join(" — ");
  });
  let text = lines.join("\n");
  if (text.length > MAX_REPORT_CHARS) {
    text = `${text.slice(0, MAX_REPORT_CHARS - 1)}…`;
  }
  return text || report.summary;
}

export function serializeStructuredIssuesJson(
  issues: readonly ValidationIssue[],
): string | undefined {
  if (issues.length === 0) return undefined;
  return JSON.stringify(
    issues.slice(0, MAX_ISSUES).map((issue) => ({
      code: issue.code,
      path: issue.path,
      message: issue.message.slice(0, 600),
      ...(issue.expected ? { expected: issue.expected.slice(0, 240) } : {}),
      ...(issue.received ? { received: issue.received } : {}),
    })),
  );
}

export function parseStructuredIssuesJson(
  raw: unknown,
): ValidationIssue[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      if (typeof record.code !== "string" || typeof record.path !== "string") {
        return [];
      }
      return [
        {
          code: record.code,
          path: record.path,
          message: typeof record.message === "string" ? record.message : "",
          expected:
            typeof record.expected === "string" ? record.expected : undefined,
          received:
            typeof record.received === "string" ? record.received : undefined,
        },
      ];
    });
  } catch {
    return [];
  }
}

export const TOPIC_MATERIAL_HINTS: readonly ValidationHint[] = [
  {
    path: "display",
    expected:
      "code | conversation | callout | accordion | illustration | compare | stage | svg_slot",
    fix: "Use one visible teaching board type. Do not emit heading, paragraph, quiz, or lab types as the display.",
  },
  {
    path: "display.type",
    expected:
      "code | conversation | callout | accordion | illustration | compare | stage | svg_slot",
    fix: "Set display.type to a visible board. Image aliases become illustration; tip/warning become callout.",
  },
  {
    path: "display.left",
    expected: "{id,label,points:string[]}",
    fix: "Compare left must be an object with label and a non-empty points array, not a string.",
  },
  {
    path: "display.right",
    expected: "{id,label,points:string[]}",
    fix: "Compare right must be an object with label and a non-empty points array, not a string.",
  },
  {
    path: "display.figures",
    expected: "2-4 figure objects with unique ids",
    fix: "A stage needs 2 to 4 figures. One figure should be an atomic display instead.",
  },
  {
    path: "cues",
    expected: "array of spoken beats with text and targetIds",
    fix: "Give at least one cue. Each cue needs spoken text and targetIds from the board ids.",
  },
  {
    path: "cues.*.targetIds",
    expected: "ids from the display, sides, figures, or code parts",
    fix: "List one or more existing board object ids. Do not put layout slots such as left/right in targetIds unless those are side ids.",
  },
  {
    path: "cues.*.figureId",
    expected: "display id or a stage figure id",
    fix: "figureId must match the display id or a stage figure id.",
  },
  {
    path: "cues.*.text",
    expected: "short spoken classroom Chinese/English",
    fix: "Keep each cue to a few short spoken sentences. Split long lines into extra cues with the same targetIds. Inline $...$ matching the board is allowed; studio oralize owns classroom TTS.",
  },
  {
    path: "topicId",
    expected: "the requested topic id",
    fix: "Call commit_topic_material only for the requested topicId.",
  },
  {
    path: "display.intent",
    expected: "composition, elements, relationships, labels",
    fix: "svg_slot.intent must include composition plus elements, relationships, and labels.",
  },
];

export const SECTION_TOPICS_HINTS: readonly ValidationHint[] = [
  {
    path: "topics",
    expected: "1-8 unique {id,title} items",
    fix: "Commit unique topic ids and titles only. Do not emit displays yet.",
  },
  {
    path: "topics.*.id",
    expected: "unique short id",
    fix: "Each topic id must be unique.",
  },
  {
    path: "introduction",
    expected: "{text} or omit",
    fix: "Introduction is optional. Use {text} rather than a bare string if present.",
  },
];

export const KACOM_PREFIX_HINTS: readonly ValidationHint[] = [
  {
    path: "learningTargets.*.requirements.*.dimension",
    expected:
      "memory | understanding | application | transfer | fluency | stability | independence",
    fix: "Map Bloom verbs (remember/understand/apply) onto cognitive dimensions. Core/supporting targets need memory or understanding.",
  },
  {
    path: "learningTargets.*.requirements.*.entityRef",
    expected: "e_N or allowlisted x_N",
    fix: "Every requirement entityRef must be a generated e_N stub or an allowlisted external x_N.",
  },
  {
    path: "learningTargets.*.assessmentCriteria.*.ref",
    expected: "lt_N:cK sequential",
    fix: "Number criteria as lt_1:c1, lt_1:c2, … for that target.",
  },
  {
    path: "learningTargets.*.planningOutcomeRefs",
    expected: "assigned o_N from the frozen catalog",
    fix: "Use only assigned planning outcome refs. Do not invent o_N values.",
  },
  {
    path: "learningTargets.*.importance",
    expected: "core | supporting | enrichment",
    fix: "Map primary→core and review→enrichment.",
  },
];

export const KACOM_SUFFIX_HINTS: readonly ValidationHint[] = [
  {
    path: "atomDetails.*.ref",
    expected: "frozen prefix e_N of kind atom",
    fix: "Do not invent entity identities. Detail refs must match the frozen prefix.",
  },
  {
    path: "constructDetails.*.ref",
    expected: "frozen prefix e_N of kind concept|skill|competency",
    fix: "Construct details must keep the frozen kind and ref.",
  },
  {
    path: "relations.**",
    expected: "fromRef/toRef in the frozen or external catalog",
    fix: "Drop invalid optional relations rather than inventing refs.",
  },
];
