import { z } from "zod";
import {
  verifyAndRepairAssessmentQuestions,
  verifyAndRepairSurvey,
  learningTargetContextFromSqJson,
  type ContentVerificationResult,
} from "../content-verification/index.js";
import { recordBackendError } from "../observability/index.js";
import type { ImageEnrichProgress } from "../images/enrich-material.js";
import {
  enrichMaterialWithImages,
  stripIllustrationBlocksIfDisabled,
} from "../images/enrich-material.js";
import { isImageGenerationAvailable } from "../images/providers/index.js";
import type { StreamTokenHandler } from "../llm/chat-stream.js";
import { formatStructuredParseError } from "../llm/parse-structured.js";
import { runValidatedStructuredGeneration } from "../llm/validated-structured-generation.js";
import { buildAssessmentInvocationPrompt } from "../learning-systems/capabilities/assessment-runtime.js";
import { ASSESSMENT_GENERATION_VIEW_KEYS } from "../learning-systems/capabilities/assessment-generation-keys.js";
import { buildUnitContentInvocationPrompt } from "../learning-systems/capabilities/unit-content/capability.js";
import {
  extraDisabledMaterialTypesForRuiyanShadowDev,
  isDesktopDevRuiyanShadowIllustrationMode,
  isDesktopDevRuiyanShadowGuidedImageMode,
} from "../learning-systems/capabilities/unit-content/material-prompt.js";
import { UNIT_CONTENT_VIEW_KEYS } from "../learning-systems/capabilities/unit-content/keys.js";
import {
  formatOverviewCatalogBlock,
  overviewOrientationStagePrompt,
  resolveOverviewCourseMode,
  type GoalOverviewBranch,
} from "../goals/generate-overview-course.js";
import { appendContentMarkupRules } from "../llm/content-markup.js";
import {
  assembleSqItems,
  flashcardJitItemBindingSchema,
  flashcardJitItemSchema,
  materialToJitItems,
  type CornellJitItem,
  type MaterialJitItem,
  quizJitItemBindingSchema,
  quizJitItemSchema,
  type SqJitItem,
} from "../llm/jit-structured-items.js";
import {
  buildCornellHistoryContinuationPrompt,
  cornellHistoryResultSchema,
  cornellItemsFromCommitArgs,
  prepareCornellAuthoring,
} from "../cornell/authoring.js";
import {
  compactMaterialJsonArg,
  compactSqJsonArg,
} from "../llm/compact-json.js";
import {
  getLanguagePromptInstruction,
  resolveGoalContentLanguage,
} from "../llm/content-language.js";
import {
  buildPlanContextWithLearnerProfile,
  type PlanContext,
} from "../llm/context/plan-context.js";
import {
  learningMaterialSchema,
  sqPreviewSchema,
  diagnosticQuizSchema,
  flashCardDeckSchema,
  type FlashCardDraft,
  type QuizQuestion,
} from "../llm/schemas.js";
import {
  buildUnitSessionContext,
  buildUnitSessionContextWithSources,
} from "../domain/unit-map-context.js";
import { type QuizDifficulty } from "../learning-systems/capabilities/assessment-runtime/quiz-prompt.js";
import { type QuizBatchPlan } from "../quiz/batch-planner.js";
import type { LearnerStateMemoryInvalidationRepository } from "../../../domain/src/index.js";
import { prepareUnitQuizAuthoring } from "../quiz/authoring.js";
import { UNIT_SHARED_CONTEXT_REUSE_LINE } from "./unit-session-prompts.js";
import {
  getMissingDiagnosticQuestions,
  type DiagnosticQuizQuestion,
} from "./diagnostic-quiz-repair.js";
import {
  buildBoundedReferencePromptSection,
  stripLearningMaterialCitationMarkers,
} from "../citations/inline-citations.js";
import { getUnitModulePromptBlock } from "../goals/module-prompt-context.js";
import {
  loadTeachingSkillPrompt,
  resolveTeachingSkillForGoal,
} from "../teaching-skills/index.js";
import {
  expandUnitCognitiveModel,
  getUnitLearningTargetsV2,
} from "../cognitive-model/index.js";
import { type SqPreviewDslPartial } from "../llm/sq-preview-dsl.js";
import {
  resolveMaterialComponentSelection,
  selectComponentCategories,
} from "../llm/select-component-categories.js";
import { materialGenerationPolicyFromSelection, defaultComponentSelectionForTopic } from "../llm/component-dsl-registry.js";
import { getDisabledMaterialComponentTypes } from "../llm/material-component-settings.js";
import {
  alignQuizQuestionsToDeclaredEvidence,
  validateAdaptiveQuizRequirementCoverage,
  type UnitAssessmentTarget,
} from "../assessment/activities.js";
import { prepareUnitDiagnosticAuthoring } from "../assessment/unit-diagnostic-authoring.js";
import { prepareModuleDiagnosticAuthoring } from "../assessment/module-diagnostic-authoring.js";
import { type CornellDslPartial } from "../llm/cornell-dsl.js";
import { type QuizCompactStreamPartial } from "../llm/quiz-compact-stream.js";
import type { ContentSource } from "../rag/content-sources.js";
import { retrieveContextForUnit } from "../rag/retrieve.js";
import { ensureImageRuntimeConfig } from "../images/runtime-config.js";
import { cognitiveModelPersistence } from "../cognitive-model/persistence.js";
import { unitGenerationContextPersistence } from "./unit-session.js";
import { hasGoalCoursePattern } from "../llm/generation-options.js";
import { resolveGoalGenerationOptionsWithPattern } from "../llm/goal-course-pattern.js";
import { FEATURE_COURSE_PATTERN } from "../features.js";
import {
  applyCanonicalLearningTargetsToSq,
  assertCanonicalLearningTargetsFitLesson,
  type CanonicalSqlearningTarget,
} from "./canonical-sq.js";
import { shouldEmitMaterialPartialSnapshot } from "./material-partial-emission.js";
import { executeOperation } from "../generation/execution/index.js";
import { OperationExecutionError } from "../generation/execution/context.js";
import { hashArtifactContext } from "../generation/execution/artifact-workflow.js";
import {
  learningMaterialOperation,
  sectionPlanOperation,
  surveyOperation,
} from "../generation/execution/structured-operations.js";
import {
  attachSurveySectionPlan,
  fallbackExplorationSectionPlan,
} from "../survey/section-plan.js";
import {
  runComponentSelectionAuthoringAgent,
  runUnitAuthoringHistoryBoundCall,
  unitAuthoringAgentEnabled,
} from "../unit-authoring/runner.js";

