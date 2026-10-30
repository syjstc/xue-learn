import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import { tBackend } from "../../../../common/src/index.js";
import { StructuredGenerationError } from "../../llm/validated-structured-generation.js";
import type { AgentRunContext } from "../core/types.js";
import type { ThreadCheckpoint } from "../core/checkpoint.js";
import {
  loadCheckpoint,
  requireAgentConversationPersistence,
  saveCheckpoint,
} from "../core/checkpoint.js";
import { goalStateFromCheckpoint, mergeGoalState } from "./state.js";
import { approveGoalPlan, generatePlanForGoal } from "./actions.js";
import type { GoalCreationRunOptions } from "./embedded.js";
import { isAgenticGoalCreation } from "./contract.js";
import { getModuleStructureDraft } from "../../goal-creation/module-structure-draft-persistence.js";

const MAX_PLAN_AUTHOR_ATTEMPTS = 2;

const AgenticState = new StateSchema({
  status: z
    .enum(["author_plan", "persist", "review", "fan_out", "complete", "failed"])
    .default("author_plan"),
  error: z.string().default(""),
});

async function currentCheckpoint(threadId: string): Promise<ThreadCheckpoint> {
  return (await loadCheckpoint(threadId)) as ThreadCheckpoint;
}

export async function runAgenticPostApproval(
  ctx: AgentRunContext,
  userId: string,
  _checkpoint: ThreadCheckpoint,
  options: GoalCreationRunOptions,
  sessionId: string,
  review: { planConfirmed?: boolean } = {},
): Promise<ThreadCheckpoint> {
  const graph = new StateGraph(AgenticState)
    .addNode("author_plan", async () => {
      const checkpoint = await currentCheckpoint(ctx.threadId);
      const state = goalStateFromCheckpoint(checkpoint);
      if (state.mapPlan && state.mapPlanStatus === "ready") {
        return { status: "persist" as const, error: "" };
      }
      let lastError = "";
      // Each graph invocation (including learner retry) gets a fresh attempt
      // budget. Persisted planAuthorAttempts is telemetry + crash breadcrumbs,
      // not a permanent lock — otherwise retry after exhaustion no-ops.
      for (let attempt = 1; attempt <= MAX_PLAN_AUTHOR_ATTEMPTS; attempt += 1) {
        const live = await currentCheckpoint(ctx.threadId);
        await saveCheckpoint(
          ctx.threadId,
          mergeGoalState(live, {
            planAuthorAttempts: attempt,
            currentPhase: "generating_plan",
            currentSubagent: "plan",
          }) as ThreadCheckpoint,
        );
        try {
          const plan = await generatePlanForGoal(
            userId,
            goalStateFromCheckpoint(await currentCheckpoint(ctx.threadId)),
            ctx,
            {
              learningGoalPlan:
                options.learningSpaceApplication?.learningGoalPlan,
            },
          );
          await saveCheckpoint(
            ctx.threadId,
            mergeGoalState(await currentCheckpoint(ctx.threadId), {
              mapPlan: plan,
              mapPlanStatus: "ready",
              planAuthorAttempts: attempt,
              planRepairAttempts: 1,
            }) as ThreadCheckpoint,
          );
          return { status: "persist" as const, error: "" };
        } catch (error) {
          lastError =
            error instanceof StructuredGenerationError
              ? error.issues.join("; ")
              : error instanceof Error
                ? error.message
                : String(error);
          if (
            attempt >= MAX_PLAN_AUTHOR_ATTEMPTS ||
            (error instanceof Error &&
              !(error instanceof StructuredGenerationError))
          ) {
            return { status: "failed" as const, error: lastError };
          }
        }
      }
      return { status: "failed" as const, error: lastError };
    })
    .addNode("persist", async () => {
      const checkpoint = await currentCheckpoint(ctx.threadId);
      const state = goalStateFromCheckpoint(checkpoint);
      if (!state.goalId) {
        return { status: "failed" as const, error: "Missing goalId" };
      }
      if (!review.planConfirmed && !state.autoApproveWithoutQuestions &&
          state.mapPlan?.learningPath?.baseline.some((entry) => entry.status === "unknown")) {
        // The outer orchestrator persists its existing plan-editor interrupt.
        // No module publication or outbox dispatch occurs before that decision.
        return { status: "review" as const };
      }
      await approveGoalPlan(userId, state.goalId, {
        learningGoalPlan: options.learningSpaceApplication?.learningGoalPlan,
        sequentialCurriculumApproval:
          options.learningSpaceApplication?.sequentialCurriculumApproval,
        moduleStructureQueue:
          options.learningSpaceApplication?.moduleStructureQueue,
        moduleStructureDraft: getModuleStructureDraft(),
        sessionId,
        structureQueueMode: "draft",
      });
      await saveCheckpoint(
        ctx.threadId,
        mergeGoalState(await currentCheckpoint(ctx.threadId), {
          mapPlanStatus: "approved",
          currentPhase: "decomposing",
          auditStatus: "pending",
        }) as ThreadCheckpoint,
      );
      return { status: "fan_out" as const };
    })
    .addNode("fan_out", async () => {
      await ctx.send({
        type: "phase",
        phase: "decomposing",
        subagent: "plan",
      });
      await ctx.send({
        type: "status",
        message: tBackend("status.planning.moduleDraft.fanOut"),
        phase: "module_shell",
      });
      return { status: "complete" as const };
    })
    .addNode("fail", async (state) => {
      await ctx.send({
        type: "error",
        message: state.error || "自主目标创建失败",
      });
      const session =
        await requireAgentConversationPersistence().findGoalCreationSessionByThreadId(
          ctx.threadId,
        );
      if (session) {
        await requireAgentConversationPersistence().markGoalCreationSessionError(
          session.id,
          state.error || "自主目标创建失败",
        );
      }
      return { status: "failed" as const };
    })
    .addEdge(START, "author_plan")
    .addConditionalEdges("author_plan", (state) =>
      state.status === "persist" ? "persist" : "fail",
    )
    .addConditionalEdges("persist", (state) =>
      state.status === "review" ? END : state.status === "failed" ? "fail" : "fan_out",
    )
    .addEdge("fan_out", END)
    .addEdge("fail", END);

  const compiled = graph.compile();
  await compiled.invoke({});
  return currentCheckpoint(ctx.threadId);
}

export function shouldRunAgenticPostApproval(
  checkpoint: ThreadCheckpoint,
): boolean {
  const state = goalStateFromCheckpoint(checkpoint);
  return (
    isAgenticGoalCreation(state) &&
    Boolean(state.goalId) &&
    !state.isSmallCourse &&
    state.mapPlanStatus !== "approved"
  );
}
