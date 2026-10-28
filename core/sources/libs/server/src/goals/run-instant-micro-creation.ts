import type {
  LearnerStateMemoryInvalidationRepository,
  MaterialReplacementRepository,
  MicroUnitPublicationRepository,
} from "../../../domain/src/index.js";
import { getCurrentLocale, tBackend } from "../../../common/src/index.js";
import { createGoalRecord } from "../agents/goal-creation/actions.js";
import { analyzePendingGoalDocuments } from "../agents/goal-creation/document-seed.js";
import {
  clearPendingGoalDocuments,
  storePendingGoalDocuments,
} from "../agents/goal-creation/pending-documents.js";
import { ensureTopicSummary } from "../agents/goal-creation/subagents/intake/tools.js";
import {
  createInitialGoalState,
  type GoalCreationState,
} from "../agents/goal-creation/state.js";
import type { AgentRunContext } from "../agents/core/types.js";
import { gatherGoalPathContext } from "./goal-path-context.js";
import { resolveMicroCourseGoalTitle } from "./refine-goal-title.js";
import { sendUnitContentGenEvent } from "../graph/unit-content-gen-event.js";
import { commitSqPreviewAtRevision } from "../graph/content-revision.js";
import {
  getOrCreateSession,
  serializeMaterialContextSources,
} from "../graph/unit-session.js";
import { commitLearningMaterialReplacement } from "../graph/material-persistence.js";
import {
  streamGenerateLearningMaterialText,
  streamGenerateSqPreview,
} from "../graph/unit-session-stream.js";
import { createTrackedTokenHandler } from "../generation/token-handler.js";
import type { SseEvent } from "../llm/sse.js";
import type { TrackedWorkContext } from "../generation/tracked-sse.js";
import { assertRunActive } from "../generation/run.js";
import { resolveGoalContentLanguage } from "../llm/content-language.js";
import { INSTANT_MICRO_GENERATION_OPTIONS } from "../llm/generation-options.js";
import { generateMicroUnitStream } from "../llm/micro-unit.js";
import { goalHasRagDocuments } from "../rag/retrieve.js";
import type { LearningSpaceGoalCreationApplication } from "../learning-spaces/orm-application-service.js";
import { requireGenerationRunPersistence } from "../generation/run-persistence.js";
import { requireMicroUnitPersistence } from "./micro-unit-persistence.js";

export type InstantMicroInput = {
  topic?: string;
  files?: Array<{ filename: string; buffer: Buffer }>;
};

export type InstantMicroCreationResult = {
  goalId: string;
  unitId: string;
  navigateTo: string;
};

function buildAgentCtx(
  userId: string,
  ctx: TrackedWorkContext,
): AgentRunContext {
  return {
    userId,
    threadId: `instant-${ctx.runId}`,
    traceId: ctx.runId,
    signal: ctx.signal,
    send: (event) => ctx.send(event as SseEvent),
  };
}

