import type { QueryClient } from "@tanstack/react-query";
import { sortGoalListItemsByLastStudied } from "@/shared/domain/last-learned-unit";
import { aggregateLearningProgress } from "@/shared/domain/learning-progress";
import type { UnitContentGenStatus } from "@/shared/domain/unit-content-status";
import { queryKeys } from "./query-keys.ts";
import type { GoalDetail, GoalListItem, GoalUnit, LastLearnedUnit } from "./types.ts";

export type GoalUnitCachePatch = {
  status?: string;
  sessionState?: Partial<NonNullable<GoalUnit["sessionState"]>>;
  learningMaterial?: GoalUnit["learningMaterial"] | null;
  contentGen?: UnitContentGenStatus;
};

function mergeUnit(
  unit: GoalUnit,
  patch: GoalUnitCachePatch,
): GoalUnit {
  const next: GoalUnit = { ...unit };
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.sessionState) {
    next.sessionState = {
      sq3rData: unit.sessionState?.sq3rData ?? "",
      ...unit.sessionState,
      ...patch.sessionState,
    };
  }
  if (patch.learningMaterial !== undefined) {
    next.learningMaterial = patch.learningMaterial ?? undefined;
  }
  if (patch.contentGen) {
    next.contentGen = patch.contentGen;
  }
  return next;
}

function patchUnits(
  units: GoalUnit[],
  unitPatches: Record<string, GoalUnitCachePatch>,
): GoalUnit[] {
  if (Object.keys(unitPatches).length === 0) return units;
  return units.map((unit) => {
    const patch = unitPatches[unit.id];
    return patch ? mergeUnit(unit, patch) : unit;
  });
}

function syncListItemFromDetail(
  listItem: GoalListItem,
  goal: GoalDetail,
): GoalListItem {
  const progress = aggregateLearningProgress(goal.units);
  return {
    ...listItem,
    completedCount: progress.completedUnits,
    progressPercent: progress.progressPercent,
    progressUnits: progress.progressUnits,
    unitCount: progress.totalUnits,
    totalLearningSeconds: goal.totalLearningSeconds,
    lastLearnedUnit: goal.lastLearnedUnit ?? null,
  };
}

export function patchGoalDetailCache(
  queryClient: QueryClient,
  goalId: string,
  patch: {
    totalLearningSeconds?: number;
    lastLearnedUnit?: LastLearnedUnit | null;
    unitPatches?: Record<string, GoalUnitCachePatch>;
  },
): void {
  queryClient.setQueryData<GoalDetail>(queryKeys.goals.detail(goalId), (prev) => {
    if (!prev) return prev;
    const units = patch.unitPatches
      ? patchUnits(prev.units, patch.unitPatches)
      : prev.units;
    return {
      ...prev,
      units,
      ...(patch.totalLearningSeconds !== undefined
        ? { totalLearningSeconds: patch.totalLearningSeconds }
        : {}),
      ...(patch.lastLearnedUnit !== undefined
        ? { lastLearnedUnit: patch.lastLearnedUnit }
        : {}),
    };
  });

  const updated = queryClient.getQueryData<GoalDetail>(
    queryKeys.goals.detail(goalId),
  );
  if (!updated) return;

  queryClient.setQueryData<GoalListItem[]>(queryKeys.goals.list(), (prev) => {
    if (!prev) return prev;
    return sortGoalListItemsByLastStudied(
      prev.map((item) =>
        item.id === goalId ? syncListItemFromDetail(item, updated) : item,
      ),
    );
  });
}

export function patchGoalUnitContentGen(
  queryClient: QueryClient,
  goalId: string,
  unitId: string,
  contentGen: UnitContentGenStatus,
): void {
  patchGoalDetailCache(queryClient, goalId, {
    unitPatches: { [unitId]: { contentGen } },
  });
}

export function patchGoalActivityTouch(
  queryClient: QueryClient,
  goalId: string,
  unitId: string,
  input: {
    activeSeconds?: number;
    tab?: string;
  },
): void {
  const goal = queryClient.getQueryData<GoalDetail>(
    queryKeys.goals.detail(goalId),
  );
  if (!goal) return;

  const unit = goal.units.find((row) => row.id === unitId);
  if (!unit) return;

  const learnedAt = new Date().toISOString();
  const totalLearningSeconds =
    typeof input.activeSeconds === "number" && input.activeSeconds > 0
      ? (goal.totalLearningSeconds ?? 0) + input.activeSeconds
      : goal.totalLearningSeconds;

  const shouldUpdateLast =
    unit.unitKind === "lesson" &&
    (!goal.lastLearnedUnit || learnedAt >= goal.lastLearnedUnit.learnedAt);

  const nextLastLearned: LastLearnedUnit | undefined =
    shouldUpdateLast
      ? {
          id: unit.id,
          title: unit.title,
          status: unit.status,
          learnedAt,
        }
      : undefined;

  patchGoalDetailCache(queryClient, goalId, {
    totalLearningSeconds,
    ...(nextLastLearned ? { lastLearnedUnit: nextLastLearned } : {}),
    unitPatches: {
      [unitId]: {
        sessionState: {
          updatedAt: learnedAt,
          ...(input.tab === "sq" ||
          input.tab === "material" ||
          input.tab === "cornell" ||
          input.tab === "done"
            ? { currentStep: unit.sessionState?.currentStep ?? "structured_input" }
            : {}),
        },
      },
    },
  });
}

/** Apply session/stream response fields without refetching goal detail. */
export function patchGoalFromSessionResponse(
  queryClient: QueryClient,
  goalId: string,
  unitId: string,
  data: Record<string, unknown>,
): void {
  const unitPatch: GoalUnitCachePatch = {};
  let hasPatch = false;

  if (typeof data.unitStatus === "string") {
    unitPatch.status = data.unitStatus;
    hasPatch = true;
  } else if (data.resetProgress) {
    unitPatch.status = "in_progress";
    hasPatch = true;
  }

  const sessionPatch: NonNullable<GoalUnitCachePatch["sessionState"]> = {};
  if (typeof data.currentStep === "string") {
    sessionPatch.currentStep = data.currentStep;
    hasPatch = true;
  }
  if (Object.keys(sessionPatch).length > 0) {
    unitPatch.sessionState = sessionPatch;
  }

  if (data.clearedMaterial) {
    unitPatch.learningMaterial = null;
    unitPatch.contentGen = {
      hasSurvey: Boolean(data.sq),
      hasMaterial: false,
    };
    hasPatch = true;
  }

  if (data.sq) {
    unitPatch.contentGen = {
      hasSurvey: true,
      hasMaterial: unitPatch.contentGen?.hasMaterial ?? false,
    };
    hasPatch = true;
  }

  if (data.material) {
    unitPatch.learningMaterial = { sections: "[{}]", introduction: " " };
    unitPatch.contentGen = {
      hasSurvey: true,
      hasMaterial: true,
    };
    hasPatch = true;
  }

  if (data.cornell) {
    hasPatch = true;
  }

  if (typeof data.nextStep === "string" && data.nextStep === "complete") {
    unitPatch.status = "completed";
    sessionPatch.currentStep = "complete";
    unitPatch.sessionState = sessionPatch;
    hasPatch = true;
  }

  if (!hasPatch) return;

  patchGoalDetailCache(queryClient, goalId, {
    unitPatches: { [unitId]: unitPatch },
  });
}
