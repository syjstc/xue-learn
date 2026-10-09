import type { LearningMainlineRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { MikroOrmLearningMainlineRepository } from "./learning-mainline.repository.ts";
import type { LearningTrajectoryRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { MikroOrmLearningTrajectoryRepository } from "./learning-trajectory.repository.ts";
import type { EntityManager } from "@mikro-orm/core";
import type { LearnerProfileRepository, LearnerPlanningSettingsRepository, AgendaProgressRepository, AgendaPublicationRepository, AgendaRefreshReadRepository, AgendaProjectionReadRepository, LearningGoalRepository, LearningSpaceItemRelationRepository, LearningSpaceItemRepository, LearningSpaceRepository, TeachingPersonaRepository, UserSettingsRepository, EventOutboxRepository, EventOutboxDeliveryRepository, LearningUnitRepository, UnitMapContextRepository, LegacyMapUnitMutationRepository, LegacyMapReplacementRepository, OverviewCoursePublicationRepository, MicroUnitPublicationRepository, ScopedMemoryPort, LearningModuleRepository, ModuleTestOutRepository, ModuleGenerationRetryRepository, ExplorationCurriculumReadyRepository, ModuleStructureQueueRepository, ModuleStructureDraftRepository, ModuleGenerationLeaseRepository, DeepPlanningResearchRepository, AiGenerationRunRepository, LearningGoalSettingsRepository, LearningGoalSummaryRepository, LearningGoalPlanRepository, SequentialCurriculumApprovalRepository, LockedModuleReplanningRepository, UnitSessionStateRepository, UnitContentRevisionRepository, UnitStructuredCleanupRepository, UnitActivityRepository, UnitSectionProgressRepository, UnitSectionPlanRepository, ChatNarrationRepository, ReviewExperienceRepository, FlashcardExperienceRepository, LearnerStateMemoryMaintenanceRepository, RagDocumentRepository, RagVectorRepository, AgentConversationRepository, FormalDerivationRepository, TeachingDerivationRepository, GeneralMemoryRepositoryPort, DomainEventOutboxRepository, DomainEventDispatchRepository, UnitCompletionRepository, UnitCompletionReadRepository, CompletedUnitKnowledgeReadRepository, LearningGoalTreeDeletionRepository, FoundationMasteryTransitionRepository, PreparedModulePublicationRepository, ExplorationModulePublicationRepository, ModuleSliceReconciliationRepository, CognitiveModelExpansionLeaseRepository, CognitiveModelExpansionContextRepository, CognitiveModelEventRepository, CognitiveModelInvalidationRepository, CognitiveModelGenerationRunRepository, CognitiveModelPublicationRepository, CognitiveModelPublicationFinalizationRepository, TaskAttemptRepository, VerifiedEvidenceAppendRepository, VerifiedAssessmentCompletionRepository, MaterialCheckCompletionRepository, UnitLearningProgressResetRepository, UnitDiagnosticCompletionRepository, ModuleDiagnosticCompletionRepository, MaterialReplacementRepository, MaterialEnrichmentRepository, SectionMaterialReplacementRepository, ProjectBlueprintRepository, ProjectExperienceRepository, AdaptiveAssessmentEvidenceRepository, AdaptiveAssessmentTaskRepository, AssessmentTargetRepository, UnitDiagnosticReadRepository, ModuleDiagnosticReadRepository, ModuleEntryReadinessReadRepository, PrerequisiteBridgeRepository, CognitiveModelPresentationReadRepository, LearnerStateProjectionReadRepository, LearnerStateMemoryReadRepository, LearnerStateMemoryInvalidationRepository, CognitiveEntityEvidenceReadRepository, FeynmanEvidenceRepository, SocraticEvidenceRepository, QuizSubmissionRepository, QuizSessionRepository, GlobalGenerationSettingsRepository, LlmRoutingRepository, BatchContentGenerationRepository, ModuleEntryFoundationQueueRepository, GoalModuleReadRepository, MasterySummaryReadRepository, GoalCrudReadRepository, AnalyticsMaintenanceRepository, GoalTextbookReadRepository, MediaAccessRepository, RequestMetricsRepository, ObservabilityRepository, WebKnowledgeRepository, UnitSubdivisionRepository, UnitDeliveryReadRepository, UnitSessionArtifactRepository, ScenarioTheaterSessionRepository, ScenarioTheaterGenerationRepository, UnitLabRepository, UnitGenerationContextRepository, MaterialRegenerationRepository, LlmRequestLogRepository, LlmLogQueryRepository, MaterialFollowUpRepository, DiagnosticRemediationRepository, GoalIconRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { MikroOrmScenarioTheaterSessionRepository } from "./scenario-theater-session.repository.ts";
import { MikroOrmScenarioTheaterGenerationRepository } from "./scenario-theater-generation.repository.ts";
import { MikroOrmUnitLabRepository } from "./unit-lab.repository.ts";
import { MikroOrmUnitGenerationContextRepository } from "./unit-generation-context.repository.ts";
import { MikroOrmMaterialRegenerationRepository } from "./material-regeneration.repository.ts";
import { MikroOrmLlmRequestLogRepository } from "./llm-request-log.repository.ts";
import { MikroOrmLlmLogQueryRepository } from "./llm-log-query.repository.ts";
import { LearnerProfileSchema, LearnerProfileEntity } from "./learner-profile.entity.ts";
import { MikroOrmLearnerProfileRepository } from "./learner-profile.repository.ts";
import { LearnerPlanningSettingsSchema, LearnerPlanningSettingsEntity } from "./learner-planning-settings.entity.ts";
import { MikroOrmLearnerPlanningSettingsRepository } from "./learner-planning-settings.repository.ts";
import { MikroOrmAgendaProgressRepository } from "./agenda-progress.repository.ts";
import { MikroOrmAgendaPublicationRepository } from "./agenda-publication.repository.ts";
import { MikroOrmAgendaRefreshReadRepository } from "./agenda-refresh-read.repository.ts";
import { MikroOrmAgendaProjectionReadRepository } from "./agenda-projection-read.repository.ts";
import { LearningGoalSchema, LearningGoalEntity } from "./learning-goal.entity.ts";
import { MikroOrmLearningGoalRepository } from "./learning-goal.repository.ts";
import { LearningSpaceItemRelationSchema, LearningSpaceItemRelationEntity } from "./learning-space-item-relation.entity.ts";
import { MikroOrmLearningSpaceItemRelationRepository } from "./learning-space-item-relation.repository.ts";
import { LearningSpaceItemSchema, LearningSpaceItemEntity } from "./learning-space-item.entity.ts";
import { MikroOrmLearningSpaceItemRepository } from "./learning-space-item.repository.ts";
import { LearningSpaceSchema, LearningSpaceEntity } from "./learning-space.entity.ts";
import { MikroOrmLearningSpaceRepository } from "./learning-space.repository.ts";
import { TeachingPersonaSchema, TeachingPersonaEntity } from "./teaching-persona.entity.ts";
import { MikroOrmTeachingPersonaRepository } from "./teaching-persona.repository.ts";
import { UserSettingsSchema, UserSettingsEntity } from "./user-settings.entity.ts";
import { MikroOrmUserSettingsRepository } from "./user-settings.repository.ts";
import { MikroOrmModuleEntryFoundationQueueRepository } from "./module-entry-foundation-queue.repository.ts";
import { MikroOrmGoalModuleReadRepository } from "./goal-module-read.repository.ts";
import { MikroOrmMasterySummaryReadRepository } from "./mastery-summary-read.repository.ts";
import { MikroOrmGoalCrudReadRepository } from "./goal-crud-read.repository.ts";
import { MikroOrmAnalyticsMaintenanceRepository } from "./analytics-maintenance.repository.ts";
import { MikroOrmGoalTextbookReadRepository } from "./goal-textbook-read.repository.ts";
import { MikroOrmMediaAccessRepository } from "./media-access.repository.ts";
import { MikroOrmRequestMetricsRepository } from "./request-metrics.repository.ts";
import { MikroOrmObservabilityRepository } from "./observability.repository.ts";
import { MikroOrmWebKnowledgeRepository } from "./web-knowledge.repository.ts";
import { MikroOrmUnitSubdivisionRepository } from "./unit-subdivision.repository.ts";
import { MikroOrmUnitDeliveryReadRepository } from "./unit-delivery-read.repository.ts";
import { MikroOrmUnitSessionArtifactRepository } from "./unit-session-artifact.repository.ts";
import { MikroOrmMaterialFollowUpRepository } from "./material-follow-up.repository.ts";
import { UserSchema, UserEntity } from "./user.entity.ts";
import { EventOutboxSchema, EventOutboxEntity } from "./event-outbox.entity.ts";
import { MikroOrmEventOutboxRepository } from "./event-outbox.repository.ts";
import { MikroOrmEventOutboxDeliveryRepository } from "./event-outbox-delivery.repository.ts";
import { MikroOrmLearningUnitRepository } from "./learning-unit.repository.ts";
import { MikroOrmUnitMapContextRepository } from "./unit-map-context.repository.ts";
import { MikroOrmLegacyMapUnitMutationRepository } from "./legacy-map-unit-mutation.repository.ts";
import { MikroOrmLegacyMapReplacementRepository } from "./legacy-map-replacement.repository.ts";
import { MikroOrmOverviewCoursePublicationRepository } from "./overview-course-publication.repository.ts";
import { MikroOrmMicroUnitPublicationRepository } from "./micro-unit-publication.repository.ts";
import { MikroOrmScopedMemoryRepository } from "./scoped-memory.repository.ts";
import { MikroOrmLearningModuleRepository } from "./learning-module.repository.ts";
import { MikroOrmModuleTestOutRepository } from "./module-test-out.repository.ts";
import { MikroOrmModuleGenerationRetryRepository } from "./module-generation-retry.repository.ts";
import { MikroOrmExplorationCurriculumReadyRepository } from "./exploration-curriculum-ready.repository.ts";
import { MikroOrmModuleStructureQueueRepository } from "./module-structure-queue.repository.ts";
import { MikroOrmModuleStructureDraftRepository } from "./module-structure-draft.repository.ts";
import { MikroOrmModuleGenerationLeaseRepository } from "./module-generation-lease.repository.ts";
import { MikroOrmDeepPlanningResearchRepository } from "./deep-planning-research.repository.ts";
import { MikroOrmAiGenerationRunRepository } from "./ai-generation-run.repository.ts";
import { MikroOrmFormalDerivationRepository } from "./formal-derivation.repository.ts";
import { MikroOrmTeachingDerivationRepository } from "./teaching-derivation.repository.ts";
import { MikroOrmLearningGoalSettingsRepository } from "./learning-goal-settings.repository.ts";
import { MikroOrmLearningGoalSummaryRepository } from "./learning-goal-summary.repository.ts";
import { MikroOrmLearningGoalPlanRepository } from "./learning-goal-plan.repository.ts";
import { MikroOrmSequentialCurriculumApprovalRepository } from "./sequential-curriculum-approval.repository.ts";
import { MikroOrmLockedModuleReplanningRepository } from "./locked-module-replanning.repository.ts";
import { MikroOrmUnitSessionStateRepository } from "./unit-session.repository.ts";
import { MikroOrmUnitContentRevisionRepository } from "./unit-content-revision.repository.ts";
import { MikroOrmUnitStructuredCleanupRepository } from "./unit-structured-cleanup.repository.ts";
import { MikroOrmUnitActivityRepository } from "./unit-activity.repository.ts";
import { MikroOrmUnitSectionProgressRepository } from "./unit-section-progress.repository.ts";
import { MikroOrmUnitSectionPlanRepository } from "./unit-section-plan.repository.ts";
import { MikroOrmChatNarrationRepository } from "./chat-narration.repository.ts";
import { MikroOrmReviewExperienceRepository } from "./review-experience.repository.ts";
import { MikroOrmFlashcardExperienceRepository } from "./flashcard-experience.repository.ts";
import { MikroOrmLearnerStateMemoryMaintenanceRepository } from "./learner-state-memory-maintenance.repository.ts";
import { MikroOrmRagDocumentRepository } from "./rag-document.repository.ts";
import { MikroOrmRagVectorRepository } from "./rag-vector.repository.ts";
import { MikroOrmAgentConversationRepository } from "./agent-conversation.repository.ts";
import { MikroOrmGeneralMemoryRepository } from "./general-memory.repository.ts";
import { MikroOrmTeachingSkillRuntimeRepository } from "./teaching-skill-runtime.repository.ts";
import type { TeachingSkillRuntimePersistence } from "@xue-learn/core/source/libs/server/src/teaching-skills/persistence.ts";
import { MikroOrmDomainEventOutboxRepository } from "./domain-event.repository.ts";
import { MikroOrmDomainEventDispatchRepository } from "./domain-event-dispatch.repository.ts";
import { MikroOrmUnitCompletionRepository } from "./unit-completion.repository.ts";
import { MikroOrmUnitCompletionReadRepository } from "./unit-completion-read.repository.ts";
import { MikroOrmCompletedUnitKnowledgeReadRepository } from "./completed-unit-knowledge-read.repository.ts";
import { MikroOrmLearningGoalTreeDeletionRepository } from "./learning-goal-tree-deletion.repository.ts";
import { MikroOrmFoundationMasteryTransitionRepository } from "./foundation-mastery-transition.repository.ts";
import { MikroOrmPreparedModulePublicationRepository } from "./prepared-module-publication.repository.ts";
import { MikroOrmExplorationModulePublicationRepository } from "./exploration-module-publication.repository.ts";
import { MikroOrmModuleSliceReconciliationRepository } from "./module-slice-reconciliation.repository.ts";
import { MikroOrmCognitiveModelExpansionLeaseRepository } from "./cognitive-model-expansion-lease.repository.ts";
import { MikroOrmCognitiveModelExpansionContextRepository } from "./cognitive-model-expansion-context.repository.ts";
import { MikroOrmCognitiveModelEventRepository } from "./cognitive-model-event.repository.ts";
import { MikroOrmCognitiveModelInvalidationRepository } from "./cognitive-model-invalidation.repository.ts";
import { MikroOrmCognitiveModelGenerationRunRepository } from "./cognitive-model-generation-run.repository.ts";
import { MikroOrmCognitiveModelPublicationRepository } from "./cognitive-model-publication.repository.ts";
import { MikroOrmCognitiveModelPublicationFinalizationRepository } from "./cognitive-model-publication-finalization.repository.ts";
import { MikroOrmTaskAttemptRepository } from "./task-attempt.repository.ts";
import { MikroOrmVerifiedEvidenceAppendRepository } from "./verified-evidence-append.repository.ts";
import { MikroOrmVerifiedAssessmentCompletionRepository } from "./verified-assessment-completion.repository.ts";
import { MikroOrmMaterialCheckCompletionRepository } from "./material-check-completion.repository.ts";
import { MikroOrmUnitLearningProgressResetRepository } from "./unit-learning-progress-reset.repository.ts";
import { MikroOrmUnitDiagnosticCompletionRepository } from "./unit-diagnostic-completion.repository.ts";
import { MikroOrmModuleDiagnosticCompletionRepository } from "./module-diagnostic-completion.repository.ts";
import { MikroOrmMaterialReplacementRepository } from "./material-replacement.repository.ts";
import { MikroOrmMaterialEnrichmentRepository } from "./material-enrichment.repository.ts";
import { MikroOrmGlobalGenerationSettingsRepository } from "./global-generation-settings.repository.ts";
import { MikroOrmLlmRoutingRepository } from "./llm-routing.repository.ts";
import { MikroOrmBatchContentGenerationRepository } from "./batch-content-generation.repository.ts";
import { MikroOrmSectionMaterialReplacementRepository } from "./section-material-replacement.repository.ts";
import { MikroOrmProjectBlueprintRepository } from "./project-blueprint.repository.ts";
import { MikroOrmProjectExperienceRepository } from "./project-experience.repository.ts";
import { MikroOrmAdaptiveAssessmentEvidenceRepository } from "./adaptive-assessment-evidence.repository.ts";
import { MikroOrmAdaptiveAssessmentTaskRepository } from "./adaptive-assessment-task.repository.ts";
import { MikroOrmAssessmentTargetRepository } from "./assessment-target.repository.ts";
import { MikroOrmUnitDiagnosticReadRepository } from "./unit-diagnostic-read.repository.ts";
import { MikroOrmModuleDiagnosticReadRepository } from "./module-diagnostic-read.repository.ts";
import { MikroOrmModuleEntryReadinessReadRepository } from "./module-entry-readiness-read.repository.ts";
import { MikroOrmPrerequisiteBridgeRepository } from "./prerequisite-bridge.repository.ts";
import { MikroOrmCognitiveModelPresentationReadRepository } from "./cognitive-model-presentation-read.repository.ts";
import { MikroOrmLearnerStateProjectionReadRepository } from "./learner-state-projection-read.repository.ts";
import { MikroOrmLearnerStateMemoryReadRepository } from "./learner-state-memory-read.repository.ts";
import { MikroOrmLearnerStateMemoryInvalidationRepository } from "./learner-state-memory-invalidation.repository.ts";
import { MikroOrmCognitiveEntityEvidenceReadRepository } from "./cognitive-entity-evidence-read.repository.ts";
import { MikroOrmFeynmanEvidenceRepository } from "./feynman-evidence.repository.ts";
import { MikroOrmSocraticEvidenceRepository } from "./socratic-evidence.repository.ts";
import { MikroOrmQuizSubmissionRepository } from "./quiz-submission.repository.ts";
import { MikroOrmQuizSessionRepository } from "./quiz-session.repository.ts";
import { MikroOrmDiagnosticRemediationRepository } from "./diagnostic-remediation.repository.ts";
import { MikroOrmGoalIconRepository } from "./goal-icon.repository.ts";
/** All currently accepted personal-core schemas in dependency order. */
export const REFERENCE_ENTITY_SCHEMAS = [
    UserSchema,
    LearnerProfileSchema,
    UserSettingsSchema,
    TeachingPersonaSchema,
    LearnerPlanningSettingsSchema,
    LearningSpaceSchema,
    LearningGoalSchema,
    LearningSpaceItemSchema,
    LearningSpaceItemRelationSchema,
    EventOutboxSchema,
] as const;
export type ReferenceRepositories = Readonly<{
    learnerProfile: LearnerProfileRepository;
    userSettings: UserSettingsRepository;
    moduleEntryFoundationQueue: ModuleEntryFoundationQueueRepository;
    goalModuleRead: GoalModuleReadRepository;
    masterySummaryRead: MasterySummaryReadRepository;
    goalCrudRead: GoalCrudReadRepository;
    analyticsMaintenance: AnalyticsMaintenanceRepository;
    goalTextbookRead: GoalTextbookReadRepository;
    mediaAccess: MediaAccessRepository;
    requestMetrics: RequestMetricsRepository;
    observability: ObservabilityRepository;
    webKnowledge: WebKnowledgeRepository;
    unitSubdivision: UnitSubdivisionRepository;
    unitDeliveryRead: UnitDeliveryReadRepository;
    unitSessionArtifact: UnitSessionArtifactRepository;
    scenarioTheaterSession: ScenarioTheaterSessionRepository;
    scenarioTheaterGeneration: ScenarioTheaterGenerationRepository;
    unitLab: UnitLabRepository;
    unitGenerationContext: UnitGenerationContextRepository;
    materialRegeneration: MaterialRegenerationRepository;
    llmRequestLog: LlmRequestLogRepository;
    llmLogQuery: LlmLogQueryRepository;
    materialFollowUp: MaterialFollowUpRepository;
    learningTrajectory: LearningTrajectoryRepository;
    learningMainline: LearningMainlineRepository;
    teachingPersona: TeachingPersonaRepository;
    learnerPlanningSettings: LearnerPlanningSettingsRepository;
    agendaProgress: AgendaProgressRepository;
    agendaPublication: AgendaPublicationRepository;
    agendaRefreshRead: AgendaRefreshReadRepository;
    agendaProjectionRead: AgendaProjectionReadRepository;
    learningSpace: LearningSpaceRepository;
    learningGoal: LearningGoalRepository;
    learningSpaceItem: LearningSpaceItemRepository;
    learningSpaceItemRelation: LearningSpaceItemRelationRepository;
    eventOutbox: EventOutboxRepository;
    eventOutboxDelivery: EventOutboxDeliveryRepository;
    learningUnit: LearningUnitRepository;
    unitMapContext: UnitMapContextRepository;
    legacyMapUnitMutation: LegacyMapUnitMutationRepository;
    legacyMapReplacement: LegacyMapReplacementRepository;
    overviewCoursePublication: OverviewCoursePublicationRepository;
    microUnitPublication: MicroUnitPublicationRepository;
    scopedMemory: ScopedMemoryPort;
    learningModule: LearningModuleRepository;
    moduleTestOut: ModuleTestOutRepository;
    moduleGenerationRetry: ModuleGenerationRetryRepository;
    explorationCurriculumReady: ExplorationCurriculumReadyRepository;
    moduleStructureQueue: ModuleStructureQueueRepository;
    moduleStructureDraft: ModuleStructureDraftRepository;
    moduleGenerationLease: ModuleGenerationLeaseRepository;
    deepPlanningResearch: DeepPlanningResearchRepository;
    aiGenerationRun: AiGenerationRunRepository;
    formalDerivation: FormalDerivationRepository;
    teachingDerivation: TeachingDerivationRepository;
    learningGoalSettings: LearningGoalSettingsRepository;
    learningGoalSummary: LearningGoalSummaryRepository;
    learningGoalPlan: LearningGoalPlanRepository;
    sequentialCurriculumApproval: SequentialCurriculumApprovalRepository;
    lockedModuleReplanning: LockedModuleReplanningRepository;
    unitSessionState: UnitSessionStateRepository;
    unitContentRevision: UnitContentRevisionRepository;
    unitStructuredCleanup: UnitStructuredCleanupRepository;
    unitActivity: UnitActivityRepository;
    unitSectionProgress: UnitSectionProgressRepository;
    unitSectionPlan: UnitSectionPlanRepository;
    chatNarration: ChatNarrationRepository;
    reviewExperience: ReviewExperienceRepository;
    flashcardExperience: FlashcardExperienceRepository;
    globalGenerationSettings: GlobalGenerationSettingsRepository;
    llmRouting: LlmRoutingRepository;
    batchContentGeneration: BatchContentGenerationRepository;
    learnerStateMemoryMaintenance: LearnerStateMemoryMaintenanceRepository;
    ragDocument: RagDocumentRepository;
    ragVector: RagVectorRepository;
    agentConversation: AgentConversationRepository;
    generalMemory: GeneralMemoryRepositoryPort;
    teachingSkillRuntime: TeachingSkillRuntimePersistence;
    domainEventOutbox: DomainEventOutboxRepository;
    domainEventDispatch: DomainEventDispatchRepository;
    unitCompletion: UnitCompletionRepository;
    unitCompletionRead: UnitCompletionReadRepository;
    completedUnitKnowledgeRead: CompletedUnitKnowledgeReadRepository;
    goalTreeDeletion: LearningGoalTreeDeletionRepository;
    foundationMasteryTransition: FoundationMasteryTransitionRepository;
    preparedModulePublication: PreparedModulePublicationRepository;
    explorationModulePublication: ExplorationModulePublicationRepository;
    moduleSliceReconciliation: ModuleSliceReconciliationRepository;
    cognitiveModelExpansionLease: CognitiveModelExpansionLeaseRepository;
    cognitiveModelExpansionContext: CognitiveModelExpansionContextRepository;
    cognitiveModelEvent: CognitiveModelEventRepository;
    cognitiveModelInvalidation: CognitiveModelInvalidationRepository;
    cognitiveModelGenerationRun: CognitiveModelGenerationRunRepository;
    cognitiveModelPublication: CognitiveModelPublicationRepository;
    cognitiveModelPublicationFinalization: CognitiveModelPublicationFinalizationRepository;
    taskAttempt: TaskAttemptRepository;
    verifiedEvidenceAppend: VerifiedEvidenceAppendRepository;
    verifiedAssessmentCompletion: VerifiedAssessmentCompletionRepository;
    materialCheckCompletion: MaterialCheckCompletionRepository;
    unitLearningProgressReset: UnitLearningProgressResetRepository;
    unitDiagnosticCompletion: UnitDiagnosticCompletionRepository;
    moduleDiagnosticCompletion: ModuleDiagnosticCompletionRepository;
    materialReplacement: MaterialReplacementRepository;
    materialEnrichment: MaterialEnrichmentRepository;
    sectionMaterialReplacement: SectionMaterialReplacementRepository;
    projectBlueprint: ProjectBlueprintRepository;
    projectExperience: ProjectExperienceRepository;
    adaptiveAssessmentEvidence: AdaptiveAssessmentEvidenceRepository;
    adaptiveAssessmentTask: AdaptiveAssessmentTaskRepository;
    assessmentTarget: AssessmentTargetRepository;
    unitDiagnosticRead: UnitDiagnosticReadRepository;
    moduleDiagnosticRead: ModuleDiagnosticReadRepository;
    moduleEntryReadinessRead: ModuleEntryReadinessReadRepository;
    prerequisiteBridge: PrerequisiteBridgeRepository;
    cognitiveModelPresentationRead: CognitiveModelPresentationReadRepository;
    learnerStateProjectionRead: LearnerStateProjectionReadRepository;
    learnerStateMemoryRead: LearnerStateMemoryReadRepository;
    learnerStateMemoryInvalidation: LearnerStateMemoryInvalidationRepository;
    cognitiveEntityEvidenceRead: CognitiveEntityEvidenceReadRepository;
    feynmanEvidence: FeynmanEvidenceRepository;
    socraticEvidence: SocraticEvidenceRepository;
    quizSubmission: QuizSubmissionRepository;
    quizSession: QuizSessionRepository;
    diagnosticRemediation: DiagnosticRemediationRepository;
    goalIcon: GoalIconRepository;
}>;
/** Construct the reference adapters at one infrastructure composition boundary. */
export function createReferenceRepositories(em: EntityManager): ReferenceRepositories {
    return {
        learnerProfile: new MikroOrmLearnerProfileRepository(em),
        userSettings: new MikroOrmUserSettingsRepository(em),
        moduleEntryFoundationQueue: new MikroOrmModuleEntryFoundationQueueRepository(em),
        goalModuleRead: new MikroOrmGoalModuleReadRepository(em),
        masterySummaryRead: new MikroOrmMasterySummaryReadRepository(em),
        goalCrudRead: new MikroOrmGoalCrudReadRepository(em),
        analyticsMaintenance: new MikroOrmAnalyticsMaintenanceRepository(em),
        goalTextbookRead: new MikroOrmGoalTextbookReadRepository(em),
        mediaAccess: new MikroOrmMediaAccessRepository(em),
        requestMetrics: new MikroOrmRequestMetricsRepository(em),
        observability: new MikroOrmObservabilityRepository(em),
        webKnowledge: new MikroOrmWebKnowledgeRepository(em),
        unitSubdivision: new MikroOrmUnitSubdivisionRepository(em),
        unitDeliveryRead: new MikroOrmUnitDeliveryReadRepository(em),
        unitSessionArtifact: new MikroOrmUnitSessionArtifactRepository(em),
        scenarioTheaterSession: new MikroOrmScenarioTheaterSessionRepository(em),
        scenarioTheaterGeneration: new MikroOrmScenarioTheaterGenerationRepository(em),
        unitLab: new MikroOrmUnitLabRepository(em),
        unitGenerationContext: new MikroOrmUnitGenerationContextRepository(em),
        materialRegeneration: new MikroOrmMaterialRegenerationRepository(em),
        llmRequestLog: new MikroOrmLlmRequestLogRepository(em),
        llmLogQuery: new MikroOrmLlmLogQueryRepository(em),
        materialFollowUp: new MikroOrmMaterialFollowUpRepository(em),
        learningTrajectory: new MikroOrmLearningTrajectoryRepository(em),
        learningMainline: new MikroOrmLearningMainlineRepository(em),
        teachingPersona: new MikroOrmTeachingPersonaRepository(em),
        learnerPlanningSettings: new MikroOrmLearnerPlanningSettingsRepository(em),
        agendaProgress: new MikroOrmAgendaProgressRepository(em),
        agendaPublication: new MikroOrmAgendaPublicationRepository(em),
        agendaRefreshRead: new MikroOrmAgendaRefreshReadRepository(em),
        agendaProjectionRead: new MikroOrmAgendaProjectionReadRepository(em),
        learningSpace: new MikroOrmLearningSpaceRepository(em),
        learningGoal: new MikroOrmLearningGoalRepository(em),
        learningSpaceItem: new MikroOrmLearningSpaceItemRepository(em),
        learningSpaceItemRelation: new MikroOrmLearningSpaceItemRelationRepository(em),
        eventOutbox: new MikroOrmEventOutboxRepository(em),
        eventOutboxDelivery: new MikroOrmEventOutboxDeliveryRepository(em),
        learningUnit: new MikroOrmLearningUnitRepository(em),
        unitMapContext: new MikroOrmUnitMapContextRepository(em),
        legacyMapUnitMutation: new MikroOrmLegacyMapUnitMutationRepository(em),
        legacyMapReplacement: new MikroOrmLegacyMapReplacementRepository(em),
        overviewCoursePublication: new MikroOrmOverviewCoursePublicationRepository(em),
        microUnitPublication: new MikroOrmMicroUnitPublicationRepository(em),
        scopedMemory: new MikroOrmScopedMemoryRepository(em),
        learningModule: new MikroOrmLearningModuleRepository(em),
        moduleTestOut: new MikroOrmModuleTestOutRepository(em),
        moduleGenerationRetry: new MikroOrmModuleGenerationRetryRepository(em),
        explorationCurriculumReady: new MikroOrmExplorationCurriculumReadyRepository(em),
        moduleStructureQueue: new MikroOrmModuleStructureQueueRepository(em),
        moduleStructureDraft: new MikroOrmModuleStructureDraftRepository(em),
        moduleGenerationLease: new MikroOrmModuleGenerationLeaseRepository(em),
        deepPlanningResearch: new MikroOrmDeepPlanningResearchRepository(em),
        aiGenerationRun: new MikroOrmAiGenerationRunRepository(em),
        formalDerivation: new MikroOrmFormalDerivationRepository(em),
        teachingDerivation: new MikroOrmTeachingDerivationRepository(em),
        learningGoalSettings: new MikroOrmLearningGoalSettingsRepository(em),
        learningGoalSummary: new MikroOrmLearningGoalSummaryRepository(em),
        learningGoalPlan: new MikroOrmLearningGoalPlanRepository(em),
        sequentialCurriculumApproval: new MikroOrmSequentialCurriculumApprovalRepository(em),
        lockedModuleReplanning: new MikroOrmLockedModuleReplanningRepository(em),
        unitSessionState: new MikroOrmUnitSessionStateRepository(em),
        unitContentRevision: new MikroOrmUnitContentRevisionRepository(em),
        unitStructuredCleanup: new MikroOrmUnitStructuredCleanupRepository(em),
        unitActivity: new MikroOrmUnitActivityRepository(em),
        unitSectionProgress: new MikroOrmUnitSectionProgressRepository(em),
        unitSectionPlan: new MikroOrmUnitSectionPlanRepository(em),
        chatNarration: new MikroOrmChatNarrationRepository(em),
        reviewExperience: new MikroOrmReviewExperienceRepository(em),
        flashcardExperience: new MikroOrmFlashcardExperienceRepository(em),
        globalGenerationSettings: new MikroOrmGlobalGenerationSettingsRepository(em),
        llmRouting: new MikroOrmLlmRoutingRepository(em),
        batchContentGeneration: new MikroOrmBatchContentGenerationRepository(em),
        learnerStateMemoryMaintenance: new MikroOrmLearnerStateMemoryMaintenanceRepository(em),
        ragDocument: new MikroOrmRagDocumentRepository(em),
        ragVector: new MikroOrmRagVectorRepository(em),
        agentConversation: new MikroOrmAgentConversationRepository(em),
        generalMemory: new MikroOrmGeneralMemoryRepository(em),
        teachingSkillRuntime: new MikroOrmTeachingSkillRuntimeRepository(em),
        domainEventOutbox: new MikroOrmDomainEventOutboxRepository(em),
        domainEventDispatch: new MikroOrmDomainEventDispatchRepository(em),
        unitCompletion: new MikroOrmUnitCompletionRepository(em),
        unitCompletionRead: new MikroOrmUnitCompletionReadRepository(em),
        completedUnitKnowledgeRead: new MikroOrmCompletedUnitKnowledgeReadRepository(em),
        goalTreeDeletion: new MikroOrmLearningGoalTreeDeletionRepository(em),
        foundationMasteryTransition: new MikroOrmFoundationMasteryTransitionRepository(em),
        preparedModulePublication: new MikroOrmPreparedModulePublicationRepository(em),
        explorationModulePublication: new MikroOrmExplorationModulePublicationRepository(em),
        moduleSliceReconciliation: new MikroOrmModuleSliceReconciliationRepository(em),
        cognitiveModelExpansionLease: new MikroOrmCognitiveModelExpansionLeaseRepository(em),
        cognitiveModelExpansionContext: new MikroOrmCognitiveModelExpansionContextRepository(em),
        cognitiveModelEvent: new MikroOrmCognitiveModelEventRepository(em),
        cognitiveModelInvalidation: new MikroOrmCognitiveModelInvalidationRepository(em),
        cognitiveModelGenerationRun: new MikroOrmCognitiveModelGenerationRunRepository(em),
        cognitiveModelPublication: new MikroOrmCognitiveModelPublicationRepository(em),
        cognitiveModelPublicationFinalization: new MikroOrmCognitiveModelPublicationFinalizationRepository(em),
        taskAttempt: new MikroOrmTaskAttemptRepository(em),
        verifiedEvidenceAppend: new MikroOrmVerifiedEvidenceAppendRepository(em),
        verifiedAssessmentCompletion: new MikroOrmVerifiedAssessmentCompletionRepository(em),
        materialCheckCompletion: new MikroOrmMaterialCheckCompletionRepository(em),
        unitLearningProgressReset: new MikroOrmUnitLearningProgressResetRepository(em),
        unitDiagnosticCompletion: new MikroOrmUnitDiagnosticCompletionRepository(em),
        moduleDiagnosticCompletion: new MikroOrmModuleDiagnosticCompletionRepository(em),
        materialReplacement: new MikroOrmMaterialReplacementRepository(em),
        materialEnrichment: new MikroOrmMaterialEnrichmentRepository(em),
        sectionMaterialReplacement: new MikroOrmSectionMaterialReplacementRepository(em),
        projectBlueprint: new MikroOrmProjectBlueprintRepository(em),
        projectExperience: new MikroOrmProjectExperienceRepository(em),
        adaptiveAssessmentEvidence: new MikroOrmAdaptiveAssessmentEvidenceRepository(em),
        adaptiveAssessmentTask: new MikroOrmAdaptiveAssessmentTaskRepository(em),
        assessmentTarget: new MikroOrmAssessmentTargetRepository(em),
        unitDiagnosticRead: new MikroOrmUnitDiagnosticReadRepository(em),
        moduleDiagnosticRead: new MikroOrmModuleDiagnosticReadRepository(em),
        moduleEntryReadinessRead: new MikroOrmModuleEntryReadinessReadRepository(em),
        prerequisiteBridge: new MikroOrmPrerequisiteBridgeRepository(em),
        cognitiveModelPresentationRead: new MikroOrmCognitiveModelPresentationReadRepository(em),
        learnerStateProjectionRead: new MikroOrmLearnerStateProjectionReadRepository(em),
        learnerStateMemoryRead: new MikroOrmLearnerStateMemoryReadRepository(em),
        learnerStateMemoryInvalidation: new MikroOrmLearnerStateMemoryInvalidationRepository(em),
        cognitiveEntityEvidenceRead: new MikroOrmCognitiveEntityEvidenceReadRepository(em),
        feynmanEvidence: new MikroOrmFeynmanEvidenceRepository(em),
        socraticEvidence: new MikroOrmSocraticEvidenceRepository(em),
        quizSubmission: new MikroOrmQuizSubmissionRepository(em),
        quizSession: new MikroOrmQuizSessionRepository(em),
        diagnosticRemediation: new MikroOrmDiagnosticRemediationRepository(em),
        goalIcon: new MikroOrmGoalIconRepository(em)
    };
}
/** Keep entity classes reachable for composition roots that register classes. */
export const REFERENCE_ENTITY_CLASSES = [
    UserEntity,
    LearnerProfileEntity,
    UserSettingsEntity,
    TeachingPersonaEntity,
    LearnerPlanningSettingsEntity,
    LearningSpaceEntity,
    LearningGoalEntity,
    LearningSpaceItemEntity,
    LearningSpaceItemRelationEntity,
    EventOutboxEntity,
] as const;
