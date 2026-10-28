import { invalidateAgendaForUser } from "../agenda/index.js";
import type { DecomposeResult } from "../llm/schemas.js";
import { reconcileUnitCurriculumKeys } from "./unit-curriculum-key.js";
import { parsePlanningOutcomeRefs } from "./plan-coverage.js";
import type {
  CognitiveModelInvalidationRepository,
  LegacyMapReplacementRepository,
} from "../../../domain/src/index.js";

function samePlanningBinding(
  existing: { planAreaRef: string; planningOutcomeRefs: unknown } | undefined,
  next: { planAreaRef?: string; planningOutcomeRefs?: string[] },
): boolean {
  if (!existing) return false;
  return (
    existing.planAreaRef === (next.planAreaRef ?? "") &&
    JSON.stringify(
      parsePlanningOutcomeRefs(existing.planningOutcomeRefs).sort(),
    ) === JSON.stringify([...(next.planningOutcomeRefs ?? [])].sort())
  );
}

export async function persistDecomposeResult(params: {
  userId: string;
  goalId: string;
  title: string;
  level: string;
  pathSource: "rag" | "search" | "generic";
  contentLanguage: string;
  goalKind?: "full" | "micro";
  mapPlanStatus?: "pending";
  mapSummaryStatus?: "approved" | "skipped";
  detailedPlanStatus?: "ready";
  result: DecomposeResult;
  cognitiveModelInvalidation: CognitiveModelInvalidationRepository;
  legacyMapReplacement: LegacyMapReplacementRepository;
}) {
  const { goalId, title, level, pathSource, contentLanguage, result } = params;
  const topLevelUnits = result.units.filter(
    (unit) => !unit.parentTitle?.trim(),
  );
  if (topLevelUnits.length === 0) {
    throw new Error("学习地图未包含任何顶层单元");
  }

  const existingUnits =
    await params.legacyMapReplacement.listOwnedReconciliationUnits(
      params.userId,
      goalId,
    );
  if (!existingUnits) throw new Error("Goal not found");
  const reconciled = reconcileUnitCurriculumKeys(
    existingUnits.map((unit) => ({
      id: unit.id,
      parentUnitId: unit.parentUnitId,
      title: unit.title,
      contentSummary: unit.contentSummary,
      curriculumKey: unit.curriculumKey,
    })),
    result.units.map((unit) => ({
      title: unit.title,
      parentTitle: unit.parentTitle,
      contentSummary: unit.contentSummary?.trim() || unit.title,
    })),
  );
  const existingById = new Map(existingUnits.map((unit) => [unit.id, unit]));
  const parentTitles = new Set(
    result.units
      .map((unit) => unit.parentTitle?.trim())
      .filter((value): value is string => Boolean(value)),
  );
  const topLevelOrder = new Map(
    topLevelUnits.map((unit, orderIndex) => [unit, orderIndex]),
  );
  const childOrder = new Map<string, number>();
  const replacementUnits = result.units.map((unit, index) => {
    const identity = reconciled[index]!;
    const parentRef = unit.parentTitle?.trim() || null;
    const sourceMappings = identity.sourceUnitId
      ? (existingById.get(identity.sourceUnitId)?.learningTargets ?? [])
      : [];
    const reuseLearningTargets =
      identity.reuseLearningTargets &&
      samePlanningBinding(
        identity.sourceUnitId
          ? existingById.get(identity.sourceUnitId)
          : undefined,
        unit,
      );
    const orderIndex = parentRef
      ? (() => {
          const next = childOrder.get(parentRef) ?? 0;
          childOrder.set(parentRef, next + 1);
          return next;
        })()
      : (topLevelOrder.get(unit) ?? index);
    return {
      ref: unit.title,
      parentRef,
      prerequisiteRefs: unit.prerequisiteTitles,
      unitKind: parentTitles.has(unit.title)
        ? ("module" as const)
        : ("lesson" as const),
      title: unit.title,
      orderIndex,
      difficulty: unit.difficulty,
      contentSummary: unit.contentSummary?.trim() || unit.title,
      planAreaRef: unit.planAreaRef ?? "",
      planningOutcomeRefs: unit.planningOutcomeRefs ?? [],
      curriculumKey: identity.curriculumKey ?? null,
      cognitiveModelStatus:
        reuseLearningTargets && sourceMappings.length > 0
          ? ("expanded" as const)
          : ("pending" as const),
      learningTargets:
        reuseLearningTargets && sourceMappings.length > 0 ? sourceMappings : [],
    };
  });

  const replaced = await params.legacyMapReplacement.replaceOwned({
    userId: params.userId,
    goalId,
    title,
    level,
    domainTag: result.domainTag,
    pathSource,
    contentLanguage,
    goalKind: params.goalKind,
    mapPlanStatus: params.mapPlanStatus,
    mapSummaryStatus: params.mapSummaryStatus,
    detailedPlanStatus: params.detailedPlanStatus,
    units: replacementUnits,
  });
  if (replaced.status !== "replaced") {
    throw new Error(
      replaced.status === "not_found"
        ? "Goal not found"
        : `Invalid legacy map replacement: ${replaced.reason}`,
    );
  }
  if (replaced.goal.userId) await invalidateAgendaForUser(replaced.goal.userId);
  await params.cognitiveModelInvalidation.invalidate({
    goalId: replaced.goal.id,
    reason: "course_map_regenerated",
    force: true,
  });
  return { goal: replaced.goal, units: replaced.units };
}
