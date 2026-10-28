import { z } from "zod";
import { defineAgentTool } from "../../../core/tools.js";
import {
  approveGoalPlan,
  decomposeGoalMap,
  generateOverviewCourseForGoal,
  generatePlanForGoal,
} from "../../actions.js";
import type { AgentRunContext } from "../../../core/types.js";
import { goalStateFromCheckpoint } from "../../state.js";
import type {
  LearningGoalPlanRepository,
  LegacyMapReplacementRepository,
  ModuleStructureQueueRepository,
  OverviewCoursePublicationRepository,
  SequentialCurriculumApprovalRepository,
  CognitiveModelInvalidationRepository,
} from "../../../../../../domain/src/index.js";

export function createPlanTools(options?: {
  legacyMapReplacement?: LegacyMapReplacementRepository;
  overviewCoursePublication?: OverviewCoursePublicationRepository;
  learningGoalPlan?: LearningGoalPlanRepository;
  sequentialCurriculumApproval?: SequentialCurriculumApprovalRepository;
  moduleStructureQueue?: ModuleStructureQueueRepository;
  cognitiveModelInvalidation?: CognitiveModelInvalidationRepository;
}) {
  return [
    defineAgentTool({
      name: "generate_plan",
      description:
        "Generate the structured learning plan used to create the goal's module journey (SSE stream).",
      schema: z.object({}),
      handler: async (_args, ctx) => {
        const state = goalStateFromCheckpoint(ctx.state);
        if (!state.goalId) return JSON.stringify({ error: "Missing goalId." });

        const plan = await generatePlanForGoal(ctx.userId, state, ctx, {
          learningGoalPlan: options?.learningGoalPlan,
        });
        Object.assign(ctx.state, {
          mapPlan: plan,
          mapPlanStatus: "ready",
          currentPhase: "reviewing_plan",
        });
        return JSON.stringify({ status: "contract_ready", plan });
      },
    }),

    defineAgentTool({
      name: "review_plan",
      description: "Show the goal contract for learner review.",
      schema: z.object({
        message: z.string().optional(),
      }),
      uiKind: "plan_editor",
      requiresHumanInput: true,
      handler: async (_args, ctx) => {
        const state = goalStateFromCheckpoint(ctx.state);
        return JSON.stringify({
          awaiting: "contract_review",
          goalId: state.goalId,
          plan: state.mapPlan,
        });
      },
    }),

    defineAgentTool({
      name: "approve_plan",
      description: "Approve the goal contract after learner confirmation.",
      schema: z.object({ approved: z.boolean() }),
      handler: async (args, ctx) => {
        if (!args.approved) {
          return JSON.stringify({
            error: "The learner has not confirmed the learning plan.",
          });
        }
        const state = goalStateFromCheckpoint(ctx.state);
        if (!state.goalId) return JSON.stringify({ error: "Missing goalId." });
        await approveGoalPlan(ctx.userId, state.goalId, {
          learningGoalPlan: options?.learningGoalPlan,
          sequentialCurriculumApproval: options?.sequentialCurriculumApproval,
          moduleStructureQueue: options?.moduleStructureQueue,
        });
        Object.assign(ctx.state, {
          mapPlanStatus: "approved",
          currentPhase: "decomposing",
          currentSubagent: "plan",
        });
        return JSON.stringify({ status: "approved" });
      },
    }),

    defineAgentTool({
      name: "generate_map",
      description:
        "Generate the learning map from the approved goal contract (SSE stream). Call generate_overview_course after it completes.",
      schema: z.object({}),
      handler: async (_args, ctx) => {
        const state = goalStateFromCheckpoint(ctx.state);
        if (!state.goalId) return JSON.stringify({ error: "Missing goalId." });

        const result = await decomposeGoalMap(ctx.userId, state, ctx, {
          legacyMapReplacement: options?.legacyMapReplacement,
          cognitiveModelInvalidation: options?.cognitiveModelInvalidation,
        });
        return JSON.stringify({
          goalId: result.goalId,
          unitCount: result.unitCount,
          status: "map_ready",
        });
      },
    }),

    defineAgentTool({
      name: "generate_overview_course",
      description:
        "Generate an overview course for each goal branch (SSE stream).",
      schema: z.object({}),
      handler: async (_args, ctx) => {
        const state = goalStateFromCheckpoint(ctx.state);
        if (!state.goalId) return JSON.stringify({ error: "Missing goalId." });

        const result = await generateOverviewCourseForGoal(
          ctx.userId,
          state,
          ctx,
          { overviewCoursePublication: options?.overviewCoursePublication },
        );
        Object.assign(ctx.state, {
          currentPhase: "completed",
          currentSubagent: "plan",
        });
        return JSON.stringify({
          goalId: state.goalId,
          status: "overview_course_ready",
          ...result,
        });
      },
    }),
  ];
}

export async function applyPlanResumeResult(
  toolName: string,
  result: unknown,
  ctx: Pick<AgentRunContext, "send" | "signal" | "threadId" | "traceId"> & {
    state: Record<string, unknown>;
    userId: string;
  },
  options: { learningGoalPlan?: LearningGoalPlanRepository } = {},
): Promise<void> {
  if (toolName !== "review_plan") return;
  const data =
    typeof result === "object" && result
      ? (result as Record<string, unknown>)
      : {};
  const state = goalStateFromCheckpoint(ctx.state);
  if (!state.goalId) return;

  if (data.approved === false) {
    const feedback =
      typeof data.feedback === "string" ? data.feedback.trim() : "";
    if (feedback) {
      const adjusted = await generatePlanForGoal(ctx.userId, state, ctx, {
        adjustment: feedback,
        learningGoalPlan: options.learningGoalPlan,
      });
      Object.assign(ctx.state, {
        mapPlan: adjusted,
        mapPlanStatus: "ready",
        currentPhase: "reviewing_plan",
        currentSubagent: "plan",
      });
    }
  }

  if (data.approved === true) {
    Object.assign(ctx.state, { mapPlanStatus: "approved" });
  }
}
