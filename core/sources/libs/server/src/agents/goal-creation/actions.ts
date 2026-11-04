import { createPathProgressReporter } from "../../goal-creation/path-progress.js";
import { mergeRegenerationAdjustment } from "../../llm/generation-options.js";
import { createHash, randomUUID } from "node:crypto";
import { getCurrentLocale, tBackend } from "../../../../common/src/index.js";
import { gatherGoalPathContext } from "../../goals/goal-path-context.js";
import {
  appendRunEvent,
  cancelActiveRuns,
  completeGenerationRun,
  createGenerationRun,
  failGenerationRun,
} from "../../generation/run.js";
import { parseMapPlan, serializeMapPlan } from "../../goals/map-plan.js";
import {
  excludeFoundationScopeFromPlan,
  parseFoundationGoalItems,
} from "../../goals/foundation-support.js";
import {
  coerceGoalMapSummary,
  parseMapSummary,
  serializeMapSummary,
} from "../../goals/map-summary.js";
import { persistDecomposeResult } from "../../goals/persist-decompose.js";
import { resolveRefinedGoalTitle } from "../../goals/refine-goal-title.js";
import { curriculumModuleMatchesContentLanguage } from "../../goals/normalize-goal-map-plan.js";
import {
  getContentLanguageLabel,
  resolveGoalContentLanguage,
} from "../../llm/content-language.js";
import { decomposeGoalStream } from "../../llm/decompose.js";
import { planGoalMapStream } from "../../llm/plan-goal-map.js";
import { planGoalSummaryStream } from "../../llm/plan-goal-summary.js";
import {
  goalMapPlanSchema,
  type GoalMapPlan,
  type GoalMapSummary,
} from "../../llm/schemas.js";
import { resolveGoalGenerationOptionsWithPattern } from "../../llm/goal-course-pattern.js";
import { resolveGoalKind } from "../../domain/goal-kind.js";
import { goalHasRagDocuments } from "../../rag/retrieve.js";
import { scheduleGoalIconGeneration } from "../../goals/ensure-goal-icon.js";
import { persistOverviewCourseShellForGoal } from "../../goals/persist-overview-course.js";
import { appendLearnerProfileToPromptOptions } from "../../persona/learner-profile.js";
import { invalidateAgendaForUser } from "../../agenda/index.js";
import type { SseEvent } from "../../llm/sse.js";
import type { AgentRunContext, AgentSseEvent } from "../core/types.js";
import type { KnowledgeActivity } from "../../../../domain/src/index.js";
import type { PlanningMode } from "../../../../domain/src/index.js";
import type { LegacyMapReplacementRepository } from "../../../../domain/src/index.js";
import type { OverviewCoursePublicationRepository } from "../../../../domain/src/index.js";
import type { LearningGoalPlanRepository } from "../../../../domain/src/index.js";
import type { ModuleStructureDraftRepository } from "../../../../domain/src/index.js";
import type { ModuleStructureQueueRepository } from "../../../../domain/src/index.js";
import type { SequentialCurriculumApprovalRepository } from "../../../../domain/src/index.js";
import type { CognitiveModelInvalidationRepository } from "../../../../domain/src/index.js";
import {
  buildPlanningOutlineEvent,
  gatherDeepPlanningResearch,
} from "../../goals/deep-planning-research.js";
import { withPlanningActivity } from "../../goals/planning-activity.js";
import { getLlmRuntimeConfig } from "../../llm/runtime-config.js";
import {
  reasoningCapabilityForProvider,
  withOperationReasoning,
} from "../../providers/llm/index.js";
import {
  hasPendingGoalDocuments,
  ingestPendingGoalDocuments,
} from "./pending-documents.js";
import { resolveConfirmedGoalTitle } from "./confirmed-goal-title.js";
import type { GoalCreationState } from "./state.js";
import {
  loadTeachingSkillPrompt,
  resolveTeachingSkillForGoal,
} from "../../teaching-skills/index.js";
import type { LearningSpaceGoalCreationApplication } from "../../learning-spaces/orm-application-service.js";
import { verifyAndRepairGoalPlan } from "../../content-verification/index.js";
import { requireAgentGoalCreationPersistence } from "./persistence.js";
import { getModuleStructureDraft } from "../../goal-creation/module-structure-draft-persistence.js";
import { seedGoalAuthoringContract } from "../../goal-authoring/runner.js";
import {
  addFoundationBridge,
  canAddFoundationBridge,
} from "../../goal-authoring/foundation-bridge.js";

type GoalPlanGenerationOptions = Readonly<{
  adjustment?: string;
  foundationEntityKey?: string;
  learningGoalPlan?: LearningGoalPlanRepository;
}>;

type GoalPlanApprovalOptions = Readonly<{
  learningGoalPlan?: LearningGoalPlanRepository;
  sequentialCurriculumApproval?: SequentialCurriculumApprovalRepository;
  moduleStructureQueue?: ModuleStructureQueueRepository;
  moduleStructureDraft?: ModuleStructureDraftRepository;
  sessionId?: string;
  structureQueueMode?: "direct" | "draft";
}>;

async function emitGoalKnowledgeActivity(
  ctx: Pick<AgentRunContext, "send">,
  activity: KnowledgeActivity,
) {
  await ctx.send({ type: "knowledge_activity", activity });
}

async function requireOwnedGoal(userId: string, goalId: string) {
  const goal = await requireAgentGoalCreationPersistence().goals.findOwnedById(
    userId,
    goalId,
  );
  if (!goal) throw new Error("目标不存在");
  return goal;
}

