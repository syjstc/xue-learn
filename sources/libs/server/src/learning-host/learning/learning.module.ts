import { LearningMainlineController } from "./learning-mainline.controller.js";
import { LearningTrajectoryController } from "./learning-trajectory.controller.js";
import { Module } from "@nestjs/common";
import { LearningController } from "./learning.controller.js";
import { LearningService } from "./learning.service.js";
import { CognitionController } from "./cognition.controller.js";
import { ProjectsController } from "./projects.controller.js";
import { ProjectsService } from "./projects.service.js";
import { ModuleLearningController } from "./module-learning.controller.js";
import { AdaptiveAssessmentController } from "./adaptive-assessment.controller.js";
import { FollowUpsController } from "./follow-ups.controller.js";
import { LearningSpaceOrmProvider } from "../../learning-spaces/learning-space-orm.provider.js";
import { LearningSpacePersistenceModule } from "../../learning-spaces/learning-space-persistence.module.js";
import { UNIT_SESSION_STATE_REPOSITORY } from "../../learning-spaces/unit-session-token.js";
import { UNIT_ACTIVITY_REPOSITORY } from "../../learning-spaces/unit-activity-token.js";
import { UNIT_STRUCTURED_CLEANUP_REPOSITORY } from "../../learning-spaces/unit-structured-cleanup-token.js";
import { UNIT_COMPLETION_REPOSITORY } from "../../learning-spaces/unit-completion-token.js";
import { UNIT_COMPLETION_READ_REPOSITORY } from "../../learning-spaces/unit-completion-read-token.js";
import { COMPLETED_UNIT_KNOWLEDGE_READ_REPOSITORY } from "../../learning-spaces/completed-unit-knowledge-read-token.js";
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

@Module({
  imports: [LearningSpacePersistenceModule],
  controllers: [
    LearningController,
    ModuleLearningController,
    AdaptiveAssessmentController,
    FollowUpsController,
    LearningTrajectoryController,
    LearningMainlineController,
    CognitionController,
    ProjectsController,
  ],
  providers: [
    LearningService,
    ProjectsService,
    {
      provide: UNIT_SESSION_STATE_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.unitSessionState),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: UNIT_STRUCTURED_CLEANUP_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.unitStructuredCleanup),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: UNIT_ACTIVITY_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.unitActivity),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: UNIT_COMPLETION_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.unitCompletion),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: UNIT_COMPLETION_READ_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.unitCompletionRead),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: COMPLETED_UNIT_KNOWLEDGE_READ_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.completedUnitKnowledgeRead),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: UNIT_SECTION_PROGRESS_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.unitSectionProgress),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: MODULE_TEST_OUT_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.moduleTestOut),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: COGNITIVE_MODEL_GENERATION_RUN_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(
          () => provider.cognitiveModelGenerationRun,
        ),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: COGNITIVE_MODEL_EVENT_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.cognitiveModelEvent),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: COGNITIVE_MODEL_PUBLICATION_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.cognitiveModelPublication),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: COGNITIVE_MODEL_PUBLICATION_FINALIZATION_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(
          () => provider.cognitiveModelPublicationFinalization,
        ),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: PREREQUISITE_BRIDGE_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.prerequisiteBridge),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: TASK_ATTEMPT_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.taskAttempt),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: VERIFIED_ASSESSMENT_COMPLETION_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(
          () => provider.verifiedAssessmentCompletion,
        ),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: MATERIAL_CHECK_COMPLETION_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.materialCheckCompletion),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: UNIT_LEARNING_PROGRESS_RESET_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.unitLearningProgressReset),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: UNIT_DIAGNOSTIC_COMPLETION_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.unitDiagnosticCompletion),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: MODULE_DIAGNOSTIC_COMPLETION_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.moduleDiagnosticCompletion),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: FLASHCARD_EXPERIENCE_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.flashcardExperience),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: MATERIAL_ENRICHMENT_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.materialEnrichment),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: MATERIAL_REPLACEMENT_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.materialReplacement),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: SECTION_MATERIAL_REPLACEMENT_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.sectionMaterialReplacement),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: PROJECT_BLUEPRINT_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.projectBlueprint),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: ADAPTIVE_ASSESSMENT_EVIDENCE_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.adaptiveAssessmentEvidence),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: ADAPTIVE_ASSESSMENT_TASK_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.adaptiveAssessmentTask),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: ASSESSMENT_TARGET_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.assessmentTarget),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: UNIT_DIAGNOSTIC_READ_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.unitDiagnosticRead),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: MODULE_DIAGNOSTIC_READ_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.moduleDiagnosticRead),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: COGNITIVE_MODEL_PRESENTATION_READ_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(
          () => provider.cognitiveModelPresentationRead,
        ),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: LEARNER_STATE_PROJECTION_READ_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.learnerStateProjectionRead),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: LEARNER_STATE_MEMORY_READ_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.learnerStateMemoryRead),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: LEARNER_STATE_MEMORY_INVALIDATION_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(
          () => provider.learnerStateMemoryInvalidation,
        ),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: COGNITIVE_ENTITY_EVIDENCE_READ_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(
          () => provider.cognitiveEntityEvidenceRead,
        ),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: FEYNMAN_EVIDENCE_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.feynmanEvidence),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: SOCRATIC_EVIDENCE_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.socraticEvidence),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: QUIZ_SESSION_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.quizSession),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: QUIZ_SUBMISSION_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.quizSubmission),
      inject: [LearningSpaceOrmProvider],
    },
    {
      provide: DIAGNOSTIC_REMEDIATION_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.diagnosticRemediation),
      inject: [LearningSpaceOrmProvider],
    },
  ],
})
export class LearningModule {}
