import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import { localizeBackendMessage, tBackend } from "../../../../../common/src/index.js";
import {
  isUnitLearningDone,
  type FeynmanEvidenceRepository,
  type SocraticEvidenceRepository,
  type QuizSubmissionRepository,
  type MaterialCheckCompletionRepository,
  type UnitActivityRepository,
  type TouchUnitActivityInput,
  type UnitCompletionRepository,
  type CompletedUnitKnowledgeReadRepository,
  type UnitCompletionReadRepository,
  type CognitiveModelEventRepository,
  type UnitDeliveryReadRepository,
  type UnitSessionArtifactRepository,
  type UnitSectionProgressRepository,
  type UnitSessionStateRepository,
  type UnitLearningProgressResetRepository,
  type MaterialReplacementRepository,
  type CognitiveModelGenerationRunRepository,
  type CognitiveModelPublicationRepository,
  type CognitiveModelPublicationFinalizationRepository,
  type ProjectBlueprintRepository,
  type LearnerStateProjectionReadRepository,
  type LearnerStateMemoryInvalidationRepository,
} from "../../../../../domain/src/index.js";
import { FEATURE_FEYNMAN, postQuizNextStep } from "../../../features.js";
import {
  invalidateAgendaForUser,
  markAgendaItemCompletedForUnit,
} from "../../../agenda/index.js";
import { invalidateLearnerStateMemory } from "../../../learner-state-memory/index.js";
import { resetUnitLearningProgress } from "../../../domain/reset-unit-learning.js";
import { parseSessionGraphState } from "../../../graph/review-mode.js";
import {
  ensureSocraticThreads,
  pickActiveSocraticThread,
  processSocraticTurn,
} from "../../../graph/socratic-threads.js";
import {
  completeUnit,
  evaluateFeynman,
  generateCornell,
  generateLearningMaterialWithSources,
  generateSqPreview,
  generateSqQuestionAnswers,
  getOrCreateSession,
  gradeQuiz,
  parseLearningMaterial,
  serializeLearningMaterialForQuiz,
  serializeMaterialContextSources,
} from "../../../graph/unit-session.js";
import { bumpUnitContentRevision } from "../../../graph/content-revision.js";
import { commitLearningMaterialReplacement } from "../../../graph/material-persistence.js";
import { streamGenerateQuiz } from "../../../graph/unit-session-stream.js";
import { getQuizSetDetail } from "../../../quiz/quiz-sets.js";
import { sqQuestionTexts } from "../../../domain/learning-targets.js";
import {
  buildQuizEvidenceSubmissionId,
  ensureUnitQuizAssessableRequirements,
  isQuizAssessableLearningTarget,
  learningTargetCompetencyBlock,
  listMaterialCheckResults,
  publishedMaterialCheckDefinitions,
  recordFeynmanTaskEvidence,
  buildQuizSubmissionItems,
  recordVerifiedMaterialCheckEvidence,
  scoreQuizByLearningTarget,
  submitPublishedMaterialCheck,
  submitSectionMiniTestAnswers,
  validateFeynmanRubricResult,
  validateQuizQuestionEvidenceDeclaration,
} from "../../../assessment/index.js";
import {
  type QuizQuestion,
  type SqPreview,
} from "../../../llm/schemas.js";
import { parseJson } from "../../../utils.js";
import {
  completeUnitSection,
  ensureUnitSectionPlan,
  generateUnitSectionMaterial,
  getAggregatedUnitMaterial,
  getUnitSectionContent,
  getUnitSectionManifest,
} from "../../../sections/index.js";
import {
  assertUnitSessionAssessmentReady,
  dispatchUnitSessionProgressionCommand,
  finishMaterialReading,
  MaterialReadingTransitionError,
} from "../../../unit-session/application.js";

import { KACOM_ASSESSMENT_ACTIONS } from "./constants.js";
import { assertUnitAssessmentReady } from "./helpers/assessment-gate.js";
import { hostedSessionProgressionException } from "./helpers/session-progression.js";
import { hostedFeynmanEligibility } from "./helpers/feynman-eligibility.js";
import {
  clearStructuredDownstream,
  parseSqData,
} from "./helpers/session-graph.js";
import { enrichMaterialImagesInBackground } from "./helpers/material-enrich.js";
import {
  persistGeneratedQuiz,
  buildAdaptiveQuizBatch,
  buildUnitRecallProgress,
} from "./helpers/quiz.js";
import {
  applySocraticTurnResult,
  bootstrapSocraticForSession,
  finishSocraticSession,
  recordSocraticEvidenceBestEffort,
} from "./helpers/socratic.js";
import { ensureExpandedLearningTargets } from "./targets.js";
import { resetUnitAuthoringSession } from "../../../unit-authoring/session.js";
import { unitAuthoringAgentEnabled } from "../../../unit-authoring/runner.js";
import { serializeUnitPreviewStart } from "../../../generation/unit-preview-start.js";
import { generateUnitFlashcards } from "./quiz-lists.js";
import {
  chooseScenarioTheaterOption,
  enqueueRecommendedScenarioTheater,
  invalidateScenarioTheater,
  recommendScenarioTheaterFromSurvey,
  restartScenarioTheater,
  scenarioTheaterCompletionRequired,
  startScenarioTheater,
} from "../../../scenario-theater/index.js";
import {
  completeUnitLab,
  enqueueRecommendedUnitLab,
  invalidateUnitLab,
  recommendUnitLabFromSurvey,
  startUnitLab,
  unitLabCompletionOffered,
} from "../../../unit-lab/index.js";

