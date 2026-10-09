import { getCurrentLocale, tBackend } from "../../../common/src/index.js";
import { hasValidSqPreview } from "../domain/sq-preview.js";
import { gatherGoalPathContext } from "./goal-path-context.js";
import { resolveMicroCourseGoalTitle } from "./refine-goal-title.js";
import {
  generateSqPreview,
  getOrCreateSession,
} from "../graph/unit-session.js";
import { resolveGoalContentLanguage } from "../llm/content-language.js";
import { generateMicroUnitStream } from "../llm/micro-unit.js";
import { goalHasRagDocuments } from "../rag/retrieve.js";
import { appendLearnerProfileToPromptOptions } from "../persona/learner-profile.js";
import {
  ensureUnitSectionPlan,
  generateUnitSectionMaterial,
} from "../sections/index.js";
import type { AgentRunContext } from "../agents/core/types.js";
import type { MicroUnitPublicationRepository } from "../../../domain/src/index.js";
import { requireUnitSessionPersistence } from "../graph/unit-session-persistence.js";
import { requireMicroUnitPersistence } from "./micro-unit-persistence.js";

export type CreateMicroUnitResult = {
  goalId: string;
  unitId: string;
  isOverview: boolean;
};

type MicroLessonContentState = {
  id: string;
  title: string;
  contentSummary: string;
  sessionState: { sq3rData: string } | null;
  learningMaterial: { id: string } | null;
};

async function ensureMicroLessonContent(
  userId: string,
  goalId: string,
  unit: MicroLessonContentState,
  ctx: Pick<AgentRunContext, "send">,
  options: { autoSurvey: boolean; autoContent: boolean },
): Promise<void> {
  if (!options.autoSurvey && !options.autoContent) return;

  await getOrCreateSession(userId, unit.id);
  let sqJson = unit.sessionState?.sq3rData ?? "";
  if (!hasValidSqPreview(sqJson)) {
    await ctx.send({
      type: "status",
      message: tBackend("status.generation.sq"),
      phase: "sq_preview",
    });
    const sq = await generateSqPreview(
      goalId,
      unit.id,
      unit.title,
      unit.contentSummary,
      { canonicalLearningTargets: [] },
    );
    sqJson = JSON.stringify(sq);
    await requireUnitSessionPersistence().updateOwned({
      userId, unitId: unit.id, patch: {
        sq3rData: sqJson,
        structuredSubStep: "sq",
        currentStep: "structured_input",
      },
    });
  }

  if (!options.autoContent || unit.learningMaterial) return;

  await ctx.send({
    type: "status",
    message: tBackend("status.generation.material"),
    phase: "material",
  });
  const sections = await ensureUnitSectionPlan(unit.id, undefined, {
    force: true,
  });
  const firstSection = sections[0];
  if (!firstSection) throw new Error("轻课学习小节规划失败");
  await generateUnitSectionMaterial({
    userId,
    unitId: unit.id,
    sectionId: String(firstSection.id),
  });
}

async function upgradeLegacyMicroOverview(
  goalId: string,
  unit: MicroLessonContentState & { unitKind: string },
  goalTitle: string,
  userId: string,
  microUnitPublication?: MicroUnitPublicationRepository,
): Promise<MicroLessonContentState & { unitKind: "lesson" }> {
  const lessonTitle = goalTitle.trim() || unit.title;
  {
    const upgraded = await (microUnitPublication ?? requireMicroUnitPersistence()).upgradeOwnedOverviewToLesson({
      userId,
      goalId,
      unitId: unit.id,
      title: lessonTitle,
    });
    if (upgraded.status === "not_found") {
      throw new Error("目标或轻课概览不存在");
    }
  }
  return {
    id: unit.id,
    unitKind: "lesson",
    title: lessonTitle,
    contentSummary: unit.contentSummary,
    sessionState: unit.sessionState,
    learningMaterial: null,
  };
}