function unitLlmMeta(
  plan: PlanContext,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...extra,
    topicCategory: plan.topicCategory,
    goalTitle: plan.goalTitle,
  };
}

type GoalPromptFields = {
  id: string;
  contentLanguage: string;
  title: string;
  level?: string;
  generationOptions?: string;
  goalKind?: string | null;
  userId?: string | null;
  topicCategory?: string | null;
  mapPlanJson?: string | null;
};

function generationContextSubject(goal: GoalPromptFields, unitId?: string) {
  return {
    userId: goal.userId ?? undefined,
    goalId: goal.id,
    unitId,
  };
}

function unitArtifactSequenceId(goalId: string, unitId: string): string {
  return `unit-content:${hashArtifactContext(`${goalId}:${unitId}`).slice(0, 24)}`;
}

async function planForGoal(goal: GoalPromptFields): Promise<PlanContext> {
  let generationOptions = goal.generationOptions;
  if (FEATURE_COURSE_PATTERN && !hasGoalCoursePattern(generationOptions)) {
    generationOptions = await resolveGoalGenerationOptionsWithPattern({
      title: goal.title,
      level: goal.level ?? "zero",
      contentLanguage: resolveGoalContentLanguage(
        goal.contentLanguage,
        goal.title,
      ),
      generationOptions,
      isSmallCourse: goal.goalKind === "micro",
    });
    goal.generationOptions = generationOptions;
    await unitGenerationContextPersistence()
      .updateGenerationOptions({ goalId: goal.id, generationOptions })
      .catch((error: unknown) => {
        console.error("Failed to persist goal course pattern", error);
        void recordBackendError({
          source: "internal",
          service: "learning-service",
          error,
          operation: "persist-goal-course-pattern",
        });
      });
  }

  let userId = goal.userId;
  if (!userId) {
    const storedGoal = await unitGenerationContextPersistence().findGoal(
      goal.id,
    );
    userId = storedGoal?.userId ?? null;
    goal.userId = userId;
  }

  return buildPlanContextWithLearnerProfile({
    id: goal.id,
    title: goal.title,
    level: goal.level ?? "zero",
    contentLanguage: goal.contentLanguage,
    generationOptions: goal.generationOptions,
    topicCategory: goal.topicCategory,
    mapPlanJson: goal.mapPlanJson,
    userId,
  });
}

