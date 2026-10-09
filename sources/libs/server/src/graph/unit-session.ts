import { parseSessionGraphState } from "./review-mode.js";
import { buildSocraticCorrectionPriorContext } from "../unit-session/socratic-correction.js";
import {
  verifyAndRepairAssessmentQuestions,
  learningTargetContextFromSqJson,
} from "../content-verification/index.js";
import {
  resolveGoalContentLanguage,
  type ContentLanguageCode,
} from "../llm/content-language.js";
import {
  buildPlanContextWithLearnerProfile,
  type PlanContext,
} from "../llm/context/plan-context.js";
import { getUnitModulePromptBlock } from "../goals/module-prompt-context.js";
import { runValidatedStructuredGeneration } from "../llm/validated-structured-generation.js";
import {
  materialToJitItems,
  type MaterialJitItem,
} from "../llm/jit-structured-items.js";
import {
  buildCornellHistoryContinuationPrompt,
  cornellHistoryResultSchema,
  prepareCornellAuthoring,
} from "../cornell/authoring.js";
import { prepareGuidingQuestionAuthoring } from "../survey/guiding-question-authoring.js";
import {
  resolveMaterialComponentSelection,
  selectComponentCategories,
} from "../llm/select-component-categories.js";
import { materialGenerationPolicyFromSelection } from "../llm/component-dsl-registry.js";
import { getDisabledMaterialComponentTypes } from "../llm/material-component-settings.js";
import { materialForQuizPrompt } from "../learning-systems/capabilities/assessment-runtime/quiz-prompt.js";
import { buildAssessmentInvocationPrompt } from "../learning-systems/capabilities/assessment-runtime.js";
import { ASSESSMENT_GENERATION_VIEW_KEYS } from "../learning-systems/capabilities/assessment-generation-keys.js";
import { buildUnitContentInvocationPrompt } from "../learning-systems/capabilities/unit-content/capability.js";
import {
  extraDisabledMaterialTypesForRuiyanShadowDev,
  isDesktopDevRuiyanShadowIllustrationMode,
  isDesktopDevRuiyanShadowGuidedImageMode,
} from "../learning-systems/capabilities/unit-content/material-prompt.js";
import { UNIT_CONTENT_VIEW_KEYS } from "../learning-systems/capabilities/unit-content/keys.js";
import { streamGenerateQuiz } from "./unit-session-stream.js";
import {
  loadTeachingSkillPrompt,
  resolveTeachingSkillForGoal,
} from "../teaching-skills/index.js";
import {
  compactLearningMaterialForPrompt,
  compactMaterialJsonArg,
  compactSqJsonArg,
} from "../llm/compact-json.js";
import {
  DRILLS_JSON_SHAPE,
  FEYNMAN_JSON_SHAPE,
  SQ_QUESTION_ANSWERS_JSON_SHAPE,
} from "../llm/schema-shapes.js";
import {
  sqPreviewSchema,
  learningMaterialSchema,
  feynmanFeedbackSchema,
  drillsSchema,
  type QuizQuestion,
  type LearningMaterialContent,
  type SqPreview,
} from "../llm/schemas.js";

