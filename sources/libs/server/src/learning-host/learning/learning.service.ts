import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { localizeBackendMessage, tBackend } from "../../../../common/src/index.js";
import type {
  UnitActivityRepository,
  UnitCompletionRepository,
  UnitCompletionReadRepository,
  CompletedUnitKnowledgeReadRepository,
  UnitSectionProgressRepository,
  ModuleTestOutRepository,
  UnitSessionStateRepository,
  CognitiveModelGenerationRunRepository,
  CognitiveModelEventRepository,
  CognitiveModelPublicationRepository,
  CognitiveModelPublicationFinalizationRepository,
  VerifiedAssessmentCompletionRepository,
  TaskAttemptRepository,
  UnitStructuredCleanupRepository,
  PrerequisiteBridgeRepository,
  MaterialCheckCompletionRepository,
  UnitLearningProgressResetRepository,
  UnitDiagnosticCompletionRepository,
  ModuleDiagnosticCompletionRepository,
  MaterialReplacementRepository,
  MaterialEnrichmentRepository,
  SectionMaterialReplacementRepository,
  ProjectBlueprintRepository,
  AdaptiveAssessmentEvidenceRepository,
  AdaptiveAssessmentTaskRepository,
  AssessmentTargetRepository,
  UnitDiagnosticReadRepository,
  ModuleDiagnosticReadRepository,
  CognitiveModelPresentationReadRepository,
  LearnerStateProjectionReadRepository,
  LearnerStateMemoryReadRepository,
  LearnerStateMemoryInvalidationRepository,
  CognitiveEntityEvidenceReadRepository,
  FeynmanEvidenceRepository,
  SocraticEvidenceRepository,
  QuizSubmissionRepository,
  QuizSessionRepository,
  FlashcardExperienceRepository,
  DiagnosticRemediationRepository,
} from "../../../../domain/src/index.js";
import { UNIT_ACTIVITY_REPOSITORY } from "../../learning-spaces/unit-activity-token.js";
import { UNIT_STRUCTURED_CLEANUP_REPOSITORY } from "../../learning-spaces/unit-structured-cleanup-token.js";
import { UNIT_COMPLETION_REPOSITORY } from "../../learning-spaces/unit-completion-token.js";
import { UNIT_COMPLETION_READ_REPOSITORY } from "../../learning-spaces/unit-completion-read-token.js";
import { COMPLETED_UNIT_KNOWLEDGE_READ_REPOSITORY } from "../../learning-spaces/completed-unit-knowledge-read-token.js";
import { UNIT_SESSION_STATE_REPOSITORY } from "../../learning-spaces/unit-session-token.js";
import { UNIT_SECTION_PROGRESS_REPOSITORY } from "../../learning-spaces/unit-section-progress-token.js";
import { MODULE_TEST_OUT_REPOSITORY } from "../../learning-spaces/module-test-out-token.js";
import { COGNITIVE_MODEL_GENERATION_RUN_REPOSITORY } from "../../learning-spaces/cognitive-model-generation-run-token.js";
import { COGNITIVE_MODEL_EVENT_REPOSITORY } from "../../learning-spaces/cognitive-model-event-token.js";
import { COGNITIVE_MODEL_PUBLICATION_REPOSITORY } from "../../learning-spaces/cognitive-model-publication-token.js";
import { COGNITIVE_MODEL_PUBLICATION_FINALIZATION_REPOSITORY } from "../../learning-spaces/cognitive-model-publication-finalization-token.js";
import { VERIFIED_ASSESSMENT_COMPLETION_REPOSITORY } from "../../learning-spaces/verified-assessment-completion-token.js";
import { TASK_ATTEMPT_REPOSITORY } from "../../learning-spaces/task-attempt-token.js";
import { PREREQUISITE_BRIDGE_REPOSITORY } from "../../learning-spaces/prerequisite-bridge-token.js";
import { MATERIAL_CHECK_COMPLETION_REPOSITORY } from "../../learning-spaces/material-check-completion-token.js";
import { UNIT_LEARNING_PROGRESS_RESET_REPOSITORY } from "../../learning-spaces/unit-learning-progress-reset-token.js";
import { UNIT_DIAGNOSTIC_COMPLETION_REPOSITORY } from "../../learning-spaces/unit-diagnostic-completion-token.js";
import { MODULE_DIAGNOSTIC_COMPLETION_REPOSITORY } from "../../learning-spaces/module-diagnostic-completion-token.js";
import { MATERIAL_REPLACEMENT_REPOSITORY } from "../../learning-spaces/material-replacement-token.js";
import { MATERIAL_ENRICHMENT_REPOSITORY } from "../../learning-spaces/material-enrichment-token.js";
import { SECTION_MATERIAL_REPLACEMENT_REPOSITORY } from "../../learning-spaces/section-material-replacement-token.js";
import { PROJECT_BLUEPRINT_REPOSITORY } from "../../learning-spaces/project-blueprint-token.js";
import { ADAPTIVE_ASSESSMENT_EVIDENCE_REPOSITORY } from "../../learning-spaces/adaptive-assessment-evidence-token.js";
import { ADAPTIVE_ASSESSMENT_TASK_REPOSITORY } from "../../learning-spaces/adaptive-assessment-task-token.js";
import { ASSESSMENT_TARGET_REPOSITORY } from "../../learning-spaces/assessment-target-token.js";
import { UNIT_DIAGNOSTIC_READ_REPOSITORY } from "../../learning-spaces/unit-diagnostic-read-token.js";
import { MODULE_DIAGNOSTIC_READ_REPOSITORY } from "../../learning-spaces/module-diagnostic-read-token.js";
import { COGNITIVE_MODEL_PRESENTATION_READ_REPOSITORY } from "../../learning-spaces/cognitive-model-presentation-read-token.js";
import { LEARNER_STATE_PROJECTION_READ_REPOSITORY } from "../../learning-spaces/learner-state-projection-read-token.js";
import {
  LEARNER_STATE_MEMORY_READ_REPOSITORY,
  LEARNER_STATE_MEMORY_INVALIDATION_REPOSITORY,
} from "../../learning-spaces/learner-state-memory-read-token.js";
import { COGNITIVE_ENTITY_EVIDENCE_READ_REPOSITORY } from "../../learning-spaces/cognitive-entity-evidence-read-token.js";
import { FEYNMAN_EVIDENCE_REPOSITORY } from "../../learning-spaces/feynman-evidence-token.js";
import { SOCRATIC_EVIDENCE_REPOSITORY } from "../../learning-spaces/socratic-evidence-token.js";
import { QUIZ_SUBMISSION_REPOSITORY } from "../../learning-spaces/quiz-submission-token.js";
import { QUIZ_SESSION_REPOSITORY } from "../../learning-spaces/quiz-session-token.js";
import { FLASHCARD_EXPERIENCE_REPOSITORY } from "../../learning-spaces/flashcard-experience-token.js";
import { DIAGNOSTIC_REMEDIATION_REPOSITORY } from "../../learning-spaces/diagnostic-remediation-token.js";
import type { LearningMaterialContent } from "../../llm/schemas.js";