export async function streamGenerateSqPreview(
  goal: GoalPromptFields & { id: string },
  unitId: string,
  unitTitle: string,
  summary: string,
  onToken?: StreamTokenHandler,
  signal?: AbortSignal,
  streamOptions?: {
    onPartialSq?: (partial: SqPreviewDslPartial) => void | Promise<void>;
    canonicalLearningTargets?: CanonicalSqlearningTarget[];
    onVerificationStart?: () => void | Promise<void>;
    onVerificationComplete?: (
      result: ContentVerificationResult,
    ) => void | Promise<void>;
    onRepairApplied?: (
      patches: Array<{ index: number; kind: string; content: unknown }>,
    ) => void | Promise<void>;
    onAcceptedSq?: (
      sq: z.infer<typeof sqPreviewSchema>,
    ) => void | Promise<void>;
    onSectionPlanStart?: () => void | Promise<void>;
    generationRunId?: string;
    learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository;
  },
) {
  let canonicalPoints: CanonicalSqlearningTarget[] =
    streamOptions?.canonicalLearningTargets ?? [];
  if (!streamOptions?.canonicalLearningTargets) {
    const persistence = cognitiveModelPersistence();
    if (!persistence)
      throw new Error("Cognitive-model persistence is not configured");
    await expandUnitCognitiveModel(null, unitId, {
      signal,
      learnerStateMemoryInvalidation:
        streamOptions?.learnerStateMemoryInvalidation,
    });
    const result = await getUnitLearningTargetsV2(undefined, unitId, {
      ...(goal.userId ? { userId: goal.userId } : {}),
      presentationRead: persistence.presentationRead,
    });
    canonicalPoints = result.learningTargets;
  }
  assertCanonicalLearningTargetsFitLesson(canonicalPoints, {
    contentLanguage: goal.contentLanguage,
    unitTitle,
    contentSummary: summary,
  });
  if (canonicalPoints.length > 0 && streamOptions?.onPartialSq) {
    await streamOptions.onPartialSq({
      sq: applyCanonicalLearningTargetsToSq(
        {
          survey: { outline: [], learningTargetLabels: [] },
          learningTargets: [],
          questions: [],
        },
        canonicalPoints,
        {
          contentLanguage: goal.contentLanguage,
          unitTitle,
          contentSummary: summary,
        },
      ),
      completeLineCount: canonicalPoints.length,
    });
  }
  const context = await buildUnitSessionContext(
    goal.id,
    unitId,
    unitTitle,
    summary,
  );
  const plan = await planForGoal(goal);
  const moduleContext = await getUnitModulePromptBlock(unitId);
  const options = plan.optionsBlock();
  let lastPartialLineCount = canonicalPoints.length;
  const canonicalTargetBlock = canonicalPoints
    .map(
      (point) =>
        `${point.localRef}: ${point.title} — ${point.description ?? ""}; objective: ${point.learningObjective}; criteria: ${point.assessmentCriteria.join("; ")}`,
    )
    .join("\n");
  const sectionPlanningMode =
    canonicalPoints.length > 0
      ? ("kacom" as const)
      : goal.goalKind === "micro"
        ? ("micro" as const)
        : ("exploration" as const);
  const componentSelection = await selectComponentCategories({
    unitTitle,
    summary,
    context,
    learningTargets: canonicalTargetBlock,
    topicCategory: plan.topicCategory,
    extraDisabledComponentTypes:
      extraDisabledMaterialTypesForRuiyanShadowDev(plan),
    contextSubject: generationContextSubject(goal, unitId) as {
      userId?: string;
      goalId: string;
      unitId: string;
    },
    signal,
    authorSelection:
      unitAuthoringAgentEnabled() && goal.userId
        ? ({ prompt, resultSchema, contextInvocation }) =>
            runComponentSelectionAuthoringAgent({
              userId: goal.userId!,
              goalId: goal.id,
              unitId,
              prompt,
              resultSchema,
              contextSubject: generationContextSubject(goal, unitId),
              contextQuery: `${unitTitle}: ${summary}`.slice(0, 2_000),
              contextInvocation,
              signal,
              meta: unitLlmMeta(plan, { goalId: goal.id, unitTitle }),
            })
        : undefined,
  });
  const emitSqPartial = async (items: SqJitItem[]) => {
    if (!streamOptions?.onPartialSq) return;
    let sq;
    try {
      const completeOutlineCount = items.filter(
        (item) => item.kind === "outline",
      ).length;
      sq = applyCanonicalLearningTargetsToSq(
        assembleSqItems(items, [], {
          includeSectionOutline:
            canonicalPoints.length > 0 && completeOutlineCount >= 2,
          includeSectionPlan: false,
        }),
        canonicalPoints,
        {
          contentLanguage: goal.contentLanguage,
          unitTitle,
          contentSummary: summary,
        },
      );
    } catch {
      return;
    }
    const visibleLineCount =
      canonicalPoints.length + sq.survey.outline.length + sq.questions.length;
    if (visibleLineCount <= lastPartialLineCount) return;
    lastPartialLineCount = visibleLineCount;
    await streamOptions.onPartialSq({
      completeLineCount: visibleLineCount,
      sq,
    });
  };
  const verificationTargets = canonicalPoints
    .map(
      (point) =>
        `${point.title} — ${point.description ?? ""}; objective: ${point.learningObjective}; criteria: ${point.assessmentCriteria.join("; ")}`,
    )
    .join("\n");
  const execution = await executeOperation(
    surveyOperation,
    {
      unitTitle,
      goalBlock: plan.goalBlock(),
      difficultyBlock: plan.difficultyBlock(),
      styleBlock: plan.styleBlock(),
      languageBlock: plan.languageBlock(),
      optionsBlock: options,
      context,
      canonicalLearningTargetsBlock: canonicalTargetBlock,
      moduleContext,
      sharedContextReuseLine: UNIT_SHARED_CONTEXT_REUSE_LINE,
      sectionPlanningMode,
      finalizeSurvey: (draft: z.infer<typeof sqPreviewSchema>) =>
        sqPreviewSchema.parse(
          applyCanonicalLearningTargetsToSq(draft, canonicalPoints, {
            contentLanguage: goal.contentLanguage,
            unitTitle,
            contentSummary: summary,
          }),
        ),
      componentSelection,
      ...(unitAuthoringAgentEnabled() && goal.userId
        ? {
            authoringAgent: {
              userId: goal.userId,
              goalId: goal.id,
              unitId,
            },
          }
        : {}),
      contextSubject: generationContextSubject(goal, unitId),
      contextQuery: `${unitTitle}: ${summary}`.slice(0, 2_000),
      meta: unitLlmMeta(plan, { goalId: goal.id, unitTitle }),
      artifactContext: {
        sequenceId: unitArtifactSequenceId(goal.id, unitId),
        entries: [],
      },
      verification: {
        unitTitle,
        objective: summary,
        learningTargets: verificationTargets,
        evidenceContext: context,
        generationRunId: streamOptions?.generationRunId,
      },
    },
    {
      subject: generationContextSubject(goal, unitId),
      signal,
      events: {
        emit: async (event) => {
          if (event.type === "token") {
            await onToken?.(event.token);
          } else if (event.type === "partial") {
            await emitSqPartial(
              (event.payload as { items: SqJitItem[] }).items,
            );
          } else if (event.type === "verification") {
            if (event.status === "started") {
              await streamOptions?.onVerificationStart?.();
            } else if (
              event.status === "passed" ||
              event.status === "repaired" ||
              event.status === "shadow_issues" ||
              event.status === "skipped_error"
            ) {
              await streamOptions?.onVerificationComplete?.(
                event.status as ContentVerificationResult,
              );
              if (event.status === "repaired") {
                await streamOptions?.onRepairApplied?.(
                  (event.repairedIndexes ?? []).map((index) => ({
                    index,
                    kind: "survey",
                    content: undefined,
                  })),
                );
              }
            }
          }
        },
      },
    },
  );
  const acceptedSq = execution.output;
  if (sectionPlanningMode !== "exploration") return acceptedSq;
  await streamOptions?.onAcceptedSq?.(acceptedSq);
  await streamOptions?.onSectionPlanStart?.();
  try {
    const planned = await executeOperation(
      sectionPlanOperation,
      {
        unitTitle,
        outline: acceptedSq.survey.outline,
        questions: acceptedSq.questions.map((question) => question.text),
        languageBlock: plan.languageBlock(),
        ...(unitAuthoringAgentEnabled() && goal.userId
          ? {
              authoringAgent: {
                userId: goal.userId,
                goalId: goal.id,
                unitId,
              },
            }
          : {}),
        contextSubject: generationContextSubject(goal, unitId),
        contextQuery: `${unitTitle}: ${summary}`.slice(0, 2_000),
        meta: unitLlmMeta(plan, { goalId: goal.id, unitTitle }),
        artifactContext: {
          sequenceId: unitArtifactSequenceId(goal.id, unitId),
          entries: [
            {
              stage: "survey",
              kind: "related_artifact" as const,
              summary: "Use the frozen Survey outline; do not rewrite it.",
              contentHash: hashArtifactContext(
                JSON.stringify(acceptedSq.survey.outline),
              ),
            },
          ],
        },
      },
      {
        subject: generationContextSubject(goal, unitId),
        signal,
      },
    );
    return attachSurveySectionPlan(acceptedSq, planned.output);
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError") ||
      (error instanceof OperationExecutionError &&
        error.evidence.status === "cancelled")
    ) {
      throw error;
    }
    return attachSurveySectionPlan(
      acceptedSq,
      fallbackExplorationSectionPlan(acceptedSq.survey.outline),
    );
  }
}

