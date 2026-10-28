import type { GoalModule } from "@/shared/api";

const COMPLETED_UNIT_STATUSES = new Set([
  "completed",
  "mastered",
  "completed_needs_reinforcement",
]);

type ProgressUnit = {
  id: string;
  orderIndex: number;
  status: string;
  learnable?: boolean;
  supportKind?: string | null;
};

type CurrentModuleProgress = Pick<
  GoalModule,
  | "id"
  | "orderIndex"
  | "status"
  | "unlockStatus"
  | "completedRequiredUnits"
  | "requiredUnitCount"
  | "structureUnitCount"
>;

export type ModuleProgressAction =
  | { kind: "unit"; unitId: string; continuing: boolean }
  | { kind: "module"; moduleId: string }
  | { kind: "journey"; reason: "final_module" | "next_module_locked" };

export function resolveModuleProgressAction({
  currentModule,
  units,
  journeyModules,
}: {
  currentModule: CurrentModuleProgress;
  units: readonly ProgressUnit[];
  journeyModules?: readonly GoalModule[];
}): ModuleProgressAction | null {
  const totalRequiredLessons =
    currentModule.requiredUnitCount || currentModule.structureUnitCount || 0;
  const moduleComplete =
    currentModule.status === "completed" ||
    currentModule.unlockStatus === "completed" ||
    (totalRequiredLessons > 0 &&
      currentModule.completedRequiredUnits >= totalRequiredLessons);

  if (!moduleComplete) {
    const nextUnit = units
      .filter((unit) => unit.supportKind !== "prerequisite_bridge")
      .sort((left, right) => left.orderIndex - right.orderIndex)
      .find(
        (unit) =>
          unit.learnable !== false && !COMPLETED_UNIT_STATUSES.has(unit.status),
      );

    return nextUnit
      ? {
          kind: "unit",
          unitId: nextUnit.id,
          continuing: nextUnit.status === "in_progress",
        }
      : null;
  }

  if (!journeyModules) return null;

  const nextModule = [...journeyModules]
    .filter((candidate) => candidate.orderIndex > currentModule.orderIndex)
    .sort((left, right) => left.orderIndex - right.orderIndex)[0];

  if (!nextModule) {
    return { kind: "journey", reason: "final_module" };
  }
  if (nextModule.unlockStatus === "locked") {
    return { kind: "journey", reason: "next_module_locked" };
  }
  return { kind: "module", moduleId: nextModule.id };
}