import {
  getCognitiveEntityEvidence,
  getCognitiveEntityState,
} from "./service/cognition.js";
import {
  getLearningAccess,
  getSession,
  getUnitContent,
  getUnitPage,
} from "./service/unit-reads.js";
import {
  getLearningTargets,
  getUnitConceptMap,
  learningTargetExpansionStream,
} from "./service/targets.js";
import { getDiagnostic, submitDiagnostic } from "./service/diagnostic.js";
import { postSession } from "./service/session-post.js";
import { sessionStream } from "./service/session-stream.js";
import {
  getSubdivisionStatus,
  regenerateSubMapStream,
  removeSubMap,
  subdivideStream,
} from "./service/subdivide.js";
import {
  regenerateComponent,
  regenerateIllustration,
  replaceSvgWithIllustration,
} from "./service/regenerate.js";
import {
  deleteComponentBlock,
  editComponentWithAi,
} from "./service/ai-block-edit.js";
import { regenerateUnitLabItem } from "../../unit-lab/index.js";
import {
  followUpsStream,
  getFollowUps,
  getRecentFollowUps,
  postFollowUps,
} from "./service/follow-ups.js";
import {
  generateUnitFlashcards,
  getQuizSets,
  getUnitFlashcards,
} from "./service/quiz-lists.js";
import {
  getModuleDiagnostic,
  streamModuleDiagnostic,
  submitModuleDiagnostic,
} from "./service/module-diagnostic.js";
import { getAdaptiveAssessmentPlan } from "../../assessment/index.js";
import { submitAdaptiveAssessmentStream } from "./service/adaptive-assessment.js";
import {
  completeUnitSection,
  generateUnitSectionMaterial,
  cancelUnitSectionGeneration,
  getUnitSectionContent,
  updateUnitTeachingPresentation,
  getPendingTeachingPresentation,
  acceptPendingTeachingPresentation,
  getUnitSectionManifest,
} from "../../sections/index.js";
import { createSseStream, sseResponse } from "../../llm/sse.js";
import {
  createSectionMaterialDeltaEmitter,
  sectionGenerationDescriptor,
  sectionGenerationDoneEvent,
} from "../../unit-session/section-generation-events.js";
import {
  ensureCurrentChatNarration,
  listCurrentChatNarration,
  readOwnedChatNarration,
} from "../../audio/chat-narration.js";
import { LearningSpaceOrmProvider } from "../../learning-spaces/learning-space-orm.provider.js";

function sectionRewriteFromBody(rewrite?: {
  topicId?: string;
  topicIndex?: number;
}): { rewriteTopicId?: string; rewriteTopicIndex?: number } {
  const topicId = rewrite?.topicId?.trim();
  const topicIndex = rewrite?.topicIndex;
  return {
    ...(topicId ? { rewriteTopicId: topicId } : {}),
    ...(typeof topicIndex === "number" && Number.isInteger(topicIndex)
      ? { rewriteTopicIndex: topicIndex }
      : {}),
  };
}