export async function streamGenerateLearningMaterialText(
  goal: GoalPromptFields & { id: string },
  unitId: string,
  unitTitle: string,
  summary: string,
  sqJson: string,
  onToken?: StreamTokenHandler,
  signal?: AbortSignal,
  streamOptions?: {
    onPartialMaterial?: (partial: {
      material: z.infer<typeof learningMaterialSchema>;
      completeBlockCount: number;
      placeholderBlockCount?: number;
    }) => void | Promise<void>;
    previousSectionContext?: string;
    sectionBoundaryContext?: string;
    sectionId?: string;
    onVerificationStart?: () => void | Promise<void>;
    onVerificationComplete?: (
      result: ContentVerificationResult,
    ) => void | Promise<void>;
    onRepairApplied?: (
      patches: Array<{ index: number; kind: string; content: unknown }>,
    ) => void | Promise<void>;
    generationRunId?: string;
    orientationLesson?: {
      topicOverview: string;
      branches: GoalOverviewBranch[];
    };
    force?: boolean;
    rewriteTopicId?: string;
    rewriteTopicIndex?: number;
    publishedMaterial?: z.infer<typeof learningMaterialSchema>;
  },
): Promise<{
  material: z.infer<typeof learningMaterialSchema>;
  contextSources: ContentSource[];
  contentLanguage: PlanContext["langCode"];
  materialSourceItems: MaterialJitItem[];
}> {
  const { context, sources } = await buildUnitSessionContextWithSources(
    goal.id,
    unitId,
    unitTitle,
    summary,
  );
  const referenceSection = buildBoundedReferencePromptSection(context, sources);
  const plan = await planForGoal(goal);
  const moduleContext = await getUnitModulePromptBlock(unitId);
  await resolveTeachingSkillForGoal({
    goalId: goal.id,
    title: goal.title,
    level: goal.level ?? "zero",
    generationOptions: goal.generationOptions,
    sourceSummary: summary,
  });
  const teachingSkill = await loadTeachingSkillPrompt(
    goal.id,
    "unit_content",
    `${goal.title} ${unitTitle} ${summary}`,
  );
  const langCode = plan.langCode;
  const planOptions = plan.optionsBlock();
  await ensureImageRuntimeConfig();
  const isRuiyanShadowDev = isDesktopDevRuiyanShadowIllustrationMode(plan);
  const extraDisabled = extraDisabledMaterialTypesForRuiyanShadowDev(plan);
  const imagesEnabled = isRuiyanShadowDev || isImageGenerationAvailable();
  const orientationLesson = streamOptions?.orientationLesson;
  const componentSelection = orientationLesson
    ? defaultComponentSelectionForTopic(plan.topicCategory)
    : await resolveMaterialComponentSelection({
        sqJson,
        unitTitle,
        summary,
        context,
        topicCategory: plan.topicCategory,
        extraDisabledComponentTypes: extraDisabled,
        contextSubject: generationContextSubject(goal, unitId) as {
          userId?: string;
          goalId: string;
          unitId: string;
        },
        signal,
      });
  const disabledMaterialComponentTypes = [
    ...(await getDisabledMaterialComponentTypes().catch(() => [])),
    ...extraDisabled,
  ];
  let lastPartialAt = 0;
  let lastPartialBlockCount = 0;
  let lastPartialPlaceholderCount = 0;
  const emitPartialMaterial = async (partial: {
    material: z.infer<typeof learningMaterialSchema>;
    completeBlockCount: number;
    placeholderBlockCount: number;
  }) => {
    if (!streamOptions?.onPartialMaterial) return;
    const now = Date.now();
    if (
      !shouldEmitMaterialPartialSnapshot({
        now,
        lastEmittedAt: lastPartialAt,
        completeBlockCount: partial.completeBlockCount,
        lastCompleteBlockCount: lastPartialBlockCount,
        placeholderBlockCount: partial.placeholderBlockCount,
        lastPlaceholderBlockCount: lastPartialPlaceholderCount,
      })
    ) {
      return;
    }
    lastPartialAt = now;
    lastPartialBlockCount = partial.completeBlockCount;
    lastPartialPlaceholderCount = partial.placeholderBlockCount;
    await streamOptions.onPartialMaterial({
      material: stripIllustrationBlocksIfDisabled(
        stripLearningMaterialCitationMarkers(partial.material),
      ),
      completeBlockCount: partial.completeBlockCount,
      placeholderBlockCount: partial.placeholderBlockCount,
    });
  };
  const promptInvocation = {
    unitTitle,
    plan,
    optionsBlock: planOptions,
    sqJson: orientationLesson ? "{}" : sqJson,
    referenceSection,
    previousSectionContext: streamOptions?.previousSectionContext,
    sectionBoundaryContext: streamOptions?.sectionBoundaryContext,
    includeImages: imagesEnabled,
    isMicroCourse: goal.goalKind === "micro",
    componentSelection,
    disabledMaterialComponentTypes,
    moduleContext,
    teachingSkillBlock: teachingSkill?.promptBlock,
    omitSurvey: Boolean(orientationLesson),
    orientationPreface: orientationLesson
      ? overviewOrientationStagePrompt({
          title: goal.title,
          topicOverview: orientationLesson.topicOverview,
          catalogBlock: formatOverviewCatalogBlock(orientationLesson.branches),
          mode: resolveOverviewCourseMode(orientationLesson.branches),
        })
      : undefined,
  };
  const generationPolicy = materialGenerationPolicyFromSelection(
    componentSelection,
    plan.topicCategory,
    imagesEnabled,
    disabledMaterialComponentTypes,
    isRuiyanShadowDev
      ? {
          maxIllustrationCount: 12,
          replaceInLessonVisualsWithIllustrations: true,
        }
      : undefined,
  );
  const materialPrompt =
    buildUnitContentInvocationPrompt(
      UNIT_CONTENT_VIEW_KEYS.materialInstructionContext,
      promptInvocation,
    ) ?? "";
  const execution = await executeOperation(
    learningMaterialOperation,
    {
      prompt: materialPrompt,
      generationPolicy,
      componentContext: {
        unitTitle,
        language: langCode,
        context,
        ...(goal.userId
          ? {
              authoringScope: {
                userId: goal.userId,
                goalId: goal.id,
                unitId,
              },
            }
          : {}),
      },
      contextSubject: generationContextSubject(goal, unitId),
      contextQuery: `${unitTitle}: ${summary}`.slice(0, 2_000),
      contextInvocation: promptInvocation,
      meta: unitLlmMeta(plan, {
        goalId: goal.id,
        unitTitle,
        outputFormat: "structured_material_envelope",
        teachingSkill: teachingSkill
          ? `${teachingSkill.slug}@${teachingSkill.version}`
          : undefined,
        teachingSkillHash: teachingSkill?.contentHash,
      }),
      artifactContext: {
        sequenceId: unitArtifactSequenceId(goal.id, unitId),
        entries: orientationLesson
          ? [
              {
                stage: "orientation",
                kind: "related_artifact",
                summary:
                  "This orientation lesson has no Survey. Author one teaching section from the goal catalog and topic overview.",
                contentHash: hashArtifactContext(
                  JSON.stringify({
                    title: goal.title,
                    topicOverview: orientationLesson.topicOverview,
                    branches: orientationLesson.branches,
                  }),
                ),
              },
            ]
          : [
              {
                stage: "survey",
                kind: "related_artifact",
                summary:
                  "The Survey embedded in the material request is the frozen authoritative predecessor. Preserve its section order, learning-target identities, and learner-facing scope.",
                contentHash: hashArtifactContext(sqJson),
              },
            ],
      },
      verification: {
        unitTitle,
        objective: summary,
        learningTargets: orientationLesson
          ? ""
          : learningTargetContextFromSqJson(sqJson),
        evidenceContext: context,
        generationRunId: streamOptions?.generationRunId,
      },
      authoringAgent:
        unitAuthoringAgentEnabled() && goal.userId && (streamOptions?.sectionId || isDesktopDevRuiyanShadowGuidedImageMode(plan))
          ? {
              userId: goal.userId,
              goalId: goal.id,
              unitId,
              sectionId: streamOptions?.sectionId ?? "__unit_material__",
              skipSurvey: Boolean(orientationLesson) || !streamOptions?.sectionId,
              force: Boolean(streamOptions?.force),
              rewriteTopicId: streamOptions?.rewriteTopicId,
              rewriteTopicIndex: streamOptions?.rewriteTopicIndex,
              publishedMaterial: streamOptions?.publishedMaterial,
              languageBlock: plan.languageBlock(),
              guidedImagePersonaRef: isDesktopDevRuiyanShadowGuidedImageMode(plan) ? plan.teachingPersonaRef : undefined,
            }
          : undefined,
    },
    {
      subject: generationContextSubject(goal, unitId),
      signal,
      events: {
        emit: async (event) => {
          if (event.type === "token") {
            await onToken?.(event.token);
          } else if (event.type === "partial") {
            await emitPartialMaterial(
              event.payload as {
                material: z.infer<typeof learningMaterialSchema>;
                completeBlockCount: number;
                placeholderBlockCount: number;
              },
            );
          } else if (event.type === "verification") {
            if (event.status === "started") {
              await streamOptions?.onVerificationStart?.();
            } else if (
              event.status === "passed" ||
              event.status === "repaired" ||
              event.status === "shadow_issues" ||
              event.status === "skipped_error"
            ) {
              await streamOptions?.onVerificationComplete?.(
                event.status as ContentVerificationResult,
              );
              if (event.status === "repaired") {
                await streamOptions?.onRepairApplied?.(
                  event.patches ??
                    (event.repairedIndexes ?? []).map((index) => ({
                      index,
                      kind: "material",
                      content: undefined,
                    })),
                );
              }
            }
          }
        },
      },
    },
  );
  const material = execution.output;
  return {
    material,
    contextSources: sources,
    contentLanguage: langCode,
    materialSourceItems: materialToJitItems(material),
  };
}

