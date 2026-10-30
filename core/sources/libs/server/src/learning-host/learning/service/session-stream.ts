import { NotFoundException } from "@nestjs/common";
import { tBackend } from "../../../../../common/src/index.js";
import {
  isUnitLearningDone,
  type MaterialReplacementRepository,
  type UnitLearningProgressResetRepository,
  type LearnerStateProjectionReadRepository,
  type LearnerStateMemoryInvalidationRepository,
  type UnitDeliveryReadRepository,
  type UnitSessionArtifactRepository,
} from "../../../../../domain/src/index.js";
import { createMaterialDelta } from "../../../../../contracts/src/index.js";
import { assertRunActive } from "../../../generation/run.js";
import { createTrackedTokenHandler } from "../../../generation/token-handler.js";
import { handleTrackedStreamPost } from "../../../generation/tracked-sse.js";
import { startUnitPreviewStream } from "../../../generation/unit-preview-start.js";
import { runWithUserId } from "../../../user-context.js";
import { resetUnitLearningProgress } from "../../../domain/reset-unit-learning.js";
import { parseSessionGraphState } from "../../../graph/review-mode.js";
import {
  ensureSocraticThreads,
  pickActiveSocraticThread,
  processSocraticTurn,
} from "../../../graph/socratic-threads.js";
import {
  commitLearningMaterialReplacement,
  publishMaterialChecksForCurrentGeneration,
} from "../../../graph/material-persistence.js";
import {
  getOrCreateSession,
  parseLearningMaterial,
  serializeLearningMaterialForQuiz,
  serializeMaterialContextSources,
} from "../../../graph/unit-session.js";
import {
  streamGenerateCornell,
  streamGenerateDiagnosticQuiz,
  streamGenerateLearningMaterialText,
  streamGenerateQuiz,
  streamGenerateSqPreview,
} from "../../../graph/unit-session-stream.js";
import { streamExplainQuizQuestion } from "../../../graph/quiz-explain.js";
import { bumpUnitContentRevision } from "../../../graph/content-revision.js";
import {
  assessLearningTargetsFromDirectState,
  ensureUnitQuizAssessableRequirements,
  isQuizAssessableLearningTarget,
  learningTargetCompetencyBlock,
  planUnitDiagnosticGeneration,
  validateQuizQuestionEvidenceDeclaration,
} from "../../../assessment/index.js";
import { saveQuizAttemptExplanation } from "../../../quiz/quiz-sets.js";
import {
  type LearningMaterialContent,
  type QuizQuestion,
  type SqPreview,
} from "../../../llm/schemas.js";
import { parseJson } from "../../../utils.js";
import { sendUnitContentGenEvent } from "../../../graph/unit-content-gen-event.js";
import {
  normalizeUnitSessionStreamCommand,
  openUnitSession,
  withUnitSessionActiveRun,
} from "../../../unit-session/application.js";
import {
  configuredUnitSectionPlanRepository,
  ensureUnitSectionPlan,
  generateUnitSectionMaterial,
  getAggregatedUnitMaterial,
  getUnitSectionManifest,
} from "../../../sections/index.js";

import { KACOM_ASSESSMENT_ACTIONS } from "./constants.js";
import { assertUnitAssessmentReady } from "./helpers/assessment-gate.js";
import { enrichMaterialImagesInBackground } from "./helpers/material-enrich.js";
import {
  clearStructuredDownstream,
  parseSqData,
} from "./helpers/session-graph.js";
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
import {
  ensureExpandedLearningTargets,
  getLearningTargetsForEarlyTeaching,
} from "./targets.js";
import type {
  CognitiveModelGenerationRunRepository,
  CognitiveModelPublicationRepository,
  CognitiveModelPublicationFinalizationRepository,
  ProjectBlueprintRepository,
  SocraticEvidenceRepository,
} from "../../../../../domain/src/index.js";
import {
  enqueueRecommendedScenarioTheater,
  generateCurrentScenarioTheaterScene,
  invalidateScenarioTheater,
  prepareScenarioTheater,
  recommendScenarioTheaterFromSurvey,
  startScenarioTheater,
} from "../../../scenario-theater/index.js";
import {
  enqueueRecommendedUnitLab,
  invalidateUnitLab,
  prepareUnitLab,
  recommendUnitLabFromSurvey,
} from "../../../unit-lab/index.js";
import { resetUnitAuthoringSession } from "../../../unit-authoring/session.js";
import { unitAuthoringAgentEnabled } from "../../../unit-authoring/runner.js";