export async function createGoalRecord(
  userId: string,
  state: GoalCreationState,
  options?: {
    threadId?: string;
    onStatus?: (message: string) => void | Promise<void>;
    learningSpaceApplication?: LearningSpaceGoalCreationApplication;
  },
): Promise<{ goalId: string }> {
  // Confirmation already presents the refined title to the learner. Creating
  // the record must not start another LLM request: a transient structured-output
  // failure after the learner clicks confirm would otherwise block persistence.
  const rawTopic = state.topic.trim();
  const title = resolveConfirmedGoalTitle(state);
  const contentLanguage = resolveGoalContentLanguage(
    state.contentLanguage,
    state.contentLanguageSourceText.trim() || rawTopic || title,
    getCurrentLocale(),
  );
  const confirmedGoalContract = [
    "[User-confirmed goal contract — authoritative]",
    `Original learning goal: ${rawTopic}`,
    `Starting level: ${state.level || "zero"}`,
    ...(state.teachingIntent
      ? [
          `Target level (destination, not starting level): ${state.teachingIntent.targetLevel}`,
          `Observable exit outcomes: ${state.teachingIntent.observableOutcomes.join("; ")}`,
          `Included scope: ${state.teachingIntent.includedScope.join("; ")}`,
          `Excluded scope: ${state.teachingIntent.excludedScope.join("; ")}`,
          `Teach before first use: ${state.teachingIntent.prerequisiteBridges.join("; ")}`,
        ]
      : []),
    state.generationOptions,
  ]
    .filter(Boolean)
    .join("\n");
  const baseGenerationOptions = await resolveGoalGenerationOptionsWithPattern({
    title,
    level: state.level || "zero",
    contentLanguage,
    generationOptions: confirmedGoalContract,
    isSmallCourse: state.isSmallCourse,
  });
  const generationOptions = await appendLearnerProfileToPromptOptions(
    userId,
    baseGenerationOptions,
  );
  const goalInput = {
    title,
    level: state.level || "zero",
    contentLanguage,
    goalKind: resolveGoalKind(state.isSmallCourse),
    learningMode: state.isSmallCourse ? "exploration" : state.learningMode,
    planningMode: state.isSmallCourse ? "fast" : state.planningMode,
    generationOptions,
    parentGoalId: state.parentGoalId || null,
    goalRelationType: state.goalRelationType || null,
    goalRelationContextJson: state.goalRelationContext,
  };
  const goal = options?.learningSpaceApplication
    ? await options.learningSpaceApplication.createOwnedGoal(userId, goalInput)
    : await requireAgentGoalCreationPersistence().goals.create({
        id: randomUUID(),
        ...goalInput,
        userId,
      });

  if (state.targetSpaceId) {
    const input = {
      spaceId: state.targetSpaceId,
      targetSpaceItemId: state.targetSpaceItemId || undefined,
    };
    if (!options?.learningSpaceApplication)
      throw new Error("Learning-space goal creation is not configured");
    await options.learningSpaceApplication.attachCreatedGoal(
      userId,
      goal.id,
      input,
    );
  } else if (
    state.parentGoalId &&
    state.goalRelationType === "foundation_support"
  ) {
    if (!options?.learningSpaceApplication)
      throw new Error("Learning-space goal creation is not configured");
    const parentSpaceId = await options.learningSpaceApplication.spaceIdForGoal(
      userId,
      state.parentGoalId,
    );
    if (parentSpaceId) {
      const input = { spaceId: parentSpaceId, source: "foundation" };
      await options.learningSpaceApplication.attachCreatedGoal(
        userId,
        goal.id,
        input,
      );
    }
  }

  await invalidateAgendaForUser(userId);

  scheduleGoalIconGeneration(userId, goal.id, title);

  const threadId = options?.threadId?.trim();
  if (threadId && (state.hasDocuments || hasPendingGoalDocuments(threadId))) {
    try {
      await options?.onStatus?.(
        tBackend("status.generation.uploadingMaterials"),
      );
      await ingestPendingGoalDocuments(threadId, goal.id, options?.onStatus);
      await options?.onStatus?.(
        tBackend("status.generation.materialsIngested"),
      );
    } catch (error) {
      console.error("Failed to ingest pending goal documents", error);
      await options?.onStatus?.(
        tBackend("status.generation.materialIngestionFailed"),
      );
      throw new Error(
        `学习资料写入失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { goalId: goal.id };
}

export async function generatePlanForGoal(
  userId: string,
  state: GoalCreationState,
  ctx: Pick<AgentRunContext, "send" | "signal" | "threadId" | "traceId">,
  options: GoalPlanGenerationOptions = {},
): Promise<GoalMapPlan> {
  const goalId = state.goalId;
  if (!goalId) throw new Error("缺少 goalId");

  const goal = await requireOwnedGoal(userId, goalId);

  await ctx.send({ type: "phase", phase: "generating_plan", subagent: "plan" });
  await ctx.send({
    type: "status",
    message: tBackend("status.generation.path"),
    phase: "plan",
  });

  const contentLanguage = resolveGoalContentLanguage(
    goal.contentLanguage,
    goal.title,
  );

  const hasRag = await goalHasRagDocuments(goalId);
  const planningMode = ((goal as { planningMode?: PlanningMode })
    .planningMode ??
    state.planningMode ??
    "fast") as PlanningMode;
  const usesBlueprintPlanning =
    planningMode === "deep" || planningMode === "docs_first";
  const adjustment = options.adjustment?.trim() ?? "";
  const existingPlan = parseMapPlan(goal.mapPlanJson);
  const isRevision = Boolean(adjustment && existingPlan);
  const foundationEntityKey = options.foundationEntityKey?.trim();
  if (
    foundationEntityKey &&
    !existingPlan?.learningPath?.baseline.some(
      (entry) => entry.entityKey === foundationEntityKey,
    )
  ) {
    throw new Error(tBackend("error.agent.foundationSelectionStale"));
  }
  if (
    foundationEntityKey &&
    existingPlan &&
    canAddFoundationBridge(existingPlan, foundationEntityKey)
  ) {
    // An explicit rejected baseline needs a small teaching bridge, not a new
    // identity, outline, registry and every previously validated module.
    await ctx.send({
      type: "planning_stage",
      stage: "revising_plan",
      message: tBackend("status.goal.revisingPlanFromSources"),
    });
    await ctx.send(
      buildPlanningOutlineEvent(existingPlan, { reusedSources: true }),
    );
    const plan = await withPlanningActivity(
      ctx.send,
      {
        id: "foundation_bridge",
        category: "synthesis",
        startedMessage: tBackend("status.goal.revisingPlanFromSources"),
        pulseMessages: [tBackend("status.planning.journey.pulse1")],
        completedMessage: tBackend("status.planning.journey.completed"),
        pulseIntervalMs: 8_000,
      },
      () =>
        addFoundationBridge({
          userId,
          goalId,
          plan: existingPlan,
          entityKey: foundationEntityKey,
          contentLanguage,
          signal: ctx.signal,
          onToken: async (delta) => {
            await ctx.send({ type: "token", delta });
          },
        }),
    );
    ctx.signal?.throwIfAborted();
    const revisedOptions = adjustment
      ? mergeRegenerationAdjustment(
          goal.generationOptions,
          adjustment,
          "Latest explicit learner correction (overrides only conflicting earlier requirements)",
        )
      : goal.generationOptions;
    const pathSource =
      goal.pathSource === "rag" || goal.pathSource === "search"
        ? goal.pathSource
        : "generic";
    if (options.learningGoalPlan) {
      const published = await options.learningGoalPlan.publishOwnedPlan({
        userId,
        goalId,
        title: goal.title,
        topicOverview: plan.topicOverview,
        mapPlanJson: serializeMapPlan(plan),
        pathSource,
        domainTag: plan.domainAnalysis.domainTag,
        topicCategory: plan.domainAnalysis.topicCategory,
        contentLanguage,
        resetIcon: false,
        generationOptions: revisedOptions,
      });
      if (published.status === "not_found") throw new Error("目标不存在");
      if (published.status === "locked")
        throw new Error("当前学习地图已绑定学习计划，无法直接更新");
    } else {
      await requireAgentGoalCreationPersistence().goals.updateOwned(
        userId,
        goalId,
        {
          topicOverview: plan.topicOverview,
          mapPlanJson: serializeMapPlan(plan),
          mapPlanStatus: "ready",
          generationOptions: revisedOptions,
        },
      );
    }
    await ctx.send(buildPlanningOutlineEvent(plan, { reusedSources: true }));
    await createPathProgressReporter(ctx.send)({
      moduleTitles: plan.modules!.map((module) => module.title),
      unitCount: plan.learningPath!.modules.reduce(
        (count, module) => count + module.units.length,
        0,
      ),
      complete: true,
      plan,
    });
    return plan;
  }
  if (planningMode === "docs_first" && !hasRag && !isRevision) {
    throw new Error("DOCS_REQUIRED_FOR_PLANNING_MODE");
  }
  if (isRevision) {
    await ctx.send({
      type: "planning_stage",
      stage: "revising_plan",
      message: tBackend("status.goal.revisingPlanFromSources"),
    });
    await ctx.send(
      buildPlanningOutlineEvent(existingPlan!, { reusedSources: true }),
    );
  } else if (usesBlueprintPlanning) {
    await ctx.send({
      type: "planning_stage",
      stage: "analyzing_goal",
      message: tBackend("status.goal.analyzingBoundaries"),
    });
  }
  const gatherContext = () =>
    gatherGoalPathContext({
      goalId,
      title: goal.title,
      hasUpload: hasRag,
      uploadedDocumentsOnly: planningMode === "docs_first",
      extraQuery: isRevision ? adjustment : undefined,
      allowWebSearch: isRevision || usesBlueprintPlanning ? false : !hasRag,
      searchPurpose: "map",
      onKnowledgeActivity: (activity) =>
        emitGoalKnowledgeActivity(ctx, activity),
    });
  const gathered = usesBlueprintPlanning
    ? await withPlanningActivity(
        ctx.send,
        {
          id: "goal_context",
          category: "research",
          startedMessage: tBackend("status.planning.context.started"),
          pulseMessages: [
            tBackend("status.planning.context.pulse1"),
            tBackend("status.planning.context.pulse2"),
          ],
          completedMessage: tBackend("status.planning.context.completed"),
        },
        gatherContext,
      )
    : await gatherContext();
  let { context, pathSource, sourceCount } = gathered;
  if (!isRevision && planningMode === "deep") {
    await ctx.send({
      type: "planning_stage",
      stage: "searching_web",
      message: tBackend("status.goal.collectingReferences"),
    });
    const reusableScopeContext = state.scopeResearch?.context?.trim() ?? "";
    if (reusableScopeContext) {
      context = [
        context,
        "[Pre-creation topic landscape research]",
        reusableScopeContext,
      ]
        .filter(Boolean)
        .join("\n\n---\n\n");
      if (!hasRag) pathSource = "search";
      sourceCount = Math.max(
        sourceCount,
        state.scopeResearch?.sources.length ?? 0,
      );
    } else if (!hasRag) {
      const deepResearch = await gatherDeepPlanningResearch({
        userId,
        goalId,
        title: goal.title,
        queryLimit: 1,
        onEvent: (event) => ctx.send(event),
        onKnowledgeActivity: (activity) =>
          emitGoalKnowledgeActivity(ctx, activity),
      });
      if (deepResearch.context) {
        context = [context, deepResearch.context]
          .filter(Boolean)
          .join("\n\n---\n\n");
        if (!hasRag) pathSource = "search";
        sourceCount = Math.max(sourceCount, deepResearch.sources.length);
      }
    }
    await ctx.send({
      type: "planning_stage",
      stage: "reading_sources",
      message: tBackend("status.goal.selectingSources"),
    });
    await ctx.send({
      type: "planning_stage",
      stage: "cross_checking",
      message: tBackend("status.goal.generatingPlanFromSources"),
    });
  } else if (!isRevision && planningMode === "docs_first") {
    await ctx.send({
      type: "planning_stage",
      stage: "searching_web",
      message: tBackend("status.goal.collectingReferences"),
    });
    const supplement = await gatherDeepPlanningResearch({
      userId,
      goalId,
      title: goal.title,
      queryLimit: 1,
      desiredSourceCount: 5,
      sourceLimit: 10,
      onEvent: (event) => ctx.send(event),
      onKnowledgeActivity: (activity) =>
        emitGoalKnowledgeActivity(ctx, activity),
    });
    context = [context, "Supplemental web verification:", supplement.context]
      .filter(Boolean)
      .join("\n\n");
    sourceCount += supplement.sources.length;
    await ctx.send({
      type: "planning_stage",
      stage: "reading_sources",
      message: tBackend("status.goal.selectingSources"),
    });
    await ctx.send({
      type: "planning_stage",
      stage: "cross_checking",
      message: tBackend("status.goal.generatingPlanFromSources"),
    });
  }
  const planStatusMessage = isRevision
    ? tBackend("status.goal.revisingPlanFromSources")
    : pathSource === "rag"
      ? tBackend("status.goal.mapSourcesRag", { count: sourceCount })
      : pathSource === "search"
        ? tBackend("status.goal.mapSourcesSearch", { count: sourceCount })
        : tBackend("status.goal.mapSourcesGeneric");
  await ctx.send({
    type: "status",
    message: planStatusMessage,
    phase: "plan",
  });
  await ctx.send({
    type: "planning_stage",
    stage: isRevision ? "revising_plan" : "sequencing_modules",
    message: planStatusMessage,
  });

  if (options.learningGoalPlan) {
    const started = await options.learningGoalPlan.beginOwnedPlan(
      userId,
      goalId,
      pathSource,
    );
    if (started.status === "not_found") {
      throw new Error("目标不存在");
    }
  } else {
    await requireAgentGoalCreationPersistence().goals.updateOwned(
      userId,
      goalId,
      { pathSource, mapPlanStatus: "pending" },
    );
  }

  let tokenBuffer = "";
  const generationOptions = await appendLearnerProfileToPromptOptions(
    goal.userId,
    [
      goal.generationOptions,
      state.topic.trim()
        ? `[User-confirmed original learning goal from intake — authoritative]\n${state.topic.trim()}`
        : "",
      isRevision && existingPlan
        ? `[Current validated plan — revise this plan in place; preserve unaffected decisions]\n${serializeMapPlan(existingPlan)}\nDo not increase the module or lesson count merely because this is a revision. Keep all unaffected module boundaries and lesson contracts. A missing entry foundation needs only the smallest coherent bridge before first use; it must not trigger a larger curriculum.`
        : "",
      adjustment
        ? `User adjustment request for the revised goal contract:\n${adjustment}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
  await seedGoalAuthoringContract({
    userId,
    goalId,
    userRequest: state.topic.trim() || goal.title,
    traceId: ctx.traceId,
    contract: {
      title: goal.title,
      level: goal.level,
      contentLanguage,
      planningMode: goal.planningMode,
      generationOptions,
      goalRelationType: state.goalRelationType,
      goalRelationContext: state.goalRelationContext,
    },
  });
  await resolveTeachingSkillForGoal({
    goalId,
    title: goal.title,
    level: goal.level,
    generationOptions,
    sourceSummary: context,
    authoringAgent: { userId },
  });
  const teachingSkill = await loadTeachingSkillPrompt(
    goalId,
    "goal_plan",
    `${goal.title} ${generationOptions}`,
  );

  const runtime = getLlmRuntimeConfig();
  const reasoningStatus = reasoningCapabilityForProvider(
    runtime.provider,
    runtime.chatModel,
  );
  if (usesBlueprintPlanning) {
    await ctx.send({
      type: "reasoning_status",
      status: "requested",
      provider: runtime.provider,
    });
    await ctx.send({
      type: "reasoning_status",
      status: reasoningStatus,
      provider: runtime.provider,
    });
  }
  if (usesBlueprintPlanning && !isRevision) {
    await ctx.send({
      type: "planning_stage",
      stage: "sequencing_modules",
      message: tBackend("status.goal.draftingModules"),
    });
  }
  const runPlan = () =>
    planGoalMapStream({
      title: goal.title,
      level: goal.level,
      context,
      pathSource,
      contentLanguage,
      generationOptions,
      teachingSkillBlock: teachingSkill?.promptBlock,
      onToken: async (delta) => {
        tokenBuffer += delta;
        await ctx.send({ type: "token", delta });
      },
      signal: ctx.signal,
      operation: usesBlueprintPlanning
        ? "goal.curriculum.plan.deep_blueprint"
        : "goal.curriculum.plan",
      authoringAgent: { userId, goalId },
      onPathProgress: createPathProgressReporter(ctx.send),
      wrapIdentity: (run) =>
        withPlanningActivity(
          ctx.send,
          {
            id: "goal_identity",
            category: "synthesis",
            startedMessage: tBackend("status.planning.identity.started"),
            pulseMessages: [
              tBackend("status.planning.identity.pulse1"),
              tBackend("status.planning.identity.pulse2"),
            ],
            completedMessage: tBackend("status.planning.identity.completed"),
            pulseIntervalMs: 8_000,
          },
          () =>
            usesBlueprintPlanning ? withOperationReasoning(true, run) : run(),
        ),
      wrapJourney: (run) =>
        withPlanningActivity(
          ctx.send,
          {
            id: "goal_journey",
            category: "synthesis",
            startedMessage: tBackend("status.planning.journey.started"),
            pulseMessages: [
              tBackend("status.planning.journey.pulse1"),
              tBackend("status.planning.journey.pulse2"),
              tBackend("status.planning.journey.pulse3"),
            ],
            completedMessage: tBackend("status.planning.journey.completed"),
            pulseIntervalMs: 8_000,
          },
          () =>
            usesBlueprintPlanning ? withOperationReasoning(true, run) : run(),
        ),
      onIdentity: async (identity) => {
        await ctx.send(
          buildPlanningOutlineEvent(
            {
              schemaVersion: 2,
              refinedTitle: identity.refinedTitle,
              domainAnalysis: identity.domainAnalysis,
              topicOverview: identity.topicOverview,
              whatYouWillLearn: identity.whatYouWillLearn,
              prerequisitesAssumed: identity.prerequisitesAssumed,
              majorAreas: [
                {
                  title: identity.domainAnalysis.subdomain,
                  description: identity.topicOverview,
                  mapRole: "branch",
                },
              ],
              mapStructure: {
                recommendedDepth: 2,
                estimatedLeafUnits: 1,
                layeringStrategy: "Modules will be sequenced next.",
                nestingRationale:
                  "Identity is frozen before the module journey is authored.",
              },
              modules: [],
              outOfScope: [],
            },
            { reusedSources: isRevision },
          ),
        );
      },
    });
  const generatedPlan = await runPlan();
  const verifiedPlan = usesBlueprintPlanning
    ? await withPlanningActivity(
        ctx.send,
        {
          id: "plan_validation",
          category: "validation",
          startedMessage: tBackend("status.planning.validation.started"),
          pulseMessages: [],
          completedMessage: tBackend("status.planning.validation.completed"),
        },
        () =>
          verifyAndRepairGoalPlan({
            plan: generatedPlan,
            goalTitle: goal.title,
            confirmedGoal: [goal.title, generationOptions]
              .filter(Boolean)
              .join("\n\n"),
            evidenceContext: context,
            signal: ctx.signal,
          }),
      )
    : generatedPlan;
  const plan =
    state.goalRelationType === "foundation_support"
      ? excludeFoundationScopeFromPlan(
          verifiedPlan,
          parseFoundationGoalItems(state.goalRelationContext),
        )
      : verifiedPlan;
  if (usesBlueprintPlanning || isRevision) {
    await ctx.send(
      buildPlanningOutlineEvent(plan, { reusedSources: isRevision }),
    );
    await ctx.send({ type: "planning_stage", stage: "validating_plan" });
  }

  const { title: refinedTitle, changed: titleChanged } =
    resolveRefinedGoalTitle(goal.title, plan.refinedTitle);
  const finalContentLanguage = titleChanged
    ? resolveGoalContentLanguage(goal.contentLanguage, refinedTitle)
    : contentLanguage;

  const revisedOptions = adjustment
    ? mergeRegenerationAdjustment(
        goal.generationOptions,
        adjustment,
        "Latest explicit learner correction (overrides only conflicting earlier requirements)",
      )
    : undefined;
  const persistPlan = async () => {
    if (options.learningGoalPlan) {
      const result = await options.learningGoalPlan.publishOwnedPlan({
        userId,
        goalId,
        title: refinedTitle,
        topicOverview: plan.topicOverview,
        mapPlanJson: serializeMapPlan(plan),
        pathSource,
        domainTag: plan.domainAnalysis.domainTag,
        topicCategory: plan.domainAnalysis.topicCategory,
        contentLanguage: finalContentLanguage,
        resetIcon: titleChanged,
        ...(revisedOptions !== undefined
          ? { generationOptions: revisedOptions }
          : {}),
      });
      if (result.status === "not_found") {
        throw new Error("目标不存在");
      }
      if (result.status === "locked") {
        throw new Error("当前学习地图已绑定学习计划，无法直接更新");
      }
      return;
    }
    await requireAgentGoalCreationPersistence().goals.updateOwned(
      userId,
      goalId,
      {
        title: refinedTitle,
        contentLanguage: finalContentLanguage,
        topicOverview: plan.topicOverview,
        mapPlanJson: serializeMapPlan(plan),
        mapPlanStatus: "ready",
        ...(revisedOptions !== undefined
          ? { generationOptions: revisedOptions }
          : {}),
        domainTag: plan.domainAnalysis.domainTag,
        topicCategory: plan.domainAnalysis.topicCategory,
        ...(titleChanged ? { iconSvg: "", iconTint: "" } : {}),
      },
    );
  };
  await persistPlan();

  if (titleChanged) {
    scheduleGoalIconGeneration(userId, goalId, refinedTitle);
  }

  return plan;
}

export async function generateSummaryForGoal(
  userId: string,
  state: GoalCreationState,
  ctx: Pick<AgentRunContext, "send" | "signal" | "threadId">,
  options: { adjustment?: string } = {},
): Promise<GoalMapSummary> {
  const goalId = state.goalId;
  if (!goalId) throw new Error("缺少 goalId");

  const goal = await requireOwnedGoal(userId, goalId);

  await ctx.send({
    type: "phase",
    phase: "generating_plan",
    subagent: "plan",
  });
  await ctx.send({
    type: "status",
    message: tBackend("status.generation.goal"),
    phase: "summary",
  });

  const contentLanguage = resolveGoalContentLanguage(
    goal.contentLanguage,
    goal.title,
  );
  const hasRag = await goalHasRagDocuments(goalId);
  const { context, pathSource, sourceCount } = await gatherGoalPathContext({
    goalId,
    title: goal.title,
    hasUpload: hasRag,
    allowWebSearch: !hasRag,
    searchPurpose: "summary",
    onKnowledgeActivity: (activity) => emitGoalKnowledgeActivity(ctx, activity),
  });
  await ctx.send({
    type: "status",
    message:
      pathSource === "rag"
        ? tBackend("status.goal.summarySourcesRag", { count: sourceCount })
        : pathSource === "search"
          ? tBackend("status.goal.summarySourcesSearch", {
              count: sourceCount,
            })
          : tBackend("status.goal.summarySourcesGeneric"),
    phase: "summary",
  });

  await requireAgentGoalCreationPersistence().goals.updateOwned(
    userId,
    goalId,
    { pathSource, mapSummaryStatus: "pending" },
  );

  const generationOptions = await appendLearnerProfileToPromptOptions(
    goal.userId,
    [
      goal.generationOptions,
      state.topic.trim()
        ? `[User-confirmed original learning goal from intake — authoritative]\n${state.topic.trim()}`
        : "",
      options.adjustment?.trim()
        ? `User adjustment request for this revised summary:\n${options.adjustment.trim()}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  );

  const summary = await planGoalSummaryStream({
    title: goal.title,
    level: goal.level,
    context,
    pathSource,
    contentLanguage,
    generationOptions,
    onToken: async (delta) => {
      await ctx.send({ type: "token", delta });
    },
    signal: ctx.signal,
  });

  const { title: refinedTitle, changed: titleChanged } =
    resolveRefinedGoalTitle(goal.title, summary.refinedTitle);
  const finalSummary = { ...summary, refinedTitle };
  const finalContentLanguage = titleChanged
    ? resolveGoalContentLanguage(goal.contentLanguage, refinedTitle)
    : contentLanguage;

  await requireAgentGoalCreationPersistence().goals.updateOwned(
    userId,
    goalId,
    {
      title: refinedTitle,
      contentLanguage: finalContentLanguage,
      topicOverview: finalSummary.topicOverview,
      mapSummaryJson: serializeMapSummary(finalSummary),
      mapSummaryStatus: "ready",
      ...(titleChanged ? { iconSvg: "", iconTint: "" } : {}),
    },
  );

  if (titleChanged) {
    scheduleGoalIconGeneration(userId, goalId, refinedTitle);
  }

  return finalSummary;
}

export async function patchGoalPlan(
  userId: string,
  goalId: string,
  patch: {
    topicOverview?: string;
    whatYouWillLearn?: string[];
    majorAreas?: GoalMapPlan["majorAreas"];
    outOfScope?: string[];
    prerequisitesAssumed?: string[];
  },
): Promise<GoalMapPlan> {
  const goal = await requireOwnedGoal(userId, goalId);

  const existing = parseMapPlan(goal.mapPlanJson);
  if (!existing) throw new Error("尚无学习计划");

  const merged = goalMapPlanSchema.parse({
    ...existing,
    topicOverview:
      typeof patch.topicOverview === "string"
        ? patch.topicOverview
        : existing.topicOverview,
    whatYouWillLearn: Array.isArray(patch.whatYouWillLearn)
      ? patch.whatYouWillLearn
      : existing.whatYouWillLearn,
    majorAreas: Array.isArray(patch.majorAreas)
      ? patch.majorAreas
      : existing.majorAreas,
    outOfScope: Array.isArray(patch.outOfScope)
      ? patch.outOfScope
      : existing.outOfScope,
    prerequisitesAssumed: Array.isArray(patch.prerequisitesAssumed)
      ? patch.prerequisitesAssumed
      : existing.prerequisitesAssumed,
  });

  await requireAgentGoalCreationPersistence().goals.updateOwned(
    userId,
    goalId,
    {
      topicOverview: merged.topicOverview,
      mapPlanJson: serializeMapPlan(merged),
      mapPlanStatus: "ready",
    },
  );

  return merged;
}

export async function approveGoalPlan(
  userId: string,
  goalId: string,
  options: GoalPlanApprovalOptions = {},
): Promise<void> {
  const goal = await requireOwnedGoal(userId, goalId);
  const plan = parseMapPlan(goal.mapPlanJson);
  if (!plan) throw new Error("请先生成学习计划");
  const contentLanguage = resolveGoalContentLanguage(
    goal.contentLanguage,
    goal.title,
  );
  if (
    plan.schemaVersion === 2 &&
    plan.modules?.some(
      (module) =>
        !curriculumModuleMatchesContentLanguage(module, contentLanguage),
    )
  ) {
    throw new Error(
      "学习计划包含与课程语言不一致的模块，请让 AI 重新调整后再确认",
    );
  }
  const boundUnitCount =
    await requireAgentGoalCreationPersistence().assistant.countGoalUnits(
      goalId,
      true,
    );
  if (boundUnitCount > 0 && goal.mapPlanStatus !== "approved") {
    throw new Error(
      "当前学习地图已绑定学习计划；如需调整范围，请使用地图替换流程",
    );
  }

  if (plan.schemaVersion === 2 && plan.modules?.length) {
    if (options.sequentialCurriculumApproval) {
      const result = await options.sequentialCurriculumApproval.persistOwned({
        userId,
        goalId,
        modules: plan.modules.map((modulePlan) => ({
          title: modulePlan.title,
          summary: modulePlan.summary,
          objective: modulePlan.objective,
          plannedOutcomes: [...modulePlan.plannedOutcomes],
          entryFoundationBriefs: modulePlan.entryFoundationBriefs.map(
            (brief) => ({
              ref: brief.ref,
              title: brief.title,
              rationale: brief.rationale,
              criticality: brief.criticality,
              verificationDimensions: [...brief.verificationDimensions],
            }),
          ),
          exitCapabilityBriefs: [...modulePlan.exitCapabilityBriefs],
          estimatedUnitCount: modulePlan.estimatedUnitCount,
          unitPlanningBrief: {
            ...modulePlan.unitPlanningBrief,
            scopeSize: modulePlan.unitPlanningBrief.scopeSize,
            rationale: modulePlan.unitPlanningBrief.rationale,
            progression: [...modulePlan.unitPlanningBrief.progression],
          },
        })),
        enqueueFirst: false,
      });
      if (result.status === "not_found") {
        throw new Error("目标不存在");
      }
    } else {
      throw new Error("Sequential curriculum persistence is not configured");
    }
    if (options.structureQueueMode === "draft") {
      const drafts = options.moduleStructureDraft ?? getModuleStructureDraft();
      if (!drafts || !options.sessionId) {
        throw new Error("Module structure draft persistence is not configured");
      }
      const createdModules = await drafts.listModuleIdsForGoal(goalId);
      const planHash = createHash("sha256")
        .update(serializeMapPlan(plan))
        .digest("hex");
      await drafts.upsertMany(
        createdModules.map((moduleId) => ({
          moduleId,
          sessionId: options.sessionId!,
          goalId,
          planHash,
          status: "queued",
        })),
      );
      await drafts.enqueuePrepareEvents({
        goalId,
        sessionId: options.sessionId,
        moduleIds: createdModules.slice(0, 1),
        reason: "starter_priority",
      });
      await drafts.enqueueCoordinateEvent({
        goalId,
        sessionId: options.sessionId,
        reason: "after_plan",
      });
      return;
    }
    if (options.moduleStructureQueue) {
      await options.moduleStructureQueue.enqueueOwned({ userId, goalId });
    } else {
      throw new Error("Module structure queue persistence is not configured");
    }
    return;
  }

  if (options.learningGoalPlan) {
    const result = await options.learningGoalPlan.approveOwnedPlan(
      userId,
      goalId,
    );
    if (result.status === "not_found") {
      throw new Error("目标不存在");
    }
    if (result.status === "locked") {
      throw new Error("学习计划已经确认");
    }
    return;
  }

  await requireAgentGoalCreationPersistence().goals.updateOwned(
    userId,
    goalId,
    { mapPlanStatus: "approved" },
  );
}

export async function approveGoalSummary(
  userId: string,
  goalId: string,
  fallbackSummary?: GoalMapSummary | null,
): Promise<void> {
  const goal = await requireOwnedGoal(userId, goalId);

  let summary =
    parseMapSummary(goal.mapSummaryJson) ??
    (fallbackSummary ? coerceGoalMapSummary(fallbackSummary) : null);

  if (!summary) throw new Error("请先生成学习地图摘要");

  const data: {
    mapSummaryStatus: "approved";
    topicOverview?: string;
    mapSummaryJson?: string;
    title?: string;
  } = { mapSummaryStatus: "approved" };

  if (!parseMapSummary(goal.mapSummaryJson)) {
    data.topicOverview = summary.topicOverview;
    data.mapSummaryJson = serializeMapSummary(summary);
    if (summary.refinedTitle) {
      data.title = summary.refinedTitle;
    }
  }

  await requireAgentGoalCreationPersistence().goals.updateOwned(
    userId,
    goalId,
    data,
  );
}

export async function decomposeGoalMap(
  userId: string,
  state: GoalCreationState,
  ctx: AgentRunContext,
  options: {
    legacyMapReplacement?: LegacyMapReplacementRepository;
    cognitiveModelInvalidation?: CognitiveModelInvalidationRepository;
  } = {},
): Promise<{
  goalId: string;
  unitCount: number;
  complete: boolean;
  modulesNeedingExpansion?: Array<{ id: string; title: string }>;
}> {
  if (!options.legacyMapReplacement || !options.cognitiveModelInvalidation) {
    throw new Error("Goal map persistence is unavailable");
  }
  const goalId = state.goalId;
  if (!goalId) throw new Error("缺少 goalId");

  const goal = await requireOwnedGoal(userId, goalId);

  await cancelActiveRuns("goal", goalId, "goal.map");
  const runId = await createGenerationRun({
    scope: "goal",
    scopeId: goalId,
    operation: "goal.map",
  });

  const toGenerationRunEvent = (event: AgentSseEvent): SseEvent | null => {
    switch (event.type) {
      case "status":
      case "token":
      case "progress":
      case "done":
      case "error":
      case "cancelled":
      case "reasoning_status":
      case "planning_stage":
      case "planning_outline":
      case "research_query":
      case "module_research_progress":
      case "planning_warning":
        return event;
      default:
        return null;
    }
  };

  const send = async (event: AgentSseEvent) => {
    const runEvent = toGenerationRunEvent(event);
    if (runEvent) await appendRunEvent(runId, runEvent);
    try {
      await ctx.send(event);
    } catch (error) {
      console.warn(
        "[goal-creation] failed to send assistant map event:",
        error instanceof Error ? error.message : error,
      );
    }
  };

  try {
    await send({ type: "phase", phase: "decomposing", subagent: "plan" });
    await send({
      type: "status",
      message: tBackend("status.generation.path"),
      phase: "map",
    });

    const contentLanguage = resolveGoalContentLanguage(
      goal.contentLanguage,
      goal.title,
    );
    const mapPlan = parseMapPlan(goal.mapPlanJson) ?? undefined;
    if (!mapPlan || goal.mapPlanStatus !== "approved") {
      throw new Error("请先整理并确认学习计划");
    }
    const mapSummary =
      state.mapSummary ?? parseMapSummary(goal.mapSummaryJson) ?? undefined;
    const hasRag = await goalHasRagDocuments(goalId);

    let pathSource = (goal.pathSource ?? "generic") as
      "rag" | "search" | "generic";
    const gathered = await gatherGoalPathContext({
      goalId,
      title: goal.title,
      hasUpload: hasRag,
      allowWebSearch: !hasRag,
      searchPurpose: "map",
      onKnowledgeActivity: (activity) =>
        emitGoalKnowledgeActivity({ send }, activity),
    });
    const context = gathered.context;
    pathSource = gathered.pathSource;
    await send({
      type: "status",
      message:
        pathSource === "rag"
          ? tBackend("status.goal.mapSourcesRag", {
              count: gathered.sourceCount,
            })
          : pathSource === "search"
            ? tBackend("status.goal.mapSourcesSearch", {
                count: gathered.sourceCount,
              })
            : tBackend("status.goal.mapSourcesGeneric"),
      phase: "map",
    });

    const generationOptions = await appendLearnerProfileToPromptOptions(
      goal.userId,
      goal.generationOptions,
    );

    const result = await decomposeGoalStream({
      title: goal.title,
      level: goal.level,
      context,
      pathSource,
      contentLanguage,
      generationOptions,
      mapPlan,
      mapSummary,
      onToken: async (delta) => {
        await send({ type: "token", delta });
      },
      signal: ctx.signal,
    });

    const { units } = await persistDecomposeResult({
      userId,
      goalId,
      title: goal.title,
      level: goal.level,
      pathSource,
      contentLanguage,
      detailedPlanStatus: "ready",
      result,
      legacyMapReplacement: options.legacyMapReplacement,
      cognitiveModelInvalidation: options.cognitiveModelInvalidation,
    });

    const finalUnitCount =
      await requireAgentGoalCreationPersistence().assistant.countGoalUnits(
        goalId,
      );
    const done = {
      type: "done" as const,
      goalId,
      pathSource,
      contentLanguage,
      unitCount: finalUnitCount,
    };
    await appendRunEvent(runId, done);
    await completeGenerationRun(runId, done);
    try {
      await ctx.send(done);
    } catch (error) {
      console.warn(
        "[goal-creation] failed to send assistant map done event:",
        error instanceof Error ? error.message : error,
      );
    }

    return {
      goalId,
      unitCount: finalUnitCount || units.length,
      complete: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "学习地图生成失败";
    await failGenerationRun(runId, message);
    throw error;
  }
}

export async function generateOverviewCourseForGoal(
  userId: string,
  state: GoalCreationState,
  ctx: AgentRunContext,
  options: {
    overviewCoursePublication?: OverviewCoursePublicationRepository;
  } = {},
): Promise<{ navigateTo: string; overviewCourseStatus: string }> {
  const goalId = state.goalId;
  if (!goalId) throw new Error("缺少 goalId");

  const goal = await requireOwnedGoal(userId, goalId).catch(() => {
    throw new Error("目标不存在或无权访问");
  });

  if (options.overviewCoursePublication) {
    const started =
      await options.overviewCoursePublication.beginOwnedOverviewCourse(
        userId,
        goalId,
      );
    if (started.status === "not_found") {
      throw new Error("目标不存在或无权访问");
    }
  } else {
    await requireAgentGoalCreationPersistence().goals.updateOwned(
      userId,
      goalId,
      { overviewCourseStatus: "pending" },
    );
  }
  await ctx.send({
    type: "status",
    message: tBackend("status.generation.overview"),
    phase: "overview",
  });

  const branchRows =
    await requireAgentGoalCreationPersistence().assistant.listGoalOverviewBranches(
      goalId,
    );
  const branches = branchRows.map((row) => ({
    title: row.title,
    summary: row.contentSummary,
  }));

  if (!options.overviewCoursePublication) {
    throw new Error("Overview-course persistence is not configured");
  }
  const published = await persistOverviewCourseShellForGoal(goalId, {
    userId,
    title: goal.title,
    topicOverview: goal.topicOverview,
    branches,
    overviewCoursePublication: options.overviewCoursePublication,
  });
  const navigateTo = `/goals/${goalId}/units/${published.unitId}`;
  await ctx.send({
    type: "done",
    goalId,
    navigateTo,
    inline: true,
  });
  return { navigateTo, overviewCourseStatus: "ready" };
}

export function formatLanguageLabel(code: string): string {
  return getContentLanguageLabel(
    code as Parameters<typeof getContentLanguageLabel>[0],
  );
}