export async function streamGenerateLearningMaterial(
  goal: GoalPromptFields & { id: string },
  unitId: string,
  unitTitle: string,
  summary: string,
  sqJson: string,
  onToken?: StreamTokenHandler,
  signal?: AbortSignal,
  onImageProgress?: (progress: ImageEnrichProgress) => void | Promise<void>,
): Promise<{
  material: z.infer<typeof learningMaterialSchema>;
  contextSources: ContentSource[];
}> {
  const {
    material: cited,
    contextSources,
    contentLanguage,
  } = await streamGenerateLearningMaterialText(
    goal,
    unitId,
    unitTitle,
    summary,
    sqJson,
    onToken,
    signal,
  );
  const material = await enrichMaterialWithImages(
    cited,
    unitId,
    {
      goalId: goal.id,
      unitTitle,
      contentLanguage,
    },
    {
      onStart: onImageProgress
        ? async (total) => {
            await onImageProgress({
              current: 0,
              total,
              caption: "",
            });
          }
        : undefined,
      onProgress: onImageProgress,
      signal,
    },
  );
  return { material, contextSources };
}

export async function streamGenerateCornell(
  goal: GoalPromptFields & { id: string },
  unitTitle: string,
  sqJson: string,
  materialJson: string,
  onToken?: StreamTokenHandler,
  signal?: AbortSignal,
  streamOptions?: {
    onPartialCornell?: (partial: CornellDslPartial) => void | Promise<void>;
    unitId?: string;
  },
) {
  const context = await retrieveContextForUnit(goal.id, unitTitle);
  const plan = await planForGoal(goal);
  const options = plan.optionsBlock();
  let lastPartialAt = 0;
  let lastPartialLineCount = 0;
  const emitCornellPartial = async (items: CornellJitItem[]) => {
    if (!streamOptions?.onPartialCornell) return;
    const now = Date.now();
    const lineDelta = items.length - lastPartialLineCount;
    if (now - lastPartialAt < 120 && lineDelta < 2) return;
    lastPartialAt = now;
    lastPartialLineCount = items.length;
    await streamOptions.onPartialCornell({
      cornell: {
        notes: items
          .flatMap((item) => (item.kind === "note" ? [item.text] : []))
          .join("\n"),
        cues: items
          .flatMap((item) => (item.kind === "cue" ? [item.text] : []))
          .join("\n"),
        summary: items.find((item) => item.kind === "summary")?.text ?? "",
      },
      completeLineCount: items.length,
    });
  };
  const userId = goal.userId?.trim();
  const unitId = streamOptions?.unitId?.trim();
  if (userId && unitId && unitAuthoringAgentEnabled()) {
    const historyResult = await runUnitAuthoringHistoryBoundCall({
      userId,
      goalId: goal.id,
      unitId,
      operation: "unit.cornell",
      expectedTool: "commit_cornell",
      prompt: buildCornellHistoryContinuationPrompt({
        unitTitle,
        languageBlock: plan.languageBlock(),
        styleBlock: plan.styleBlock(),
        optionsBlock: options,
        context: context ?? "",
      }),
      resultSchema: cornellHistoryResultSchema(),
      branchKind: "notes",
      signal,
      meta: unitLlmMeta(plan, { goalId: goal.id, unitTitle, unitId }),
      onToken,
      onPartialCandidate: async (candidate) => {
        const items = cornellItemsFromCommitArgs(candidate);
        if (!Array.isArray(items)) return;
        const valid = items.flatMap((item) => {
          const parsed = z
            .object({
              kind: z.enum(["note", "cue", "summary"]),
              text: z.string(),
            })
            .safeParse(item);
          return parsed.success ? [parsed.data as CornellJitItem] : [];
        });
        if (valid.length > 0) await emitCornellPartial(valid);
      },
    });
    if (historyResult) return historyResult;
  }
  const prepared = prepareCornellAuthoring({
    unitTitle,
    goalBlock: plan.goalBlock(),
    difficultyBlock: plan.difficultyBlock(),
    timeBudgetBlock: plan.timeBudgetBlock(),
    styleBlock: plan.styleBlock(),
    languageBlock: plan.languageBlock(),
    optionsBlock: options,
    sqJson: compactSqJsonArg(sqJson),
    materialJson: compactMaterialJsonArg(materialJson),
    context: context ?? "",
  });
  return runValidatedStructuredGeneration<
    CornellJitItem,
    CornellJitItem[],
    ReturnType<typeof prepared.parseProviderOutput>
  >(
    {
      mode: "item-array",
      operation: "unit.cornell",
      prompt: prepared.prompt,
      itemSchema: prepared.itemSchema,
      resultSchema: prepared.resultSchema,
      assemble: (items) => items,
      assemblePartial: (items) => items,
      meta: unitLlmMeta(plan, { goalId: goal.id, unitTitle }),
      contextSubject: generationContextSubject(goal),
      contextQuery: unitTitle,
      contextInvocation: prepared.contextInvocation,
    },
    { onToken, signal, onPartial: emitCornellPartial },
  );
}

