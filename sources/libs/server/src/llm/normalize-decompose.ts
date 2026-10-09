export type NormalizeDecomposeOptions = {
  topLevelCap?: number;
};

const DOMAIN_TAGS = ["stem", "humanities", "general"] as const;
type DomainTag = (typeof DOMAIN_TAGS)[number];

const DIFFICULTIES = ["easy", "medium", "hard"] as const;

type NormalizedUnit = {
  title: string;
  difficulty: (typeof DIFFICULTIES)[number];
  prerequisiteTitles: string[];
  contentSummary: string;
  planAreaRef?: string;
  planningOutcomeRefs: string[];
  scope: "session";
  parentTitle: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickDomainTag(
  ...sources: Array<Record<string, unknown> | null>
): DomainTag {
  for (const src of sources) {
    if (!src) continue;
    const raw = src.domainTag ?? src.domain ?? src.domain_tag;
    if (typeof raw !== "string") continue;
    const lower = raw.toLowerCase();
    if (DOMAIN_TAGS.includes(lower as DomainTag)) return lower as DomainTag;
  }
  return "general";
}

/** Unwrap common LLM wrappers (e.g. { curriculum: { units, domain } }). */
function unwrapDecomposeRoot(data: unknown): Record<string, unknown> {
  const root = asRecord(data) ?? {};

  if (Array.isArray(root.units)) return root;

  for (const key of [
    "curriculum",
    "learningPath",
    "learning_path",
    "path",
    "plan",
    "result",
    "data",
  ]) {
    const nested = asRecord(root[key]);
    if (nested && Array.isArray(nested.units)) {
      return {
        ...nested,
        domainTag:
          nested.domainTag ?? nested.domain ?? root.domainTag ?? root.domain,
      };
    }
  }

  return root;
}

function normalizeDifficulty(value: unknown): (typeof DIFFICULTIES)[number] {
  if (typeof value !== "string") return "medium";
  const lower = value.toLowerCase();
  if (DIFFICULTIES.includes(lower as (typeof DIFFICULTIES)[number])) {
    return lower as (typeof DIFFICULTIES)[number];
  }
  return "medium";
}

function normalizeUnit(raw: unknown, index: number): NormalizedUnit {
  const u = asRecord(raw) ?? {};
  const title = String(u.title ?? u.name ?? `Unit ${index + 1}`);
  const prerequisiteTitles = Array.isArray(u.prerequisiteTitles)
    ? u.prerequisiteTitles.map(String)
    : Array.isArray(u.prerequisites)
      ? u.prerequisites.map((p) =>
          typeof p === "string"
            ? p
            : String((p as { title?: string }).title ?? p),
        )
      : [];

  const contentSummaryRaw =
    u.contentSummary ?? u.summary ?? u.description ?? "";
  const contentSummary = String(contentSummaryRaw).trim() || title;

  return {
    title,
    difficulty: normalizeDifficulty(u.difficulty),
    prerequisiteTitles,
    contentSummary,
    ...(typeof u.planAreaRef === "string" && /^a_[1-9]\d*$/.test(u.planAreaRef)
      ? { planAreaRef: u.planAreaRef }
      : {}),
    planningOutcomeRefs: Array.isArray(u.planningOutcomeRefs)
      ? [
          ...new Set(
            u.planningOutcomeRefs
              .map(String)
              .filter((ref) => /^o_[1-9]\d*$/.test(ref)),
          ),
        ]
      : [],
    scope: "session",
    parentTitle:
      typeof u.parentTitle === "string" && u.parentTitle.trim()
        ? u.parentTitle.trim()
        : null,
  };
}

/**
 * Map provider-specific decompose JSON into learnable session units, preserving
 * a single parent-child relationship when supplied.
 */
export function normalizeDecomposePayload(
  data: unknown,
  options?: NormalizeDecomposeOptions,
): unknown {
  void options;
  const root = unwrapDecomposeRoot(data);
  const domainTag = pickDomainTag(root);
  const rawUnits = Array.isArray(root.units) ? root.units : [];
  const normalizedUnits = rawUnits.map((u, i) => normalizeUnit(u, i));

  const topLevel = normalizedUnits.filter((unit) => !unit.parentTitle);
  const topLevelTitles = new Set(topLevel.map((unit) => unit.title));
  return {
    domainTag,
    units: [
      ...topLevel,
      ...normalizedUnits.filter(
        (unit) => unit.parentTitle && topLevelTitles.has(unit.parentTitle),
      ),
    ],
  };
}
