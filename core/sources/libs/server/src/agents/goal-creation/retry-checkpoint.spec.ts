import { prepareGoalCreationRetryCheckpoint } from "./retry-checkpoint.js";
import { phaseFromGoalCreationCheckpoint } from "./session-phase.js";
import type { ThreadCheckpoint } from "../core/checkpoint.js";
import type { GoalMapPlan } from "../../llm/schemas.js";

it("restores an interrupted plan edit to the same validated review instead of rebuilding the curriculum", () => {
  const review: ThreadCheckpoint = {
    llmMessages: [],
    pendingInterrupt: {
      toolName: "review_plan",
      toolCallId: "review-1",
      uiKind: "plan_editor",
      args: { plan: { preserved: true } },
    },
    goalState: {
      goalId: "goal-1",
      mapPlanStatus: "ready",
      currentPhase: "reviewing_plan",
    },
  };
  const running: ThreadCheckpoint = {
    ...review,
    pendingInterrupt: null,
    goalState: {
      ...review.goalState,
      mapPlanStatus: "pending",
      currentPhase: "generating_plan",
    },
    planRevisionRecovery: review,
  };
  expect(phaseFromGoalCreationCheckpoint(running)).toBe("planning");
  const retried = prepareGoalCreationRetryCheckpoint(running);
  expect(retried).toEqual(review);
  expect(phaseFromGoalCreationCheckpoint(retried)).toBe("plan_review");
  expect(running.pendingInterrupt).toBeNull();
});

it.each([true, false])(
  "shows the published revision after interruption, including when error recovery removed the marker (%s)",
  (hasRecoveryMarker) => {
    const oldPlan = { refinedTitle: "Original contract" } as GoalMapPlan;
    const publishedPlan = {
      refinedTitle: "Contract with the foundation bridge",
    } as GoalMapPlan;
    const reviewCall = { id: "review-old", name: "review_plan", args: {} };
    const review: ThreadCheckpoint = {
      llmMessages: [
        { role: "assistant", content: "", toolCalls: [reviewCall] },
      ],
      goalCreationMessages: [
        { role: "assistant", content: "", toolCalls: [reviewCall] },
      ],
      goalState: {
        goalId: "goal-1",
        mapPlan: oldPlan,
        mapPlanStatus: "ready",
        currentPhase: "reviewing_plan",
      },
      pendingInterrupt: {
        toolName: "review_plan",
        toolCallId: "review-old",
        uiKind: "plan_editor",
        args: { goalId: "goal-1", plan: oldPlan },
      },
    };
    const interrupted: ThreadCheckpoint = hasRecoveryMarker
      ? {
          ...review,
          pendingInterrupt: null,
          goalState: {
            ...review.goalState,
            currentPhase: "generating_plan",
            mapPlanStatus: "pending",
          },
          planRevisionRecovery: review,
        }
      : review;
    const before = structuredClone(interrupted);
    const retried = prepareGoalCreationRetryCheckpoint(
      interrupted,
      publishedPlan,
    );
    expect(retried.goalState).toMatchObject({
      mapPlan: publishedPlan,
      mapPlanStatus: "ready",
      currentPhase: "reviewing_plan",
    });
    expect(retried.pendingInterrupt?.args.plan).toEqual(publishedPlan);
    expect(retried.pendingInterrupt?.toolCallId).not.toBe("review-old");
    expect(retried.llmMessages[0]!.toolCalls?.[0]!.id).toBe(
      retried.pendingInterrupt?.toolCallId,
    );
    expect(retried.goalCreationMessages?.[0]!.toolCalls?.[0]!.id).toBe(
      retried.pendingInterrupt?.toolCallId,
    );
    expect(phaseFromGoalCreationCheckpoint(retried)).toBe("plan_review");
    expect(retried.planRevisionRecovery).toBeUndefined();
    expect(prepareGoalCreationRetryCheckpoint(retried, publishedPlan)).toBe(
      retried,
    );
    expect(interrupted).toEqual(before);
  },
);

it("keeps the last review when no published plan is available", () => {
  const review: ThreadCheckpoint = {
    llmMessages: [],
    goalState: { mapPlanStatus: "ready", mapPlan: { preserved: true } },
    pendingInterrupt: {
      toolName: "review_plan",
      toolCallId: "review-1",
      uiKind: "plan_editor",
      args: { plan: { preserved: true } },
    },
  };
  expect(prepareGoalCreationRetryCheckpoint(review, null)).toBe(review);
});