export async function streamGenerateQuiz(
  goal: GoalPromptFields & { id: string },
  unitTitle: string,
  materialJson: string,
  onToken?: StreamTokenHandler,
  signal?: AbortSignal,
  streamOptions?: {
    difficulty?: QuizDifficulty;
    learningTargetsBlock?: string;
    /** Published targets used to clamp evidenceDimension / criterionRef. */
    assessmentTargets?: readonly UnitAssessmentTarget[];
    standaloneMicro?: boolean;
    onPartialQuiz?: (partial: QuizCompactStreamPartial) => void | Promise<void>;
    validateQuiz?: (quiz: {
      questions: QuizQuestion[];
      interleaved: QuizQuestion[];
    }) => void;
    batchPlan?: QuizBatchPlan;
    onVerificationStart?: () => void | Promise<void>;
    onVerificationComplete?: (
      result: ContentVerificationResult,
    ) => void | Promise<void>;
    onRepairApplied?: (
      patches: Array<{ index: number; kind: string; content: unknown }>,
    ) => void | Promise<void>;
    generationRunId?: string;
    unitId?: string;
  },
) {
  const plan = await planForGoal(goal);
  const options = plan.optionsBlock();
  const topicCategory = plan.topicCategory;
  const assessmentTargets = streamOptions?.assessmentTargets ?? [];
  const prepared = prepareUnitQuizAuthoring({
    unitTitle,
    materialJson: compactMaterialJsonArg(materialJson),
    languageBlock: plan.languageBlock(),
    styleBlock: plan.styleBlock(),
    optionsBlock: options,
    difficulty: streamOptions?.difficulty,
    learningTargetsBlock: streamOptions?.learningTargetsBlock,
    standaloneMicro: streamOptions?.standaloneMicro,
    batchPlan: streamOptions?.batchPlan,
    topicCategory,
    goalTitle: plan.goalTitle,
    decoratePrompt: (prompt) =>
      appendContentMarkupRules(prompt, {
        topicCategory,
        goalTitle: plan.goalTitle,
      }),
    alignQuestions: (questions) =>
      assessmentTargets.length > 0
        ? alignQuizQuestionsToDeclaredEvidence(questions, assessmentTargets)
        : questions,
    validateQuiz: streamOptions?.validateQuiz,
  });
  const questionCount = prepared.questionCount;
  let lastPartialAt = 0;
  let lastPartialCount = 0;
  let authored: {
    questions: QuizQuestion[];
    interleaved: QuizQuestion[];
  } | null = null;
  const userId = goal.userId?.trim();
  const unitId = streamOptions?.unitId?.trim();
  if (userId && unitId && unitAuthoringAgentEnabled()) {
    authored = await runUnitAuthoringHistoryBoundCall({
      userId,
      goalId: goal.id,
      unitId,
      operation: "unit.quiz",
      expectedTool: "commit_quiz",
      prompt: `Generate exactly ${questionCount} active-recall quiz questions for "${unitTitle}" from the accepted Survey and learning material already in this conversation.
Do not rewrite Survey or material. Call commit_quiz with {"items":[...questions]}.
${streamOptions?.learningTargetsBlock?.trim() ? `Learning targets / evidence bindings:\n${streamOptions.learningTargetsBlock.trim()}\n` : ""}${streamOptions?.batchPlan ? "Honor the fixed batch slots from the server plan; do not change bindings.\n" : ""}${plan.languageBlock()}
${plan.styleBlock()}`,
      resultSchema: z.preprocess((value) => {
        if (
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          Array.isArray((value as { items?: unknown }).items)
        ) {
          return (value as { items: unknown[] }).items;
        }
        return value;
      }, prepared.resultSchema),
      branchKind: "assessment",
      signal,
      meta: unitLlmMeta(plan, {
        goalId: goal.id,
        unitTitle,
        unitId,
        questionCount,
      }),
      onToken,
    });
  }
  if (!authored) {
    authored = await runValidatedStructuredGeneration<
      QuizQuestion,
      QuizCompactStreamPartial,
      { questions: QuizQuestion[]; interleaved: QuizQuestion[] }
    >(
      {
        mode: "item-array",
        operation: "unit.quiz",
        prompt: prepared.prompt,
        itemSchema: prepared.itemSchema,
        bindingItemSchema: prepared.bindingItemSchema,
        resultSchema: prepared.resultSchema,
        assemble: (items) => items,
        assemblePartial: (items, invalidPlaceholders) => ({
          questions: prepared.alignQuestions(items),
          completeQuestionCount: items.length,
          placeholderQuestionCount: Math.max(
            invalidPlaceholders,
            questionCount - items.length,
          ),
        }),
        recoveryPolicy: {
          normalize: (items) => {
            const aligned = prepared.alignQuestions(items);
            const normalizedCount = aligned.filter(
              (question, index) =>
                JSON.stringify(question) !== JSON.stringify(items[index]),
            ).length;
            return { items: aligned, normalizedCount };
          },
        },
        repairContext: streamOptions?.standaloneMicro
          ? `Required question count: ${questionCount}. Keep the standalone micro-course transport placeholders exactly as instructed.`
          : streamOptions?.batchPlan
            ? `Required question count: ${questionCount}. Generate exactly the fixed batch slots above without changing bindings.`
            : `Required question count: ${questionCount}. Match each question's evidenceDimension to that target's Allowed quiz evidenceDimension. ${streamOptions?.learningTargetsBlock ?? ""}`,
        meta: unitLlmMeta(plan, { goalId: goal.id, unitTitle, questionCount }),
        contextSubject: generationContextSubject(goal),
        contextQuery: unitTitle,
        contextInvocation: prepared.contextInvocation,
      },
      {
        onToken,
        signal,
        onPartial: async (partial) => {
          if (!streamOptions?.onPartialQuiz) return;
          const now = Date.now();
          const countDelta = partial.completeQuestionCount - lastPartialCount;
          if (now - lastPartialAt < 120 && countDelta < 1) return;
          lastPartialAt = now;
          lastPartialCount = partial.completeQuestionCount;
          await streamOptions.onPartialQuiz(partial);
        },
      },
    );
  }
  const questions = await verifyAndRepairAssessmentQuestions({
    questions: authored.questions,
    unitTitle,
    objective: unitTitle,
    learningTargets: streamOptions?.learningTargetsBlock ?? "",
    evidenceContext: materialJson,
    signal,
    onVerificationStart: streamOptions?.onVerificationStart,
    onVerificationComplete: streamOptions?.onVerificationComplete,
    onRepairApplied: streamOptions?.onRepairApplied,
    generationRunId: streamOptions?.generationRunId,
  });
  return prepared.resultSchema.parse(questions);
}

