import { z } from "zod";
import { defineAgentTool } from "../agents/core/tools.js";
import {
  learningSupplementDraftSchema,
  type LearningGuidanceTurn,
} from "./contracts.js";
import {
  learningGuidancePreferences,
  proposeLearningGoal,
  saveLearningSupplement,
} from "./service.js";
import { learningTrajectoryPersistence } from "./persistence.js";
import type { LearningBranch } from "../../../domain/src/index.js";
function turn(state: Record<string, unknown>): LearningGuidanceTurn {
  const value = state.learningGuidance as LearningGuidanceTurn | undefined;
  if (!value)
    throw new Error("Learning guidance is unavailable for this conversation");
  return value;
}
const card = (_args: unknown, result: unknown) => ({
  uiKind: "learning_branch",
  args: {
    branchId: (result as LearningBranch).id,
    unitId: (result as LearningBranch).unitId,
  },
});
export function createLearningGuidanceTools() {
  return [
    defineAgentTool({
      name: "save_learning_supplement",
      description:
        "Save ONE small optional supplement when a clear foundation gap or sustained conceptual difficulty warrants reusable course content. Prefer answering in chat, reuse existing supplements, and never infer a deficit from one wrong answer. User chooses when to enter. A topic has one topic; a section at most three. Respect auto-save preference.",
      schema: learningSupplementDraftSchema,
      handler: (args, ctx) => saveLearningSupplement(turn(ctx.state), args),
      renderUi: card,
    }),
    defineAgentTool({
      name: "propose_learning_goal",
      description:
        "Propose a separate learning goal only for a genuinely independent larger topic. Saves a reviewable proposal, never creates a real goal or navigates. Use at most one learning action per event.",
      schema: z.object({
        title: z.string().min(2).max(80),
        reason: z.string().min(2).max(500),
        returnGoal: z
          .string()
          .min(2)
          .max(500)
          .describe(
            "Learner-facing outcome explaining the connection back to the original question, never a goal ID.",
          ),
      }),
      handler: (args, ctx) => proposeLearningGoal(turn(ctx.state), args),
      renderUi: card,
    }),
    defineAgentTool({
      name: "recommend_learning_return",
      description:
        "When currently studying a supplement, suggest returning to the original lesson after a useful explanation or evidence of understanding. Interest needs no test. This is advice, never mastery or automatic navigation.",
      schema: z.object({ reason: z.string().min(2).max(500) }),
      handler: async (args, ctx) => {
        const t = turn(ctx.state);
        if (t.performedAction || !t.activeVisitId)
          throw new Error(
            "No active learning branch or suggestion already provided",
          );
        const prefs = await learningGuidancePreferences(ctx.userId);
        if (!prefs.proactiveGuidance)
          throw new Error("Proactive advice is disabled");
        const state = await learningTrajectoryPersistence().snapshot({
          userId: ctx.userId,
          unitId: t.unitId,
          limit: 10,
        });
        const visit = state.visits.find(
          (v) => v.id === t.activeVisitId && v.state !== "returned",
        );
        if (!visit) throw new Error("Learning visit no longer active");
        t.performedAction = true;
        await learningTrajectoryPersistence().appendEvent(ctx.userId, {
          id: `return-advice:${t.eventId}`,
          unitId: t.unitId,
          branchId: visit.branchId,
          visitId: visit.id,
          threadId: t.threadId ?? null,
          kind: "suggestion",
          text: args.reason,
          evidence: null,
          position: visit.returnPosition,
        });
        return { visitId: visit.id, unitId: t.unitId, reason: args.reason };
      },
      renderUi: (_args, result) => ({
        uiKind: "learning_return_suggestion",
        args: result as Record<string, unknown>,
      }),
    }),
  ];
}
