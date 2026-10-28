import { BadRequestException } from "@nestjs/common";
import { tBackend } from "../../../../common/src/index.js";
import { refreshDetailedPlanForGoal } from "../../goals/refresh-detailed-plan.js";
import { isMicroGoal } from "../../domain/goal-kind.js";
import type {
  CognitiveModelInvalidationRepository,
  LearningGoalPlanRepository,
} from "../../../../domain/src/index.js";

export function assertFullGoal(goal: { goalKind?: string | null }) {
  if (isMicroGoal(goal)) {
    throw new BadRequestException(tBackend("error.goal.microUnsupportedMap"));
  }
}

export function assertEditableMapUnit(unit: { unitKind: string }) {
  if (unit.unitKind === "overview") {
    throw new BadRequestException(tBackend("error.goal.overviewUnitReadonly"));
  }
}

export async function refreshDetailedPlanFromMap(params: {
  goalId: string;
  userId: string;
  onToken?: (delta: string) => Promise<void> | void;
  signal?: AbortSignal;
  cognitiveModelInvalidation: CognitiveModelInvalidationRepository;
  learningGoalPlan: LearningGoalPlanRepository;
}) {
  const plan = await refreshDetailedPlanForGoal({
    goalId: params.goalId,
    userId: params.userId,
    onToken: params.onToken,
    signal: params.signal,
    learningGoalPlan: params.learningGoalPlan,
  });
  // Detailed-plan generation can refine graph inputs such as domain/source.
  // Fingerprint after it commits so the rebuild represents the final values.
  await params.cognitiveModelInvalidation.invalidate({
    goalId: params.goalId,
    reason: "detailed_plan_refreshed",
  });
  return plan;
}