export async function streamGenerateDiagnosticQuiz(
  goal: GoalPromptFields & { id: string },
  unitTitle: string,
  competencyBlock: string,
  questionCount: number,
  learningTargetIds: string[],
  onToken?: StreamTokenHandler,
  signal?: AbortSignal,
  onPartialQuiz?: (partial: QuizCompactStreamPartial) => void | Promise<void>,
  scopeKind: "unit" | "module" = "unit",
  assessmentTargets: readonly UnitAssessmentTarget[] = [],
  verificationOptions?: {
    onVerificationStart?: () => void | Promise<void>;
    onVerificationComplete?: (
      result: ContentVerificationResult,
    ) => void | Promise<void>;
    onRepairApplied?: (
      patches: Array<{ index: number; kind: string; content: unknown }>,
    ) => void | Promise<void>;
    generationRunId?: string;
  },
) {
  const plan = await planForGoal(goal);
  const topicCategory = plan.topicCategory;
  const questionTargets = new Map(
    learningTargetIds.map((id) => {
      const block = competencyBlock
        .split(/\n\s*\n/)
        .find((candidate) =>
          candidate.trim().toLowerCase().startsWith(`${id.toLowerCase()}:`),
        );
      const allocation = block?.match(/Summative questions:\s*(\d+)/i)?.[1];
      return [id, Math.max(1, Number(allocation) || 2)] as const;
    }),
  );
  const allocatedQuestionCount = [...questionTargets.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  const sharedDiagnosticContract =
    assessmentTargets.length === 0
      ? null
      : scopeKind === "unit"
        ? prepareUnitDiagnosticAuthoring({
            unitTitle,
            languageBlock: plan.languageBlock(),
            styleBlock: plan.styleBlock(),
            targets: assessmentTargets,
          })
        : prepareModuleDiagnosticAuthoring({
            moduleTitle: unitTitle,
            languageBlock: plan.languageBlock(),
            styleBlock: plan.styleBlock(),
            targets: assessmentTargets,
          });
  const expectedQuestionCount =
    sharedDiagnosticContract?.questionCount ?? allocatedQuestionCount;
  const promptInvocation = {
    unitTitle,
    promptOptions: {
      unitTitle,
      scopeKind,
      competencyBlock,
      questionCount: expectedQuestionCount,
      languageBlock: plan.languageBlock(),
      styleBlock: plan.styleBlock(),
    },
    topicCategory,
    goalTitle: plan.goalTitle,
  };
  const finalSchema = diagnosticQuizSchema(expectedQuestionCount);
  const alignQuestions = (questions: QuizQuestion[]) =>
    sharedDiagnosticContract
      ? sharedDiagnosticContract.alignQuestions(questions)
      : assessmentTargets.length > 0
        ? alignQuizQuestionsToDeclaredEvidence(questions, assessmentTargets)
        : questions;
  const diagnosticItemsSchema = z
    .array(quizJitItemSchema)
    .min(expectedQuestionCount)
    .transform((questions) => alignQuestions(questions))
    .superRefine((questions, ctx) => {
      const missing = getMissingDiagnosticQuestions(
        questions,
        learningTargetIds,
        questionTargets,
      );
      if (missing.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: `Missing diagnostic questions: ${missing
            .map((item) => `${item.learningTargetId}=${item.count}`)
            .join(", ")}`,
        });
      }
      if (assessmentTargets.length > 0) {
        try {
          if (sharedDiagnosticContract) {
            sharedDiagnosticContract.validateQuestions(questions);
          } else {
            validateAdaptiveQuizRequirementCoverage({
              questions,
              targets: assessmentTargets,
            });
          }
        } catch (error) {
          ctx.addIssue({
            code: "custom",
            message:
              error instanceof Error
                ? error.message
                : "Diagnostic entity coverage is incomplete",
          });
        }
      }
    })
    .transform((questions) =>
      finalSchema.parse({
        questions: questions.slice(0, expectedQuestionCount),
        interleaved: [],
      }),
    );
  const authored = await runValidatedStructuredGeneration<
    DiagnosticQuizQuestion,
    QuizCompactStreamPartial,
    {
      questions: DiagnosticQuizQuestion[];
      interleaved: DiagnosticQuizQuestion[];
    }
  >(
    {
      mode: "item-array",
      operation: `${scopeKind}.diagnostic`,
      prompt:
        buildAssessmentInvocationPrompt(
          ASSESSMENT_GENERATION_VIEW_KEYS.diagnosticInstructionContext,
          promptInvocation,
        ) ?? "",
      itemSchema: quizJitItemSchema,
      bindingItemSchema: quizJitItemBindingSchema,
      resultSchema: diagnosticItemsSchema,
      assemble: (items) => items,
      assemblePartial: (items, invalidPlaceholders) => ({
        questions: alignQuestions(items),
        completeQuestionCount: items.length,
        placeholderQuestionCount: Math.max(
          invalidPlaceholders,
          expectedQuestionCount - items.length,
        ),
      }),
      recoveryPolicy: {
        // Cosmetic max: truncate overshoot locally instead of fail-closed
        // on Zod maxItems ("Too big: expected array to have <=N items").
        maxItems: expectedQuestionCount,
        normalize: (items) => {
          const aligned = alignQuestions(items);
          const normalizedCount = aligned.filter(
            (question, index) =>
              JSON.stringify(question) !== JSON.stringify(items[index]),
          ).length;
          return { items: aligned, normalizedCount };
        },
      },
      repairContext: `Required count: ${expectedQuestionCount}. Match each question's evidenceDimension to that target's Allowed quiz evidenceDimension.\nLearning-target definitions:\n${competencyBlock}`,
      meta: unitLlmMeta(plan, {
        goalId: goal.id,
        unitTitle,
        questionCount: expectedQuestionCount,
        requestedQuestionCount: questionCount,
      }),
      contextSubject: generationContextSubject(goal),
      contextQuery: `${scopeKind} diagnostic: ${unitTitle}`,
      contextInvocation: promptInvocation,
    },
    { onToken, signal, onPartial: onPartialQuiz },
  );
  const questions = await verifyAndRepairAssessmentQuestions({
    questions: authored.questions,
    unitTitle,
    objective: `${scopeKind} diagnostic`,
    learningTargets: competencyBlock,
    evidenceContext: competencyBlock,
    signal,
    onVerificationStart: verificationOptions?.onVerificationStart,
    onVerificationComplete: verificationOptions?.onVerificationComplete,
    onRepairApplied: verificationOptions?.onRepairApplied,
    generationRunId: verificationOptions?.generationRunId,
  });
  return finalSchema.parse({ ...authored, questions });
}