export async function postSession(
  unitRead: UnitDeliveryReadRepository,
  artifacts: UnitSessionArtifactRepository,
  scenarioTheaterSession: import("../../../../../domain/src/index.js").ScenarioTheaterSessionRepository,
  scenarioTheaterGeneration: import("../../../../../domain/src/index.js").ScenarioTheaterGenerationRepository,
  unitLab: import("../../../../../domain/src/index.js").UnitLabRepository,
  userId: string,
  unitId: string,
  body: { action: string; payload?: Record<string, unknown> },
  unitSessionState?: UnitSessionStateRepository,
  unitActivity?: UnitActivityRepository,
  unitCompletion?: UnitCompletionRepository,
  unitSectionProgress?: UnitSectionProgressRepository,
  generationRun?: CognitiveModelGenerationRunRepository,
  publication?: CognitiveModelPublicationRepository,
  publicationFinalization?: CognitiveModelPublicationFinalizationRepository,
  materialCheckCompletion?: MaterialCheckCompletionRepository,
  unitLearningProgressReset?: UnitLearningProgressResetRepository,
  materialReplacement?: MaterialReplacementRepository,
  projectBlueprint?: ProjectBlueprintRepository,
  stateRead?: LearnerStateProjectionReadRepository,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
  feynmanEvidence?: FeynmanEvidenceRepository,
  socraticEvidence?: SocraticEvidenceRepository,
  quizSubmission?: QuizSubmissionRepository,
  completedUnitKnowledgeRead?: CompletedUnitKnowledgeReadRepository,
  unitCompletionRead?: UnitCompletionReadRepository,
  cognitiveModelEvent?: CognitiveModelEventRepository,
  presentationRead?: import("../../../../../domain/src/index.js").CognitiveModelPresentationReadRepository,
  unitStructuredCleanup?: import("../../../../../domain/src/index.js").UnitStructuredCleanupRepository,
  materialEnrichment?: import("../../../../../domain/src/index.js").MaterialEnrichmentRepository,
  quizSession?: import("../../../../../domain/src/index.js").QuizSessionRepository,
  assessmentTarget?: import("../../../../../domain/src/index.js").AssessmentTargetRepository,
  flashcardExperience?: import("../../../../../domain/src/index.js").FlashcardExperienceRepository,
) {
  try {
    if (
      !unitActivity ||
      !unitStructuredCleanup ||
      !materialEnrichment ||
      !quizSession ||
      !unitSessionState ||
      !unitLearningProgressReset ||
      !materialCheckCompletion ||
      !quizSubmission ||
      !socraticEvidence ||
      !assessmentTarget ||
      !flashcardExperience
    ) {
      throw new Error("Unit activity persistence is unavailable");
    }
    const { action, payload } = body;

    const [page, content] = await Promise.all([
      unitRead.findPage({ userId, unitId }),
      unitRead.findContent({ userId, unitId }),
    ]);
    if (!page || !content) {
      throw new NotFoundException(tBackend("error.goal.unitNotFound"));
    }
    const unit = {
      ...page,
      contentRevision: content.contentRevision,
      learningMaterial: content.learningMaterial,
      goal: {
        id: page.goalId,
        userId: page.userId,
        title: page.goalTitle,
        contentLanguage: page.contentLanguage,
        level: page.level,
        generationOptions: page.generationOptions,
        goalKind: page.goalKind,
        learningMode: page.learningMode,
        topicCategory: page.topicCategory,
        mapPlanJson: page.mapPlanJson,
        cognitiveModelInputHash: page.cognitiveModelInputHash,
      },
    };

    if (unit.unitKind === "module") {
      throw new BadRequestException(tBackend("error.learning.moduleContainer"));
    }
    const isOverviewUnit = unit.unitKind === "overview";

    if (KACOM_ASSESSMENT_ACTIONS.has(action)) {
      await assertUnitAssessmentReady(
        unitId,
        generationRun,
        publicationFinalization,
        learnerStateMemoryInvalidation,
        presentationRead,
      );
    }

    const goalId = unit.goalId;
    const completionPersistence =
      unitCompletion && unitCompletionRead && cognitiveModelEvent
        ? {
            userId,
            repository: unitCompletion,
            contextRead: unitCompletionRead,
            knowledgeRead: completedUnitKnowledgeRead,
            cognitiveModelEvent,
          }
        : undefined;
    const progressionPort = {
      async openSession() {
        return unitSessionState
          ? unitSessionState.getOrCreateOwned(userId, unitId)
          : getOrCreateSession(userId, unitId);
      },
      async touchActivity(input: {
        payload: Omit<TouchUnitActivityInput, "userId" | "unitId">;
      }) {
        return unitActivity.touchOwned({
          userId,
          unitId,
          ...input.payload,
        });
      },
      async completeSection(input: { sectionId: string; skip: boolean }) {
        try {
          await completeUnitSection({
            userId,
            unitId,
            sectionId: input.sectionId,
            skip: input.skip,
            sectionProgress: unitSectionProgress,
            materialCheckCompletion,
          });
        } catch (error) {
          // Domain guardrails throw plain Error; map like LearningService.completeUnitSection.
          throw new HttpException(
            error instanceof Error
              ? localizeBackendMessage(error.message)
              : tBackend("error.internal"),
            HttpStatus.CONFLICT,
          );
        }
      },
      async listSections() {
        return getUnitSectionManifest(userId, unitId, undefined);
      },
      async setStep(input: { step: string; structuredSubStep?: "done" }) {
        await unitSessionState.updateOwned({
          userId,
          unitId,
          patch: {
            currentStep: input.step,
            ...(input.structuredSubStep
              ? { structuredSubStep: input.structuredSubStep }
              : {}),
          },
        });
      },
      async submitSectionMiniTest(input: {
        sectionId: string;
        answers: Record<string, number | number[] | boolean>;
      }) {
        let sectionContent: Awaited<ReturnType<typeof getUnitSectionContent>>;
        try {
          sectionContent = await getUnitSectionContent(
            userId,
            unitId,
            input.sectionId,
            undefined,
            undefined,
          );
        } catch (error) {
          throw new BadRequestException(
            error instanceof Error
              ? localizeBackendMessage(error.message)
              : tBackend("error.learning.sectionQuizContentInvalid"),
          );
        }
        if (!sectionContent.material) {
          throw new BadRequestException(
            tBackend("error.learning.sectionQuizRequired"),
          );
        }
        const sectionCheckIds = new Set(
          publishedMaterialCheckDefinitions(sectionContent.material).map(
            (definition) => definition.checkId,
          ),
        );
        const aggregated = await getAggregatedUnitMaterial(unitId, undefined);
        if (!aggregated) {
          throw new BadRequestException(
            tBackend("error.learning.materialRequired"),
          );
        }
        const definitions = publishedMaterialCheckDefinitions(
          aggregated,
        ).filter((definition) => sectionCheckIds.has(definition.checkId));
        try {
          const graded = await submitSectionMiniTestAnswers({
            persistence: undefined,
            userId,
            goalId,
            unitId,
            sectionId: input.sectionId,
            definitions,
            answers: input.answers,
            material: aggregated,
            targets: await assessmentTarget.findForUnit({ userId, unitId }),
            materialCheckCompletion,
          });
          if (
            unit.goal.goalKind !== "micro" &&
            unit.goal.learningMode !== "exploration"
          ) {
            await invalidateAgendaForUser(userId);
          }
          return graded;
        } catch (error) {
          throw new BadRequestException(
            error instanceof Error
              ? localizeBackendMessage(error.message)
              : tBackend("error.learning.sectionQuizSubmitFailed"),
          );
        }
      },
    };
    const session = (await dispatchUnitSessionProgressionCommand(
      progressionPort,
      { userId, unitId },
      { action: "open" },
    )) as Awaited<ReturnType<typeof getOrCreateSession>>;

    switch (action) {
      case "generate_section": {
        const sectionId = String(payload?.sectionId ?? "");
        if (!sectionId)
          throw new BadRequestException(
            tBackend("error.learning.sectionIdRequired"),
          );
        await generateUnitSectionMaterial({
          userId,
          unitId,
          sectionId,
          force: payload?.force === true,
          learnerStateMemoryInvalidation,
        });
        return {
          sections: await getUnitSectionManifest(userId, unitId, undefined),
          currentSectionId: sectionId,
        };
      }

      case "complete_section":
      case "skip_section": {
        try {
          return await dispatchUnitSessionProgressionCommand(
            progressionPort,
            { userId, unitId },
            { action, payload },
          );
        } catch (error) {
          const mapped = hostedSessionProgressionException(error);
          if (mapped) throw mapped;
          throw error;
        }
      }

      case "touch_activity": {
        return dispatchUnitSessionProgressionCommand(
          progressionPort,
          { userId, unitId },
          { action, payload },
        );
      }

      case "generate_sq": {
        // Legacy non-stream callers share the Survey lane until their save.
        // The main UI uses the tracked stream, which releases it after start.
        return await serializeUnitPreviewStart({ userId, unitId }, async () => {
        if (isOverviewUnit) {
          return {
            sq: null,
            structuredSubStep: "material",
            currentStep: "structured_input",
          };
        }
        await invalidateScenarioTheater(scenarioTheaterGeneration, unitId);
        await invalidateUnitLab(unitLab, unitId);
        if (content.sq3rData && unitAuthoringAgentEnabled()) {
          await resetUnitAuthoringSession({
            userId,
            goalId: unit.goal.id,
            unitId,
          });
        }
        {
          await ensureExpandedLearningTargets(
            unitRead,
            userId,
            unitId,
            undefined,
            generationRun,
            publication,
            publicationFinalization,
            projectBlueprint,
            learnerStateMemoryInvalidation,
          );
        }
        const artifactSnapshot = await artifacts.inspect({ userId, unitId });
        if (!artifactSnapshot)
          throw new NotFoundException(tBackend("error.goal.unitNotFound"));
        const sectionCount = artifactSnapshot.sectionCount;
        const hadLearningMaterial =
          Boolean(unit.learningMaterial) ||
          artifactSnapshot.hasLearningMaterial;
        const hadCornell = artifactSnapshot.hasCornellNote;
        const hadDownstream =
          hadLearningMaterial || sectionCount > 0 || hadCornell;
        const sq = await generateSqPreview(
          goalId,
          unitId,
          unit.title,
          unit.contentSummary,
          unit.goal.goalKind === "micro" ||
            unit.goal.learningMode === "exploration"
            ? {
                canonicalLearningTargets: [],
                learnerStateMemoryInvalidation,
              }
            : { learnerStateMemoryInvalidation },
        );
        // Regeneration is replacement-first. If authoring fails, retain the
        // old Survey and its course instead of leaving a half-deleted unit.
        const resetProgress = await resetUnitLearningProgress(
          unitId,
          unitLearningProgressReset,
          learnerStateMemoryInvalidation,
        );
        if (hadDownstream) {
          await clearStructuredDownstream(
            unitStructuredCleanup,
            userId,
            unitId,
            "sq",
          );
        }
        await unitSessionState.updateOwned({
          userId,
          unitId,
          patch: {
            sq3rData: JSON.stringify(sq),
            structuredSubStep: "sq",
            currentStep: "structured_input",
          },
        });
        await recommendScenarioTheaterFromSurvey(
          scenarioTheaterGeneration,
          unitId,
        );
        await recommendUnitLabFromSurvey(unitLab, unitId);
        const contentRevision = await bumpUnitContentRevision(unitId);
        return {
          sq,
          contentRevision,
          structuredSubStep: "sq",
          sections: [],
          clearedMaterial: hadDownstream,
          clearedSections: sectionCount > 0,
          clearedCornell: hadDownstream,
          resetProgress,
          unitStatus: resetProgress ? "in_progress" : unit.status,
          currentStep: "structured_input",
        };
        });
      }

      case "generate_material": {
        await invalidateScenarioTheater(scenarioTheaterGeneration, unitId);
        await invalidateUnitLab(unitLab, unitId);
        if (
          unit.goal.goalKind !== "micro" &&
          unit.goal.learningMode !== "exploration"
        ) {
          await clearStructuredDownstream(
            unitStructuredCleanup,
            userId,
            unitId,
            "material",
          );
          const sectionPlan = await ensureUnitSectionPlan(unitId, undefined, {
            force: true,
          });
          const firstSection = sectionPlan[0];
          if (firstSection) {
            await generateUnitSectionMaterial({
              userId,
              unitId,
              sectionId: String(firstSection.id),
              force: true,
              learnerStateMemoryInvalidation,
            });
            await artifacts.deleteLegacyMaterial({ userId, unitId });
            const sections = await getUnitSectionManifest(
              userId,
              unitId,
              undefined,
            );
            const unitRevision = await artifacts.inspect({ userId, unitId });
            await enqueueRecommendedScenarioTheater({
              client: scenarioTheaterGeneration,
              userId,
              unitId,
            });
            await enqueueRecommendedUnitLab({
              client: unitLab,
              userId,
              unitId,
            });
            return {
              material: await getAggregatedUnitMaterial(unitId, undefined),
              sections,
              contentRevision: unitRevision?.contentRevision,
              currentSectionId:
                sections.find(
                  (section) =>
                    section.status !== "completed" &&
                    section.status !== "skipped",
                )?.id ?? firstSection.id,
              structuredSubStep: "material",
              clearedCornell: true,
            };
          }
        }
        const hadCornell = Boolean(
          (await artifacts.inspect({ userId, unitId }))?.hasCornellNote,
        );
        const sq =
          parseSqData(session.sq3rData) ??
          (await generateSqPreview(
            goalId,
            unitId,
            unit.title,
            unit.contentSummary,
            unit.goal.goalKind === "micro" ||
              unit.goal.learningMode === "exploration"
              ? {
                  canonicalLearningTargets: [],
                  learnerStateMemoryInvalidation,
                }
              : { learnerStateMemoryInvalidation },
          ));
        const materialBase = await artifacts.inspect({ userId, unitId });
        if (!materialBase)
          throw new NotFoundException(tBackend("error.goal.unitNotFound"));
        const {
          material: textMaterial,
          contextSources,
          contentLanguage,
          materialSourceItems,
        } = await generateLearningMaterialWithSources(
          goalId,
          unitId,
          unit.title,
          unit.contentSummary,
          JSON.stringify(sq),
        );
        // Keep the last-good lesson, downstream artifacts, and learner state
        // intact until the replacement material has passed every structured
        // validation/repair and required component compilation step.
        const sourcesJson = serializeMaterialContextSources(contextSources);
        const committed = await commitLearningMaterialReplacement({
          materialReplacement,
          userId,
          goalId,
          unitId,
          material: textMaterial,
          materialSourceItems,
          contextSourcesJson: sourcesJson,
          sq3rData: JSON.stringify(sq),
          publishChecks:
            unit.goal.goalKind !== "micro" &&
            unit.goal.learningMode !== "exploration",
          expectedContentRevision: materialBase.contentRevision,
          assessmentTargets:
            unit.goal.goalKind !== "micro" &&
            unit.goal.learningMode !== "exploration"
              ? await assessmentTarget.findForUnit({ userId, unitId })
              : [],
          learnerStateMemoryInvalidation,
        });
        const contentRevision = committed.contentRevision;
        const resetProgress = committed.reset.reset;
        void enrichMaterialImagesInBackground(
          materialEnrichment,
          userId,
          unitId,
          textMaterial,
          goalId,
          unit.title,
          contentLanguage,
          contentRevision,
        );
        await enqueueRecommendedScenarioTheater({
          client: scenarioTheaterGeneration,
          userId,
          unitId,
        });
        await enqueueRecommendedUnitLab({
          client: unitLab,
          userId,
          unitId,
        });
        return {
          material: textMaterial,
          materialSources: contextSources,
          contentRevision,
          structuredSubStep: "material",
          clearedCornell: hadCornell,
          resetProgress,
          unitStatus: resetProgress ? "in_progress" : unit.status,
          currentStep: "structured_input",
        };
      }

      case "finish_material_reading": {
        try {
          return await finishMaterialReading(
            {
              async loadMaterialReadingGate() {
                const manifest = await getUnitSectionManifest(
                  userId,
                  unitId,
                  undefined,
                );
                const requiredSections = manifest.filter(
                  (section) => section.requiredForCompletion,
                );
                const completedSections = requiredSections
                  .filter(
                    (section) =>
                      section.status === "completed" ||
                      section.status === "skipped",
                  )
                  .map((section) => ({ sectionId: section.id }));
                const material = requiredSections.length
                  ? await getAggregatedUnitMaterial(unitId, undefined, {
                      requireAll: true,
                    })
                  : unit.learningMaterial
                    ? parseLearningMaterial(unit.learningMaterial)
                    : null;
                const definitions = material
                  ? publishedMaterialCheckDefinitions(material)
                  : [];
                const results = material
                  ? await listMaterialCheckResults({
                      persistence: undefined,
                      userId,
                      unitId,
                      checkIds: definitions.map(
                        (definition) => definition.checkId,
                      ),
                      materialCheckCompletion,
                    })
                  : [];
                const answered = new Set(
                  results.map((result) => result.checkId),
                );
                return {
                  requiredSectionIds: requiredSections.map(
                    (section) => section.id,
                  ),
                  completedSectionIds: completedSections.map(
                    (progress) => progress.sectionId,
                  ),
                  hasMaterial: material !== null,
                  missingCheckIds: definitions
                    .map((definition) => definition.checkId)
                    .filter((checkId) => !answered.has(checkId)),
                  scenarioTheaterOffered:
                    await scenarioTheaterCompletionRequired(
                      scenarioTheaterSession,
                      userId,
                      unitId,
                    ),
                  unitLabOffered: await unitLabCompletionOffered(
                    unitLab,
                    userId,
                    unitId,
                  ),
                };
              },
              async setStructuredSubStep() {
                await unitSessionState.updateOwned({
                  userId,
                  unitId,
                  patch: { structuredSubStep: "questions" },
                });
              },
            },
            { userId, unitId },
          );
        } catch (error) {
          if (!(error instanceof MaterialReadingTransitionError)) throw error;
          if (error.code === "unit_sections_required") {
            throw new HttpException(
              {
                message: tBackend(
                  "error.learning.completeRequiredSectionsFirst",
                ),
                code: error.code,
              },
              HttpStatus.CONFLICT,
            );
          }
          if (error.code === "material_checks_required") {
            throw new HttpException(
              {
                message: tBackend("error.learning.completeSectionQuizFirst"),
                code: error.code,
                missingCheckIds: error.details.missingCheckIds ?? [],
              },
              HttpStatus.CONFLICT,
            );
          }
          throw new BadRequestException(
            tBackend("error.learning.materialRequired"),
          );
        }
      }

      case "start_scenario_theater":
        return {
          scenarioTheater: await startScenarioTheater(
            scenarioTheaterSession,
            userId,
            unitId,
          ),
          structuredSubStep: "theater",
        };

      case "start_unit_lab":
        return {
          ...(await startUnitLab(unitLab, userId, unitId)),
          structuredSubStep: "questions",
        };

      case "complete_unit_lab":
        return {
          unitLabSession: await completeUnitLab(unitLab, userId, unitId),
          structuredSubStep: "questions",
        };

      case "choose_scenario_option":
        return {
          scenarioTheater: await chooseScenarioTheaterOption(
            scenarioTheaterSession,
            userId,
            unitId,
            payload ?? {},
          ),
          structuredSubStep: "theater",
        };

      case "restart_scenario_theater":
        return {
          scenarioTheater: await restartScenarioTheater(
            scenarioTheaterSession,
            userId,
            unitId,
          ),
          structuredSubStep: "theater",
        };

      case "submit_section_mini_test": {
        try {
          return await dispatchUnitSessionProgressionCommand(
            progressionPort,
            { userId, unitId },
            { action, payload },
          );
        } catch (error) {
          const mapped = hostedSessionProgressionException(error);
          if (mapped) throw mapped;
          throw error;
        }
      }

      case "submit_material_check": {
        const blockIndex = Number(payload?.blockIndex);
        const itemIndex = Number(payload?.itemIndex ?? 0);
        if (!Number.isInteger(blockIndex) || blockIndex < 0) {
          throw new BadRequestException(
            tBackend("error.learning.invalidInteractionIndex"),
          );
        }
        const material = await getAggregatedUnitMaterial(unitId, undefined);
        if (!material)
          throw new BadRequestException(
            tBackend("error.learning.materialRequired"),
          );
        const requestedCheckId =
          typeof payload?.checkId === "string" ? payload.checkId.trim() : "";
        const currentPublishedDefinition = publishedMaterialCheckDefinitions(
          material,
        ).find(
          (definition) =>
            definition.blockIndex === blockIndex &&
            definition.itemIndex === itemIndex,
        );
        const publishedDefinition =
          currentPublishedDefinition?.checkId === requestedCheckId
            ? currentPublishedDefinition
            : undefined;
        const block = material.blocks[blockIndex];
        if (!block || block.type !== "check") {
          throw new BadRequestException(
            tBackend("error.learning.interactionValidationUnsupported"),
          );
        }
        if (
          (requestedCheckId && !publishedDefinition) ||
          (currentPublishedDefinition && !requestedCheckId)
        ) {
          throw new BadRequestException(
            tBackend("error.learning.materialCheckUpdated"),
          );
        }
        if (publishedDefinition) {
          if (block.type !== "check") {
            throw new BadRequestException(
              tBackend("error.learning.materialCheckTypeInvalid"),
            );
          }
          let selectedAnswer: number | number[] | boolean;
          if (publishedDefinition.questionType === "true_false") {
            if (typeof payload?.answer !== "boolean") {
              throw new BadRequestException(
                tBackend("error.learning.trueFalseAnswerRequired"),
              );
            }
            selectedAnswer = payload.answer;
          } else if (publishedDefinition.questionType === "mcq_multi") {
            if (!Array.isArray(payload?.answer)) {
              throw new BadRequestException(
                tBackend("error.learning.answerChoiceRequired"),
              );
            }
            const answer = payload.answer.filter((item) =>
              Number.isInteger(item),
            ) as number[];
            if (
              answer.length === 0 ||
              answer.some(
                (index) => index < 0 || index >= (block.options?.length ?? 0),
              )
            ) {
              throw new BadRequestException(
                tBackend("error.learning.invalidAnswerOption"),
              );
            }
            selectedAnswer = answer;
          } else {
            if (typeof payload?.answer !== "number") {
              throw new BadRequestException(
                tBackend("error.learning.answerChoiceRequired"),
              );
            }
            if (
              !Number.isInteger(payload.answer) ||
              payload.answer < 0 ||
              payload.answer >= (block.options?.length ?? 0)
            ) {
              throw new BadRequestException(
                tBackend("error.learning.invalidAnswerOption"),
              );
            }
            selectedAnswer = payload.answer;
          }
          const submit = submitPublishedMaterialCheck({
            persistence: undefined,
            userId,
            goalId,
            unitId,
            definition: publishedDefinition,
            selectedAnswer,
            material,
            targets: await assessmentTarget.findForUnit({ userId, unitId }),
            materialCheckCompletion,
          });
          return submit.then(async (result) => {
            if (
              unit.goal.goalKind !== "micro" &&
              unit.goal.learningMode !== "exploration"
            ) {
              await invalidateAgendaForUser(userId);
            }
            return result;
          });
        }
        if (typeof payload?.answer !== "number") {
          throw new BadRequestException(
            tBackend("error.learning.answerChoiceRequired"),
          );
        }
        const localLearningTargetRef = block.learningTargetIds[0];
        const criterionRef = block.criterionRef;
        if (block.evidenceDimension === "memory") {
          throw new BadRequestException(
            tBackend("error.learning.legacyCheckEvidenceUnsupported"),
          );
        }
        const dimension = block.evidenceDimension;
        const contextDistance = block.contextDistance;
        const correct = payload.answer === block.correctIndex;
        const explanation = block.explanation;
        if (
          unit.goal.goalKind !== "micro" &&
          unit.goal.learningMode !== "exploration"
        ) {
          await recordVerifiedMaterialCheckEvidence({
            persistence: undefined,
            userId,
            goalId,
            unitId,
            blockKey: `${unit.contentRevision}:${blockIndex}:${itemIndex}`,
            localLearningTargetRef,
            criterionRef,
            dimension,
            contextDistance,
            correct,
            response: payload?.answer,
            targets: await assessmentTarget.findForUnit({ userId, unitId }),
            materialCheckCompletion,
          });
        }
        return { correct, explanation };
      }

      case "generate_sq_answers": {
        const sq =
          parseSqData(session.sq3rData) ??
          parseJson<SqPreview>(session.sq3rData, {
            survey: { outline: [], learningTargetLabels: [] },
            learningTargets: [],
            questions: [],
          });
        const questionTexts = sqQuestionTexts(sq.questions);
        if (!questionTexts.length) {
          throw new BadRequestException(
            tBackend("error.learning.guidingQuestionsNotFound"),
          );
        }
        const material = await getAggregatedUnitMaterial(unitId, undefined, {
          requireAll: true,
        });
        if (!material) {
          throw new BadRequestException(
            tBackend("error.learning.materialRequired"),
          );
        }
        const answers = await generateSqQuestionAnswers(
          goalId,
          unit.title,
          questionTexts,
          JSON.stringify(material),
        );
        const graphState = parseSessionGraphState(session.graphState);
        await unitSessionState.updateOwned({
          userId,
          unitId,
          patch: {
            graphState: JSON.stringify({
              ...graphState,
              sqQuestionAnswers: answers,
            }),
          },
        });
        return { sqQuestionAnswers: answers };
      }

      case "generate_cornell": {
        const resetProgress = await resetUnitLearningProgress(
          unitId,
          unitLearningProgressReset,
          learnerStateMemoryInvalidation,
        );
        const sq =
          parseSqData(session.sq3rData) ??
          parseJson<SqPreview>(session.sq3rData, {
            survey: { outline: [], learningTargetLabels: [] },
            learningTargets: [],
            questions: [],
          });
        const material = await getAggregatedUnitMaterial(unitId, undefined, {
          requireAll: true,
        });
        if (!material) {
          throw new BadRequestException(
            tBackend("error.learning.completeMaterialFirst"),
          );
        }
        const cornell = await generateCornell(
          goalId,
          unit.title,
          JSON.stringify(sq),
          JSON.stringify(material),
          { userId, unitId },
        );
        await artifacts.saveCornell({
          userId,
          unitId,
          notes: cornell.notes,
          cues: cornell.cues,
          summary: cornell.summary,
        });
        await unitSessionState.updateOwned({
          userId,
          unitId,
          patch: { structuredSubStep: "cornell" },
        });
        return {
          cornell,
          structuredSubStep: "cornell",
          resetProgress,
          unitStatus: resetProgress ? "in_progress" : unit.status,
          currentStep: "structured_input",
        };
      }

      case "start_sq3r": {
        const sq = await generateSqPreview(
          goalId,
          unitId,
          unit.title,
          unit.contentSummary,
          unit.goal.goalKind === "micro" ||
            unit.goal.learningMode === "exploration"
            ? {
                canonicalLearningTargets: [],
                learnerStateMemoryInvalidation,
              }
            : { learnerStateMemoryInvalidation },
        );
        await unitSessionState.updateOwned({
          userId,
          unitId,
          patch: {
            sq3rData: JSON.stringify(sq),
            structuredSubStep: "sq",
          },
        });
        return { sq, structuredSubStep: "sq" };
      }

      case "set_step": {
        let next: string;
        try {
          const result = await dispatchUnitSessionProgressionCommand(
            progressionPort,
            { userId, unitId },
            {
              action,
              payload,
              gate: {
                isLearningDone: isUnitLearningDone(unit.status),
                feynmanEnabled: FEATURE_FEYNMAN,
              },
            },
          );
          next = (result as { currentStep: string }).currentStep;
        } catch (error) {
          const mapped = hostedSessionProgressionException(error);
          if (mapped) throw mapped;
          throw error;
        }
        if (next === "socratic") {
          const graphState = parseSessionGraphState(session.graphState);
          const payload = await bootstrapSocraticForSession(
            unitSessionState,
            userId,
            unitId,
            goalId,
            unit.title,
            graphState,
          );
          return {
            currentStep: next,
            isLearningDone: true,
            unitStatus: unit.status,
            ...payload,
          };
        }
        return {
          currentStep: next,
          isLearningDone: true,
          unitStatus: unit.status,
        };
      }

      case "start_socratic": {
        const graphState = parseSessionGraphState(session.graphState);
        return bootstrapSocraticForSession(
          unitSessionState,
          userId,
          unitId,
          goalId,
          unit.title,
          graphState,
          { socraticTurn: session.socraticTurn },
        );
      }

      case "select_socratic_thread": {
        const threadId = String(payload?.threadId ?? "");
        if (!threadId) {
          throw new BadRequestException(
            tBackend("error.learning.threadIdRequired"),
          );
        }
        const graphState = parseSessionGraphState(session.graphState);
        const { threads } = ensureSocraticThreads(graphState);
        if (!threads.some((thread) => thread.id === threadId)) {
          throw new BadRequestException(
            tBackend("error.learning.threadNotFound"),
          );
        }
        return bootstrapSocraticForSession(
          unitSessionState,
          userId,
          unitId,
          goalId,
          unit.title,
          graphState,
          {
            activeThreadId: threadId,
            socraticTurn: session.socraticTurn,
            bootstrapQuestion: true,
          },
        );
      }

      case "finish_socratic": {
        const graphState = parseSessionGraphState(session.graphState);
        return finishSocraticSession(
          unitSessionState,
          userId,
          unitId,
          goalId,
          unit.title,
          graphState,
        );
      }

      case "generate_quiz": {
        const requiresSectionCompletion =
          unit.goal.goalKind !== "micro" &&
          unit.goal.learningMode !== "exploration";
        const requiredSections = requiresSectionCompletion
          ? (await getUnitSectionManifest(userId, unitId, undefined)).filter(
              (section) => section.requiredForCompletion,
            )
          : [];
        const completedSections = requiredSections.length
          ? requiredSections
              .filter(
                (section) =>
                  section.status === "completed" ||
                  section.status === "skipped",
              )
              .map((section) => ({ sectionId: section.id }))
          : [];
        const material = await getAggregatedUnitMaterial(unitId, undefined, {
          requireAll: true,
        });
        const checkIds = material
          ? publishedMaterialCheckDefinitions(material).map(
              (definition) => definition.checkId,
            )
          : [];
        const checkResults = checkIds.length
          ? await listMaterialCheckResults({
              persistence: undefined,
              userId,
              unitId,
              checkIds,
              materialCheckCompletion,
            })
          : [];
        try {
          assertUnitSessionAssessmentReady({
            requiredSectionIds: requiredSections.map((section) => section.id),
            completedSectionIds: completedSections.map(
              (section) => section.sectionId,
            ),
            hasMaterial: material !== null,
            missingCheckIds: checkIds.filter(
              (checkId) =>
                !new Set(checkResults.map((result) => result.checkId)).has(
                  checkId,
                ),
            ),
          });
        } catch (error) {
          if (!(error instanceof MaterialReadingTransitionError)) throw error;
          if (error.code === "unit_sections_required") {
            throw new HttpException(
              {
                message: tBackend(
                  "error.learning.completeRequiredSectionsFirst",
                ),
                code: error.code,
              },
              HttpStatus.CONFLICT,
            );
          }
          if (error.code === "material_checks_required") {
            throw new HttpException(
              {
                message: tBackend("error.learning.completeSectionQuizFirst"),
                code: error.code,
                missingCheckIds: error.details.missingCheckIds ?? [],
              },
              HttpStatus.CONFLICT,
            );
          }
          throw new BadRequestException(
            tBackend("error.learning.materialRequiredForQuiz"),
          );
        }
        if (!material) {
          // The shared gate above has already mapped this condition; this
          // guard narrows the adapter result for the remainder of the flow.
          throw new BadRequestException(
            tBackend("error.learning.materialRequiredForQuiz"),
          );
        }
        const materialJson = serializeLearningMaterialForQuiz(material);
        if (
          unit.goal.goalKind !== "micro" &&
          unit.goal.learningMode !== "exploration"
        ) {
          await ensureExpandedLearningTargets(
            unitRead,
            userId,
            unitId,
            undefined,
            generationRun,
            publication,
            publicationFinalization,
            projectBlueprint,
            learnerStateMemoryInvalidation,
          );
        }
        const targets =
          unit.goal.goalKind === "micro" ||
          unit.goal.learningMode === "exploration"
            ? []
            : await assessmentTarget.ensureQuizAssessableForUnit({
                userId,
                unitId,
              });
        const quizTargets = targets.filter(isQuizAssessableLearningTarget);
        if (
          unit.goal.goalKind !== "micro" &&
          unit.goal.learningMode !== "exploration" &&
          quizTargets.length === 0
        ) {
          throw new BadRequestException(
            tBackend("error.learning.noQuizAssessableTargets"),
          );
        }
        const adaptiveBatch =
          unit.goal.goalKind === "micro" ||
          unit.goal.learningMode === "exploration"
            ? null
            : await buildAdaptiveQuizBatch(
                userId,
                unitId,
                quizTargets,
                stateRead,
                quizSession,
              );
        const quiz = await streamGenerateQuiz(
          unit.goal,
          unit.title,
          materialJson,
          undefined,
          undefined,
          {
            unitId,
            difficulty: unit.difficulty as
              "easy" | "medium" | "hard" | undefined,
            standaloneMicro:
              unit.goal.goalKind === "micro" ||
              unit.goal.learningMode === "exploration",
            ...(unit.goal.goalKind === "micro" ||
            unit.goal.learningMode === "exploration"
              ? {}
              : {
                  learningTargetsBlock:
                    learningTargetCompetencyBlock(quizTargets),
                  assessmentTargets: quizTargets,
                  batchPlan: adaptiveBatch?.batchPlan,
                  validateQuiz: (candidate: {
                    questions: QuizQuestion[];
                    interleaved: QuizQuestion[];
                  }) =>
                    validateQuizQuestionEvidenceDeclaration({
                      source: "quiz",
                      questions: [
                        ...candidate.questions,
                        ...candidate.interleaved,
                      ],
                      targets: quizTargets,
                    }),
                }),
          },
        );
        const persisted = await persistGeneratedQuiz(
          quizSession,
          userId,
          unitId,
          session.graphState,
          quiz,
        );
        const recallProgress =
          unit.goal.goalKind === "micro" ||
          unit.goal.learningMode === "exploration"
            ? undefined
            : await buildUnitRecallProgress(
                userId,
                unitId,
                quizTargets,
                stateRead,
                quizSession,
              );
        return recallProgress ? { ...persisted, recallProgress } : persisted;
      }

      case "generate_flashcards": {
        const material = await getAggregatedUnitMaterial(unitId, undefined, {
          requireAll: true,
        });
        if (!material) {
          throw new BadRequestException(
            tBackend("error.learning.materialRequiredForFlashcards"),
          );
        }
        const result = await generateUnitFlashcards(
          quizSession,
          flashcardExperience,
          userId,
          unitId,
        );
        const graphState = parseSessionGraphState(session.graphState);
        await unitSessionState.updateOwned({
          userId,
          unitId,
          patch: {
            graphState: JSON.stringify({
              ...graphState,
              flashcardDeckId: result.deck?.id,
            }),
            currentStep: "active_recall",
          },
        });
        return result;
      }

      case "select_quiz_set": {
        const quizSetId = String(payload?.quizSetId ?? "");
        if (!quizSetId) {
          throw new BadRequestException(
            tBackend("error.learning.quizSetIdRequired"),
          );
        }
        const detail = await getQuizSetDetail(
          unitId,
          quizSetId,
          undefined,
          quizSession,
          userId,
        );
        if (!detail) {
          throw new NotFoundException(
            tBackend("error.learning.quizSetNotFound"),
          );
        }

        const attemptId =
          typeof payload?.attemptId === "string" ? payload.attemptId : null;
        const attempt =
          attemptId === "latest"
            ? (detail.attempts[0] ?? null)
            : attemptId
              ? (detail.attempts.find((row) => row.id === attemptId) ?? null)
              : null;
        const graphState = parseSessionGraphState(session.graphState);
        const { questions, interleaved } = {
          questions: detail.questions,
          interleaved: detail.interleaved,
        };

        await unitSessionState.updateOwned({
          userId,
          unitId,
          patch: {
            graphState: JSON.stringify({
              ...graphState,
              quiz: { questions, interleaved },
              quizSetId: detail.id,
              quizAttemptId: attempt?.id,
              score: attempt?.score,
              weakTags: attempt?.weakTags,
              quizResults: attempt?.results,
            }),
            currentStep: "active_recall",
            structuredSubStep: "done",
          },
        });

        return {
          quizSetId: detail.id,
          questions,
          interleaved,
          quizGrade: attempt
            ? {
                score: attempt.score,
                weakTags: attempt.weakTags,
                results: attempt.results,
              }
            : null,
          quizExplanations:
            attempt && Object.keys(attempt.explanations).length > 0
              ? attempt.explanations
              : undefined,
          quizAttemptId: attempt?.id ?? null,
          readOnly: Boolean(attempt),
          selectedAttemptId: attempt?.id ?? null,
        };
      }

      case "submit_quiz": {
        const state = parseJson<{
          quiz?: { questions: QuizQuestion[]; interleaved: QuizQuestion[] };
          quizSetId?: string;
          quizAttemptId?: string;
        }>(session.graphState, {});
        if (state.quizAttemptId) {
          throw new BadRequestException(
            tBackend("error.learning.quizAlreadySubmittedReset"),
          );
        }
        const allQ = [
          ...(state.quiz?.questions ?? []),
          ...(state.quiz?.interleaved ?? []),
        ];
        const answerPayload =
          (payload?.answers as Record<
            string,
            string | number | boolean | number[]
          >) ?? {};
        const sq = parseSqData(session.sq3rData);
        const { score, weakTags, weakLearningTargetIds, results } =
          await gradeQuiz(allQ, answerPayload, sq?.learningTargets);
        const quizSetId = state.quizSetId;
        if (!quizSetId) {
          throw new BadRequestException(
            tBackend("error.learning.quizSetInvalid"),
          );
        }
        const targets =
          unit.goal.goalKind === "micro" ||
          unit.goal.learningMode === "exploration"
            ? []
            : await assessmentTarget.findForUnit({ userId, unitId });
        const perLearningTargetResults =
          unit.goal.goalKind === "micro" ||
          unit.goal.learningMode === "exploration"
            ? []
            : scoreQuizByLearningTarget({
                questions: allQ,
                results,
                targets,
              }).perLearningTarget;
        const practiceAfterCompletion = isUnitLearningDone(unit.status);
        const evidenceSource = practiceAfterCompletion
          ? ("review_quiz" as const)
          : ("quiz" as const);
        const evidenceDeclaration = {
          source: evidenceSource,
          questions: allQ,
          results,
          targets,
        } as const;
        let quizEvidenceRecorded = false;
        const nextStep = postQuizNextStep(score, practiceAfterCompletion);
        const activityAttemptId = buildQuizEvidenceSubmissionId({
          userId,
          unitId,
          quizSetId,
          sessionId: session.id,
          sessionUpdatedAt: session.updatedAt.toISOString(),
        });
        const recordsCognitiveEvidence =
          unit.goal.goalKind !== "micro" &&
          unit.goal.learningMode !== "exploration";
        const evidenceItems = recordsCognitiveEvidence
          ? buildQuizSubmissionItems({
              unitId,
              activityAttemptId,
              source: evidenceSource,
              questions: allQ,
              results,
              answers: answerPayload,
              targets,
              invalidQuestionPolicy: "skip",
            }).items
          : [];
        const submitted = await quizSubmission.record({
          userId,
          goalId,
          unitId,
          quizSetId,
          activityAttemptId,
          questionsJson: JSON.stringify(allQ),
          answersJson: JSON.stringify(answerPayload),
          resultsJson: JSON.stringify(results),
          weakTagsJson: JSON.stringify(weakTags),
          perLearningTargetResultsJson: JSON.stringify(
            perLearningTargetResults,
          ),
          score,
          purpose: practiceAfterCompletion ? "review" : "learning",
          nextGraphStateJson: JSON.stringify({
            ...parseSessionGraphState(session.graphState),
            quiz: state.quiz,
            quizSetId,
            score,
            weakTags,
            weakLearningTargetIds,
            quizResults: results,
            socraticQuestion: undefined,
            socraticThreads: undefined,
            activeSocraticThreadId: undefined,
          }),
          nextStep,
          items: evidenceItems,
        });
        const quizAttemptId = submitted.quizAttemptId;
        quizEvidenceRecorded = submitted.observationCount > 0;
        let completedUnitStatus: string | undefined;
        if (nextStep === "complete" && !practiceAfterCompletion) {
          const completion = await completeUnit(
            unitId,
            score,
            false,
            completionPersistence,
            learnerStateMemoryInvalidation,
          );
          completedUnitStatus = completion.status;
          await markAgendaItemCompletedForUnit(userId, unitId, "new_learning");
        }
        if (
          quizEvidenceRecorded &&
          unit.goal.goalKind !== "micro" &&
          unit.goal.learningMode !== "exploration" &&
          (practiceAfterCompletion || !completedUnitStatus)
        ) {
          await learnerStateMemoryInvalidation?.invalidate({
            userId,
            reason: "quiz_evidence_recorded",
          });
        }
        if (
          unit.goal.goalKind !== "micro" &&
          unit.goal.learningMode !== "exploration"
        ) {
          await invalidateAgendaForUser(userId);
        }
        const recallProgress =
          unit.goal.goalKind === "micro" ||
          unit.goal.learningMode === "exploration"
            ? undefined
            : await buildUnitRecallProgress(
                userId,
                unitId,
                targets,
                stateRead,
                quizSession,
              );
        return {
          score,
          weakTags,
          results,
          nextStep,
          quizSetId,
          quizAttemptId,
          quizExplanations: {},
          ...(recallProgress ? { recallProgress } : {}),
          ...(completedUnitStatus
            ? {
                isLearningDone: true,
                unitStatus: completedUnitStatus,
              }
            : practiceAfterCompletion
              ? {
                  isLearningDone: true,
                  unitStatus: unit.status,
                }
              : {}),
        };
      }

      case "submit_feynman": {
        const feynmanEligibility = hostedFeynmanEligibility(
          unit.goal,
          FEATURE_FEYNMAN,
        );
        if (feynmanEligibility === "feature_disabled") {
          throw new BadRequestException(
            tBackend("error.learning.feynmanUnavailable"),
          );
        }
        if (feynmanEligibility === "exploration_unsupported") {
          throw new BadRequestException(
            tBackend("error.learning.explorationFeynmanEvidenceUnsupported"),
          );
        }
        const userText = String(payload?.userText ?? "");
        const targets = await assessmentTarget.findForUnit({ userId, unitId });
        const fb = await evaluateFeynman(
          goalId,
          unitId,
          unit.title,
          userText,
          learningTargetCompetencyBlock(targets),
        );
        validateFeynmanRubricResult({
          targets,
          observations: fb.criterionScores,
          passed: fb.passed,
        });
        let feynmanObservationCount = 0;
        if (feynmanEvidence) {
          const { createHash } = await import("node:crypto");
          const stableHash = (value: unknown) =>
            createHash("sha256")
              .update(JSON.stringify(value))
              .digest("hex")
              .slice(0, 24);
          const observations = fb.criterionScores.map((observation) => {
            const target = targets.find(
              (candidate) =>
                candidate.localRef.toLowerCase() ===
                observation.learningTargetId.toLowerCase(),
            );
            if (!target) {
              throw new Error(
                `Unknown Feynman LearningTarget ${observation.learningTargetId}`,
              );
            }
            const requirements = target.requirements.filter(
              (requirement) => requirement.dimension === "understanding",
            );
            const declarationHash = stableHash(
              JSON.stringify({
                unitId,
                targetId: target.id,
                criterionRef: observation.criterionRef,
                entities: requirements.map((requirement) => [
                  requirement.cognitiveEntityId,
                  requirement.entityDefinitionVersion,
                ]),
              }),
            );
            return {
              task: {
                stableKey: `assessment:feynman:${declarationHash}`,
                targetId: target.id,
                title: `Feynman explanation · ${target.title}`,
                instructions: target.learningObjective,
                definitionVersion: 1,
                requirements: requirements.map((requirement, orderIndex) => ({
                  cognitiveEntityId: requirement.cognitiveEntityId,
                  learningTargetId: target.id,
                  dimension: "understanding" as const,
                  criterionRef: observation.criterionRef,
                  definitionVersion: requirement.entityDefinitionVersion,
                  required: requirement.required,
                  weight: requirement.weight,
                  orderIndex,
                  rubricCriterion: {
                    ref: observation.criterionRef,
                    definitionVersion: requirement.entityDefinitionVersion,
                  },
                })),
              },
              criterionRef: observation.criterionRef,
              score: observation.score,
              rationale: observation.rationale,
            };
          });
          const recorded = await feynmanEvidence.record({
            userId,
            goalId,
            unitId,
            userText,
            feedback: fb,
            passed: fb.passed,
            observations,
          });
          feynmanObservationCount = recorded.observationCount;
        } else {
          throw new Error("Feynman evidence persistence is unavailable");
        }
        if (feynmanObservationCount > 0) {
          await learnerStateMemoryInvalidation?.invalidate({
            userId,
            reason: "feynman_evidence_recorded",
          });
        }
        const graphState = parseSessionGraphState(session.graphState);
        const mergeWeakTags = (spots: string[]) => [
          ...new Set([...(graphState.weakTags ?? []), ...spots]),
        ];
        const practiceAfterCompletion = isUnitLearningDone(unit.status);

        if (practiceAfterCompletion) {
          if (!fb.passed) {
            const weakTags = mergeWeakTags(fb.blindSpots);
            const nextGraph = {
              ...graphState,
              weakTags,
              feynmanFeedback: fb,
              socraticThreads: undefined,
              activeSocraticThreadId: undefined,
              socraticQuestion: undefined,
            };
            const socratic = await bootstrapSocraticForSession(
              unitSessionState,
              userId,
              unitId,
              goalId,
              unit.title,
              nextGraph,
            );
            return {
              feedback: fb,
              nextStep: "socratic",
              ...socratic,
            };
          }
          await unitSessionState.updateOwned({
            userId,
            unitId,
            patch: { currentStep: "feynman" },
          });
          return {
            feedback: fb,
            nextStep: "feynman",
          };
        }

        let nextStep: string = fb.passed ? "complete" : "socratic";
        let completedUnitStatus: string | undefined;
        if (fb.passed && (graphState.score ?? 0) >= 0.7) {
          const completion = await completeUnit(
            unitId,
            graphState.score ?? 0.8,
            true,
            completionPersistence,
            learnerStateMemoryInvalidation,
          );
          completedUnitStatus = completion.status;
          await markAgendaItemCompletedForUnit(userId, unitId, "new_learning");
          await invalidateAgendaForUser(userId);
          nextStep = "complete";
        } else if (!fb.passed) {
          const weakTags = mergeWeakTags(fb.blindSpots);
          const nextGraph = {
            ...graphState,
            weakTags,
            feynmanFeedback: fb,
            socraticThreads: undefined,
            activeSocraticThreadId: undefined,
            socraticQuestion: undefined,
          };
          const socratic = await bootstrapSocraticForSession(
            unitSessionState,
            userId,
            unitId,
            goalId,
            unit.title,
            nextGraph,
          );
          return {
            feedback: fb,
            nextStep: "socratic",
            ...socratic,
          };
        }
        return {
          feedback: fb,
          nextStep,
          ...(completedUnitStatus
            ? {
                isLearningDone: true,
                unitStatus: completedUnitStatus,
              }
            : {}),
        };
      }

      case "socratic": {
        const graphState = parseSessionGraphState(session.graphState);
        const answer = String(payload?.answer ?? "").trim();
        if (!answer) {
          throw new BadRequestException(
            tBackend("error.learning.answerRequired"),
          );
        }
        const { threads, activeThreadId } = ensureSocraticThreads(graphState);
        const activeThread = pickActiveSocraticThread(threads, activeThreadId);
        if (!activeThread) {
          throw new BadRequestException(
            tBackend("error.learning.noSocraticConversation"),
          );
        }
        if (activeThread.done) {
          throw new BadRequestException(
            tBackend("error.learning.socraticEnded"),
          );
        }

        const result = await processSocraticTurn({
          goalId,
          unitId,
          unitTitle: unit.title,
          graphState,
          thread: activeThread,
          answer,
          weakTags: graphState.weakTags ?? [],
        });

        const response = await applySocraticTurnResult(
          unitSessionState,
          userId,
          unitId,
          graphState,
          threads,
          activeThread,
          result,
        );
        if (
          unit.goal.goalKind !== "micro" &&
          unit.goal.learningMode !== "exploration"
        ) {
          await recordSocraticEvidenceBestEffort({
            userId,
            goalId,
            unitId,
            threadId: activeThread.id,
            turn: result.thread.turn,
            learningTargetRef: activeThread.learningTargetRef,
            criterionRef: activeThread.criterionRef,
            answer,
            resolved: result.resolved,
            terminatedByLimit: result.terminatedByLimit,
            learnerStateMemoryInvalidation,
            socraticEvidence,
            assessmentTarget,
          });
        }
        return response;
      }

      case "complete": {
        if (isUnitLearningDone(unit.status)) {
          await unitSessionState.updateOwned({
            userId,
            unitId,
            patch: { currentStep: "complete" },
          });
          return {
            nextStep: "complete",
            isLearningDone: true,
            unitStatus: unit.status,
          };
        }
        const graphState = parseSessionGraphState(session.graphState);
        const lastFeynman = await artifacts.findLatestFeynman({
          userId,
          unitId,
        });
        const completion = await completeUnit(
          unitId,
          graphState.score ?? 0.75,
          lastFeynman?.passed ?? true,
          completionPersistence,
          learnerStateMemoryInvalidation,
        );
        await markAgendaItemCompletedForUnit(userId, unitId, "new_learning");
        await invalidateAgendaForUser(userId);
        return {
          nextStep: "complete",
          isLearningDone: true,
          unitStatus: completion.status,
        };
      }

      default:
        throw new BadRequestException(tBackend("error.learning.invalidAction"));
    }
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error(e);
    throw new HttpException(
      tBackend("error.internal"),
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
