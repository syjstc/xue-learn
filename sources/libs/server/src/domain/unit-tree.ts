import type { UnitScope } from "../llm/schemas.js";

export type UnitKind = "lesson" | "module";

export function isTopLevelUnit(unit: { parentUnitId: string | null }): boolean {
  return unit.parentUnitId == null;
}

export function isLearnableUnitKind(unitKind: string): boolean {
  return unitKind === "lesson" || unitKind === "branch";
}

export function isOverviewUnitKind(unitKind?: string | null): boolean {
  return unitKind === "overview";
}

export function isModuleUnit(unit: { unitKind: string }): boolean {
  return unit.unitKind === "module";
}

/** Heuristic: unit scope is broad enough to benefit from structural subdivision. */
export function unitNeedsSubdivision(unit: {
  scope?: UnitScope;
  contentSummary: string;
  title: string;
}): boolean {
  if (unit.scope === "module") return true;
  if (unit.contentSummary.length > 240) return true;
  const broadHints =
    /\b(introduction to|overview of|fundamentals of|全套|入门到|全面|整个|基础到进阶)\b/i;
  if (broadHints.test(unit.title) && unit.contentSummary.length > 120)
    return true;
  return false;
}

export function canSubdivideAtDepth(depth: number): boolean {
  return Number.isFinite(depth) && depth >= 0;
}

/** Depth from root (0 = top-level on goal map). */
export async function getUnitDepth(
  unitId: string,
  loadParent: (id: string) => Promise<{ parentUnitId: string | null } | null>,
): Promise<number> {
  let depth = 0;
  let current = await loadParent(unitId);
  while (current?.parentUnitId) {
    depth++;
    current = await loadParent(current.parentUnitId);
  }
  return depth;
}
