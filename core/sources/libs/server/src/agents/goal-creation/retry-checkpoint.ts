import type { ThreadCheckpoint } from "../core/checkpoint.js";
import { goalStateFromCheckpoint, mergeGoalState } from "./state.js";

/**
 * Learner retry keeps durable goal + authoring history and only clears
 * in-run attempt counters that would otherwise make the next orchestrator
 * pass exit immediately without calling the model.
 */
export function prepareGoalCreationRetryCheckpoint(
  checkpoint: ThreadCheckpoint,
): ThreadCheckpoint {
  const state = goalStateFromCheckpoint(checkpoint);
  if (state.mapPlanStatus === "approved" || state.mapPlanStatus === "ready") {
    if (state.moduleAuditRepairRound <= 0) return checkpoint;
    return mergeGoalState(checkpoint, {
      moduleAuditRepairRound: 0,
      auditStatus: "pending",
    }) as ThreadCheckpoint;
  }
  if (state.planAuthorAttempts <= 0) {
    return checkpoint;
  }
  return mergeGoalState(checkpoint, {
    planAuthorAttempts: 0,
    currentPhase: "generating_plan",
    currentSubagent: "plan",
  }) as ThreadCheckpoint;
}