export {
  gradeQuiz,
  type QuizGradeItem,
} from "./grade-quiz.js";
import {
  buildUnitSessionContext,
  buildUnitSessionContextWithSources,
} from "../domain/unit-map-context.js";
import {
  buildReferencePromptSection,
  stripLearningMaterialCitationMarkers,
} from "../citations/inline-citations.js";
import { dedupeExactMaterialBlocks } from "../llm/normalize-learning-material.js";
import { enrichMaterialWithImages } from "../images/enrich-material.js";
import { isImageGenerationAvailable } from "../images/providers/index.js";
import { ensureImageRuntimeConfig } from "../images/runtime-config.js";
import {
  type ContentSource,
  parseContentSources,
} from "../rag/content-sources.js";
import { retrieveContextForUnit } from "../rag/retrieve.js";
import { indexCompletedUnitKnowledge } from "../rag/learned-knowledge.js";
export {
  sanitizeLearningMaterialText,
  serializeLearningMaterialBlocks,
  serializeLearningMaterialKeyTakeaways,
  serializeMaterialContextSources,
} from "./material-serialization.js";
import { invalidateLearnerStateMemory } from "../learner-state-memory/index.js";
import { cognitiveModelPersistence } from "../cognitive-model/persistence.js";
import {
  expandUnitCognitiveModel,
  getUnitLearningTargetsV2,
} from "../cognitive-model/index.js";
import { parseJson } from "../utils.js";
import { resolveGoalGenerationOptionsWithPattern } from "../llm/goal-course-pattern.js";
import { hasGoalCoursePattern } from "../llm/generation-options.js";
import { FEATURE_COURSE_PATTERN } from "../features.js";
import { UNIT_SHARED_CONTEXT_REUSE_LINE } from "./unit-session-prompts.js";
import { planUnitCompletion } from "../unit-session/completion-application.js";
import {
  applyCanonicalLearningTargetsToSq,
  assertCanonicalLearningTargetsFitLesson,
  type CanonicalSqlearningTarget,
} from "./canonical-sq.js";
import type {
  CognitiveModelEventRepository,
  CompletedUnitKnowledgeReadRepository,
  LearnerStateMemoryInvalidationRepository,
  UnitCompletionRepository,
  UnitCompletionReadRepository,
  UnitGenerationContextRepository,
} from "../../../domain/src/index.js";
import { requireUnitSessionPersistence } from "./unit-session-persistence.js";
import { executeOperation } from "../generation/execution/index.js";
import {
  learningMaterialOperation,
  surveyOperation,
} from "../generation/execution/structured-operations.js";
import { hashArtifactContext } from "../generation/execution/artifact-workflow.js";
import {
  runComponentSelectionAuthoringAgent,
  runUnitAuthoringHistoryBoundCall,
  unitAuthoringAgentEnabled,
} from "../unit-authoring/runner.js";

let generationContextPersistence: UnitGenerationContextRepository | undefined;
export function configureUnitGenerationContextPersistence(
  value: UnitGenerationContextRepository | undefined,
) {
  generationContextPersistence = value;
}
export function unitGenerationContextPersistence() {
  if (!generationContextPersistence)
    throw new Error("Unit generation context persistence is not configured");
  return generationContextPersistence;
}
const requireGenerationContextPersistence = unitGenerationContextPersistence;

function unitArtifactSequenceId(goalId: string, unitId: string): string {
  return `unit-content:${hashArtifactContext(`${goalId}:${unitId}`).slice(0, 24)}`;
}

export async function getPlanContextForGoal(
  goalId: string,
): Promise<PlanContext> {
  const persistence = requireGenerationContextPersistence();
  const goal = await persistence.findGoal(goalId);
  if (!goal) {
    return buildPlanContextWithLearnerProfile({
      id: goalId,
      title: "",
      level: "zero",
      contentLanguage: "zh-Hans",
      generationOptions: "",
    });
  }
  let generationOptions = goal.generationOptions;
  if (FEATURE_COURSE_PATTERN && !hasGoalCoursePattern(generationOptions)) {
    generationOptions = await resolveGoalGenerationOptionsWithPattern({
      title: goal.title,
      level: goal.level,
      contentLanguage: resolveGoalContentLanguage(
        goal.contentLanguage,
        goal.title,
      ),
      generationOptions,
      isSmallCourse: goal.goalKind === "micro",
    });
    await persistence.updateGenerationOptions({
      goalId: goal.id,
      generationOptions,
    });
  }

  return buildPlanContextWithLearnerProfile({
    id: goal.id,
    title: goal.title,
    level: goal.level,
    contentLanguage: goal.contentLanguage,
    generationOptions,
    topicCategory: goal.topicCategory,
    mapPlanJson: goal.mapPlanJson,
    userId: goal.userId,
  });
}

