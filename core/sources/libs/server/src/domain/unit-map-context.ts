import { parseMapPlan } from "../goals/map-plan.js";
import type { ContentSource } from "../rag/content-sources.js";
import { retrieveContextForUnitWithSources } from "../rag/retrieve.js";
import { requireUnitMapContextPersistence } from "./unit-map-context-persistence.js";

type MapUnitRow = {
  id: string;
  title: string;
  contentSummary: string;
};

type AncestorUnitRow = MapUnitRow & {
  parentUnitId: string | null;
};

function trimSummary(summary: string, max = 280): string {
  const s = summary.trim();
  if (!s) return "";
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/**
 * Text block describing where this unit sits on the nested goal map,
 * so SQ and material generation stay scoped and do not overlap siblings.
 */
export async function buildUnitMapScopePrompt(unitId: string): Promise<string> {
  const context = await requireUnitMapContextPersistence().find(unitId);
  if (!context) return "";
  const { unit, goal } = context;
  const parent = unit.parentUnitId
    ? context.units.find((candidate) => candidate.id === unit.parentUnitId)
    : null;
  const siblings: MapUnitRow[] = context.units.filter(
    (candidate) => candidate.parentUnitId === unit.parentUnitId,
  );

  const mapLabel = unit.parentUnitId
    ? `Sub-map (lessons inside module "${parent?.title ?? "parent"}")`
    : "Goal cognitive map (top-level units)";

  const unitLines = siblings.map((s, i) => {
    const isCurrent = s.id === unitId;
    const summary = trimSummary(s.contentSummary);
    const tag = isCurrent ? " ← THIS UNIT (generate only for this one)" : "";
    return `${i + 1}. "${s.title}"${tag}${summary ? `\n   Scope: ${summary}` : ""}`;
  });

  const siblingTitles = siblings
    .filter((s) => s.id !== unitId)
    .map((s) => `"${s.title}"`);

  const parentBlock = parent
    ? `Parent module: "${parent.title}"${
        parent.contentSummary
          ? `\nModule overview: ${trimSummary(parent.contentSummary, 200)}`
          : ""
      }\n`
    : "";

  return `${mapLabel} for learning goal "${goal.title}":
${parentBlock}${unitLines.join("\n")}

Scope rules (critical):
- Output is for THIS unit only: "${unit.title}".
- Intended session scope: ${unit.contentSummary.trim() || "(narrow focus implied by title)"}.
- Do NOT teach or survey topics reserved for other units on this map${
    siblingTitles.length > 0 ? `: ${siblingTitles.join(", ")}` : "."
  }
- Keep the survey outline, guiding questions, and teaching material local to this capability; do not expand into a whole chapter or sibling unit.`;
}

/** Map placement + optional reference from indexed uploads / persisted web search. */
export async function buildUnitSessionContextWithSources(
  goalId: string,
  unitId: string,
  unitTitle: string,
  summary: string,
): Promise<{ context: string; sources: ContentSource[] }> {
  const mapScope = await buildUnitMapScopePrompt(unitId);
  const retrieved = await retrieveContextForUnitWithSources(
    goalId,
    unitTitle,
    summary.trim() ? `Unit summary: ${summary}` : undefined,
  );
  const reference =
    retrieved.context || (summary.trim() ? `Unit summary: ${summary}` : "");

  return {
    context: [mapScope, reference].filter(Boolean).join("\n\n---\n\n"),
    sources: retrieved.sources,
  };
}

export async function buildUnitSessionContext(
  goalId: string,
  unitId: string,
  unitTitle: string,
  summary: string,
): Promise<string> {
  const { context } = await buildUnitSessionContextWithSources(
    goalId,
    unitId,
    unitTitle,
    summary,
  );
  return context;
}

/**
 * Map placement block for unit subdivision — keeps child lessons scoped to the
 * parent unit and away from sibling topics on the goal map.
 */
export async function buildSubdivisionScopePrompt(
  unitId: string,
  options: { purpose?: "subdivide" | "map_expansion" } = {},
): Promise<string> {
  const purpose = options.purpose ?? "subdivide";
  const context = await requireUnitMapContextPersistence().find(unitId);
  if (!context) return "";
  const { unit, goal } = context;
  const byId = new Map(
    context.units.map((candidate) => [candidate.id, candidate]),
  );
  const parent = unit.parentUnitId ? byId.get(unit.parentUnitId) : null;

  const mapPlan = parseMapPlan(goal.mapPlanJson ?? "{}");
  const matchedArea = mapPlan?.majorAreas.find(
    (area) =>
      area.title === unit.title ||
      unit.title.includes(area.title) ||
      area.title.includes(unit.title),
  );
  const planHintBlock = mapPlan
    ? `\nApproved plan layering (${mapPlan.mapStructure.recommendedDepth} layers, ~${mapPlan.mapStructure.estimatedLeafUnits} leaf sessions):
Strategy: ${mapPlan.mapStructure.layeringStrategy}${
        matchedArea?.mapRole === "branch"
          ? `\nThis unit matches pillar "${matchedArea.title}" — branch module${
              matchedArea.estimatedChildCount
                ? `, roughly ~${matchedArea.estimatedChildCount} children (hint only — use judgment)`
                : ""
            }${
              matchedArea.groupingAxis
                ? `, group by: ${matchedArea.groupingAxis}`
                : ""
            }.`
          : ""
      }`
    : "";

  const ancestors: AncestorUnitRow[] = [];
  let parentId = unit.parentUnitId;
  while (parentId) {
    const ancestor = byId.get(parentId);
    if (!ancestor) break;
    ancestors.unshift(ancestor);
    parentId = ancestor.parentUnitId;
  }

  const siblings: MapUnitRow[] = context.units.filter(
    (candidate) =>
      candidate.parentUnitId === unit.parentUnitId && candidate.id !== unitId,
  );

  const parentBlock = parent
    ? `Parent module: "${parent.title}"${
        parent.contentSummary
          ? `\nModule overview: ${trimSummary(parent.contentSummary, 200)}`
          : ""
      }\nChild lessons must stay within this unit, the parent module, and the full ancestor path.\n`
    : "";

  const ancestorBlock =
    ancestors.length > 0
      ? `\nFull ancestor path from goal to this unit (do not forget upper layers):\n${[
          `"${goal.title}"`,
          ...ancestors.map((a) => {
            const summary = trimSummary(a.contentSummary, 240);
            return `"${a.title}"${summary ? ` (${summary})` : ""}`;
          }),
          `"${unit.title}"`,
        ].join(" → ")}\n`
      : "";

  const siblingBlock =
    siblings.length > 0
      ? `\nSibling units at this map level (do NOT move their topics into child lessons):\n${siblings
          .map((s) => {
            const summary = trimSummary(s.contentSummary);
            return `- "${s.title}"${summary ? `: ${summary}` : ""}`;
          })
          .join("\n")}`
      : "";

  const parentScope =
    unit.contentSummary.trim() || "(narrow focus implied by the unit title)";

  if (purpose === "map_expansion") {
    return `Map placement for learning goal "${goal.title}":
${parentBlock}${ancestorBlock}You are expanding the module "${unit.title}" into child units.
Intended parent scope: ${parentScope}.${siblingBlock}${planHintBlock}

Expansion scope rules (critical):
- Decide per topic whether it warrants further splitting — small or narrow subtopics should be scope "session" (leaf), not another module.
- Only use scope "module" when a subtopic is large enough to need its own branch (multiple lessons or a catalog).
- When you do split a module, use as few children as the content needs — from 2 upward; never pad with filler units.
- If the entire parent scope fits one focused lesson, return a single scope "session" child.
- Every child must stay within "${unit.title}"; do not drift to sibling topics.
- Do not create shallow module wrappers around a single item — one item = one session leaf.
- Order siblings in a sensible learning sequence.`;
  }

  return `Map placement for learning goal "${goal.title}":
${parentBlock}${ancestorBlock}You are splitting ONLY the unit "${unit.title}".
Intended parent scope: ${parentScope}.${siblingBlock}${planHintBlock}

Subdivision scope rules (critical):
- Every child lesson must be a strict subtopic of "${unit.title}" — a narrower slice of the parent scope above
- Together, children should partition the parent: full coverage without gaps, without adding topics outside it
- Do not introduce tangential fields, adjacent subjects, or material reserved for sibling units
- Do not create circular "overview / basics / recap / applications" splits that re-survey the same parent from different angles
- Make the children parallel sibling slices at the same granularity, like spreading one unit into smaller adjacent units
- Each child contentSummary must be 2-3 sentences listing the core things to generate — which part of "${unit.title}" that lesson covers, plus key concepts, skills, or practice; stay inside the ancestor path`;
}