export async function runInstantMicroCreation(
  ctx: TrackedWorkContext,
  userId: string,
  input: InstantMicroInput,
  materialReplacement?: MaterialReplacementRepository,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
  learningSpaceApplication?: LearningSpaceGoalCreationApplication,
  microUnitPublication?: MicroUnitPublicationRepository,
): Promise<InstantMicroCreationResult> {
  if (!materialReplacement || !learningSpaceApplication) {
    throw new Error("Instant micro persistence is unavailable");
  }
  const sessionKey = `instant-${ctx.runId}`;
  const trimmedTopic = input.topic?.trim() ?? "";
  const hasFiles = (input.files?.length ?? 0) > 0;

  if (!trimmedTopic && !hasFiles) {
    throw new Error("请输入主题或上传资料");
  }

  await ctx.send({
    type: "status",
    message: tBackend("status.generation.goal"),
    phase: "micro",
  });

  const agentCtx = buildAgentCtx(userId, ctx);
  let topic = trimmedTopic;
  let refinedTitle = trimmedTopic;
  let intentAnalysis = "";
  let documentSummary = "";
  let hasDocuments = false;

  if (hasFiles) {
    storePendingGoalDocuments(sessionKey, input.files!);
    hasDocuments = true;
    if (!topic) {
      await ctx.send({
        type: "status",
        message: tBackend("status.generation.goal"),
        phase: "ingesting",
      });
      const seed = await analyzePendingGoalDocuments(sessionKey);
      topic = seed.topic.trim() || seed.refinedTitle.trim();
      refinedTitle = seed.refinedTitle.trim() || topic;
      intentAnalysis = seed.intentAnalysis.trim();
      documentSummary = seed.documentSummary.trim();
    }
  }

  if (!topic) {
    throw new Error("无法确定学习主题，请补充描述或上传资料");
  }

  // Resolve before title refinement. A model-authored display title must never
  // be allowed to switch an English learner's course to Chinese.
  const initialContentLanguage = resolveGoalContentLanguage(
    "auto",
    topic,
    getCurrentLocale(),
  );

  if (topic && (!refinedTitle || !intentAnalysis)) {
    const summary = await ensureTopicSummary(topic, agentCtx, {
      forMicroCourse: true,
      contentLanguage: initialContentLanguage,
    });
    refinedTitle = summary.refinedTitle.trim() || topic;
    intentAnalysis = summary.intentAnalysis.trim();
  }

  const generationOptions = [INSTANT_MICRO_GENERATION_OPTIONS, documentSummary]
    .filter(Boolean)
    .join("\n\n");

  const state: GoalCreationState = {
    ...createInitialGoalState(),
    topic,
    refinedTitle,
    intentAnalysis,
    isSmallCourse: true,
    contentLanguage: initialContentLanguage,
    level: "zero",
    hasDocuments,
    generationOptions,
    collectedFields: ["isSmallCourse"],
  };

  const { goalId } = await createGoalRecord(userId, state, {
    threadId: sessionKey,
    onStatus: async (message) => {
      await ctx.send({ type: "status", message, phase: "ingesting" });
    },
    learningSpaceApplication,
  });

  await requireGenerationRunPersistence().updateScopeId(ctx.runId, goalId);

  if (hasFiles) {
    clearPendingGoalDocuments(sessionKey);
  }

  await ctx.send({
    type: "status",
    message: tBackend("status.generation.path"),
    phase: "micro",
  });

  const publication = microUnitPublication ?? requireMicroUnitPersistence();
  const creationContext = await publication.findOwnedCreationContext(userId, goalId);
  if (!creationContext) throw new Error("目标不存在");
  const goal = { ...creationContext.goal, goalKind: "micro", topicCategory: null, mapPlanJson: null };

  const contentLanguage = resolveGoalContentLanguage(
    goal.contentLanguage,
    goal.title,
  );
  const hasRag = await goalHasRagDocuments(goalId);
  const { context, pathSource } = await gatherGoalPathContext({
    goalId,
    title: goal.title,
    hasUpload: hasRag,
    allowWebSearch: !hasRag,
    searchPurpose: "map",
  });

  const onToken = createTrackedTokenHandler(ctx);
  const microResult = await generateMicroUnitStream({
    title: goal.title,
    level: goal.level,
    context,
    pathSource,
    contentLanguage,
    generationOptions: goal.generationOptions,
    instantMode: true,
    onToken,
    onPartialMicroUnit: async (partial) => {
      await ctx.send({
        type: "micro_unit_partial",
        microUnit: partial.microUnit,
        pendingFields: partial.pendingFields,
      });
    },
    signal: ctx.signal,
  });

  const { title: nextTitle, changed: titleChanged } =
    resolveMicroCourseGoalTitle(goal.title, microResult.refinedTitle);
  const finalContentLanguage = titleChanged
    ? resolveGoalContentLanguage(goal.contentLanguage, nextTitle)
    : contentLanguage;

  let refreshedGoal = goal;
  let unit: {
    id: string;
    title: string;
    contentSummary: string;
    contentRevision: number;
  };
  {
    const published = await publication.publishOwnedMicroUnit({
      userId,
      goalId,
      goalTitle: nextTitle,
      contentLanguage: finalContentLanguage,
      topicOverview: microResult.topicOverview,
      pathSource,
      unitTitle: microResult.title,
      difficulty: microResult.difficulty,
      contentSummary: microResult.contentSummary,
    });
    if (published.status === "not_found") {
      throw new Error("目标不存在");
    }
    refreshedGoal = { ...goal, title: nextTitle, contentLanguage: finalContentLanguage };
    unit = {
      id: published.unitId,
      title: microResult.title,
      contentSummary: microResult.contentSummary,
      contentRevision: 0,
    };
  }
  await getOrCreateSession(goal.userId, unit.id);

  const navigateTo = `/goals/${goalId}/units/${unit.id}`;
  await ctx.send({
    type: "status",
    message: tBackend("status.generation.sq"),
    phase: "sq_preview",
  });

  await assertRunActive(ctx.runId, ctx.signal);
  // Open the lesson exactly as SQ generation starts so the learner can watch
  // the preview arrive progressively instead of waiting on generated content.
  await ctx.send({
    type: "shell_ready",
    goalId,
    unitId: unit.id,
    navigateTo,
    runId: ctx.runId,
  });
  const sq = await streamGenerateSqPreview(
    refreshedGoal,
    unit.id,
    microResult.title,
    microResult.contentSummary,
    onToken,
    ctx.signal,
    {
      canonicalLearningTargets: [],
      learnerStateMemoryInvalidation,
      onPartialSq: async (partial) => {
        await ctx.send({
          type: "sq_partial",
          sq: partial.sq,
          completeLineCount: partial.completeLineCount,
        });
      },
      onVerificationStart: () =>
        ctx.send({
          type: "status",
          message: tBackend("status.generation.verifyingContent"),
          phase: "verification",
        }),
      generationRunId: ctx.runId,
    },
  );
  const sqJson = JSON.stringify(sq);
  const materialBaseRevision = await commitSqPreviewAtRevision({
    unitId: unit.id,
    expectedContentRevision: unit.contentRevision,
    sq3rData: sqJson,
  });
  await sendUnitContentGenEvent(ctx, unit.id, { hasSurvey: true });

  await ctx.send({
    type: "status",
    message: tBackend("status.generation.material"),
    phase: "material",
  });
  await assertRunActive(ctx.runId, ctx.signal);
  const { material, contextSources, materialSourceItems } =
    await streamGenerateLearningMaterialText(
      refreshedGoal,
      unit.id,
      microResult.title,
      microResult.contentSummary,
      sqJson,
      onToken,
      ctx.signal,
      {
        onPartialMaterial: async (partial) => {
          await ctx.send({
            type: "material_partial",
            material: partial.material,
            completeBlockCount: partial.completeBlockCount,
            placeholderBlockCount: partial.placeholderBlockCount,
          });
        },
        onVerificationStart: () =>
          ctx.send({
            type: "status",
            message: tBackend("status.generation.verifyingContent"),
            phase: "material",
          }),
        generationRunId: ctx.runId,
      },
    );
  await assertRunActive(ctx.runId, ctx.signal);
  const committed = await commitLearningMaterialReplacement({
    materialReplacement,
    learnerStateMemoryInvalidation,
    userId,
    goalId,
    unitId: unit.id,
    material,
    materialSourceItems,
    contextSourcesJson: serializeMaterialContextSources(contextSources),
    sq3rData: sqJson,
    publishChecks: false,
    resetProgress: false,
    clearDownstream: false,
    expectedContentRevision: materialBaseRevision,
  });
  await sendUnitContentGenEvent(ctx, unit.id, {
    hasSurvey: true,
    hasMaterial: true,
  });
  await ctx.send({
    type: "material_ready",
    material,
    contentRevision: committed.contentRevision,
  });

  await ctx.send({
    type: "done",
    goalId,
    unitId: unit.id,
    navigateTo,
    contentRevision: committed.contentRevision,
  });

  return { goalId, unitId: unit.id, navigateTo };
}