export async function streamGenerateFlashcards(
  goal: GoalPromptFields & { id: string },
  unitId: string,
  unitTitle: string,
  materialJson: string,
  target: { min: number; max: number },
  extras: { cornellCues?: string; learningTargetsBlock?: string } = {},
  onToken?: StreamTokenHandler,
  signal?: AbortSignal,
) {
  const plan = await planForGoal(goal);
  const deckItemsSchema = z
    .array(flashcardJitItemSchema)
    .min(target.min)
    .max(target.max)
    .transform((cards) => flashCardDeckSchema.parse({ cards }));
  const promptInvocation = [
    unitTitle,
    compactMaterialJsonArg(materialJson),
    {
      lang: plan.languageBlock(),
      style: plan.styleBlock(),
      cornellCues: extras.cornellCues,
      learningTargetsBlock: extras.learningTargetsBlock,
    },
    target,
  ];
  const standalonePrompt =
    buildUnitContentInvocationPrompt(
      UNIT_CONTENT_VIEW_KEYS.flashcardsInstructionContext,
      promptInvocation,
    ) ?? "";
  const userId = goal.userId?.trim();
  if (userId && unitAuthoringAgentEnabled()) {
    const historyPrompt = `Generate ${target.min}–${target.max} flashcards for "${unitTitle}" from the accepted Survey and learning material already in this conversation.
Do not rewrite Survey or material. Call commit_flashcards with {"items":[...cards]}.
Each card needs front, back, and exactly one declared local learning-target id in learningTargetIds.
${plan.styleBlock()}
${plan.languageBlock()}
${extras.learningTargetsBlock?.trim() ? `\nLearning targets:\n${extras.learningTargetsBlock.trim()}\n` : ""}${extras.cornellCues?.trim() ? `\nCornell cues:\n${extras.cornellCues.trim()}\n` : ""}`;
    const historyResult = await runUnitAuthoringHistoryBoundCall({
      userId,
      goalId: goal.id,
      unitId,
      operation: "unit.flashcards",
      expectedTool: "commit_flashcards",
      prompt: historyPrompt,
      resultSchema: z.preprocess((value) => {
        if (
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          Array.isArray((value as { items?: unknown }).items)
        ) {
          return (value as { items: unknown[] }).items;
        }
        return value;
      }, deckItemsSchema),
      branchKind: "notes",
      signal,
      meta: unitLlmMeta(plan, { unitId, unitTitle, goalId: goal.id }),
      onToken,
    });
    if (historyResult) return historyResult;
  }
  return runValidatedStructuredGeneration<
    FlashCardDraft,
    never,
    { cards: FlashCardDraft[] }
  >(
    {
      mode: "item-array",
      operation: "unit.flashcards",
      prompt: standalonePrompt,
      itemSchema: flashcardJitItemSchema,
      bindingItemSchema: flashcardJitItemBindingSchema,
      resultSchema: deckItemsSchema,
      assemble: (items) => items,
      recoveryPolicy: {
        maxItems: target.max,
      },
      repairContext: `Return ${target.min}–${target.max} cards. Each card must contain one complete recall question in "front", its concise answer in "back", and exactly one declared local learning-target id in "learningTargetIds".`,
      meta: unitLlmMeta(plan, { unitId, unitTitle, goalId: goal.id }),
      contextSubject: generationContextSubject(goal, unitId),
      contextQuery: unitTitle,
      contextInvocation: promptInvocation,
    },
    { onToken, signal },
  );
}