export async function generateSqPreview(
  goalId: string,
  unitId: string,
  unitTitle: string,
  summary: string,
  generationOptions?: {
    canonicalLearningTargets?: CanonicalSqlearningTarget[];
    learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository;
  },
): Promise<SqPreview> {
  const goalMode = await requireGenerationContextPersistence().findGoal(goalId);
  let canonicalPoints = generationOptions?.canonicalLearningTargets;
  if (!canonicalPoints) {
    const persistence = cognitiveModelPersistence();
    if (!persistence)
      throw new Error(
        "Cognitive-model expansion persistence is not configured",
      );
    await expandUnitCognitiveModel(null, unitId, {
      learnerStateMemoryInvalidation:
        generationOptions?.learnerStateMemoryInvalidation,
    });
    const result = await getUnitLearningTargetsV2(undefined, unitId, {
      presentationRead: persistence.presentationRead,
    });
    canonicalPoints = result.learningTargets;
  }
  const context = await buildUnitSessionContext(
    goalId,
    unitId,
    unitTitle,
    summary,
  );
  const plan = await getPlanContextForGoal(goalId);
  assertCanonicalLearningTargetsFitLesson(canonicalPoints, {
    contentLanguage: plan.langCode,
    unitTitle,
    contentSummary: summary,
  });
  const moduleContext = await getUnitModulePromptBlock(unitId);
  const options = plan.optionsBlock();
  const canonicalTargetBlock = canonicalPoints
    .map(
      (point) =>
        `${point.localRef}: ${point.title} — ${point.description ?? ""}; objective: ${point.learningObjective}; criteria: ${point.assessmentCriteria.join("; ")}`,
    )
    .join("\n");
  const sectionPlanningMode =
    canonicalPoints.length > 0
      ? ("kacom" as const)
      : goalMode?.goalKind === "micro"
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
    contextSubject: { userId: plan.userId, goalId, unitId },
    authorSelection:
      unitAuthoringAgentEnabled() && plan.userId
        ? ({ prompt, resultSchema, contextInvocation }) =>
            runComponentSelectionAuthoringAgent({
              userId: plan.userId!,
              goalId,
              unitId,
              prompt,
              resultSchema,
              contextSubject: { userId: plan.userId, goalId, unitId },
              contextQuery: `${unitTitle}: ${summary}`.slice(0, 2_000),
              contextInvocation,
              meta: {
                goalId,
                unitTitle,
                topicCategory: plan.topicCategory,
              },
            })
        : undefined,
  });
  const promptInvocation = {
    unitTitle,
    plan,
    optionsBlock: options,
    context,
    canonicalLearningTargets: canonicalTargetBlock,
    moduleContext,
    sectionPlanningMode,
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
      finalizeSurvey: (draft) =>
        sqPreviewSchema.parse(
          applyCanonicalLearningTargetsToSq(draft, canonicalPoints, {
            contentLanguage: plan.langCode,
            unitTitle,
            contentSummary: summary,
          }),
        ),
      componentSelection,
      ...(unitAuthoringAgentEnabled() && plan.userId
        ? {
            authoringAgent: {
              userId: plan.userId,
              goalId,
              unitId,
            },
          }
        : {}),
      contextSubject: { userId: plan.userId, goalId, unitId },
      contextQuery: `${unitTitle}: ${summary}`.slice(0, 2_000),
      contextInvocation: promptInvocation,
      meta: {
        goalId,
        unitTitle,
        topicCategory: plan.topicCategory,
        goalTitle: plan.goalTitle,
      },
      artifactContext: {
        sequenceId: unitArtifactSequenceId(goalId, unitId),
        entries: [],
      },
      verification: {
        unitTitle,
        objective: summary,
        learningTargets: verificationTargets,
        evidenceContext: context,
      },
    },
    { subject: { userId: plan.userId, goalId, unitId } },
  );
  return execution.output;
}

