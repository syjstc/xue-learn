import { createHash } from "node:crypto";
import type { ThreadCheckpoint } from "../core/checkpoint.js";
import type { LlmMessageRecord } from "../core/types.js";
import type { GoalMapPlan } from "../../llm/schemas.js";
import { goalStateFromCheckpoint, mergeGoalState } from "./state.js";

function alignRecoveredPlanReview(
  checkpoint: ThreadCheckpoint,
  durablePlan?: GoalMapPlan | null,
): ThreadCheckpoint {
  const pending = checkpoint.pendingInterrupt;
  if (
    !durablePlan ||
    pending?.toolName !== "review_plan" ||
    goalStateFromCheckpoint(checkpoint).mapPlanStatus !== "ready"
  ) {
    return checkpoint;
  }
  const encoded = JSON.stringify(durablePlan);
  const changed =
    JSON.stringify(checkpoint.goalState?.mapPlan) !== encoded ||
    JSON.stringify(pending.args.plan) !== encoded;
  if (!changed) return checkpoint;

  // Publishing a revision and recording its new interrupt are separate writes.
  // Recover the published contract and invalidate a card that showed the old one.
  const toolCallId = `goal-plan-review-recovered-${createHash("sha256")
    .update(`${pending.toolCallId}:${encoded}`)
    .digest("hex")
    .slice(0, 16)}`;
  const remapReview = (messages: LlmMessageRecord[]) =>
    messages.map((message) => ({
      ...message,
      ...(message.toolCalls
        ? {
            toolCalls: message.toolCalls.map((call) =>
              call.id === pending.toolCallId
                ? { ...call, id: toolCallId }
                : call,
            ),
          }
        : {}),
      ...(message.toolCallId === pending.toolCallId ? { toolCallId } : {}),
    }));
  const plan = structuredClone(durablePlan);
  return {
    ...checkpoint,
    llmMessages: remapReview(checkpoint.llmMessages ?? []),
    ...(checkpoint.goalCreationMessages
      ? { goalCreationMessages: remapReview(checkpoint.goalCreationMessages) }
      : {}),
    goalState: {
      ...checkpoint.goalState,
      mapPlan: plan,
      mapPlanStatus: "ready",
      currentPhase: "reviewing_plan",
    },
    pendingInterrupt: {
      ...pending,
      toolCallId,
      args: { ...pending.args, plan },
    },
  };
}

/**
 * Learner retry keeps durable goal + authoring history and only clears
 * in-run attempt counters that would otherwise make the next orchestrator
 * pass exit immediately without calling the model.
 */
export function prepareGoalCreationRetryCheckpoint(
  checkpoint: ThreadCheckpoint,
  durablePlan?: GoalMapPlan | null,
): ThreadCheckpoint {
  const recovery = checkpoint.planRevisionRecovery as
    ThreadCheckpoint | undefined;
  if (
    recovery?.pendingInterrupt?.toolName === "review_plan" &&
    goalStateFromCheckpoint(recovery).mapPlanStatus === "ready"
  ) {
    // A process interruption during an edit restores the last valid review;
    // retry must never start a fresh curriculum or lose the selected goal.
    const restored = { ...recovery };
    delete restored.planRevisionRecovery;
    return alignRecoveredPlanReview(restored, durablePlan);
  }
  const aligned = alignRecoveredPlanReview(checkpoint, durablePlan);
  if (aligned !== checkpoint) return aligned;
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
