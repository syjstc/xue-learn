import { getCurrentLocale, tBackend } from "../../../common/src/index.js";
import type { AgentRunContext } from "../agents/core/types.js";
import { ensureTopicSummary } from "../agents/goal-creation/subagents/intake/tools.js";
import { createGoalRecord } from "../agents/goal-creation/actions.js";
import {
  createInitialGoalState,
  type GoalCreationState,
} from "../agents/goal-creation/state.js";
import { createMicroUnitForGoal } from "./create-micro-unit.js";
import { resolveGoalContentLanguage } from "../llm/content-language.js";
import type { MicroUnitPublicationRepository } from "../../../domain/src/index.js";
import type { LearningSpaceGoalCreationApplication } from "../learning-spaces/orm-application-service.js";

export type CreateMicroCourseFromTopicResult = {
  goalId: string;
  unitId: string;
  title: string;
  isOverview: boolean;
  navigateTo: string;
};

export async function createMicroCourseFromTopic(
  userId: string,
  topic: string,
  ctx: Pick<AgentRunContext, "send" | "signal" | "threadId" | "traceId">,
  options?: {
    contentLanguage?: string;
    learningSpaceApplication?: LearningSpaceGoalCreationApplication;
    microUnitPublication?: MicroUnitPublicationRepository;
  },
): Promise<CreateMicroCourseFromTopicResult> {
  const trimmedTopic = topic.trim();
  if (!trimmedTopic) throw new Error("请提供学习主题");

  await ctx.send({
    type: "status",
    message: tBackend("status.generation.goal"),
    phase: "micro",
  });

  const agentCtx: AgentRunContext = {
    userId,
    threadId: ctx.threadId,
    traceId: ctx.traceId,
    signal: ctx.signal,
    send: ctx.send,
  };

  const contentLanguage = resolveGoalContentLanguage(
    options?.contentLanguage,
    trimmedTopic,
    getCurrentLocale(),
  );
  const summary = await ensureTopicSummary(trimmedTopic, agentCtx, {
    forMicroCourse: true,
    contentLanguage,
  });
  const refinedTitle = summary.refinedTitle.trim() || trimmedTopic;

  const state: GoalCreationState = {
    ...createInitialGoalState(),
    topic: trimmedTopic,
    refinedTitle,
    intentAnalysis: summary.intentAnalysis.trim(),
    isSmallCourse: true,
    contentLanguage,
    level: "zero",
    collectedFields: ["isSmallCourse"],
  };

  const { goalId } = await createGoalRecord(userId, state, {
    learningSpaceApplication: options?.learningSpaceApplication,
  });
  const { unitId, isOverview } = await createMicroUnitForGoal(
    userId,
    goalId,
    agentCtx,
    {
      autoContent: true,
      microUnitPublication: options?.microUnitPublication,
    },
  );

  const navigateTo = isOverview
    ? `/goals/${goalId}/overview`
    : `/goals/${goalId}/units/${unitId}`;

  return {
    goalId,
    unitId,
    title: refinedTitle,
    isOverview,
    navigateTo,
  };
}