export async function generateLearningMaterialWithSources(
  goalId: string,
  unitId: string,
  unitTitle: string,
  summary: string,
  sqJson: string,
): Promise<{
  material: LearningMaterialContent;
  contextSources: ContentSource[];
  contentLanguage: ContentLanguageCode;
  materialSourceItems: MaterialJitItem[];
}> {
  const { context, sources } = await buildUnitSessionContextWithSources(
    goalId,
    unitId,
    unitTitle,
    summary,
  );
  const referenceSection = buildReferencePromptSection(context, sources);
  const plan = await getPlanContextForGoal(goalId);
  const langCode = plan.langCode;
  const options = plan.optionsBlock();
  const moduleContext = await getUnitModulePromptBlock(unitId);
  const goal = await requireGenerationContextPersistence().findGoal(goalId);
  if (goal) {
    await resolveTeachingSkillForGoal({
      goalId,
      title: goal.title,
      level: goal.level,
      generationOptions: goal.generationOptions,
      sourceSummary: summary,
    });
  }
  const teachingSkill = await loadTeachingSkillPrompt(
    goalId,
    "unit_content",
    `${goal?.title ?? ""} ${unitTitle} ${summary}`,
  );
  await ensureImageRuntimeConfig();
  const isRuiyanShadowDev = isDesktopDevRuiyanShadowIllustrationMode(plan);
  const imagesEnabled = isRuiyanShadowDev || isImageGenerationAvailable();
  const extraDisabled = extraDisabledMaterialTypesForRuiyanShadowDev(plan);
  const componentSelection = await resolveMaterialComponentSelection({
    sqJson,
    unitTitle,
    summary,
    context,
    topicCategory: plan.topicCategory,
    extraDisabledComponentTypes: extraDisabled,
    contextSubject: { userId: plan.userId, goalId, unitId },
  });
  const disabledMaterialComponentTypes = [
    ...(await getDisabledMaterialComponentTypes().catch(() => [])),
    ...extraDisabled,
  ];
  const promptInvocation = {
    unitTitle,
    plan,
    optionsBlock: options,
    sqJson,
    referenceSection,
    includeImages: imagesEnabled,
    isMicroCourse: goal?.goalKind === "micro",
    componentSelection,
    disabledMaterialComponentTypes,
    moduleContext,
    teachingSkillBlock: teachingSkill?.promptBlock,
  };
  const execution = await executeOperation(
    learningMaterialOperation,
    {
      prompt:
        buildUnitContentInvocationPrompt(
          UNIT_CONTENT_VIEW_KEYS.materialInstructionContext,
          promptInvocation,
        ) ?? "",
      generationPolicy: materialGenerationPolicyFromSelection(
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
      ),
      componentContext: {
        unitTitle,
        language: langCode,
        context,
        ...(plan.userId
          ? {
              authoringScope: {
                userId: plan.userId,
                goalId,
                unitId,
              },
            }
          : {}),
      },
      authoringAgent: isDesktopDevRuiyanShadowGuidedImageMode(plan) && plan.userId ? {
        userId: plan.userId, goalId, unitId, sectionId: "__unit_material__",
        skipSurvey: true, languageBlock: plan.languageBlock(), guidedImagePersonaRef: plan.teachingPersonaRef,
      } : undefined,
      contextSubject: { userId: plan.userId, goalId, unitId },
      contextQuery: `${unitTitle}: ${summary}`.slice(0, 2_000),
      contextInvocation: promptInvocation,
      meta: {
        goalId,
        unitTitle,
        topicCategory: plan.topicCategory,
        goalTitle: plan.goalTitle,
        teachingSkill: teachingSkill
          ? `${teachingSkill.slug}@${teachingSkill.version}`
          : undefined,
        teachingSkillHash: teachingSkill?.contentHash,
      },
      artifactContext: {
        sequenceId: unitArtifactSequenceId(goalId, unitId),
        entries: [
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
        learningTargets: learningTargetContextFromSqJson(sqJson),
        evidenceContext: context,
      },
    },
    { subject: { userId: plan.userId, goalId, unitId } },
  );
  const material = execution.output;
  return {
    material,
    contextSources: sources,
    contentLanguage: langCode,
    materialSourceItems: materialToJitItems(material),
  };
}

export async function generateLearningMaterial(
  goalId: string,
  unitId: string,
  unitTitle: string,
  summary: string,
  sqJson: string,
): Promise<LearningMaterialContent> {
  const { material } = await generateLearningMaterialWithSources(
    goalId,
    unitId,
    unitTitle,
    summary,
    sqJson,
  );
  return material;
}

export function parseMaterialContextSources(stored: {
  contextSources?: string;
}): ContentSource[] {
  return parseContentSources(stored.contextSources);
}

export async function generateSqQuestionAnswers(
  goalId: string,
  unitTitle: string,
  questions: string[],
  materialJson: string,
): Promise<string[]> {
  const plan = await getPlanContextForGoal(goalId);
  const options = plan.optionsBlock();
  const prepared = prepareGuidingQuestionAuthoring({
    unitTitle,
    questions,
    goalBlock: plan.goalBlock(),
    languageBlock: plan.languageBlock(),
    styleBlock: plan.styleBlock(),
    optionsBlock: options,
    materialJson: compactMaterialJsonArg(materialJson),
  });
  const result = await runValidatedStructuredGeneration({
    mode: "object",
    schema: prepared.schema,
    prompt: prepared.prompt,
    options: {
      operation: "unit.sq_question_answers",
      topicCategory: plan.topicCategory,
      meta: { goalId, unitTitle, goalTitle: plan.goalTitle },
      schemaShape: SQ_QUESTION_ANSWERS_JSON_SHAPE,
    },
    contextSubject: { goalId },
    contextQuery: `${unitTitle}: ${questions.join("; ")}`.slice(0, 2_000),
    contextInvocation: prepared.contextInvocation,
  });
  return prepared.parseResult(result);
}

export async function generateCornell(
  goalId: string,
  unitTitle: string,
  sqJson: string,
  materialJson: string,
  scope?: { userId?: string | null; unitId?: string | null },
) {
  const context = await retrieveContextForUnit(goalId, unitTitle);
  const plan = await getPlanContextForGoal(goalId);
  const options = plan.optionsBlock();
  const userId = scope?.userId?.trim() || plan.userId?.trim();
  const unitId = scope?.unitId?.trim();
  if (userId && unitId && unitAuthoringAgentEnabled()) {
    const historyResult = await runUnitAuthoringHistoryBoundCall({
      userId,
      goalId,
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
      meta: {
        goalId,
        unitTitle,
        unitId,
        topicCategory: plan.topicCategory,
        goalTitle: plan.goalTitle,
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
  return runValidatedStructuredGeneration({
    mode: "item-array",
    operation: "unit.cornell",
    prompt: prepared.prompt,
    itemSchema: prepared.itemSchema,
    resultSchema: prepared.resultSchema,
    assemble: (items) => items,
    meta: {
      goalId,
      unitTitle,
      topicCategory: plan.topicCategory,
      goalTitle: plan.goalTitle,
    },
    contextSubject: { goalId },
    contextQuery: unitTitle,
    contextInvocation: prepared.contextInvocation,
  });
}

export function parseLearningMaterial(stored: {
  introduction: string;
  sections: string;
  keyTakeaways: string;
}): LearningMaterialContent {
  const rawSections = parseJson<unknown>(stored.sections, []);
  const payload =
    Array.isArray(rawSections) &&
    rawSections.length > 0 &&
    typeof rawSections[0] === "object" &&
    rawSections[0] !== null &&
    "type" in (rawSections[0] as object)
      ? {
          introduction: stored.introduction,
          blocks: rawSections,
          keyTakeaways: parseJson(stored.keyTakeaways, []),
        }
      : {
          introduction: stored.introduction,
          sections: rawSections,
          keyTakeaways: parseJson(stored.keyTakeaways, []),
        };
  const parsed = learningMaterialSchema.parse(payload);
  return stripLearningMaterialCitationMarkers({
    ...parsed,
    blocks: dedupeExactMaterialBlocks(parsed.blocks),
  });
}

export function patchMaterialIllustrationBlock(
  material: LearningMaterialContent,
  blockIndex: number,
  patch: { imageId: string; imageUrl: string },
): LearningMaterialContent {
  const blocks = material.blocks.map((block, index) =>
    index === blockIndex && block.type === "illustration"
      ? { ...block, ...patch }
      : block,
  );
  return { ...material, blocks };
}

export function serializeLearningMaterialForQuiz(
  material: LearningMaterialContent,
): string {
  return compactLearningMaterialForPrompt(
    materialForQuizPrompt(
      material as Parameters<typeof materialForQuizPrompt>[0],
    ) as Parameters<typeof compactLearningMaterialForPrompt>[0],
  );
}

export async function generateQuiz(
  goalId: string,
  unitTitle: string,
  materialJson: string,
  difficulty?: "easy" | "medium" | "hard",
  learningTargetsBlock?: string,
) {
  const goal = await requireGenerationContextPersistence().findGoal(goalId);
  if (!goal) throw new Error("Goal not found");
  return streamGenerateQuiz(
    goal,
    unitTitle,
    materialJson,
    undefined,
    undefined,
    {
      difficulty,
      learningTargetsBlock,
    },
  );
}

export async function evaluateFeynman(
  goalId: string,
  unitId: string,
  unitTitle: string,
  userText: string,
  learningTargetsBlock: string,
) {
  const context = await retrieveContextForUnit(goalId, unitTitle);
  const plan = await getPlanContextForGoal(goalId);
  const moduleContext = await getUnitModulePromptBlock(unitId);
  const promptInvocation = {
    unitTitle,
    userText,
    languageBlock: plan.languageBlock(),
    learningTargetsBlock,
    moduleContext,
    context: context ?? "",
  };
  const authored = await runValidatedStructuredGeneration({
    mode: "object",
    schema: feynmanFeedbackSchema,
    prompt:
      buildAssessmentInvocationPrompt(
        ASSESSMENT_GENERATION_VIEW_KEYS.feynmanInstructionContext,
        promptInvocation,
      ) ?? "",
    options: {
      operation: "unit.feynman",
      topicCategory: plan.topicCategory,
      meta: { goalId, unitTitle, goalTitle: plan.goalTitle },
      schemaShape: FEYNMAN_JSON_SHAPE,
    },
    contextSubject: { goalId, unitId },
    contextQuery: `${unitTitle}: ${userText}`.slice(0, 2_000),
    contextInvocation: promptInvocation,
  });
  return authored;
}

export function buildSocraticPriorContext(
  graphState: ReturnType<typeof parseSessionGraphState>,
): string | undefined {
  return buildSocraticCorrectionPriorContext(
    graphState as unknown as Parameters<
      typeof buildSocraticCorrectionPriorContext
    >[0],
  );
}

export async function nextSocratic(
  goalId: string,
  unitTitle: string,
  weakTags: string[],
  turn: number,
  lastAnswer?: string,
  priorContext?: string,
) {
  const { streamSocratic } = await import("./socratic-runner.js");
  return streamSocratic({
    goalId,
    unitTitle,
    weakTags,
    turn,
    lastAnswer,
    priorContext,
  });
}

export async function generateDrills(
  goalId: string,
  unitTitle: string,
  weakTags: string[],
) {
  const plan = await getPlanContextForGoal(goalId);
  const ragContext = await retrieveContextForUnit(
    goalId,
    unitTitle,
    weakTags.join(" "),
    4,
  );
  const promptInvocation = {
    unitTitle,
    weakTags,
    ragContext,
    languageBlock: plan.languageBlock(),
  };
  const authored = await runValidatedStructuredGeneration({
    mode: "object",
    schema: drillsSchema,
    prompt:
      buildAssessmentInvocationPrompt(
        ASSESSMENT_GENERATION_VIEW_KEYS.drillsInstructionContext,
        promptInvocation,
      ) ?? "",
    options: {
      operation: "unit.drills",
      topicCategory: plan.topicCategory,
      meta: { unitTitle, goalTitle: plan.goalTitle },
      schemaShape: DRILLS_JSON_SHAPE,
    },
    contextSubject: { goalId },
    contextQuery: `${unitTitle}: ${weakTags.join(", ")}`,
    contextInvocation: promptInvocation,
  });
  const questions = await verifyAndRepairAssessmentQuestions({
    questions: authored.questions,
    unitTitle,
    objective: `Targeted practice for: ${weakTags.join(", ")}`,
    learningTargets: weakTags.join("\n"),
    evidenceContext: ragContext ?? "",
  });
  return drillsSchema.parse({ ...authored, questions });
}

export async function completeUnit(
  unitId: string,
  score: number,
  feynmanPassed: boolean,
  completionPersistence?: {
    userId: string;
    repository: UnitCompletionRepository;
    completionMethod?: "learned" | "test_out";
    completionAttemptId?: string | null;
    contextRead: UnitCompletionReadRepository;
    knowledgeRead?: CompletedUnitKnowledgeReadRepository;
    cognitiveModelEvent: CognitiveModelEventRepository;
  },
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
) {
  if (!completionPersistence) {
    throw new Error("Unit completion persistence is unavailable");
  }
  const context = await completionPersistence.contextRead.findOwnedContext(
    completionPersistence.userId,
    unitId,
  );
  if (!context || context.userId !== completionPersistence.userId) {
    throw new Error("Unit not found");
  }

  const transition = planUnitCompletion({ score, feynmanPassed });
  const { completionQuality } = transition;
  const committed = await completionPersistence.repository.commitOwned({
    userId: completionPersistence.userId,
    unitId,
    transition: {
      ...transition,
      completionMethod:
        completionPersistence.completionMethod ?? transition.completionMethod,
    },
    completionAttemptId: completionPersistence.completionAttemptId,
    idempotencyKey: `unit.completed:${unitId}`,
  });

  if (completionPersistence.knowledgeRead) {
    await indexCompletedUnitKnowledge(unitId, {
      userId: context.userId,
      source: completionPersistence.knowledgeRead,
    });
  }
  await completionPersistence.cognitiveModelEvent.enqueueNext({
    goalId: context.goalId,
  });
  await invalidateLearnerStateMemory(
    context.userId,
    "unit_completed",
    undefined,
    learnerStateMemoryInvalidation,
  );

  return {
    status: committed.status,
    completionQuality,
    nextReviewAt: context.nextReviewAt,
  };
}

export async function getOrCreateSession(userId: string, unitId: string) {
  const session = await requireUnitSessionPersistence().getOrCreateOwned(
    userId,
    unitId,
  );
  if (!session) throw new Error("Unit not found");
  return session;
}

export function getStoredQuiz(sessionGraphState: string): QuizQuestion[] {
  const state = parseJson<{ quiz?: { questions: QuizQuestion[] } }>(
    sessionGraphState,
    {},
  );
  return state.quiz?.questions ?? [];
}