@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);
  private readonly chatAudioJobs = new Map<string, Promise<void>>();

  constructor(
    private readonly learningSpaceOrm: LearningSpaceOrmProvider,
    @Optional()
    @Inject(UNIT_SESSION_STATE_REPOSITORY)
    private readonly unitSessionState?: UnitSessionStateRepository,
    @Optional()
    @Inject(UNIT_STRUCTURED_CLEANUP_REPOSITORY)
    private readonly unitStructuredCleanup?: UnitStructuredCleanupRepository,
    @Optional()
    @Inject(UNIT_ACTIVITY_REPOSITORY)
    private readonly unitActivity?: UnitActivityRepository,
    @Optional()
    @Inject(UNIT_COMPLETION_REPOSITORY)
    private readonly unitCompletion?: UnitCompletionRepository,
    @Optional()
    @Inject(UNIT_COMPLETION_READ_REPOSITORY)
    private readonly unitCompletionRead?: UnitCompletionReadRepository,
    @Optional()
    @Inject(COMPLETED_UNIT_KNOWLEDGE_READ_REPOSITORY)
    private readonly completedUnitKnowledgeRead?: CompletedUnitKnowledgeReadRepository,
    @Optional()
    @Inject(UNIT_SECTION_PROGRESS_REPOSITORY)
    private readonly unitSectionProgress?: UnitSectionProgressRepository,
    @Optional()
    @Inject(MODULE_TEST_OUT_REPOSITORY)
    private readonly moduleTestOut?: ModuleTestOutRepository,
    @Optional()
    @Inject(COGNITIVE_MODEL_GENERATION_RUN_REPOSITORY)
    private readonly cognitiveModelGenerationRun?: CognitiveModelGenerationRunRepository,
    @Optional()
    @Inject(COGNITIVE_MODEL_EVENT_REPOSITORY)
    private readonly cognitiveModelEvent?: CognitiveModelEventRepository,
    @Optional()
    @Inject(COGNITIVE_MODEL_PUBLICATION_REPOSITORY)
    private readonly cognitiveModelPublication?: CognitiveModelPublicationRepository,
    @Optional()
    @Inject(COGNITIVE_MODEL_PUBLICATION_FINALIZATION_REPOSITORY)
    private readonly cognitiveModelPublicationFinalization?: CognitiveModelPublicationFinalizationRepository,
    @Optional()
    @Inject(PREREQUISITE_BRIDGE_REPOSITORY)
    private readonly prerequisiteBridge?: PrerequisiteBridgeRepository,
    @Optional()
    @Inject(TASK_ATTEMPT_REPOSITORY)
    private readonly taskAttempt?: TaskAttemptRepository,
    @Optional()
    @Inject(VERIFIED_ASSESSMENT_COMPLETION_REPOSITORY)
    private readonly verifiedAssessmentCompletion?: VerifiedAssessmentCompletionRepository,
    @Optional()
    @Inject(MATERIAL_CHECK_COMPLETION_REPOSITORY)
    private readonly materialCheckCompletion?: MaterialCheckCompletionRepository,
    @Optional()
    @Inject(UNIT_LEARNING_PROGRESS_RESET_REPOSITORY)
    private readonly unitLearningProgressReset?: UnitLearningProgressResetRepository,
    @Optional()
    @Inject(UNIT_DIAGNOSTIC_COMPLETION_REPOSITORY)
    private readonly unitDiagnosticCompletion?: UnitDiagnosticCompletionRepository,
    @Optional()
    @Inject(MODULE_DIAGNOSTIC_COMPLETION_REPOSITORY)
    private readonly moduleDiagnosticCompletion?: ModuleDiagnosticCompletionRepository,
    @Optional()
    @Inject(MATERIAL_ENRICHMENT_REPOSITORY)
    private readonly materialEnrichment?: MaterialEnrichmentRepository,
    @Optional()
    @Inject(MATERIAL_REPLACEMENT_REPOSITORY)
    private readonly materialReplacement?: MaterialReplacementRepository,
    @Optional()
    @Inject(SECTION_MATERIAL_REPLACEMENT_REPOSITORY)
    private readonly sectionMaterialReplacement?: SectionMaterialReplacementRepository,
    @Optional()
    @Inject(PROJECT_BLUEPRINT_REPOSITORY)
    private readonly projectBlueprint?: ProjectBlueprintRepository,
    @Optional()
    @Inject(ADAPTIVE_ASSESSMENT_EVIDENCE_REPOSITORY)
    private readonly adaptiveAssessmentEvidence?: AdaptiveAssessmentEvidenceRepository,
    @Optional()
    @Inject(ADAPTIVE_ASSESSMENT_TASK_REPOSITORY)
    private readonly adaptiveAssessmentTask?: AdaptiveAssessmentTaskRepository,
    @Optional()
    @Inject(ASSESSMENT_TARGET_REPOSITORY)
    private readonly assessmentTarget?: AssessmentTargetRepository,
    @Optional()
    @Inject(UNIT_DIAGNOSTIC_READ_REPOSITORY)
    private readonly unitDiagnosticRead?: UnitDiagnosticReadRepository,
    @Optional()
    @Inject(MODULE_DIAGNOSTIC_READ_REPOSITORY)
    private readonly moduleDiagnosticRead?: ModuleDiagnosticReadRepository,
    @Optional()
    @Inject(COGNITIVE_MODEL_PRESENTATION_READ_REPOSITORY)
    private readonly cognitiveModelPresentationRead?: CognitiveModelPresentationReadRepository,
    @Optional()
    @Inject(LEARNER_STATE_PROJECTION_READ_REPOSITORY)
    private readonly learnerStateProjectionRead?: LearnerStateProjectionReadRepository,
    @Optional()
    @Inject(LEARNER_STATE_MEMORY_READ_REPOSITORY)
    private readonly learnerStateMemoryRead?: LearnerStateMemoryReadRepository,
    @Optional()
    @Inject(LEARNER_STATE_MEMORY_INVALIDATION_REPOSITORY)
    private readonly learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
    @Optional()
    @Inject(COGNITIVE_ENTITY_EVIDENCE_READ_REPOSITORY)
    private readonly cognitiveEntityEvidenceRead?: CognitiveEntityEvidenceReadRepository,
    @Optional()
    @Inject(FEYNMAN_EVIDENCE_REPOSITORY)
    private readonly feynmanEvidence?: FeynmanEvidenceRepository,
    @Optional()
    @Inject(SOCRATIC_EVIDENCE_REPOSITORY)
    private readonly socraticEvidence?: SocraticEvidenceRepository,
    @Optional()
    @Inject(QUIZ_SESSION_REPOSITORY)
    private readonly quizSession?: QuizSessionRepository,
    @Optional()
    @Inject(FLASHCARD_EXPERIENCE_REPOSITORY)
    private readonly flashcardExperience?: FlashcardExperienceRepository,
    @Optional()
    @Inject(QUIZ_SUBMISSION_REPOSITORY)
    private readonly quizSubmission?: QuizSubmissionRepository,
    @Optional()
    @Inject(DIAGNOSTIC_REMEDIATION_REPOSITORY)
    private readonly diagnosticRemediation?: DiagnosticRemediationRepository,
  ) {}

  getCognitiveEntityState(userId: string, entityId: string) {
    if (!this.learnerStateProjectionRead) {
      throw new Error("Learner state persistence is unavailable");
    }
    return getCognitiveEntityState(
      userId,
      entityId,
      this.learnerStateProjectionRead,
    );
  }

  getCognitiveEntityEvidence(userId: string, entityId: string) {
    if (!this.cognitiveEntityEvidenceRead) {
      throw new Error("Cognitive evidence persistence is unavailable");
    }
    return getCognitiveEntityEvidence(
      userId,
      entityId,
      this.cognitiveEntityEvidenceRead,
    );
  }

  getUnitPage(userId: string, unitId: string, goalId?: string) {
    return getUnitPage(
      this.learningSpaceOrm.unitDeliveryRead,
      userId,
      unitId,
      goalId,
    );
  }

  getUnitContent(userId: string, unitId: string, revision?: number) {
    return getUnitContent(
      this.learningSpaceOrm.unitDeliveryRead,
      userId,
      unitId,
      revision,
      this.cognitiveModelPresentationRead,
      this.learnerStateProjectionRead,
    );
  }

  getUnitSections(userId: string, unitId: string) {
    return getUnitSectionManifest(userId, unitId);
  }

  listChatAudio(userId: string, unitId: string, sectionId?: string) {
    return listCurrentChatNarration({
      userId,
      unitId,
      sectionId,
    }).then((assets) => ({ assets }));
  }

  ensureChatAudio(userId: string, unitId: string, sectionId?: string) {
    const jobKey = `${userId}:${unitId}:${sectionId ?? "unit"}`;
    if (!this.chatAudioJobs.has(jobKey)) {
      let job: Promise<void>;
      job = ensureCurrentChatNarration({ userId, unitId, sectionId })
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.stack : String(error);
          this.logger.error(
            `Chat narration generation failed for ${jobKey}`,
            detail,
          );
        })
        .finally(() => {
          if (this.chatAudioJobs.get(jobKey) === job) {
            this.chatAudioJobs.delete(jobKey);
          }
        });
      this.chatAudioJobs.set(jobKey, job);
    }
    return { accepted: true };
  }

  readChatAudio(userId: string, unitId: string, audioId: string) {
    return readOwnedChatNarration({
      userId,
      unitId,
      audioId,
    });
  }

  getUnitSectionContent(
    userId: string,
    unitId: string,
    sectionId: string,
    revision?: number,
  ) {
    return getUnitSectionContent(userId, unitId, sectionId, revision);
  }

  generateUnitSection(
    userId: string,
    unitId: string,
    sectionId: string,
    signal?: AbortSignal,
    force = false,
    rewrite?: { topicId?: string; topicIndex?: number },
    derivationFormat?: "teaching_v1",
  ) {
    return generateUnitSectionMaterial({
      userId,
      unitId,
      sectionId,
      signal,
      force,
      derivationFormat,
      ...sectionRewriteFromBody(rewrite),
    });
  }

  pendingTeachingPresentation(
    userId: string,
    unitId: string,
    sectionId: string,
  ) {
    return getPendingTeachingPresentation({ userId, unitId, sectionId });
  }
  acceptTeachingPresentation(
    userId: string,
    unitId: string,
    sectionId: string,
    revision: number,
    hash: string,
  ) {
    return acceptPendingTeachingPresentation({
      userId,
      unitId,
      sectionId,
      revision,
      hash,
    });
  }
  teachingPresentationStream(
    userId: string,
    unitId: string,
    sectionId: string,
    expectedRevision: number,
    action: "enhance" | "restore",
  ) {
    return sseResponse(
      createSseStream(async (send) => {
        send({ type: "status", message: "Preparing formula presentation" });
        const result = await updateUnitTeachingPresentation({
          userId,
          unitId,
          sectionId,
          expectedRevision,
          action,
          onProgress: (step, total) =>
            send({ type: "status", message: `${step} / ${total}` }),
        });
        send({ type: "done", data: result });
      }),
    );
  }

  generateUnitSectionStream(
    userId: string,
    unitId: string,
    sectionId: string,
    signal?: AbortSignal,
    force = false,
    rewrite?: { topicId?: string; topicIndex?: number },
    derivationFormat?: "teaching_v1",
  ) {
    const { artifactKind: verificationArtifact, phase: generationPhase } =
      sectionGenerationDescriptor(sectionId);
    return sseResponse(
      createSseStream(
        async (send) => {
          const sendMaterialDelta =
            createSectionMaterialDeltaEmitter<
              LearningMaterialContent["blocks"][number]
            >(send);
          send({
            type: "status",
            phase: generationPhase,
            message: tBackend(
              verificationArtifact === "mini_test"
                ? "status.learning.generatingSectionQuiz"
                : "status.learning.generatingSectionMaterial",
            ),
          });
          await generateUnitSectionMaterial({
            userId,
            unitId,
            sectionId,
            signal,
            force,
            derivationFormat,
            ...sectionRewriteFromBody(rewrite),
            onPartialMaterial: async (partial) => {
              sendMaterialDelta(partial);
            },
            onNarrationAudioReady: async (asset) => {
              send({ type: "narration_audio_ready", asset });
            },
            onVerificationStart: async () => {
              send({
                type: "status",
                phase: generationPhase,
                message: tBackend("status.generation.verifyingContent"),
              });
              send({
                type: "content_verification",
                state: "verifying",
                artifactKind: verificationArtifact,
              });
            },
            onRepairApplied: async (patches) => {
              send({
                type: "content_repair",
                artifactKind: verificationArtifact,
                patches,
              });
            },
            onDerivationStart: async () => {
              send({
                type: "status",
                phase: "formal_derivation",
                message: tBackend("status.generation.formalDerivation"),
              });
            },
            onTeachingDerivationStart: async () => {
              send({
                type: "status",
                phase: "formal_derivation",
                message: tBackend("status.generation.teachingDerivation"),
              });
            },
            onPartialDerivation: async (document) => {
              send({
                type: "derivation_partial",
                derivation: document,
                completeStepCount: document.steps.length,
                finalized: document.status === "complete",
              });
            },
            onPartialTeachingDerivation: async (document, derived) => {
              send({
                type: "teaching_derivation_partial",
                teachingDerivation: document,
                derived,
                completeStepCount: document.steps.length,
                finalized: document.status === "complete",
              });
            },
            onVerificationComplete: async (result) => {
              send({
                type: "content_verification",
                state: "verified",
                artifactKind: verificationArtifact,
                result,
              });
            },
          });
          send(sectionGenerationDoneEvent(sectionId));
        },
        { keepAliveMs: 15_000 },
      ),
    );
  }

  cancelUnitSectionGeneration(
    userId: string,
    unitId: string,
    sectionId: string,
  ) {
    return cancelUnitSectionGeneration({
      userId,
      unitId,
      sectionId,
    });
  }

  async completeUnitSection(
    userId: string,
    unitId: string,
    sectionId: string,
    skip = false,
  ) {
    try {
      return await completeUnitSection({
        userId,
        unitId,
        sectionId,
        skip,
        sectionProgress: this.unitSectionProgress,
        materialCheckCompletion: this.materialCheckCompletion,
      });
    } catch (error) {
      throw new ConflictException(
        error instanceof Error
          ? localizeBackendMessage(error.message)
          : tBackend("error.internal"),
      );
    }
  }

  getLearningAccess(userId: string, unitId: string) {
    return getLearningAccess(
      this.learningSpaceOrm.unitDeliveryRead,
      userId,
      unitId,
      this.cognitiveModelGenerationRun,
      this.cognitiveModelPublicationFinalization,
      this.cognitiveModelEvent,
      this.learnerStateMemoryInvalidation,
      this.cognitiveModelPresentationRead,
    );
  }

  getSession(userId: string, unitId: string) {
    if (!this.unitActivity) {
      throw new Error("Unit activity persistence is unavailable");
    }
    return getSession(
      this.learningSpaceOrm.unitDeliveryRead,
      userId,
      unitId,
      this.unitActivity,
      this.cognitiveModelGenerationRun,
      this.cognitiveModelPublicationFinalization,
      this.cognitiveModelEvent,
      this.learnerStateMemoryInvalidation,
      this.cognitiveModelPresentationRead,
      this.unitSessionState,
      this.quizSession,
    );
  }

  getLearningTargets(userId: string, unitId: string) {
    return getLearningTargets(
      this.learningSpaceOrm.unitDeliveryRead,
      userId,
      unitId,
      this.cognitiveModelPresentationRead,
      this.learnerStateProjectionRead,
    );
  }

  getUnitConceptMap(userId: string, unitId: string) {
    return getUnitConceptMap(
      this.learningSpaceOrm.unitDeliveryRead,
      userId,
      unitId,
      this.cognitiveModelPresentationRead,
    );
  }

  learningTargetExpansionStream(userId: string, unitId: string) {
    return learningTargetExpansionStream(
      this.learningSpaceOrm.unitDeliveryRead,
      userId,
      unitId,
      this.cognitiveModelGenerationRun,
      this.cognitiveModelPublication,
      this.cognitiveModelPublicationFinalization,
      this.projectBlueprint,
      this.learnerStateMemoryInvalidation,
    );
  }

  getDiagnostic(userId: string, unitId: string) {
    return getDiagnostic(
      undefined,
      userId,
      unitId,
      this.unitDiagnosticRead,
      this.cognitiveModelPresentationRead,
      this.learnerStateProjectionRead,
    );
  }

  async getUnitAdaptiveAssessment(userId: string, unitId: string) {
    if (!this.unitDiagnosticRead) {
      throw new Error("Unit diagnostic persistence is unavailable");
    }
    const unit = await this.unitDiagnosticRead.findUnit({ userId, unitId });
    if (!unit) throw new Error("Unit not found");
    return getAdaptiveAssessmentPlan(
      undefined,
      userId,
      "unit",
      { goalId: unit.goalId, unitId },
      {
        targetRepository: this.assessmentTarget,
        evidenceRepository: this.adaptiveAssessmentEvidence,
        taskRepository: this.adaptiveAssessmentTask,
      },
    );
  }

  getModuleAdaptiveAssessment(
    userId: string,
    goalId: string,
    moduleId: string,
    purpose: "mastery" | "readiness" = "mastery",
  ) {
    return getAdaptiveAssessmentPlan(
      undefined,
      userId,
      "module",
      {
        goalId,
        moduleId,
      },
      {
        purpose,
        targetRepository: this.assessmentTarget,
        evidenceRepository: this.adaptiveAssessmentEvidence,
        taskRepository: this.adaptiveAssessmentTask,
      },
    );
  }

  submitAdaptiveAssessmentStream(
    userId: string,
    taskId: string,
    body: Record<string, unknown>,
  ) {
    return submitAdaptiveAssessmentStream(
      undefined,
      userId,
      taskId,
      body,
      this.verifiedAssessmentCompletion,
      this.learnerStateMemoryInvalidation,
      this.taskAttempt,
      this.prerequisiteBridge,
    );
  }

  getModuleDiagnostic(userId: string, goalId: string, moduleId: string) {
    return getModuleDiagnostic(
      undefined,
      userId,
      goalId,
      moduleId,
      this.moduleDiagnosticRead,
      this.assessmentTarget,
    );
  }

  moduleDiagnosticStream(
    userId: string,
    goalId: string,
    moduleId: string,
    body: { runId?: string } = {},
  ) {
    return streamModuleDiagnostic(
      undefined,
      userId,
      goalId,
      moduleId,
      body,
      this.moduleDiagnosticRead,
      this.moduleDiagnosticCompletion,
      this.assessmentTarget,
    );
  }

  submitModuleDiagnostic(
    userId: string,
    goalId: string,
    moduleId: string,
    attemptId: string,
    answers: Record<string, string | number | boolean | number[]>,
  ) {
    return submitModuleDiagnostic(
      undefined,
      userId,
      goalId,
      moduleId,
      attemptId,
      answers,
      this.moduleTestOut,
      this.moduleDiagnosticCompletion,
      this.moduleDiagnosticRead,
      this.learnerStateMemoryInvalidation,
      this.assessmentTarget,
    );
  }

  submitDiagnostic(
    userId: string,
    unitId: string,
    attemptId: string,
    answers: Record<string, string | number | boolean | number[]>,
  ) {
    if (
      !this.unitCompletion ||
      !this.unitCompletionRead ||
      !this.cognitiveModelEvent
    ) {
      throw new Error("Unit completion persistence is unavailable");
    }
    return submitDiagnostic(
      undefined,
      userId,
      unitId,
      attemptId,
      answers,
      {
        userId,
        repository: this.unitCompletion,
        contextRead: this.unitCompletionRead,
        knowledgeRead: this.completedUnitKnowledgeRead,
        cognitiveModelEvent: this.cognitiveModelEvent,
      },
      this.cognitiveModelGenerationRun,
      this.cognitiveModelPublication,
      this.cognitiveModelPublicationFinalization,
      this.unitDiagnosticCompletion,
      this.projectBlueprint,
      this.unitDiagnosticRead,
      this.learnerStateMemoryInvalidation,
      this.diagnosticRemediation,
      this.cognitiveModelPresentationRead,
      this.assessmentTarget,
    );
  }

  postSession(
    userId: string,
    unitId: string,
    body: { action: string; payload?: Record<string, unknown> },
  ) {
    return postSession(
      this.learningSpaceOrm.unitDeliveryRead,
      this.learningSpaceOrm.unitSessionArtifact,
      this.learningSpaceOrm.scenarioTheaterSession,
      this.learningSpaceOrm.scenarioTheaterGeneration,
      this.learningSpaceOrm.unitLab,
      userId,
      unitId,
      body,
      this.unitSessionState,
      this.unitActivity,
      this.unitCompletion,
      this.unitSectionProgress,
      this.cognitiveModelGenerationRun,
      this.cognitiveModelPublication,
      this.cognitiveModelPublicationFinalization,
      this.materialCheckCompletion,
      this.unitLearningProgressReset,
      this.materialReplacement,
      this.projectBlueprint,
      this.learnerStateProjectionRead,
      this.learnerStateMemoryInvalidation,
      this.feynmanEvidence,
      this.socraticEvidence,
      this.quizSubmission,
      this.completedUnitKnowledgeRead,
      this.unitCompletionRead,
      this.cognitiveModelEvent,
      this.cognitiveModelPresentationRead,
      this.unitStructuredCleanup,
      this.materialEnrichment,
      this.quizSession,
      this.assessmentTarget,
      this.flashcardExperience,
    );
  }

  sessionStream(userId: string, unitId: string, body: Record<string, unknown>) {
    return sessionStream(
      this.learningSpaceOrm.unitDeliveryRead,
      this.learningSpaceOrm.unitSessionArtifact,
      this.learningSpaceOrm.scenarioTheaterSession,
      this.learningSpaceOrm.scenarioTheaterGeneration,
      this.learningSpaceOrm.unitLab,
      userId,
      unitId,
      body,
      this.cognitiveModelGenerationRun,
      this.cognitiveModelPublication,
      this.cognitiveModelPublicationFinalization,
      this.unitLearningProgressReset,
      this.materialReplacement,
      this.projectBlueprint,
      this.learnerStateProjectionRead,
      this.learnerStateMemoryInvalidation,
      this.socraticEvidence,
      this.cognitiveModelPresentationRead,
      this.unitStructuredCleanup,
      this.materialEnrichment,
      this.quizSession,
      this.unitSessionState,
      this.assessmentTarget,
      this.flashcardExperience,
      this.materialCheckCompletion,
    );
  }

  subdivideStream(
    userId: string,
    unitId: string,
    body: Record<string, unknown>,
  ) {
    return subdivideStream(
      this.learningSpaceOrm.unitSubdivision,
      userId,
      unitId,
      body,
    );
  }

  getSubdivisionStatus(userId: string, unitId: string) {
    return getSubdivisionStatus(
      this.learningSpaceOrm.unitSubdivision,
      userId,
      unitId,
    );
  }

  removeSubMap(userId: string, unitId: string) {
    return removeSubMap(this.learningSpaceOrm.unitSubdivision, userId, unitId);
  }

  regenerateIllustration(
    userId: string,
    unitId: string,
    blockIndex: number,
    prompt?: string,
    figureIndex?: number,
  ) {
    return regenerateIllustration(
      this.learningSpaceOrm.materialRegeneration,
      this.learningSpaceOrm.unitDeliveryRead,
      userId,
      unitId,
      blockIndex,
      undefined,
      prompt,
      figureIndex,
    );
  }

  regenerateIllustrationStream(
    userId: string,
    unitId: string,
    blockIndex: number,
    prompt?: string,
    figureIndex?: number,
  ) {
    return sseResponse(
      createSseStream(async (send) => {
        const result = await regenerateIllustration(
          this.learningSpaceOrm.materialRegeneration,
          this.learningSpaceOrm.unitDeliveryRead,
          userId,
          unitId,
          blockIndex,
          (progress) =>
            send({
              type: "image_generation_progress",
              ...progress,
              message: imageProgressMessage(progress.stage),
            }),
          prompt,
          figureIndex,
        );
        send({ type: "done", ...result });
      }),
    );
  }

  replaceSvgWithIllustration(
    userId: string,
    unitId: string,
    blockIndex: number,
  ) {
    return replaceSvgWithIllustration(
      this.learningSpaceOrm.materialRegeneration,
      this.learningSpaceOrm.unitDeliveryRead,
      userId,
      unitId,
      blockIndex,
    );
  }

  replaceSvgWithIllustrationStream(
    userId: string,
    unitId: string,
    blockIndex: number,
  ) {
    return sseResponse(
      createSseStream(async (send) => {
        const result = await replaceSvgWithIllustration(
          this.learningSpaceOrm.materialRegeneration,
          this.learningSpaceOrm.unitDeliveryRead,
          userId,
          unitId,
          blockIndex,
          (progress) =>
            send({
              type: "image_generation_progress",
              ...progress,
              message: imageProgressMessage(progress.stage),
            }),
        );
        send({ type: "done", ...result });
      }),
    );
  }

  editComponentWithAi(
    userId: string,
    unitId: string,
    blockIndex: number,
    instruction: string,
  ) {
    return editComponentWithAi(
      this.learningSpaceOrm.materialRegeneration,
      this.learningSpaceOrm.unitDeliveryRead,
      userId,
      unitId,
      blockIndex,
      instruction,
    );
  }

  editComponentWithAiStream(
    userId: string,
    unitId: string,
    blockIndex: number,
    instruction: string,
  ) {
    return sseResponse(
      createSseStream(async (send) => {
        const result = await editComponentWithAi(
          this.learningSpaceOrm.materialRegeneration,
          this.learningSpaceOrm.unitDeliveryRead,
          userId,
          unitId,
          blockIndex,
          instruction,
          (component) => send({ type: "component_partial", component }),
        );
        send({ type: "done", ...result });
      }),
    );
  }

  deleteComponentBlock(userId: string, unitId: string, blockIndex: number) {
    return deleteComponentBlock(
      this.learningSpaceOrm.materialRegeneration,
      this.learningSpaceOrm.unitDeliveryRead,
      userId,
      unitId,
      blockIndex,
    );
  }

  regenerateComponent(
    userId: string,
    unitId: string,
    blockIndex: number,
    placeholderComponentType?: string,
  ) {
    return regenerateComponent(
      this.learningSpaceOrm.materialRegeneration,
      this.learningSpaceOrm.unitDeliveryRead,
      this.assessmentTarget!,
      userId,
      unitId,
      blockIndex,
      placeholderComponentType,
    );
  }

  regenerateComponentStream(
    userId: string,
    unitId: string,
    blockIndex: number,
    placeholderComponentType?: string,
  ) {
    return sseResponse(
      createSseStream(async (send) => {
        const result = await regenerateComponent(
          this.learningSpaceOrm.materialRegeneration,
          this.learningSpaceOrm.unitDeliveryRead,
          this.assessmentTarget!,
          userId,
          unitId,
          blockIndex,
          placeholderComponentType,
          (component) => send({ type: "component_partial", component }),
        );
        send({ type: "done", ...result });
      }),
    );
  }

  regenerateUnitLabItem(userId: string, unitId: string, itemIndex: number) {
    return regenerateUnitLabItem({
      client: this.learningSpaceOrm.unitLab,
      userId,
      unitId,
      itemIndex,
    }).catch((error: unknown) => {
      const code = error instanceof Error ? error.message : String(error);
      if (code === "unit_not_found") {
        throw new NotFoundException(tBackend("error.goal.unitNotFound"));
      }
      if (code === "lab_item_missing") {
        throw new BadRequestException(
          tBackend("error.learning.componentMissing"),
        );
      }
      if (code === "lab_item_regeneration_forbidden") {
        throw new BadRequestException(
          tBackend("error.learning.componentRegenerateForbidden"),
        );
      }
      if (code === "lab_item_regeneration_failed") {
        throw new BadRequestException(
          tBackend("error.learning.componentRegenerateFailed"),
        );
      }
      if (code === "lab_item_regeneration_conflict") {
        throw new ConflictException(
          tBackend("error.learning.componentRegenerateFailed"),
        );
      }
      throw error;
    });
  }

  regenerateSubMapStream(
    userId: string,
    unitId: string,
    body: Record<string, unknown>,
  ) {
    return regenerateSubMapStream(
      this.learningSpaceOrm.unitSubdivision,
      userId,
      unitId,
      body,
    );
  }

  getFollowUps(userId: string, unitId: string) {
    return getFollowUps(this.learningSpaceOrm.materialFollowUp, userId, unitId);
  }

  getRecentFollowUps(userId: string, limit?: number) {
    return getRecentFollowUps(userId, limit);
  }

  getQuizSets(userId: string, unitId: string) {
    if (!this.quizSession) throw new Error("Quiz persistence is unavailable");
    return getQuizSets(this.quizSession, userId, unitId);
  }

  getUnitFlashcards(userId: string, unitId: string) {
    if (!this.quizSession || !this.flashcardExperience) {
      throw new Error("Flashcard persistence is unavailable");
    }
    return getUnitFlashcards(
      this.quizSession,
      this.flashcardExperience,
      userId,
      unitId,
    );
  }

  generateUnitFlashcards(userId: string, unitId: string) {
    if (!this.quizSession || !this.flashcardExperience) {
      throw new Error("Flashcard persistence is unavailable");
    }
    return generateUnitFlashcards(
      this.quizSession,
      this.flashcardExperience,
      userId,
      unitId,
    );
  }

  postFollowUps(userId: string, unitId: string, body: Record<string, unknown>) {
    return postFollowUps(
      this.learningSpaceOrm.materialFollowUp,
      userId,
      unitId,
      body,
    );
  }

  followUpsStream(
    userId: string,
    unitId: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    return followUpsStream(
      this.learningSpaceOrm.materialFollowUp,
      userId,
      unitId,
      body,
      signal,
      this.learnerStateMemoryRead,
    );
  }
}

function imageProgressMessage(
  stage:
    | "requesting"
    | "generating"
    | "downloading"
    | "removing_background"
    | "saving",
): string {
  switch (stage) {
    case "requesting":
      return tBackend("status.learning.imageSubmitting");
    case "generating":
      return tBackend("status.learning.imageGenerating");
    case "downloading":
      return tBackend("status.learning.imageFetchingHd");
    case "removing_background":
      return tBackend("status.learning.imageRemovingBackground");
    case "saving":
      return tBackend("status.learning.imageSaving");
  }
}
