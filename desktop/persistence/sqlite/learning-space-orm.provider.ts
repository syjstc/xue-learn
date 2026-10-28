import { LearningSpaceOrmProvider } from "@xue-learn/core/server/learning-spaces/learning-space-orm.provider";
import { configureLearningMainlinePersistence } from "@xue-learn/core/server/learning-mainline/persistence";
import { configureCourseDisplayPolicyPersistence } from "@xue-learn/core/server/learning-spaces/course-display-policy";
import { configureLearningTrajectoryPersistence } from "@xue-learn/core/server/learning-trajectory/persistence";
import { stopLearningSupplementJobs } from "@xue-learn/core/server/learning-trajectory/generation";
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { LearningGoalRepository } from "@xue-learn/core/domain";
import { createLearningSpaceOrganizationPersistence } from "@xue-learn/core/server/learning-spaces/orm-runtime-adapter";
import { MikroOrmLearningSpaceApplicationService } from "@xue-learn/core/server/learning-spaces/orm-application-service";
import type { ReferencePersistenceRuntime } from "@cognilearn/desktop-persistence/reference/runtime";
import { resolvePersistenceMigrationsGlob, resolvePersistenceMigrationsPath } from "@cognilearn/desktop-persistence/migration-paths";
import { configureDefaultLearningSpaceApplication } from "@xue-learn/core/server/learning-systems/default-runtime";
import { configureLearnerStateMemoryRead } from "@xue-learn/core/server/learner-state-memory";
import { configureLearnerStateProjectionRead } from "@xue-learn/core/server/cognition/context";
import { configureLearnerStateProjectionRead as configureLearnerGapProjectionRead } from "@xue-learn/core/server/cognition/gap-persistence";
import { configureGoalIconPersistence } from "@xue-learn/core/server/goals/goal-icon-persistence";
import { configureMicroUnitPersistence } from "@xue-learn/core/server/goals/micro-unit-persistence";
import { configureMaterialFollowUpPersistence } from "@xue-learn/core/server/graph/material-follow-up-persistence";
import { configureAgendaPlanningSettingsPersistence } from "@xue-learn/core/server/agenda/settings";
import { configureAgendaProgressPersistence } from "@xue-learn/core/server/agenda/queries";
import { configureAgendaProjectionReadPersistence } from "@xue-learn/core/server/agenda/queries";
import { configureAgendaPublicationPersistence } from "@xue-learn/core/server/agenda/publish";
import { configureAgendaRefreshReadPersistence } from "@xue-learn/core/server/agenda/refresh";
import { configureUnitSectionPlanPersistence, SECTION_GENERATION_INTERRUPTED_ERROR } from "@xue-learn/core/server/sections";
import { configureChatNarrationPersistence } from "@xue-learn/core/server/audio/chat-narration";
import { configureUnitGenerationContextPersistence } from "@xue-learn/core/server/graph/unit-session";
import { configureLlmRequestLogPersistence } from "@xue-learn/core/server/llm/log-persistence";
import { configureCognitiveModelPersistence } from "@xue-learn/core/server/cognitive-model/persistence";
import { configureRagPersistence } from "@xue-learn/core/server/rag/persistence";
import { configureAgentCheckpointPersistence } from "@xue-learn/core/server/agents/core/checkpoint";
import { configureAgentGoalCreationPersistence } from "@xue-learn/core/server/agents/goal-creation/persistence";
import { configureModuleStructureDraftPersistence } from "@xue-learn/core/server/goal-creation/module-structure-draft-persistence";
import { configureGeneralMemoryPersistence } from "@xue-learn/core/server/learning-systems/capabilities/general-memory/persistence";
import { configureFormalDerivationPersistence } from "@xue-learn/core/server/learning-systems/capabilities/formal-derivation/persistence";
import { configureTeachingDerivationPersistence } from "@xue-learn/core/server/learning-systems/capabilities/teaching-derivation/persistence";
import { configureTeachingSkillRuntimePersistence } from "@xue-learn/core/server/teaching-skills/persistence";
import { configureModulePromptContextPersistence } from "@xue-learn/core/server/goals/module-prompt-context";
import { configureLearnerLanguagePersistence } from "@xue-learn/core/server/persona/learner-language";
import { configureLearnerProfilePersistence } from "@xue-learn/core/server/persona/learner-profile";
import { configureAssistantQueryPersistence } from "@xue-learn/core/server/assistant/queries";
import { configureTeachingSkillsCapabilityPersistence } from "@xue-learn/core/server/learning-systems/capabilities/teaching-skills";
import { configureRuntimeReviewPersistence } from "@xue-learn/core/server/learning-systems/capabilities/support/runtime";
import { configureUserSettingsPersistence } from "@xue-learn/core/server/user-settings";
import { configureGoalTextbookPersistence } from "@xue-learn/core/server/export/goal-textbook-persistence";
import { configureRequestMetricsPersistence } from "@xue-learn/core/server/observability/request-metrics-persistence";
import { configureObservabilityPersistence } from "@xue-learn/core/server/observability/observability-persistence";
import { configureWebKnowledgePersistence } from "@xue-learn/core/server/search/web-knowledge-persistence";
import { configureTeachingPersonaResolutionPersistence } from "@xue-learn/core/server/teaching-personas";
import { configureUnitMapContextPersistence } from "@xue-learn/core/server/domain/unit-map-context-persistence";
import { configureUnitSessionPersistence } from "@xue-learn/core/server/graph/unit-session-persistence";
import { configureModuleEntryReadinessRead } from "@xue-learn/core/server/assessment/readiness";
import { configureContentRevisionPersistence } from "@xue-learn/core/server/graph/content-revision-persistence";
import { configureGenerationRunPersistence } from "@xue-learn/core/server/generation/run-persistence";
import { configureGlobalGenerationSettingsPersistence } from "@xue-learn/core/server/generation/global-generation-settings-persistence";
import { configureLlmRoutingPersistence } from "@xue-learn/core/server/providers/llm/routing-persistence";
import { createLearningSystemPersistenceClient } from "@cognilearn/desktop-persistence/reference/learning-system-persistence-client";
import type { LearningGoalMutationPort, UnitSessionStateRepository, UnitStructuredCleanupRepository, UnitActivityRepository, UnitSectionProgressRepository, ModuleTestOutRepository, ModuleGenerationRetryRepository, ExplorationCurriculumReadyRepository, ModuleStructureQueueRepository, ModuleStructureDraftRepository, ModuleGenerationLeaseRepository, LearningGoalSettingsRepository, LearningGoalSummaryRepository, LearningGoalPlanRepository, SequentialCurriculumApprovalRepository, LockedModuleReplanningRepository, UnitCompletionRepository, ReviewExperienceRepository, FlashcardExperienceRepository, RagDocumentRepository, RagVectorRepository, AgentConversationRepository, DomainEventDispatchRepository, EventOutboxDeliveryRepository, EventOutboxRepository, UnitCompletionReadRepository, CompletedUnitKnowledgeReadRepository, LearningGoalTreeDeletionRepository, FoundationMasteryTransitionRepository, PreparedModulePublicationRepository, ExplorationModulePublicationRepository, ModuleSliceReconciliationRepository, CognitiveModelExpansionLeaseRepository, CognitiveModelExpansionContextRepository, CognitiveModelEventRepository, CognitiveModelInvalidationRepository, CognitiveModelGenerationRunRepository, CognitiveModelPublicationRepository, CognitiveModelPublicationFinalizationRepository, TaskAttemptRepository, VerifiedEvidenceAppendRepository, VerifiedAssessmentCompletionRepository, MaterialCheckCompletionRepository, UnitLearningProgressResetRepository, UnitDiagnosticCompletionRepository, ModuleDiagnosticCompletionRepository, MaterialReplacementRepository, MaterialEnrichmentRepository, SectionMaterialReplacementRepository, ProjectBlueprintRepository, ProjectExperienceRepository, AdaptiveAssessmentEvidenceRepository, AdaptiveAssessmentTaskRepository, AssessmentTargetRepository, UnitDiagnosticReadRepository, ModuleDiagnosticReadRepository, ModuleEntryReadinessReadRepository, PrerequisiteBridgeRepository, CognitiveModelPresentationReadRepository, LearnerStateProjectionReadRepository, LearnerStateMemoryReadRepository, LearnerStateMemoryInvalidationRepository, CognitiveEntityEvidenceReadRepository, FeynmanEvidenceRepository, SocraticEvidenceRepository, QuizSubmissionRepository, QuizSessionRepository, DiagnosticRemediationRepository, GoalIconRepository, LegacyMapUnitMutationRepository, LegacyMapReplacementRepository, OverviewCoursePublicationRepository, MicroUnitPublicationRepository, UnitSubdivisionRepository, LlmLogQueryRepository, UnitDeliveryReadRepository, UnitSessionArtifactRepository, ScenarioTheaterSessionRepository, ScenarioTheaterGenerationRepository, UnitLabRepository, MaterialRegenerationRepository, MaterialFollowUpRepository, GlobalGenerationSettingsRepository, LlmRoutingRepository, BatchContentGenerationRepository } from "@xue-learn/core/domain";
type ReferencePersistenceModule = typeof import("@cognilearn/desktop-persistence/reference");
let bootstrappedPersistenceRuntime: ReferencePersistenceRuntime | null = null;
const sqliteStartupRecoveryByRuntime = new WeakMap<ReferencePersistenceRuntime, Promise<unknown>>();
const runtimeCloseByRuntime = new WeakMap<ReferencePersistenceRuntime, Promise<void>>();
/** Hand a migrated runtime from a composition root to the shared Nest provider. */
export function provideBootstrappedPersistenceRuntime(runtime: ReferencePersistenceRuntime): void {
    if (bootstrappedPersistenceRuntime) {
        throw new Error("A bootstrapped persistence runtime is already pending.");
    }
    bootstrappedPersistenceRuntime = runtime;
}
function getBootstrappedPersistenceRuntime(): ReferencePersistenceRuntime | null {
    return bootstrappedPersistenceRuntime;
}
function recoverBootstrappedSqliteRuntimeOnce(runtime: ReferencePersistenceRuntime): Promise<unknown> {
    let recovery = sqliteStartupRecoveryByRuntime.get(runtime);
    if (!recovery) {
        recovery =
            runtime.repositories.unitSectionPlan.recoverInterruptedGenerations(SECTION_GENERATION_INTERRUPTED_ERROR);
        sqliteStartupRecoveryByRuntime.set(runtime, recovery);
    }
    return recovery;
}
function closeRuntimeOnce(runtime: ReferencePersistenceRuntime): Promise<void> {
    let closing = runtimeCloseByRuntime.get(runtime);
    if (!closing) {
        closing = runtime.close();
        runtimeCloseByRuntime.set(runtime, closing);
    }
    return closing;
}
async function loadReferencePersistence(): Promise<ReferencePersistenceModule> {
    const bundledReferencePath = resolve(__dirname, "persistence-reference.js");
    if (existsSync(bundledReferencePath)) {
        // The standalone desktop bundle keeps the ESM MikroORM reference graph in
        // a sibling CommonJS artifact so it can share externalized ORM packages
        // without requiring the repository source tree at runtime.
        return require(bundledReferencePath) as ReferencePersistenceModule;
    }
    // Build the specifier at runtime so sidecar esbuild cannot fold it into a
    // bundled `require.resolve` (require-resolve-not-external).
    const referencePath = require.resolve(["@cognilearn", "electron-persistence/reference/index"].join("/"));
    // The dev commands execute TypeScript through ts-node's CommonJS loader,
    // while MikroORM v7 and the reference persistence graph are ESM. Native
    // dynamic import bypasses ts-node for .ts files (and Node 25 then treats the
    // extensionless relative exports as ESM), so use jiti for that source-only
    // path. Bundled builds resolve to JavaScript and keep using native import.
    if (referencePath.endsWith(".ts")) {
        const { createJiti } = await import("jiti");
        const projectRoot = resolve(process.cwd());
        const jiti = createJiti(projectRoot, {
            moduleCache: false,
            alias: {
                "@xue-learn/core/common": resolve(projectRoot, "libs/common/src/index.ts"),
                "@xue-learn/core/contracts": resolve(projectRoot, "libs/contracts/src/index.ts"),
                "@xue-learn/core/domain": resolve(projectRoot, "libs/domain/src/index.ts"),
                "@xue-learn/core/memory": resolve(projectRoot, "libs/memory/src/index.ts"),
                "@cognilearn/mobile-core": resolve(projectRoot, "libs/mobile-core/src/index.ts"),
                "@xue-learn/core/runtime-contracts": resolve(projectRoot, "libs/runtime-contracts/src/index.ts"),
                "@xue-learn/core/server": resolve(projectRoot, "libs/server/src"),
                "@cognilearn/desktop-persistence": resolve(projectRoot, "persistence/sqlite"),
            },
        });
        return jiti.import(referencePath) as Promise<ReferencePersistenceModule>;
    }
    // MikroORM v7 is ESM-only while the Nest services still compile to
    // CommonJS. Keep the ESM reference barrel out of the module graph until the
    // process has reached async application initialization.
    const dynamicImport = globalThis.eval("(moduleName) => import(moduleName)") as (moduleName: string) => Promise<ReferencePersistenceModule>;
    return dynamicImport(referencePath);
}
/** Shared Nest composition boundary for the PostgreSQL learning-space slice. */
@Injectable()
export class SqliteLearningSpaceOrmProvider extends LearningSpaceOrmProvider implements OnModuleInit, OnModuleDestroy {
    private runtime: ReferencePersistenceRuntime | null = null;
    private initializationPromise: Promise<void> | null = null;
    private application: MikroOrmLearningSpaceApplicationService | null = null;
    private goalMutationPort: LearningGoalMutationPort | null = null;
    private goalTreeDeletionPort: LearningGoalTreeDeletionRepository | null = null;
    private foundationMasteryTransitionPort: FoundationMasteryTransitionRepository | null = null;
    private preparedModulePublicationPort: PreparedModulePublicationRepository | null = null;
    private explorationModulePublicationPort: ExplorationModulePublicationRepository | null = null;
    private moduleSliceReconciliationPort: ModuleSliceReconciliationRepository | null = null;
    private cognitiveModelExpansionLeasePort: CognitiveModelExpansionLeaseRepository | null = null;
    private cognitiveModelEventPort: CognitiveModelEventRepository | null = null;
    private cognitiveModelInvalidationPort: CognitiveModelInvalidationRepository | null = null;
    private cognitiveModelGenerationRunPort: CognitiveModelGenerationRunRepository | null = null;
    private cognitiveModelPublicationPort: CognitiveModelPublicationRepository | null = null;
    private cognitiveModelPublicationFinalizationPort: CognitiveModelPublicationFinalizationRepository | null = null;
    private taskAttemptPort: TaskAttemptRepository | null = null;
    private verifiedEvidenceAppendPort: VerifiedEvidenceAppendRepository | null = null;
    private verifiedAssessmentCompletionPort: VerifiedAssessmentCompletionRepository | null = null;
    private materialCheckCompletionPort: MaterialCheckCompletionRepository | null = null;
    private unitLearningProgressResetPort: UnitLearningProgressResetRepository | null = null;
    private unitDiagnosticCompletionPort: UnitDiagnosticCompletionRepository | null = null;
    private moduleDiagnosticCompletionPort: ModuleDiagnosticCompletionRepository | null = null;
    private materialReplacementPort: MaterialReplacementRepository | null = null;
    private materialEnrichmentPort: MaterialEnrichmentRepository | null = null;
    private sectionMaterialReplacementPort: SectionMaterialReplacementRepository | null = null;
    private projectBlueprintPort: ProjectBlueprintRepository | null = null;
    private adaptiveAssessmentEvidencePort: AdaptiveAssessmentEvidenceRepository | null = null;
    private adaptiveAssessmentTaskPort: AdaptiveAssessmentTaskRepository | null = null;
    private assessmentTargetPort: AssessmentTargetRepository | null = null;
    private unitDiagnosticReadPort: UnitDiagnosticReadRepository | null = null;
    private moduleDiagnosticReadPort: ModuleDiagnosticReadRepository | null = null;
    private moduleEntryReadinessReadPort: ModuleEntryReadinessReadRepository | null = null;
    private prerequisiteBridgePort: PrerequisiteBridgeRepository | null = null;
    private cognitiveModelPresentationReadPort: CognitiveModelPresentationReadRepository | null = null;
    private learnerStateProjectionReadPort: LearnerStateProjectionReadRepository | null = null;
    private learnerStateMemoryReadPort: LearnerStateMemoryReadRepository | null = null;
    private learnerStateMemoryInvalidationPort: LearnerStateMemoryInvalidationRepository | null = null;
    private cognitiveEntityEvidenceReadPort: CognitiveEntityEvidenceReadRepository | null = null;
    private feynmanEvidencePort: FeynmanEvidenceRepository | null = null;
    private socraticEvidencePort: SocraticEvidenceRepository | null = null;
    private quizSubmissionPort: QuizSubmissionRepository | null = null;
    private quizSessionPort: QuizSessionRepository | null = null;
    private diagnosticRemediationPort: DiagnosticRemediationRepository | null = null;
    private goalIconPort: GoalIconRepository | null = null;
    private learningGoalSummaryPort: LearningGoalSummaryRepository | null = null;
    private learningGoalPlanPort: LearningGoalPlanRepository | null = null;
    private legacyMapUnitMutationPort: LegacyMapUnitMutationRepository | null = null;
    private legacyMapReplacementPort: LegacyMapReplacementRepository | null = null;
    private overviewCoursePublicationPort: OverviewCoursePublicationRepository | null = null;
    private microUnitPublicationPort: MicroUnitPublicationRepository | null = null;
    private unitSubdivisionPort: UnitSubdivisionRepository | null = null;
    private unitDeliveryReadPort: UnitDeliveryReadRepository | null = null;
    private unitSessionArtifactPort: UnitSessionArtifactRepository | null = null;
    private scenarioTheaterSessionPort: ScenarioTheaterSessionRepository | null = null;
    private scenarioTheaterGenerationPort: ScenarioTheaterGenerationRepository | null = null;
    private unitLabPort: UnitLabRepository | null = null;
    private materialRegenerationPort: MaterialRegenerationRepository | null = null;
    private materialFollowUpPort: MaterialFollowUpRepository | null = null;
    private sequentialCurriculumApprovalPort: SequentialCurriculumApprovalRepository | null = null;
    private lockedModuleReplanningPort: LockedModuleReplanningRepository | null = null;
    private unitStructuredCleanupPort: UnitStructuredCleanupRepository | null = null;
    async checkConnection(): Promise<void> {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        await this.runtime.orm.em.getConnection().execute("SELECT 1");
    }
    /**
     * Nest resolves async factory providers before it invokes lifecycle hooks.
     * Factories that expose ORM repositories therefore use this boundary to
     * await the same initialization that onModuleInit performs.
     */
    async initialize(): Promise<void> {
        if (this.runtime)
            return;
        this.initializationPromise ??= this.onModuleInit();
        await this.initializationPromise;
    }
    async afterInitialization<T>(factory: () => T): Promise<T> {
        await this.initialize();
        return factory();
    }
    async onModuleInit(): Promise<void> {
        if (this.runtime)
            return;
        const databaseKind = "sqlite" as const;
        const databasePath = process.env.PERSISTENCE_DATABASE_PATH;
        if (!databasePath)
            throw new Error("SQLite persistence requires PERSISTENCE_DATABASE_PATH.");
        const { openReferencePersistenceRuntime, MikroOrmLearningGoalMutationRuntimeAdapter, MikroOrmLearningGoalTreeDeletionRuntimeAdapter, MikroOrmFoundationMasteryTransitionRuntimeAdapter, MikroOrmPreparedModulePublicationRuntimeAdapter, MikroOrmExplorationModulePublicationRuntimeAdapter, MikroOrmModuleSliceReconciliationRuntimeAdapter, MikroOrmCognitiveModelExpansionLeaseRuntimeAdapter, MikroOrmCognitiveModelEventRuntimeAdapter, MikroOrmCognitiveModelInvalidationRuntimeAdapter, MikroOrmCognitiveModelGenerationRunRuntimeAdapter, MikroOrmCognitiveModelPublicationRuntimeAdapter, MikroOrmCognitiveModelPublicationFinalizationRuntimeAdapter, MikroOrmTaskAttemptRuntimeAdapter, MikroOrmVerifiedEvidenceAppendRuntimeAdapter, MikroOrmVerifiedAssessmentCompletionRuntimeAdapter, MikroOrmMaterialCheckCompletionRuntimeAdapter, MikroOrmUnitLearningProgressResetRuntimeAdapter, MikroOrmUnitDiagnosticCompletionRuntimeAdapter, MikroOrmModuleDiagnosticCompletionRuntimeAdapter, MikroOrmMaterialReplacementRuntimeAdapter, MikroOrmMaterialEnrichmentRuntimeAdapter, MikroOrmSectionMaterialReplacementRuntimeAdapter, MikroOrmProjectBlueprintRuntimeAdapter, MikroOrmAdaptiveAssessmentEvidenceRuntimeAdapter, MikroOrmAdaptiveAssessmentTaskRuntimeAdapter, MikroOrmAssessmentTargetRuntimeAdapter, MikroOrmUnitDiagnosticReadRuntimeAdapter, MikroOrmModuleDiagnosticReadRuntimeAdapter, MikroOrmModuleEntryReadinessReadRuntimeAdapter, MikroOrmPrerequisiteBridgeRuntimeAdapter, MikroOrmUnitStructuredCleanupRuntimeAdapter, MikroOrmCognitiveModelPresentationReadRuntimeAdapter, MikroOrmLearnerStateProjectionReadRuntimeAdapter, MikroOrmLearnerStateMemoryReadRuntimeAdapter, MikroOrmLearnerStateMemoryInvalidationRuntimeAdapter, MikroOrmCognitiveEntityEvidenceReadRuntimeAdapter, MikroOrmFeynmanEvidenceRuntimeAdapter, MikroOrmSocraticEvidenceRuntimeAdapter, MikroOrmQuizSubmissionRuntimeAdapter, MikroOrmQuizSessionRuntimeAdapter, MikroOrmDiagnosticRemediationRuntimeAdapter, MikroOrmGoalIconRuntimeAdapter, MikroOrmLearningGoalSummaryRuntimeAdapter, MikroOrmLearningGoalPlanRuntimeAdapter, MikroOrmLegacyMapUnitMutationRuntimeAdapter, MikroOrmLegacyMapReplacementRuntimeAdapter, MikroOrmOverviewCoursePublicationRuntimeAdapter, MikroOrmMicroUnitPublicationRuntimeAdapter, MikroOrmUnitSubdivisionRuntimeAdapter, MikroOrmMaterialFollowUpRuntimeAdapter, MikroOrmUnitSessionArtifactRuntimeAdapter, MikroOrmScenarioTheaterSessionRuntimeAdapter, MikroOrmScenarioTheaterGenerationRuntimeAdapter, MikroOrmUnitLabRuntimeAdapter, MikroOrmMaterialRegenerationRuntimeAdapter, MikroOrmSequentialCurriculumApprovalRuntimeAdapter, MikroOrmLockedModuleReplanningRuntimeAdapter } = await loadReferencePersistence();
        const bootstrappedRuntime = getBootstrappedPersistenceRuntime();
        this.runtime =
            bootstrappedRuntime ??
                (await openReferencePersistenceRuntime({
                    kind: databaseKind,
                    databasePath,
                    migrationsPath: process.env.PERSISTENCE_MIGRATIONS_PATH ??
                        resolvePersistenceMigrationsPath(databaseKind),
                    migrationsGlob: process.env.PERSISTENCE_MIGRATIONS_GLOB ??
                        resolvePersistenceMigrationsGlob(databaseKind),
                }));
        if (databaseKind === "sqlite") {
            if (bootstrappedRuntime) {
                await recoverBootstrappedSqliteRuntimeOnce(this.runtime);
            }
            else {
                await this.runtime.repositories.unitSectionPlan.recoverInterruptedGenerations(SECTION_GENERATION_INTERRUPTED_ERROR);
            }
        }
        this.legacyMapReplacementPort =
            new MikroOrmLegacyMapReplacementRuntimeAdapter(this.runtime);
        this.overviewCoursePublicationPort =
            new MikroOrmOverviewCoursePublicationRuntimeAdapter(this.runtime);
        this.microUnitPublicationPort =
            new MikroOrmMicroUnitPublicationRuntimeAdapter(this.runtime);
        this.unitSubdivisionPort = new MikroOrmUnitSubdivisionRuntimeAdapter(this.runtime);
        this.unitDeliveryReadPort = this.runtime.repositories.unitDeliveryRead;
        this.unitSessionArtifactPort =
            new MikroOrmUnitSessionArtifactRuntimeAdapter(this.runtime);
        this.scenarioTheaterSessionPort =
            new MikroOrmScenarioTheaterSessionRuntimeAdapter(this.runtime);
        this.scenarioTheaterGenerationPort =
            new MikroOrmScenarioTheaterGenerationRuntimeAdapter(this.runtime);
        this.unitLabPort = new MikroOrmUnitLabRuntimeAdapter(this.runtime);
        this.materialRegenerationPort =
            new MikroOrmMaterialRegenerationRuntimeAdapter(this.runtime);
        this.materialFollowUpPort = new MikroOrmMaterialFollowUpRuntimeAdapter(this.runtime);
        this.learningGoalSummaryPort =
            new MikroOrmLearningGoalSummaryRuntimeAdapter(this.runtime);
        this.learningGoalPlanPort = new MikroOrmLearningGoalPlanRuntimeAdapter(this.runtime);
        const sequentialCurriculumApproval = new MikroOrmSequentialCurriculumApprovalRuntimeAdapter(this.runtime);
        const cognitiveModelInvalidation = new MikroOrmCognitiveModelInvalidationRuntimeAdapter(this.runtime);
        this.cognitiveModelInvalidationPort = cognitiveModelInvalidation;
        this.application = new MikroOrmLearningSpaceApplicationService(createLearningSpaceOrganizationPersistence(this.runtime), this.legacyMapReplacementPort, this.overviewCoursePublicationPort, this.microUnitPublicationPort, this.learningGoalPlanPort, this.learningGoalSummaryPort, sequentialCurriculumApproval, this.runtime.repositories.moduleStructureQueue, cognitiveModelInvalidation);
        this.goalMutationPort = new MikroOrmLearningGoalMutationRuntimeAdapter(this.runtime);
        this.goalTreeDeletionPort =
            new MikroOrmLearningGoalTreeDeletionRuntimeAdapter(this.runtime);
        this.foundationMasteryTransitionPort =
            new MikroOrmFoundationMasteryTransitionRuntimeAdapter(this.runtime);
        this.preparedModulePublicationPort =
            new MikroOrmPreparedModulePublicationRuntimeAdapter(this.runtime);
        this.explorationModulePublicationPort =
            new MikroOrmExplorationModulePublicationRuntimeAdapter(this.runtime);
        this.moduleSliceReconciliationPort =
            new MikroOrmModuleSliceReconciliationRuntimeAdapter(this.runtime);
        this.cognitiveModelExpansionLeasePort =
            new MikroOrmCognitiveModelExpansionLeaseRuntimeAdapter(this.runtime);
        this.cognitiveModelEventPort =
            new MikroOrmCognitiveModelEventRuntimeAdapter(this.runtime);
        this.cognitiveModelGenerationRunPort =
            new MikroOrmCognitiveModelGenerationRunRuntimeAdapter(this.runtime);
        this.cognitiveModelPublicationPort =
            new MikroOrmCognitiveModelPublicationRuntimeAdapter(this.runtime);
        this.cognitiveModelPublicationFinalizationPort =
            new MikroOrmCognitiveModelPublicationFinalizationRuntimeAdapter(this.runtime);
        configureCognitiveModelPersistence({
            expansionContext: this.runtime.repositories.cognitiveModelExpansionContext,
            expansionLease: this.cognitiveModelExpansionLeasePort,
            generationRun: this.cognitiveModelGenerationRunPort,
            publication: this.cognitiveModelPublicationPort,
            publicationFinalization: this.cognitiveModelPublicationFinalizationPort,
            projectBlueprint: this.projectBlueprintPort!,
            learnerStateMemoryInvalidation: this.runtime.repositories.learnerStateMemoryInvalidation,
            presentationRead: this.runtime.repositories.cognitiveModelPresentationRead,
            stateRead: this.runtime.repositories.learnerStateProjectionRead,
        });
        this.taskAttemptPort = new MikroOrmTaskAttemptRuntimeAdapter(this.runtime);
        this.verifiedEvidenceAppendPort =
            new MikroOrmVerifiedEvidenceAppendRuntimeAdapter(this.runtime);
        this.verifiedAssessmentCompletionPort =
            new MikroOrmVerifiedAssessmentCompletionRuntimeAdapter(this.runtime);
        this.materialCheckCompletionPort =
            new MikroOrmMaterialCheckCompletionRuntimeAdapter(this.runtime);
        this.unitLearningProgressResetPort =
            new MikroOrmUnitLearningProgressResetRuntimeAdapter(this.runtime);
        this.unitDiagnosticCompletionPort =
            new MikroOrmUnitDiagnosticCompletionRuntimeAdapter(this.runtime);
        this.moduleDiagnosticCompletionPort =
            new MikroOrmModuleDiagnosticCompletionRuntimeAdapter(this.runtime);
        this.materialReplacementPort =
            new MikroOrmMaterialReplacementRuntimeAdapter(this.runtime);
        this.materialEnrichmentPort = new MikroOrmMaterialEnrichmentRuntimeAdapter(this.runtime);
        this.sectionMaterialReplacementPort =
            new MikroOrmSectionMaterialReplacementRuntimeAdapter(this.runtime);
        this.projectBlueprintPort = new MikroOrmProjectBlueprintRuntimeAdapter(this.runtime);
        this.adaptiveAssessmentEvidencePort =
            new MikroOrmAdaptiveAssessmentEvidenceRuntimeAdapter(this.runtime);
        this.adaptiveAssessmentTaskPort =
            new MikroOrmAdaptiveAssessmentTaskRuntimeAdapter(this.runtime);
        this.assessmentTargetPort = new MikroOrmAssessmentTargetRuntimeAdapter(this.runtime);
        this.unitDiagnosticReadPort = new MikroOrmUnitDiagnosticReadRuntimeAdapter(this.runtime);
        this.moduleDiagnosticReadPort =
            new MikroOrmModuleDiagnosticReadRuntimeAdapter(this.runtime);
        this.moduleEntryReadinessReadPort =
            new MikroOrmModuleEntryReadinessReadRuntimeAdapter(this.runtime);
        this.prerequisiteBridgePort = new MikroOrmPrerequisiteBridgeRuntimeAdapter(this.runtime);
        this.unitStructuredCleanupPort =
            new MikroOrmUnitStructuredCleanupRuntimeAdapter(this.runtime);
        this.cognitiveModelPresentationReadPort =
            new MikroOrmCognitiveModelPresentationReadRuntimeAdapter(this.runtime);
        this.learnerStateProjectionReadPort =
            new MikroOrmLearnerStateProjectionReadRuntimeAdapter(this.runtime);
        this.learnerStateMemoryReadPort =
            new MikroOrmLearnerStateMemoryReadRuntimeAdapter(this.runtime);
        this.learnerStateMemoryInvalidationPort =
            new MikroOrmLearnerStateMemoryInvalidationRuntimeAdapter(this.runtime);
        this.cognitiveEntityEvidenceReadPort =
            new MikroOrmCognitiveEntityEvidenceReadRuntimeAdapter(this.runtime);
        this.feynmanEvidencePort = new MikroOrmFeynmanEvidenceRuntimeAdapter(this.runtime);
        this.socraticEvidencePort = new MikroOrmSocraticEvidenceRuntimeAdapter(this.runtime);
        this.quizSubmissionPort = new MikroOrmQuizSubmissionRuntimeAdapter(this.runtime);
        this.quizSessionPort = new MikroOrmQuizSessionRuntimeAdapter(this.runtime);
        this.diagnosticRemediationPort =
            new MikroOrmDiagnosticRemediationRuntimeAdapter(this.runtime);
        const goalIconPort = new MikroOrmGoalIconRuntimeAdapter(this.runtime);
        this.goalIconPort = goalIconPort;
        configureGoalIconPersistence(goalIconPort);
        configureModuleEntryReadinessRead(this.runtime.repositories.moduleEntryReadinessRead);
        this.legacyMapUnitMutationPort =
            new MikroOrmLegacyMapUnitMutationRuntimeAdapter(this.runtime);
        this.sequentialCurriculumApprovalPort = sequentialCurriculumApproval;
        this.lockedModuleReplanningPort =
            new MikroOrmLockedModuleReplanningRuntimeAdapter(this.runtime);
        configureLearnerStateMemoryRead(this.learnerStateMemoryReadPort, this.runtime.repositories.learnerStateMemoryMaintenance, this.cognitiveModelPresentationReadPort, this.learnerStateProjectionReadPort, this.learnerStateMemoryInvalidationPort);
        configureLearnerStateProjectionRead(this.learnerStateProjectionReadPort);
        configureLearnerGapProjectionRead(this.learnerStateProjectionReadPort);
        configureAgendaPlanningSettingsPersistence(this.runtime.repositories.learnerPlanningSettings);
        configureAgendaProgressPersistence(this.runtime.repositories.agendaProgress);
        configureAgendaProjectionReadPersistence(this.runtime.repositories.agendaProjectionRead);
        configureAgendaPublicationPersistence(this.runtime.repositories.agendaPublication);
        configureAgendaRefreshReadPersistence(this.runtime.repositories.agendaRefreshRead, this.runtime.repositories.unitCompletion);
        configureUnitSectionPlanPersistence(this.runtime.repositories.unitSectionPlan);
        configureChatNarrationPersistence(this.runtime.repositories.chatNarration);
        configureUnitGenerationContextPersistence(this.runtime.repositories.unitGenerationContext);
        configureLlmRequestLogPersistence(this.runtime.repositories.llmRequestLog);
        configureRagPersistence({
            documents: this.runtime.repositories.ragDocument,
            vectors: this.runtime.repositories.ragVector,
        });
        configureAgentCheckpointPersistence(this.runtime.repositories.agentConversation);
        configureAgentGoalCreationPersistence({
            goals: this.runtime.repositories.learningGoal,
            assistant: this.runtime.repositories.agentConversation,
        });
        configureModuleStructureDraftPersistence(this.runtime.repositories.moduleStructureDraft);
        configureGeneralMemoryPersistence(this.runtime.repositories.generalMemory);
        configureFormalDerivationPersistence(this.runtime.repositories.formalDerivation);
        configureTeachingDerivationPersistence(this.runtime.repositories.teachingDerivation);
        configureTeachingSkillRuntimePersistence(this.runtime.repositories.teachingSkillRuntime);
        configureTeachingSkillsCapabilityPersistence(this.runtime.repositories.learningGoal);
        configureModulePromptContextPersistence(this.runtime.repositories.learningUnit);
        configureUnitMapContextPersistence(this.runtime.repositories.unitMapContext);
        configureUnitSessionPersistence(this.runtime.repositories.unitSessionState);
        configureGenerationRunPersistence(this.runtime.repositories.aiGenerationRun);
        configureGlobalGenerationSettingsPersistence(this.runtime.repositories.globalGenerationSettings);
        configureLlmRoutingPersistence(this.runtime.repositories.llmRouting);
        configureLearnerLanguagePersistence(this.runtime.repositories.learningGoal);
        configureLearnerProfilePersistence(this.runtime.repositories.learnerProfile);
        configureAssistantQueryPersistence(this.runtime.repositories.agentConversation);
        configureRuntimeReviewPersistence(this.runtime.repositories.reviewExperience);
        configureUserSettingsPersistence(this.runtime.repositories.userSettings);
        configureGoalTextbookPersistence(this.runtime.repositories.goalTextbookRead);
        configureRequestMetricsPersistence(this.runtime.repositories.requestMetrics);
        configureObservabilityPersistence(this.runtime.repositories.observability);
        configureWebKnowledgePersistence(this.runtime.repositories.webKnowledge);
        configureMicroUnitPersistence(this.microUnitPublicationPort);
        configureMaterialFollowUpPersistence(this.materialFollowUpPort);
        configureLearningTrajectoryPersistence(this.runtime.repositories.learningTrajectory);
        configureLearningMainlinePersistence(this.runtime.repositories.learningMainline);
        configureCourseDisplayPolicyPersistence({
            spaces: this.runtime.repositories.learningSpace,
            items: this.runtime.repositories.learningSpaceItem,
        });
        if (process.env.XUELEARN_DESKTOP_LOCAL === "1")
            await this.runtime.repositories.learningTrajectory.recoverInterrupted();
        configureTeachingPersonaResolutionPersistence({
            goals: this.runtime.repositories.learningGoal,
            personas: this.runtime.repositories.teachingPersona,
            settings: this.runtime.repositories.userSettings,
        });
        configureDefaultLearningSpaceApplication(this.application, this.learnerStateMemoryReadPort, this.learnerStateMemoryInvalidationPort, this.runtime.repositories.learnerStateProjectionRead, this.runtime.repositories.cognitiveModelPresentationRead, createLearningSystemPersistenceClient(this.runtime.orm.em.fork()), this.verifiedEvidenceAppendPort);
    }
    get service(): MikroOrmLearningSpaceApplicationService {
        if (!this.application) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.application;
    }
    get goalMutations(): LearningGoalMutationPort {
        if (!this.goalMutationPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.goalMutationPort;
    }
    get goalIcon(): GoalIconRepository {
        if (!this.goalIconPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.goalIconPort;
    }
    get unitSessionState(): UnitSessionStateRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.unitSessionState;
    }
    get unitStructuredCleanup(): UnitStructuredCleanupRepository {
        if (!this.unitStructuredCleanupPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.unitStructuredCleanupPort;
    }
    get goalTreeDeletion(): LearningGoalTreeDeletionRepository {
        if (!this.goalTreeDeletionPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.goalTreeDeletionPort;
    }
    get unitActivity(): UnitActivityRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.unitActivity;
    }
    get foundationMasteryTransition(): FoundationMasteryTransitionRepository {
        if (!this.foundationMasteryTransitionPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.foundationMasteryTransitionPort;
    }
    get preparedModulePublication(): PreparedModulePublicationRepository {
        if (!this.preparedModulePublicationPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.preparedModulePublicationPort;
    }
    get explorationModulePublication(): ExplorationModulePublicationRepository {
        if (!this.explorationModulePublicationPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.explorationModulePublicationPort;
    }
    get moduleSliceReconciliation(): ModuleSliceReconciliationRepository {
        if (!this.moduleSliceReconciliationPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.moduleSliceReconciliationPort;
    }
    get cognitiveModelExpansionLease(): CognitiveModelExpansionLeaseRepository {
        if (!this.cognitiveModelExpansionLeasePort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.cognitiveModelExpansionLeasePort;
    }
    get cognitiveModelExpansionContext(): CognitiveModelExpansionContextRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.cognitiveModelExpansionContext;
    }
    get cognitiveModelEvent(): CognitiveModelEventRepository {
        if (!this.cognitiveModelEventPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.cognitiveModelEventPort;
    }
    get cognitiveModelInvalidation(): CognitiveModelInvalidationRepository {
        if (!this.cognitiveModelInvalidationPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.cognitiveModelInvalidationPort;
    }
    get cognitiveModelGenerationRun(): CognitiveModelGenerationRunRepository {
        if (!this.cognitiveModelGenerationRunPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.cognitiveModelGenerationRunPort;
    }
    get cognitiveModelPublicationFinalization(): CognitiveModelPublicationFinalizationRepository {
        if (!this.cognitiveModelPublicationFinalizationPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.cognitiveModelPublicationFinalizationPort;
    }
    get cognitiveModelPublication(): CognitiveModelPublicationRepository {
        if (!this.cognitiveModelPublicationPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.cognitiveModelPublicationPort;
    }
    get taskAttempt(): TaskAttemptRepository {
        if (!this.taskAttemptPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.taskAttemptPort;
    }
    get verifiedEvidenceAppend(): VerifiedEvidenceAppendRepository {
        if (!this.verifiedEvidenceAppendPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.verifiedEvidenceAppendPort;
    }
    get verifiedAssessmentCompletion(): VerifiedAssessmentCompletionRepository {
        if (!this.verifiedAssessmentCompletionPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.verifiedAssessmentCompletionPort;
    }
    get materialCheckCompletion(): MaterialCheckCompletionRepository {
        if (!this.materialCheckCompletionPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.materialCheckCompletionPort;
    }
    get unitLearningProgressReset(): UnitLearningProgressResetRepository {
        if (!this.unitLearningProgressResetPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.unitLearningProgressResetPort;
    }
    get unitDiagnosticCompletion(): UnitDiagnosticCompletionRepository {
        if (!this.unitDiagnosticCompletionPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.unitDiagnosticCompletionPort;
    }
    get moduleDiagnosticCompletion(): ModuleDiagnosticCompletionRepository {
        if (!this.moduleDiagnosticCompletionPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.moduleDiagnosticCompletionPort;
    }
    get materialReplacement(): MaterialReplacementRepository {
        if (!this.materialReplacementPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.materialReplacementPort;
    }
    get materialEnrichment(): MaterialEnrichmentRepository {
        if (!this.materialEnrichmentPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.materialEnrichmentPort;
    }
    get sectionMaterialReplacement(): SectionMaterialReplacementRepository {
        if (!this.sectionMaterialReplacementPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.sectionMaterialReplacementPort;
    }
    get projectBlueprint(): ProjectBlueprintRepository {
        if (!this.projectBlueprintPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.projectBlueprintPort;
    }
    get projectExperience(): ProjectExperienceRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.projectExperience;
    }
    get adaptiveAssessmentEvidence(): AdaptiveAssessmentEvidenceRepository {
        if (!this.adaptiveAssessmentEvidencePort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.adaptiveAssessmentEvidencePort;
    }
    get adaptiveAssessmentTask(): AdaptiveAssessmentTaskRepository {
        if (!this.adaptiveAssessmentTaskPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.adaptiveAssessmentTaskPort;
    }
    get assessmentTarget(): AssessmentTargetRepository {
        if (!this.assessmentTargetPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.assessmentTargetPort;
    }
    get unitDiagnosticRead(): UnitDiagnosticReadRepository {
        if (!this.unitDiagnosticReadPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.unitDiagnosticReadPort;
    }
    get moduleDiagnosticRead(): ModuleDiagnosticReadRepository {
        if (!this.moduleDiagnosticReadPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.moduleDiagnosticReadPort;
    }
    get moduleEntryReadinessRead(): ModuleEntryReadinessReadRepository {
        if (!this.moduleEntryReadinessReadPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.moduleEntryReadinessReadPort;
    }
    get prerequisiteBridge(): PrerequisiteBridgeRepository {
        if (!this.prerequisiteBridgePort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.prerequisiteBridgePort;
    }
    get cognitiveModelPresentationRead(): CognitiveModelPresentationReadRepository {
        if (!this.cognitiveModelPresentationReadPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.cognitiveModelPresentationReadPort;
    }
    get learnerStateProjectionRead(): LearnerStateProjectionReadRepository {
        if (!this.learnerStateProjectionReadPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.learnerStateProjectionReadPort;
    }
    get learnerStateMemoryRead(): LearnerStateMemoryReadRepository {
        if (!this.learnerStateMemoryReadPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.learnerStateMemoryReadPort;
    }
    get learnerStateMemoryInvalidation(): LearnerStateMemoryInvalidationRepository {
        if (!this.learnerStateMemoryInvalidationPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.learnerStateMemoryInvalidationPort;
    }
    get cognitiveEntityEvidenceRead(): CognitiveEntityEvidenceReadRepository {
        if (!this.cognitiveEntityEvidenceReadPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.cognitiveEntityEvidenceReadPort;
    }
    get feynmanEvidence(): FeynmanEvidenceRepository {
        if (!this.feynmanEvidencePort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.feynmanEvidencePort;
    }
    get socraticEvidence(): SocraticEvidenceRepository {
        if (!this.socraticEvidencePort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.socraticEvidencePort;
    }
    get quizSubmission(): QuizSubmissionRepository {
        if (!this.quizSubmissionPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.quizSubmissionPort;
    }
    get quizSession(): QuizSessionRepository {
        if (!this.quizSessionPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.quizSessionPort;
    }
    get diagnosticRemediation(): DiagnosticRemediationRepository {
        if (!this.diagnosticRemediationPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.diagnosticRemediationPort;
    }
    get unitCompletion(): UnitCompletionRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.unitCompletion;
    }
    get domainEventDispatch(): DomainEventDispatchRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.domainEventDispatch;
    }
    get eventOutbox(): EventOutboxRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.eventOutbox;
    }
    get eventOutboxDelivery(): EventOutboxDeliveryRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.eventOutboxDelivery;
    }
    get unitCompletionRead(): UnitCompletionReadRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.unitCompletionRead;
    }
    get completedUnitKnowledgeRead(): CompletedUnitKnowledgeReadRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.completedUnitKnowledgeRead;
    }
    get unitSectionProgress(): UnitSectionProgressRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.unitSectionProgress;
    }
    get moduleTestOut(): ModuleTestOutRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.moduleTestOut;
    }
    get moduleGenerationRetry(): ModuleGenerationRetryRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.moduleGenerationRetry;
    }
    get explorationCurriculumReady(): ExplorationCurriculumReadyRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.explorationCurriculumReady;
    }
    get moduleStructureQueue(): ModuleStructureQueueRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.moduleStructureQueue;
    }
    get moduleStructureDraft(): ModuleStructureDraftRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.moduleStructureDraft;
    }
    get moduleGenerationLease(): ModuleGenerationLeaseRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.moduleGenerationLease;
    }
    get deepPlanningResearch() {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.deepPlanningResearch;
    }
    get learningGoalSettings(): LearningGoalSettingsRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.learningGoalSettings;
    }
    get learningGoal(): LearningGoalRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.learningGoal;
    }
    get mediaAccess() {
        if (!this.runtime)
            throw new Error("Learning-space ORM provider is not initialized.");
        return this.runtime.repositories.mediaAccess;
    }
    get requestMetrics() {
        if (!this.runtime)
            throw new Error("Learning-space ORM provider is not initialized.");
        return this.runtime.repositories.requestMetrics;
    }
    get observability() {
        if (!this.runtime)
            throw new Error("Learning-space ORM is not initialized");
        return this.runtime.repositories.observability;
    }
    get webKnowledge() {
        if (!this.runtime)
            throw new Error("Learning-space ORM is not initialized");
        return this.runtime.repositories.webKnowledge;
    }
    get userSettings() {
        if (!this.runtime)
            throw new Error("Learning-space ORM provider is not initialized.");
        return this.runtime.repositories.userSettings;
    }
    get teachingPersona() {
        if (!this.runtime)
            throw new Error("Learning-space ORM provider is not initialized.");
        return this.runtime.repositories.teachingPersona;
    }
    get teachingSkillRuntime() {
        if (!this.runtime)
            throw new Error("Learning-space ORM provider is not initialized.");
        return this.runtime.repositories.teachingSkillRuntime;
    }
    get moduleEntryFoundationQueue() {
        if (!this.runtime)
            throw new Error("Learning-space ORM provider is not initialized.");
        return this.runtime.repositories.moduleEntryFoundationQueue;
    }
    get learningUnit() {
        if (!this.runtime)
            throw new Error("Learning-space ORM provider is not initialized.");
        return this.runtime.repositories.learningUnit;
    }
    get goalModuleRead() {
        if (!this.runtime)
            throw new Error("Learning-space ORM provider is not initialized.");
        return this.runtime.repositories.goalModuleRead;
    }
    get masterySummaryRead() {
        if (!this.runtime)
            throw new Error("Learning-space ORM provider is not initialized.");
        return this.runtime.repositories.masterySummaryRead;
    }
    get goalCrudRead() {
        if (!this.runtime)
            throw new Error("Learning-space ORM provider is not initialized.");
        return this.runtime.repositories.goalCrudRead;
    }
    get analyticsMaintenance() {
        if (!this.runtime)
            throw new Error("Learning-space ORM provider is not initialized.");
        return this.runtime.repositories.analyticsMaintenance;
    }
    get aiGenerationRun() {
        if (!this.runtime)
            throw new Error("Learning-space ORM provider is not initialized.");
        return this.runtime.repositories.aiGenerationRun;
    }
    get learningGoalSummary(): LearningGoalSummaryRepository {
        if (!this.learningGoalSummaryPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.learningGoalSummaryPort;
    }
    get learningGoalPlan(): LearningGoalPlanRepository {
        if (!this.learningGoalPlanPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.learningGoalPlanPort;
    }
    get legacyMapUnitMutation(): LegacyMapUnitMutationRepository {
        if (!this.legacyMapUnitMutationPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.legacyMapUnitMutationPort;
    }
    get legacyMapReplacement(): LegacyMapReplacementRepository {
        if (!this.legacyMapReplacementPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.legacyMapReplacementPort;
    }
    get overviewCoursePublication(): OverviewCoursePublicationRepository {
        if (!this.overviewCoursePublicationPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.overviewCoursePublicationPort;
    }
    get microUnitPublication(): MicroUnitPublicationRepository {
        if (!this.microUnitPublicationPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.microUnitPublicationPort;
    }
    get unitSubdivision(): UnitSubdivisionRepository {
        if (!this.unitSubdivisionPort)
            throw new Error("Unit subdivision persistence is unavailable");
        return this.unitSubdivisionPort;
    }
    get unitDeliveryRead(): UnitDeliveryReadRepository {
        if (!this.unitDeliveryReadPort)
            throw new Error("Unit delivery read persistence is unavailable");
        return this.unitDeliveryReadPort;
    }
    get unitSessionArtifact(): UnitSessionArtifactRepository {
        if (!this.unitSessionArtifactPort)
            throw new Error("Unit session artifact persistence is unavailable");
        return this.unitSessionArtifactPort;
    }
    get scenarioTheaterSession(): ScenarioTheaterSessionRepository {
        if (!this.scenarioTheaterSessionPort)
            throw new Error("Scenario theater persistence is unavailable");
        return this.scenarioTheaterSessionPort;
    }
    get scenarioTheaterGeneration(): ScenarioTheaterGenerationRepository {
        if (!this.scenarioTheaterGenerationPort)
            throw new Error("Scenario theater generation persistence is unavailable");
        return this.scenarioTheaterGenerationPort;
    }
    get unitLab(): UnitLabRepository {
        if (!this.unitLabPort)
            throw new Error("Unit lab persistence is unavailable");
        return this.unitLabPort;
    }
    get materialRegeneration(): MaterialRegenerationRepository {
        if (!this.materialRegenerationPort)
            throw new Error("Material regeneration persistence is unavailable");
        return this.materialRegenerationPort;
    }
    get materialFollowUp(): MaterialFollowUpRepository {
        if (!this.materialFollowUpPort)
            throw new Error("Material follow-up persistence is unavailable");
        return this.materialFollowUpPort;
    }
    get sequentialCurriculumApproval(): SequentialCurriculumApprovalRepository {
        if (!this.sequentialCurriculumApprovalPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.sequentialCurriculumApprovalPort;
    }
    get lockedModuleReplanning(): LockedModuleReplanningRepository {
        if (!this.lockedModuleReplanningPort) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.lockedModuleReplanningPort;
    }
    get reviewExperience(): ReviewExperienceRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.reviewExperience;
    }
    get flashcardExperience(): FlashcardExperienceRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.flashcardExperience;
    }
    get globalGenerationSettings(): GlobalGenerationSettingsRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.globalGenerationSettings;
    }
    get llmRouting(): LlmRoutingRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.llmRouting;
    }
    get batchContentGeneration(): BatchContentGenerationRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.batchContentGeneration;
    }
    get ragDocument(): RagDocumentRepository {
        if (!this.runtime)
            throw new Error("Learning-space ORM provider is not initialized.");
        return this.runtime.repositories.ragDocument;
    }
    get ragVector(): RagVectorRepository {
        if (!this.runtime)
            throw new Error("Learning-space ORM provider is not initialized.");
        return this.runtime.repositories.ragVector;
    }
    get agentConversation(): AgentConversationRepository {
        if (!this.runtime)
            throw new Error("Learning-space ORM provider is not initialized.");
        return this.runtime.repositories.agentConversation;
    }
    get formalDerivation() {
        if (!this.runtime)
            throw new Error("Learning-space ORM provider is not initialized.");
        return this.runtime.repositories.formalDerivation;
    }
    get llmLogQuery(): LlmLogQueryRepository {
        if (!this.runtime) {
            throw new Error("Learning-space ORM provider is not initialized.");
        }
        return this.runtime.repositories.llmLogQuery;
    }
    async onModuleDestroy(): Promise<void> {
        configureLearnerStateMemoryRead(undefined);
        configureLearnerStateProjectionRead(undefined);
        configureLearnerGapProjectionRead(undefined);
        configureGoalIconPersistence(undefined);
        configureAgendaPlanningSettingsPersistence(undefined);
        configureAgendaProgressPersistence(undefined);
        configureAgendaProjectionReadPersistence(undefined);
        configureAgendaPublicationPersistence(undefined);
        configureAgendaRefreshReadPersistence(undefined);
        configureUnitSectionPlanPersistence(undefined);
        configureChatNarrationPersistence(undefined);
        configureUnitGenerationContextPersistence(undefined);
        configureLlmRequestLogPersistence(undefined);
        configureRagPersistence(undefined);
        configureAgentCheckpointPersistence(undefined);
        configureAgentGoalCreationPersistence(undefined);
        configureModuleStructureDraftPersistence(undefined);
        configureGeneralMemoryPersistence(undefined);
        configureFormalDerivationPersistence(undefined);
        configureTeachingDerivationPersistence(undefined);
        configureTeachingSkillRuntimePersistence(undefined);
        configureTeachingSkillsCapabilityPersistence(undefined);
        configureModulePromptContextPersistence(undefined);
        configureLearnerLanguagePersistence(undefined);
        configureLearnerProfilePersistence(undefined);
        configureAssistantQueryPersistence(undefined);
        configureRuntimeReviewPersistence(undefined);
        configureUserSettingsPersistence(undefined);
        configureTeachingPersonaResolutionPersistence(undefined);
        configureUnitMapContextPersistence(null);
        configureUnitSessionPersistence(null);
        configureMicroUnitPersistence(null);
        stopLearningSupplementJobs();
        configureLearningTrajectoryPersistence(undefined);
        configureLearningMainlinePersistence(undefined);
        configureCourseDisplayPolicyPersistence(undefined);
        configureMaterialFollowUpPersistence(null);
        configureContentRevisionPersistence(null);
        configureGenerationRunPersistence(null);
        configureGlobalGenerationSettingsPersistence(undefined);
        configureLlmRoutingPersistence(undefined);
        configureCognitiveModelPersistence(undefined);
        configureDefaultLearningSpaceApplication(undefined);
        if (this.runtime)
            await closeRuntimeOnce(this.runtime);
        this.runtime = null;
        this.application = null;
        this.goalMutationPort = null;
        this.goalTreeDeletionPort = null;
        this.foundationMasteryTransitionPort = null;
        this.preparedModulePublicationPort = null;
        this.explorationModulePublicationPort = null;
        this.moduleSliceReconciliationPort = null;
        this.cognitiveModelExpansionLeasePort = null;
        this.cognitiveModelEventPort = null;
        this.cognitiveModelInvalidationPort = null;
        this.cognitiveModelGenerationRunPort = null;
        this.cognitiveModelPublicationPort = null;
        this.cognitiveModelPublicationFinalizationPort = null;
        this.taskAttemptPort = null;
        this.verifiedEvidenceAppendPort = null;
        this.verifiedAssessmentCompletionPort = null;
        this.materialCheckCompletionPort = null;
        this.unitLearningProgressResetPort = null;
        this.unitDiagnosticCompletionPort = null;
        this.moduleDiagnosticCompletionPort = null;
        this.materialReplacementPort = null;
        this.materialEnrichmentPort = null;
        this.sectionMaterialReplacementPort = null;
        this.projectBlueprintPort = null;
        this.adaptiveAssessmentEvidencePort = null;
        this.adaptiveAssessmentTaskPort = null;
        this.assessmentTargetPort = null;
        this.unitDiagnosticReadPort = null;
        this.moduleDiagnosticReadPort = null;
        this.moduleEntryReadinessReadPort = null;
        this.prerequisiteBridgePort = null;
        this.unitStructuredCleanupPort = null;
        this.cognitiveModelPresentationReadPort = null;
        this.learnerStateProjectionReadPort = null;
        this.learnerStateMemoryReadPort = null;
        this.learnerStateMemoryInvalidationPort = null;
        this.cognitiveEntityEvidenceReadPort = null;
        this.feynmanEvidencePort = null;
        this.socraticEvidencePort = null;
        this.quizSubmissionPort = null;
        this.quizSessionPort = null;
        this.diagnosticRemediationPort = null;
        this.goalIconPort = null;
        this.learningGoalSummaryPort = null;
        this.learningGoalPlanPort = null;
        this.legacyMapUnitMutationPort = null;
        this.legacyMapReplacementPort = null;
        this.overviewCoursePublicationPort = null;
        this.microUnitPublicationPort = null;
        this.unitSubdivisionPort = null;
        this.unitDeliveryReadPort = null;
        this.unitSessionArtifactPort = null;
        this.scenarioTheaterSessionPort = null;
        this.scenarioTheaterGenerationPort = null;
        this.unitLabPort = null;
        this.materialRegenerationPort = null;
        this.materialFollowUpPort = null;
        this.sequentialCurriculumApprovalPort = null;
        this.lockedModuleReplanningPort = null;
    }
}
