import type { GoalMapPlan } from "../llm/schemas.js";
import {
  goalPlanAreas,
  goalPlanOutcomes,
} from "../goals/plan-coverage.js";
import type { CognitiveModelSnapshot } from "./types.js";

export class PlanningCoverageError extends Error {
  constructor(
    message: string,
    readonly affectedUnitIds: string[],
  ) {
    super(message);
    this.name = "PlanningCoverageError";
  }
}

export function validateSnapshotPlanningCoverage(
  snapshot: CognitiveModelSnapshot,
  plan: GoalMapPlan | null,
): { mode: "bound" | "legacy_unbound"; coveredOutcomeRefs: string[] } {
  const lessonUnits = snapshot.units.filter(
    (unit) => unit.unitKind === "lesson",
  );
  const bound = lessonUnits.some(
    (unit) =>
      Boolean(unit.planAreaRef?.trim()) ||
      (unit.planningOutcomeRefs?.length ?? 0) > 0,
  );
  if (!plan || !bound) {
    return { mode: "legacy_unbound", coveredOutcomeRefs: [] };
  }

  const expected = new Set(
    goalPlanOutcomes(plan).map((outcome) => outcome.ref),
  );
  // Older approved plans can have curriculum areas without the newer explicit
  // outcome catalog. Their positional unit refs are non-authoritative legacy
  // metadata, so do not turn an otherwise valid cognitive model into a retry
  // loop.
  if (expected.size === 0) {
    return { mode: "legacy_unbound", coveredOutcomeRefs: [] };
  }
  const expectedAreas = new Set(goalPlanAreas(plan).map((area) => area.ref));
  const covered = new Set<string>();
  const affected = new Set<string>();
  const unitsById = new Map(snapshot.units.map((unit) => [unit.unitId, unit]));
  const rootAreaOwners = new Map<string, string[]>();
  for (const unit of snapshot.units) {
    if (unit.unitKind === "module" && !unit.parentUnitId && unit.planAreaRef) {
      rootAreaOwners.set(unit.planAreaRef, [
        ...(rootAreaOwners.get(unit.planAreaRef) ?? []),
        unit.unitId,
      ]);
    }
    if (!unit.planAreaRef || !expectedAreas.has(unit.planAreaRef)) {
      affected.add(unit.unitId);
    }
    if (unit.parentUnitId) {
      const parent = unitsById.get(unit.parentUnitId);
      if (!parent || parent.planAreaRef !== unit.planAreaRef) {
        affected.add(unit.unitId);
      }
    }
  }
  // Duplicate module roots are a real map bug. Flat curriculum-v2 lessons
  // legitimately share one plan area without a synthetic module unit in the
  // objective snapshot. Zero module roots also means that a later sequential
  // area may not be materialized yet — never blame valid lessons in either case.
  for (const areaRef of expectedAreas) {
    const owners = rootAreaOwners.get(areaRef) ?? [];
    if (owners.length > 1) {
      owners.forEach((unitId) => affected.add(unitId));
    }
  }
  for (const module of snapshot.units.filter(
    (unit) => unit.unitKind === "module",
  )) {
    const childUnion = [
      ...new Set(
        snapshot.units
          .filter((unit) => unit.parentUnitId === module.unitId)
          .flatMap((unit) => unit.planningOutcomeRefs ?? []),
      ),
    ].sort();
    const moduleRefs = [...(module.planningOutcomeRefs ?? [])].sort();
    if (JSON.stringify(childUnion) !== JSON.stringify(moduleRefs)) {
      affected.add(module.unitId);
    }
  }
  const targetsByUnit = new Map<string, typeof snapshot.learningTargets>();
  for (const target of snapshot.learningTargets) {
    for (const mapping of target.mappings) {
      targetsByUnit.set(mapping.unitId, [
        ...(targetsByUnit.get(mapping.unitId) ?? []),
        target,
      ]);
    }
  }

  for (const unit of lessonUnits) {
    const assigned = new Set(unit.planningOutcomeRefs ?? []);
    if (!unit.planAreaRef || assigned.size === 0) {
      affected.add(unit.unitId);
      continue;
    }
    const targetCoverage = new Set(
      (targetsByUnit.get(unit.unitId) ?? []).flatMap(
        (target) => target.planningOutcomeRefs ?? [],
      ),
    );
    for (const ref of assigned) {
      if (!expected.has(ref) || !targetCoverage.has(ref)) {
        affected.add(unit.unitId);
      } else {
        covered.add(ref);
      }
    }
  }

  // Only require coverage for outcomes that are actually assigned to lessons.
  // Plan outcomes owned by not-yet-generated sequential modules stay deferred.
  const assignedRefs = new Set(
    lessonUnits.flatMap((unit) => unit.planningOutcomeRefs ?? []),
  );
  const missingAssigned = [...assignedRefs].filter(
    (ref) => expected.has(ref) && !covered.has(ref),
  );
  if (missingAssigned.length || affected.size) {
    throw new PlanningCoverageError(
      `Incomplete goal-plan coverage; missing outcomes: ${
        missingAssigned.join(", ") || "none"
      }`,
      [...affected],
    );
  }
  return { mode: "bound", coveredOutcomeRefs: [...covered].sort() };
}