export async function createMicroUnitForGoal(
  userId: string,
  goalId: string,
  ctx: Pick<AgentRunContext, "send" | "signal">,
  options?: {
    hasDocuments?: boolean;
    autoSurvey?: boolean;
    autoContent?: boolean;
    microUnitPublication?: MicroUnitPublicationRepository;
  },
): Promise<CreateMicroUnitResult> {
  const autoSurvey = options?.autoSurvey !== false;
  const autoContent = options?.autoContent === true;
  const publication = options?.microUnitPublication ?? requireMicroUnitPersistence();
  const creationContext = await publication.findOwnedCreationContext(userId, goalId);
  if (!creationContext) throw new Error("目标不存在");
  const goal = creationContext.goal;
  const existing = creationContext.unit ? { ...creationContext.unit, sessionState: creationContext.unit.sq3rData ? { sq3rData: creationContext.unit.sq3rData } : null, learningMaterial: creationContext.unit.hasLearningMaterial ? { id: creationContext.unit.id } : null } : null;
  if (existing) {
    const lesson =
      existing.unitKind === "overview"
        ? await upgradeLegacyMicroOverview(
            goalId,
            existing,
            goal.title,
            userId,
            publication,
          )
        : existing;
    await ensureMicroLessonContent(userId, goalId, lesson, ctx, {
      autoSurvey,
      autoContent,
    });
    return {
      goalId,
      unitId: existing.id,
      isOverview: false,
    };
  }

  await ctx.send({ type: "phase", phase: "decomposing", subagent: "plan" });
  await ctx.send({
    type: "status",
    message: tBackend("status.generation.path"),
    phase: "micro",
  });

  const contentLanguage = resolveGoalContentLanguage(
    goal.contentLanguage,
    goal.title,
    getCurrentLocale(),
  );
  const hasRag = await goalHasRagDocuments(goalId);
  const { context, pathSource } = await gatherGoalPathContext({
    goalId,
    title: goal.title,
    hasUpload: hasRag,
    allowWebSearch: !hasRag,
    searchPurpose: "map",
  });

  const generationOptions = await appendLearnerProfileToPromptOptions(
    goal.userId,
    goal.generationOptions,
  );

  const result = await generateMicroUnitStream({
    title: goal.title,
    level: goal.level,
    context,
    pathSource,
    contentLanguage,
    generationOptions,
    onToken: async (delta) => {
      await ctx.send({ type: "token", delta });
    },
    onPartialMicroUnit: async (partial) => {
      await ctx.send({
        type: "micro_unit_partial",
        microUnit: partial.microUnit,
        pendingFields: partial.pendingFields,
      });
    },
    signal: ctx.signal,
  });

  const { title: refinedTitle, changed: titleChanged } =
    resolveMicroCourseGoalTitle(goal.title, result.refinedTitle);
  const finalContentLanguage = titleChanged
    ? resolveGoalContentLanguage(goal.contentLanguage, refinedTitle)
    : contentLanguage;

  let unit: { id: string; title: string; contentSummary: string };
  {
    const published = await publication.publishOwnedMicroUnit({
      userId,
      goalId,
      goalTitle: refinedTitle,
      contentLanguage: finalContentLanguage,
      topicOverview: result.topicOverview,
      pathSource,
      unitTitle: result.title,
      difficulty: result.difficulty,
      contentSummary: result.contentSummary,
    });
    if (published.status === "not_found") {
      throw new Error("目标不存在");
    }
    unit = { id: published.unitId, title: published.title, contentSummary: published.contentSummary };
  }
  if (!autoSurvey && !autoContent) {
    await getOrCreateSession(userId, unit.id);
    await requireUnitSessionPersistence().updateOwned({
      userId, unitId: unit.id, patch: {
        structuredSubStep: "sq",
        currentStep: "structured_input",
      },
    });
  }
  await ensureMicroLessonContent(
    userId,
    goalId,
    {
      id: unit.id,
      title: unit.title,
      contentSummary: unit.contentSummary,
      sessionState: null,
      learningMaterial: null,
    },
    ctx,
    { autoSurvey, autoContent },
  );

  return { goalId, unitId: unit.id, isOverview: false };
}