export async function sessionStream(
  unitRead: UnitDeliveryReadRepository,
  artifacts: UnitSessionArtifactRepository,
  scenarioTheaterSession: import("../../../../../domain/src/index.js").ScenarioTheaterSessionRepository,
  scenarioTheaterGeneration: import("../../../../../domain/src/index.js").ScenarioTheaterGenerationRepository,
  unitLab: import("../../../../../domain/src/index.js").UnitLabRepository,
  userId: string,
  unitId: string,
  body: Record<string, unknown>,
  generationRun?: CognitiveModelGenerationRunRepository,
  publication?: CognitiveModelPublicationRepository,
  publicationFinalization?: CognitiveModelPublicationFinalizationRepository,
  unitLearningProgressReset?: UnitLearningProgressResetRepository,
  materialReplacement?: MaterialReplacementRepository,
  projectBlueprint?: ProjectBlueprintRepository,
  stateRead?: LearnerStateProjectionReadRepository,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
  socraticEvidence?: SocraticEvidenceRepository,
  presentationRead?: import("../../../../../domain/src/index.js").CognitiveModelPresentationReadRepository,
  unitStructuredCleanup?: import("../../../../../domain/src/index.js").UnitStructuredCleanupRepository,
  materialEnrichment?: import("../../../../../domain/src/index.js").MaterialEnrichmentRepository,
  quizSession?: import("../../../../../domain/src/index.js").QuizSessionRepository,
  unitSessionState?: import("../../../../../domain/src/index.js").UnitSessionStateRepository,
  assessmentTarget?: import("../../../../../domain/src/index.js").AssessmentTargetRepository,
  flashcards?: import("../../../../../domain/src/index.js").FlashcardExperienceRepository,
  materialCheckCompletion?: import("../../../../../domain/src/index.js").MaterialCheckCompletionRepository,
) {
  if (
    !unitStructuredCleanup ||
    !materialEnrichment ||
    !quizSession ||
    !unitSessionState ||
    !unitLearningProgressReset ||
    !socraticEvidence ||
    !assessmentTarget ||
    !materialCheckCompletion ||
    !flashcards
  ) {
    throw new Error("Unit structured cleanup persistence is not configured");
  }
  const command = normalizeUnitSessionStreamCommand(body);
  const { action, payload: actionPayload, runId } = command;

  const [page, content] = await Promise.all([
    unitRead.findPage({ userId, unitId }),
    unitRead.findContent({ userId, unitId }),
  ]);
  if (!page || !content) {
    return new Response(
      JSON.stringify({ error: tBackend("error.goal.unitNotFound") }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  const unit = {
    ...page,
    contentRevision: content.contentRevision,
    learningMaterial: content.learningMaterial,
    _count: { children: page.childCount },
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

  if (unit.unitKind === "module" || unit._count.children > 0) {
    return new Response(
      JSON.stringify({
        error: tBackend("error.learning.moduleContainer"),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (KACOM_ASSESSMENT_ACTIONS.has(action)) {
    await assertUnitAssessmentReady(
      unitId,
      generationRun,
      publicationFinalization,
      learnerStateMemoryInvalidation,
      presentationRead,
    );
  }

  const ensurePreview = action === "generate_sq" && (body.onlyIfMissing === true || actionPayload.onlyIfMissing === true);
  const startStream = () => handleTrackedStreamPost(
    { runId: ensurePreview ? undefined : runId },
    {
      scope: "unit",
      scopeId: unitId,
      goalId: unit.goalId,
      operation: `unit.${action}`,
    },
    async (ctx) =>
      runWithUserId(userId, async () => {
        const onToken = createTrackedTokenHandler(ctx);
        let streamedMaterial: LearningMaterialContent | null = null;
        let streamedSections = false;
        let streamedCompleteBlockCount = -1;
        let streamedPlaceholderBlockCount = -1;
        let streamedMaterialRevision = 0;
        const sendMaterialDelta = async (
          partial: {
            material: LearningMaterialContent;
            completeBlockCount: number;
            placeholderBlockCount?: number;
          },
          metadata: Record<string, unknown> = {},
        ) => {
          const reset = streamedMaterial === null;
          const delta = createMaterialDelta(streamedMaterial, partial.material);
          // Generation may reuse nested objects between callbacks; keep an
          // immutable baseline so an in-place SVG update is still detected.
          streamedMaterial = structuredClone(partial.material);
          const sections = metadata.sections;
          const includeSections = Array.isArray(sections) && !streamedSections;
          if (includeSections) streamedSections = true;
          const placeholderBlockCount = partial.placeholderBlockCount ?? 0;
          if (
            Object.keys(delta).length === 0 &&
            partial.completeBlockCount === streamedCompleteBlockCount &&
            placeholderBlockCount === streamedPlaceholderBlockCount &&
            !includeSections
          ) {
            return;
          }
          streamedCompleteBlockCount = partial.completeBlockCount;
          streamedPlaceholderBlockCount = placeholderBlockCount;
          streamedMaterialRevision += 1;
          await ctx.send({
            type: "material_delta",
            delta,
            reset,
            streamRevision: streamedMaterialRevision,
            completeBlockCount: partial.completeBlockCount,
            placeholderBlockCount,
            ...metadata,
            ...(Array.isArray(sections) && !includeSections
              ? { sections: undefined }
              : {}),
          });
        };
        const session = await openUnitSession(
          { openSession: () => getOrCreateSession(userId, unitId) },
          { userId, unitId },
        );
        const goal = unit.goal;

        if (action === "prepare_scenario_theater") {
          const result = await prepareScenarioTheater({
            client: scenarioTheaterGeneration,
            userId,
            unitId,
            force: body.force === true || actionPayload.force === true,
            signal: ctx.signal,
            onProgress: (phase, message) =>
              ctx.send({ type: "status", phase, message }),
          });
          await ctx.send({
            type: "done",
            scenarioTheater: {
              definition: result.theater,
              revision: result.revision,
              available: true,
              status: result.status,
            },
            contentRevision: result.contentRevision,
            structuredSubStep: "theater",
          });
          return;
        }

        if (action === "prepare_unit_lab") {
          const result = await prepareUnitLab({
            client: unitLab,
            userId,
            unitId,
            force: body.force === true || actionPayload.force === true,
            signal: ctx.signal,
            onProgress: (phase, message) =>
              ctx.send({ type: "status", phase, message }),
          });
          await ctx.send({
            type: "done",
            unitLab: {
              definition: result.lab,
              revision: result.revision,
              available: result.status === "ready",
              status: result.status,
              generationError:
                result.status === "failed" ? result.generationError : "",
            },
            contentRevision: result.contentRevision,
            structuredSubStep: "questions",
          });
          return;
        }

        if (action === "generate_scenario_scene") {
          const requestedRunId = String(
            body.runId ?? actionPayload.runId ?? "",
          );
          await generateCurrentScenarioTheaterScene({
            client: scenarioTheaterGeneration,
            userId,
            unitId,
            runId: requestedRunId,
            signal: ctx.signal,
            onProgress: (phase, message) =>
              ctx.send({ type: "status", phase, message }),
          });
          const play = await startScenarioTheater(
            scenarioTheaterSession,
            userId,
            unitId,
          );
          await ctx.send({
            type: "done",
            scenarioTheater: play,
            structuredSubStep: "theater",
          });
          return;
        }

        if (action === "generate_sq") {
          if (unit.unitKind === "overview") {
            await ctx.send({
              type: "done",
              sq: null,
              structuredSubStep: "material",
              currentStep: "structured_input",
            });
            return;
          }
          await invalidateScenarioTheater(scenarioTheaterGeneration, unitId);
          await invalidateUnitLab(unitLab, unitId);
          if (content.sq3rData && unitAuthoringAgentEnabled()) {
            await resetUnitAuthoringSession({
              userId,
              goalId: goal.id,
              unitId,
            });
          }
          const usesCognitiveModel =
            goal.goalKind !== "micro" && goal.learningMode !== "exploration";
          if (usesCognitiveModel) {
            await ctx.send({
              type: "status",
              phase: "cognitive_model",
              message: tBackend("status.generation.learningTargets"),
            });
          }
          const learning = usesCognitiveModel
            ? await getLearningTargetsForEarlyTeaching(
                unitRead,
                userId,
                unitId,
                goal.cognitiveModelInputHash,
                ctx.signal,
                (activity) =>
                  ctx.send({ type: "knowledge_activity", activity }),
                generationRun,
                publication,
                publicationFinalization,
                projectBlueprint,
                learnerStateMemoryInvalidation,
              )
            : {
                learningTargets: [],
                finalized: true,
                inputHash: goal.cognitiveModelInputHash,
                prefixHash: undefined,
                completion: Promise.resolve([]),
              };
          const canonicalLearningTargets = learning.learningTargets;
          await ctx.send({
            type: "learning_access",
            access: withUnitSessionActiveRun(
              {
                modelPhase: learning.finalized ? "ready" : "targets_ready",
                contentMode: learning.finalized ? "canonical" : "draft",
                assessmentMode: learning.finalized ? "ready" : "locked",
                ...(learning.finalized
                  ? {}
                  : { lockReason: "model_building" as const }),
                inputHash: learning.inputHash,
                ...(learning.prefixHash
                  ? { prefixHash: learning.prefixHash }
                  : {}),
              },
              ctx.runId,
            ),
          });
          if (!learning.finalized) {
            void learning.completion
              .then(async () => {
                await ctx.send({
                  type: "learning_access",
                  access: withUnitSessionActiveRun(
                    {
                      modelPhase: "ready",
                      contentMode: "canonical",
                      assessmentMode: "ready",
                      inputHash: learning.inputHash,
                      ...(learning.prefixHash
                        ? { prefixHash: learning.prefixHash }
                        : {}),
                    },
                    ctx.runId,
                  ),
                });
              })
              .catch(() => undefined);
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
          await ctx.send({
            type: "status",
            phase: "sq_preview",
            message: tBackend("status.generation.sq"),
          });
          const sq = await streamGenerateSqPreview(
            goal,
            unitId,
            unit.title,
            unit.contentSummary,
            onToken,
            ctx.signal,
            {
              canonicalLearningTargets,
              learnerStateMemoryInvalidation,
              onPartialSq: async (partial) => {
                if (ctx.signal.aborted) return;
                await ctx.send({
                  type: "sq_partial",
                  sq: partial.sq,
                  completeLineCount: partial.completeLineCount,
                  finalized: learning.finalized,
                  inputHash: learning.inputHash,
                  ...(learning.prefixHash
                    ? { prefixHash: learning.prefixHash }
                    : {}),
                });
              },
              onVerificationStart: () =>
                ctx.send({
                  type: "status",
                  phase: "verification",
                  message: tBackend("status.generation.verifyingContent"),
                }),
              onRepairApplied: (patches) =>
                ctx.send({
                  type: "content_repair",
                  artifactKind: "survey",
                  patches,
                }),
              onAcceptedSq: async (acceptedSq) => {
                if (ctx.signal.aborted) return;
                await unitSessionState.updateOwned({
                  userId,
                  unitId,
                  patch: {
                    sq3rData: JSON.stringify(acceptedSq),
                    structuredSubStep: "sq",
                    currentStep: "structured_input",
                  },
                });
                await ctx.send({
                  type: "sq_partial",
                  sq: acceptedSq,
                  completeLineCount:
                    acceptedSq.survey.outline.length +
                    acceptedSq.questions.length,
                  finalized: learning.finalized,
                  inputHash: learning.inputHash,
                  ...(learning.prefixHash
                    ? { prefixHash: learning.prefixHash }
                    : {}),
                });
              },
              onSectionPlanStart: () =>
                ctx.send({
                  type: "status",
                  phase: "section_plan",
                  message: tBackend("status.generation.sectionPlan"),
                }),
              onVerificationComplete: (result) =>
                ctx.send({
                  type: "content_verification",
                  state: "verified",
                  artifactKind: "survey",
                  result,
                }),
              generationRunId: ctx.runId,
            },
          );
          // Do not destroy the accepted course until its replacement Survey
          // has completed. A provider failure must leave the previous Survey
          // and all downstream learning content usable as one coherent set.
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
          await sendUnitContentGenEvent(ctx, unitId, { hasSurvey: true });
          await ctx.send({
            type: "done",
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
            finalized: learning.finalized,
            inputHash: learning.inputHash,
            ...(learning.prefixHash ? { prefixHash: learning.prefixHash } : {}),
          });
          return;
        }

        if (action === "generate_material") {
          await invalidateScenarioTheater(scenarioTheaterGeneration, unitId);
          await invalidateUnitLab(unitLab, unitId);
          const usesCognitiveModel =
            unit.unitKind !== "overview" &&
            goal.goalKind !== "micro" &&
            goal.learningMode !== "exploration";
          const learning = usesCognitiveModel
            ? await getLearningTargetsForEarlyTeaching(
                unitRead,
                userId,
                unitId,
                goal.cognitiveModelInputHash,
                ctx.signal,
                (activity) =>
                  ctx.send({ type: "knowledge_activity", activity }),
                generationRun,
                publication,
                publicationFinalization,
                projectBlueprint,
                learnerStateMemoryInvalidation,
              )
            : {
                learningTargets: [],
                finalized: true,
                inputHash: goal.cognitiveModelInputHash,
                prefixHash: undefined,
                completion: Promise.resolve([]),
              };
          await ctx.send({
            type: "learning_access",
            access: withUnitSessionActiveRun(
              {
                modelPhase: learning.finalized ? "ready" : "targets_ready",
                contentMode: learning.finalized ? "canonical" : "draft",
                assessmentMode: learning.finalized ? "ready" : "locked",
                ...(learning.finalized
                  ? {}
                  : { lockReason: "model_building" as const }),
                inputHash: learning.inputHash,
                ...(learning.prefixHash
                  ? { prefixHash: learning.prefixHash }
                  : {}),
              },
              ctx.runId,
            ),
          });
          {
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
              const plannedSections = await getUnitSectionManifest(
                userId,
                unitId,
                undefined,
              );
              await ctx.send({
                type: "status",
                phase: "material",
                message: tBackend("status.generation.material"),
              });
              await generateUnitSectionMaterial({
                userId,
                unitId,
                sectionId: String(firstSection.id),
                force: true,
                signal: ctx.signal,
                learnerStateMemoryInvalidation,
                onPartialMaterial: async (partial) => {
                  if (ctx.signal.aborted) return;
                  await sendMaterialDelta(partial, {
                    sections: plannedSections,
                    finalized: learning.finalized,
                    inputHash: learning.inputHash,
                    ...(learning.prefixHash
                      ? { prefixHash: learning.prefixHash }
                      : {}),
                  });
                },
                onNarrationAudioReady: async (asset) => {
                  if (ctx.signal.aborted) return;
                  await ctx.send({ type: "narration_audio_ready", asset });
                },
                onVerificationStart: () =>
                  ctx.send({
                    type: "status",
                    phase: "material",
                    message: tBackend("status.generation.verifyingContent"),
                  }),
                generationRunId: ctx.runId,
              });
              await artifacts.deleteLegacyMaterial({ userId, unitId });
              const sections = await getUnitSectionManifest(
                userId,
                unitId,
                undefined,
              );
              const material = await getAggregatedUnitMaterial(
                unitId,
                undefined,
              );
              const unitRevision = await artifacts.inspect({ userId, unitId });
              await sendUnitContentGenEvent(ctx, unitId, {
                hasSurvey: true,
                hasMaterial: true,
              });
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
              const readyPayload = {
                material,
                sections,
                contentRevision: unitRevision?.contentRevision,
                currentSectionId:
                  sections.find(
                    (section) =>
                      section.status !== "completed" &&
                      section.status !== "skipped",
                  )?.id ?? firstSection.id,
                structuredSubStep: "material" as const,
                clearedCornell: true,
                currentStep: "structured_input" as const,
                finalized: learning.finalized,
                inputHash: learning.inputHash,
                ...(learning.prefixHash
                  ? { prefixHash: learning.prefixHash }
                  : {}),
              };
              await ctx.send({
                type: "material_ready",
                ...readyPayload,
              });
              const { material: _material, ...donePayload } = readyPayload;
              await ctx.send({
                type: "done",
                ...donePayload,
              });
              return;
            }
          }
          const hadCornell = Boolean(
            (await artifacts.inspect({ userId, unitId }))?.hasCornellNote,
          );
          await ctx.send({
            type: "status",
            phase: "material",
            message: tBackend("status.generation.material"),
          });
          const sq =
            parseSqData(session.sq3rData) ??
            (await streamGenerateSqPreview(
              goal,
              unitId,
              unit.title,
              unit.contentSummary,
              onToken,
              ctx.signal,
              {
                canonicalLearningTargets: learning.learningTargets,
                learnerStateMemoryInvalidation,
                onSectionPlanStart: () =>
                  ctx.send({
                    type: "status",
                    phase: "section_plan",
                    message: tBackend("status.generation.sectionPlan"),
                  }),
              },
            ));
          await assertRunActive(ctx.runId, ctx.signal);
          const materialBase = await artifacts.inspect({ userId, unitId });
          if (!materialBase)
            throw new NotFoundException(tBackend("error.goal.unitNotFound"));
          const materialResult = await streamGenerateLearningMaterialText(
            goal,
            unitId,
            unit.title,
            unit.contentSummary,
            JSON.stringify(sq),
            onToken,
            ctx.signal,
            {
              onPartialMaterial: async (partial) => {
                if (ctx.signal.aborted) return;
                await sendMaterialDelta(partial, {
                  finalized: learning.finalized,
                  inputHash: learning.inputHash,
                  ...(learning.prefixHash
                    ? { prefixHash: learning.prefixHash }
                    : {}),
                });
              },
              onVerificationStart: () =>
                Promise.all([
                  ctx.send({
                    type: "status",
                    phase: "material",
                    message: tBackend("status.generation.verifyingContent"),
                  }),
                  ctx.send({
                    type: "content_verification",
                    state: "verifying",
                    artifactKind: "material",
                  }),
                ]).then(() => undefined),
              onRepairApplied: (patches) =>
                ctx.send({
                  type: "content_repair",
                  artifactKind: "material",
                  patches,
                }),
              onVerificationComplete: (result) =>
                ctx.send({
                  type: "content_verification",
                  state: "verified",
                  artifactKind: "material",
                  result,
                }),
              generationRunId: ctx.runId,
            },
          );
          await assertRunActive(ctx.runId, ctx.signal);
          const {
            material: textMaterial,
            contextSources,
            contentLanguage,
            materialSourceItems,
          } = materialResult;
          // Streaming partials are provisional. Do not mutate authoritative
          // progress or remove the last-good downstream artifacts until the
          // complete replacement material has validated successfully.
          const sourcesJson = serializeMaterialContextSources(contextSources);
          const committed = await commitLearningMaterialReplacement({
            materialReplacement,
            userId,
            goalId: goal.id,
            unitId,
            material: textMaterial,
            materialSourceItems,
            contextSourcesJson: sourcesJson,
            sq3rData: JSON.stringify(sq),
            publishChecks: usesCognitiveModel && learning.finalized,
            expectedContentRevision: materialBase.contentRevision,
            assessmentTargets: usesCognitiveModel
              ? await assessmentTarget.findForUnit({ userId, unitId })
              : [],
            learnerStateMemoryInvalidation,
          });
          let contentRevision = committed.contentRevision;
          const resetProgress = committed.reset.reset;
          if (!learning.finalized) {
            void learning.completion
              .then(async () => {
                await publishMaterialChecksForCurrentGeneration({
                  materialCheckCompletion,
                  userId,
                  goalId: goal.id,
                  unitId,
                  expectedMaterial: textMaterial,
                  assessmentTargets: await assessmentTarget.findForUnit({
                    userId,
                    unitId,
                  }),
                });
                await ctx.send({
                  type: "learning_access",
                  access: withUnitSessionActiveRun(
                    {
                      modelPhase: "ready",
                      contentMode: "canonical",
                      assessmentMode: "ready",
                      inputHash: learning.inputHash,
                      ...(learning.prefixHash
                        ? { prefixHash: learning.prefixHash }
                        : {}),
                    },
                    ctx.runId,
                  ),
                });
              })
              .catch((error) =>
                console.error(
                  `[learning] deferred material checks failed unit=${unitId}`,
                  error instanceof Error ? error.message : error,
                ),
              );
          }
          const readyPayload = {
            material: textMaterial,
            contextSources,
            contentRevision,
            structuredSubStep: "material" as const,
            clearedCornell: hadCornell,
            resetProgress,
            unitStatus: resetProgress ? "in_progress" : unit.status,
            currentStep: "structured_input" as const,
            finalized: learning.finalized,
            inputHash: learning.inputHash,
            ...(learning.prefixHash ? { prefixHash: learning.prefixHash } : {}),
          };
          await sendUnitContentGenEvent(ctx, unitId, {
            hasSurvey: true,
            hasMaterial: true,
          });
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
          await ctx.send({
            type: "material_ready",
            ...readyPayload,
          });
          enrichMaterialImagesInBackground(
            materialEnrichment,
            userId,
            unitId,
            textMaterial,
            goal.id,
            unit.title,
            contentLanguage,
            committed.contentRevision,
          );
          await ctx.send({
            type: "done",
            contextSources,
            contentRevision,
            structuredSubStep: "material",
            clearedCornell: hadCornell,
            resetProgress,
            unitStatus: resetProgress ? "in_progress" : unit.status,
            currentStep: "structured_input",
          });
          return;
        }

        if (action === "generate_cornell") {
          const resetProgress = await resetUnitLearningProgress(
            unitId,
            unitLearningProgressReset,
            learnerStateMemoryInvalidation,
          );
          const material = await getAggregatedUnitMaterial(unitId, undefined, {
            requireAll: true,
          });
          if (!material) {
            await ctx.send({
              type: "error",
              message: tBackend("error.learning.completeMaterialFirst"),
            });
            return;
          }
          const sq =
            parseSqData(session.sq3rData) ??
            parseJson<SqPreview>(session.sq3rData, {
              survey: { outline: [], learningTargetLabels: [] },
              learningTargets: [],
              questions: [],
            });

          await ctx.send({
            type: "status",
            phase: "cornell",
            message: tBackend("status.generation.notes"),
          });
          const cornell = await streamGenerateCornell(
            goal,
            unit.title,
            JSON.stringify(sq),
            JSON.stringify(material),
            onToken,
            ctx.signal,
            {
              unitId,
              onPartialCornell: async (partial) => {
                if (ctx.signal.aborted) return;
                await ctx.send({
                  type: "cornell_partial",
                  cornell: partial.cornell,
                  completeLineCount: partial.completeLineCount,
                });
              },
            },
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
          await ctx.send({
            type: "done",
            cornell,
            structuredSubStep: "cornell",
            resetProgress,
            unitStatus: resetProgress ? "in_progress" : unit.status,
            currentStep: "structured_input",
          });
          return;
        }

        if (action === "generate_diagnostic") {
          if (
            goal.goalKind === "micro" ||
            goal.learningMode === "exploration"
          ) {
            await ctx.send({
              type: "error",
              message: tBackend("error.learning.microDiagnosticUnavailable"),
            });
            return;
          }
          if (isUnitLearningDone(unit.status)) {
            await ctx.send({
              type: "error",
              message: tBackend("error.learning.unitAlreadyCompleted"),
            });
            return;
          }
          await ensureExpandedLearningTargets(
            unitRead,
            userId,
            unitId,
            ctx.signal,
            generationRun,
            publication,
            publicationFinalization,
            projectBlueprint,
            learnerStateMemoryInvalidation,
          );
          const targets = await assessmentTarget.ensureQuizAssessableForUnit({
            userId,
            unitId,
          });
          const priorAssessments = await assessLearningTargetsFromDirectState({
            persistence: undefined,
            userId,
            targets,
            stateRead,
          });
          const diagnosticPlan = planUnitDiagnosticGeneration({
            targets,
            priorAssessments,
          });
          if (!diagnosticPlan.ready) {
            await ctx.send({
              type: "error",
              message: tBackend(
                diagnosticPlan.reason === "no_critical_targets"
                  ? "error.learning.noDiagnosticTargets"
                  : "error.learning.noQuizAssessableTargets",
              ),
            });
            return;
          }
          const selected = diagnosticPlan.selectedTargets;
          const questionCount = diagnosticPlan.questionCount;
          await ctx.send({
            type: "status",
            phase: "diagnostic",
            message: tBackend("status.generation.diagnostic", {
              count: questionCount,
            }),
          });
          const quiz = await streamGenerateDiagnosticQuiz(
            goal,
            unit.title,
            learningTargetCompetencyBlock(selected),
            questionCount,
            selected.map((point) => point.localRef),
            onToken,
            ctx.signal,
            async (partial) => {
              if (ctx.signal.aborted) return;
              await ctx.send({
                type: "quiz_partial",
                questions: partial.questions,
                completeQuestionCount: partial.completeQuestionCount,
                placeholderQuestionCount: partial.placeholderQuestionCount,
              });
            },
            "unit",
            selected,
            {
              onVerificationStart: async () => {
                await ctx.send({
                  type: "status",
                  phase: "diagnostic",
                  message: tBackend("status.generation.verifyingContent"),
                });
                await ctx.send({
                  type: "content_verification",
                  state: "verifying",
                  artifactKind: "assessment",
                });
              },
              onRepairApplied: (patches) =>
                ctx.send({
                  type: "content_repair",
                  artifactKind: "assessment",
                  patches,
                }),
              onVerificationComplete: (result) =>
                ctx.send({
                  type: "content_verification",
                  state: "verified",
                  artifactKind: "assessment",
                  result,
                }),
              generationRunId: ctx.runId,
            },
          );
          const attempt = await artifacts.createDiagnosticAttempt({
            userId,
            unitId,
            questionsJson: JSON.stringify(quiz.questions),
          });
          if (!attempt)
            throw new NotFoundException(tBackend("error.goal.unitNotFound"));
          await ctx.send({
            type: "done",
            attemptId: attempt.id,
            questions: quiz.questions,
            learningTargets: selected,
            thresholds: { overall: 0.85, perLearningTarget: 0.7 },
          });
          return;
        }

        if (action === "generate_quiz") {
          if (
            goal.goalKind !== "micro" &&
            goal.learningMode !== "exploration"
          ) {
            const requiredSections = (
              await getUnitSectionManifest(userId, unitId, undefined)
            ).filter((section) => section.requiredForCompletion);
            if (requiredSections.length > 0) {
              const finished = requiredSections.filter(
                (section) =>
                  section.status === "completed" ||
                  section.status === "skipped",
              ).length;
              if (finished !== requiredSections.length) {
                await ctx.send({
                  type: "error",
                  message: tBackend(
                    "error.learning.completeRequiredSectionsFirst",
                  ),
                });
                return;
              }
            }
          }
          const material = await getAggregatedUnitMaterial(unitId, undefined, {
            requireAll: true,
          });
          if (!material) {
            await ctx.send({
              type: "error",
              message: tBackend("error.learning.materialRequiredForQuiz"),
            });
            return;
          }
          const materialJson = serializeLearningMaterialForQuiz(material);
          if (
            goal.goalKind !== "micro" &&
            goal.learningMode !== "exploration"
          ) {
            await ensureExpandedLearningTargets(
              unitRead,
              userId,
              unitId,
              ctx.signal,
              generationRun,
              publication,
              publicationFinalization,
              projectBlueprint,
              learnerStateMemoryInvalidation,
            );
          }
          const targets =
            goal.goalKind === "micro" || goal.learningMode === "exploration"
              ? []
              : await assessmentTarget.ensureQuizAssessableForUnit({
                  userId,
                  unitId,
                });
          const quizTargets = targets.filter(isQuizAssessableLearningTarget);
          if (
            goal.goalKind !== "micro" &&
            goal.learningMode !== "exploration" &&
            quizTargets.length === 0
          ) {
            await ctx.send({
              type: "error",
              message: tBackend("error.learning.noQuizAssessableTargets"),
            });
            return;
          }

          await ctx.send({
            type: "status",
            phase: "quiz",
            message: tBackend("status.generation.quiz"),
          });

          const adaptiveBatch =
            goal.goalKind === "micro" || goal.learningMode === "exploration"
              ? null
              : await buildAdaptiveQuizBatch(
                  userId,
                  unitId,
                  quizTargets,
                  stateRead,
                  quizSession,
                );

          const quiz = await streamGenerateQuiz(
            goal,
            unit.title,
            materialJson,
            onToken,
            ctx.signal,
            {
              unitId,
              difficulty: unit.difficulty as
                "easy" | "medium" | "hard" | undefined,
              standaloneMicro:
                goal.goalKind === "micro" ||
                goal.learningMode === "exploration",
              ...(goal.goalKind === "micro" ||
              goal.learningMode === "exploration"
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
              onPartialQuiz: async (partial) => {
                if (ctx.signal.aborted) return;
                await ctx.send({
                  type: "quiz_partial",
                  questions: partial.questions,
                  completeQuestionCount: partial.completeQuestionCount,
                  placeholderQuestionCount: partial.placeholderQuestionCount,
                });
              },
              onVerificationStart: async () => {
                await ctx.send({
                  type: "status",
                  phase: "quiz",
                  message: tBackend("status.generation.verifyingContent"),
                });
                await ctx.send({
                  type: "content_verification",
                  state: "verifying",
                  artifactKind: "assessment",
                });
              },
              onRepairApplied: (patches) =>
                ctx.send({
                  type: "content_repair",
                  artifactKind: "assessment",
                  patches,
                }),
              onVerificationComplete: (result) =>
                ctx.send({
                  type: "content_verification",
                  state: "verified",
                  artifactKind: "assessment",
                  result,
                }),
              generationRunId: ctx.runId,
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
            goal.goalKind === "micro" || goal.learningMode === "exploration"
              ? undefined
              : await buildUnitRecallProgress(
                  userId,
                  unitId,
                  quizTargets,
                  stateRead,
                  quizSession,
                );

          await ctx.send({
            type: "done",
            questions: persisted.questions,
            interleaved: persisted.interleaved,
            quizSetId: persisted.quizSetId,
            ...(recallProgress ? { recallProgress } : {}),
          });
          return;
        }

        if (action === "generate_flashcards") {
          const material = await getAggregatedUnitMaterial(unitId, undefined);
          if (!material) {
            await ctx.send({
              type: "error",
              message: tBackend("error.learning.materialRequiredForFlashcards"),
            });
            return;
          }

          await ctx.send({
            type: "status",
            phase: "flashcards",
            message: tBackend("status.generation.flashcards"),
          });

          const { generateFlashcardDeckForUnit, getUnitFlashcardDeck } =
            await import("../../../flashcards/deck.js");
          await generateFlashcardDeckForUnit(flashcards, unitId, userId, {
            onToken,
            signal: ctx.signal,
          });

          const deck = await getUnitFlashcardDeck(flashcards, unitId, userId);
          const graphState = parseSessionGraphState(session.graphState);
          await unitSessionState.updateOwned({
            userId,
            unitId,
            patch: {
              graphState: JSON.stringify({
                ...graphState,
                flashcardDeckId: deck?.id,
              }),
              currentStep: "active_recall",
            },
          });

          await ctx.send({ type: "done", deck });
          return;
        }

        if (action === "explain_quiz_wrong") {
          const questionIndex =
            typeof body.questionIndex === "number"
              ? body.questionIndex
              : Number(body.questionIndex);
          if (!Number.isInteger(questionIndex) || questionIndex < 0) {
            await ctx.send({
              type: "error",
              message: tBackend("error.learning.questionIndexRequired"),
            });
            return;
          }

          const graphState = parseSessionGraphState(session.graphState);
          const quiz = graphState.quiz as
            | { questions: QuizQuestion[]; interleaved?: QuizQuestion[] }
            | undefined;
          const questions = [
            ...(quiz?.questions ?? []),
            ...(quiz?.interleaved ?? []),
          ];
          const results = graphState.quizResults ?? [];

          if (questions.length === 0 || results.length === 0) {
            await ctx.send({
              type: "error",
              message: tBackend("error.learning.gradeQuizFirst"),
            });
            return;
          }

          const graded = results.find((row) => row.index === questionIndex);
          if (!graded) {
            await ctx.send({
              type: "error",
              message: tBackend("error.learning.explanationNotNeeded"),
            });
            return;
          }

          const attemptId = graphState.quizAttemptId;
          if (!attemptId) {
            await ctx.send({
              type: "error",
              message: tBackend("error.learning.gradeQuizFirst"),
            });
            return;
          }

          await ctx.send({
            type: "status",
            phase: "quiz_explain",
            message: tBackend("status.generation.quizExplain"),
          });

          const explanation = await streamExplainQuizQuestion({
            userId,
            goalId: goal.id,
            unitId,
            unitTitle: unit.title,
            contentLanguage: goal.contentLanguage,
            questions,
            results,
            questionIndex,
            onToken,
            signal: ctx.signal,
          });

          const quizExplanations = await quizSession.saveAttemptExplanation({
            userId,
            unitId,
            attemptId,
            questionIndex,
            explanation: explanation.explanation,
          });
          if (!quizExplanations) {
            throw new NotFoundException(tBackend("error.notFound"));
          }

          await ctx.send({
            type: "done",
            ...explanation,
            quizExplanations,
          });
          return;
        }

        if (action === "start_socratic") {
          const graphState = parseSessionGraphState(session.graphState);
          await ctx.send({
            type: "status",
            phase: "socratic",
            message: tBackend("status.generation.socraticMistakes"),
          });
          const payload = await bootstrapSocraticForSession(
            unitSessionState,
            userId,
            unitId,
            goal.id,
            unit.title,
            graphState,
            { socraticTurn: session.socraticTurn },
          );
          await ctx.send({ type: "done", ...payload });
          return;
        }

        if (action === "select_socratic_thread") {
          const threadId = String(body.threadId ?? "");
          if (!threadId) {
            await ctx.send({
              type: "error",
              message: tBackend("error.learning.threadIdRequired"),
            });
            return;
          }
          const graphState = parseSessionGraphState(session.graphState);
          const { threads } = ensureSocraticThreads(graphState);
          if (!threads.some((thread) => thread.id === threadId)) {
            await ctx.send({
              type: "error",
              message: tBackend("error.learning.threadNotFound"),
            });
            return;
          }
          await ctx.send({
            type: "status",
            phase: "socratic",
            message: tBackend("status.generation.socraticQuestion"),
          });
          const payload = await bootstrapSocraticForSession(
            unitSessionState,
            userId,
            unitId,
            goal.id,
            unit.title,
            graphState,
            {
              activeThreadId: threadId,
              socraticTurn: session.socraticTurn,
              bootstrapQuestion: true,
              stream: {
                send: async (event) => {
                  await ctx.send(event);
                },
                signal: ctx.signal,
              },
            },
          );
          await ctx.send({ type: "done", ...payload });
          return;
        }

        if (action === "finish_socratic") {
          const graphState = parseSessionGraphState(session.graphState);
          const payload = await finishSocraticSession(
            unitSessionState,
            userId,
            unitId,
            goal.id,
            unit.title,
            graphState,
          );
          await ctx.send({ type: "done", ...payload });
          return;
        }

        if (action === "socratic") {
          const graphState = parseSessionGraphState(session.graphState);
          const answer = String(body.answer ?? "").trim();
          if (!answer) {
            await ctx.send({
              type: "error",
              message: tBackend("error.learning.answerRequired"),
            });
            return;
          }
          const { threads, activeThreadId } = ensureSocraticThreads(graphState);
          const activeThread = pickActiveSocraticThread(
            threads,
            activeThreadId,
          );
          if (!activeThread) {
            await ctx.send({
              type: "error",
              message: tBackend("error.learning.noSocraticConversation"),
            });
            return;
          }
          if (activeThread.done) {
            await ctx.send({
              type: "error",
              message: tBackend("error.learning.socraticEnded"),
            });
            return;
          }

          const stream = {
            send: async (
              event:
                | { type: "message"; delta: string; role?: "assistant" }
                | { type: "thinking"; delta?: string },
            ) => {
              await ctx.send(event);
            },
            signal: ctx.signal,
          };

          const result = await processSocraticTurn({
            goalId: goal.id,
            unitId,
            unitTitle: unit.title,
            graphState,
            thread: activeThread,
            answer,
            weakTags: graphState.weakTags ?? [],
            stream,
          });

          const payload = await applySocraticTurnResult(
            unitSessionState,
            userId,
            unitId,
            graphState,
            threads,
            activeThread,
            result,
          );
          if (
            goal.goalKind !== "micro" &&
            goal.learningMode !== "exploration"
          ) {
            await recordSocraticEvidenceBestEffort({
              userId,
              goalId: goal.id,
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
          await ctx.send({ type: "done", ...payload });
          return;
        }

        await ctx.send({
          type: "error",
          message: tBackend("error.learning.invalidAction"),
        });
      }),
  );
  if (action !== "generate_sq") return startStream();
  return startUnitPreviewStream({
    userId, unitId,
    onlyIfMissing: ensurePreview,
    loadOwned: async () => {
      const latest = await unitRead.findContent({ userId, unitId });
      if (!latest) return null;
      // getUnitSectionManifest also creates a missing plan. This prerequisite
      // check must only read while another Survey may still be committing.
      const sectionStore = configuredUnitSectionPlanRepository();
      const sections = sectionStore
        ? await sectionStore.findManifest({ userId, unitId, freshnessCutoff: new Date() }) : null;
      const legacyArtifacts = sectionStore ? null : await artifacts.inspect({ userId, unitId });
      return { unitKind: unit.unitKind, sq3rData: latest.sq3rData, contentRevision: latest.contentRevision,
        hasMaterial: Boolean(latest.learningMaterial || sections?.legacy)
          || Boolean(sections?.sections.some(section => section.generationStatus === "ready" || section.contentRevision > 0))
          || Boolean(legacyArtifacts?.hasLearningMaterial || legacyArtifacts?.sectionCount) };
    },
    start: startStream,
  });
}
