import { Logger } from "@nestjs/common";
import { getEnv } from "../../env.js";
import { recordBackendError, runObservabilityMaintenance, runPerformanceAlertCheck } from "../../observability/index.js";
import { prewarmLearnerStateMemories } from "../../learner-state-memory/index.js";
import { listUsersNeedingAgendaRefresh, refreshAgendaForUser } from "../../agenda/index.js";
import { COGNITIVE_MODEL_EXPAND_NEXT_EVENT, COGNITIVE_MODEL_SKELETON_EVENT, processCognitiveModelEvent, runCognitiveModelRevisionRetention } from "../../cognitive-model/index.js";
import { RAG_SCOPE_CLEANUP_EVENT, processRagScopeCleanupEvent } from "../../rag/scope-cleanup.js";
import { COGNITIVE_MODEL_OUTBOX_MAX_ATTEMPTS, decideCognitiveModelOutboxFailure } from "./cognitive-model-outbox-retry.js";
import { COURSE_MODULE_GENERATE_EVENT, processCourseModuleGenerationEvent } from "../../goals/sequential-modules.js";
import { AGENTIC_OUTBOX_HOLD_STATUSES, GOAL_CREATION_COORDINATE_EVENT, GOAL_MODULE_STRUCTURE_AUDIT_EVENT, GOAL_MODULE_STRUCTURE_DRAFT_PREPARE_EVENT, processGoalCreationCoordinateEvent, processModuleStructureAuditEvent, processModuleStructureDraftPrepareEvent, recoverStuckAgenticGoalCreation } from "../../goal-creation/module-structure-draft-worker.js";
import { reconcileReadySequentialModules } from "../../goals/module-state.js";
import { MODULE_ENTRY_FOUNDATION_GENERATE_EVENT, processModuleEntryFoundationEvent } from "../../assessment/index.js";
import { processTeachingSkillIndexEvent, TEACHING_SKILL_INDEX_EVENT } from "../../teaching-skills/index.js";
import { processUnitSectionPrefetchEvent, UNIT_SECTION_PREFETCH_EVENT } from "../../sections/index.js";
import { CHAT_AUDIO_CLEANUP_EVENT, processChatAudioCleanupEvent } from "../../audio/chat-audio-cleanup.js";
import { processScenarioTheaterFinalizeEvent, processScenarioTheaterPrepareEvent, processScenarioTheaterScenePrefetchEvent, SCENARIO_THEATER_FINALIZE_EVENT, SCENARIO_THEATER_PREPARE_EVENT, SCENARIO_THEATER_SCENE_PREFETCH_EVENT } from "../../scenario-theater/index.js";
import { processUnitLabPrepareEvent, UNIT_LAB_PREPARE_EVENT } from "../../unit-lab/index.js";
import { getDefaultLearningSystemRuntime, processDomainEventBatch } from "../../learning-systems/index.js";
import { processMemoryFormationCursors, retryPendingMemoryIndexes } from "../../learning-systems/capabilities/general-memory.js";
import { LearningSpaceOrmProvider } from "../../learning-spaces/learning-space-orm.provider.js";
import { ensureLlmRuntimeConfig } from "../../llm/runtime-config.js";
import { runWithUserId } from "../../user-context.js";
const BATCH_SIZE = 100;
const AGENDA_REFRESH_EVENT = "agenda.refresh";
const AGENDA_REFRESH_USER_LIMIT = 5;
const AGENDA_REFRESH_EVENT_WORK_LIMIT = 5;
const COGNITIVE_MODEL_EVENT_WORK_LIMIT = 5;
const TEACHING_SKILL_INDEX_WORK_LIMIT = 5;
const SCENARIO_THEATER_WORK_LIMIT = 2;
const UNIT_LAB_WORK_LIMIT = 2;
const EVENT_OUTBOX_LEASE_MS = 15 * 60000;
const AGENDA_REFRESH_JOB = "agenda-refresh";
/** Reusable learning event handlers; each host owns scheduling and transport. */
export class LearningOutboxProcessor {
    protected readonly logger = new Logger(LearningOutboxProcessor.name);
    constructor(protected readonly learningSpaceOrm: LearningSpaceOrmProvider) { }
    protected async processHostEvent(_type: string, _payload: string): Promise<"delete" | "publish" | null> { return null; }
    protected async processOutboxBatch(): Promise<number> {
        const now = new Date();
        try {
            await this.learningSpaceOrm!.moduleStructureDraft.recoverStaleLeases(now);
            await recoverStuckAgenticGoalCreation(this.learningSpaceOrm!.moduleStructureDraft);
        }
        catch (error) {
            this.logger.warn(`module structure draft lease recovery failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        const eventOutboxDelivery = this.learningSpaceOrm!.eventOutboxDelivery;
        const graphEventTypes = [
            COURSE_MODULE_GENERATE_EVENT,
            MODULE_ENTRY_FOUNDATION_GENERATE_EVENT,
            COGNITIVE_MODEL_SKELETON_EVENT,
            COGNITIVE_MODEL_EXPAND_NEXT_EVENT,
            GOAL_MODULE_STRUCTURE_DRAFT_PREPARE_EVENT,
            GOAL_MODULE_STRUCTURE_AUDIT_EVENT,
            GOAL_CREATION_COORDINATE_EVENT,
        ];
        // Keep independent lanes so a backlog of deferred graph generations never
        // occupies the whole query window ahead of agenda, cleanup, or other events.
        // Claim sequentially: desktop SQLite is one connection, and two overlapping
        // claimDue transactionals deadlock every local API including Retry.
        const cognitiveModelEvents = await eventOutboxDelivery.claimDue({
            types: graphEventTypes,
            includeTypes: true,
            limit: BATCH_SIZE,
            now,
            leaseUntil: new Date(now.getTime() + EVENT_OUTBOX_LEASE_MS),
        });
        const otherEvents = await eventOutboxDelivery.claimDue({
            types: graphEventTypes,
            includeTypes: false,
            limit: BATCH_SIZE,
            now,
            leaseUntil: new Date(now.getTime() + EVENT_OUTBOX_LEASE_MS),
        });
        const events = [...cognitiveModelEvents, ...otherEvents].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() ||
            a.id.localeCompare(b.id));
        let cognitiveModelWorkCount = 0;
        let agendaRefreshWorkCount = 0;
        let teachingSkillIndexWorkCount = 0;
        let scenarioTheaterWorkCount = 0;
        let unitLabWorkCount = 0;
        let deferredCognitiveModelCount = 0;
        let publishedCount = 0;
        for (const event of events) {
            const hostSettlement = await this.processHostEvent(event.type, event.payload);
            if (hostSettlement) {
                // Product-specific events are handled by the owning host adapter.
            }
            else if (event.type === RAG_SCOPE_CLEANUP_EVENT) {
                try {
                    await processRagScopeCleanupEvent(event.payload);
                    this.logger.log(`rag scope cleanup completed event=${event.id}`);
                }
                catch (error) {
                    await this.settleOutboxEventFailure(event, error);
                    continue;
                }
            }
            else if (event.type === CHAT_AUDIO_CLEANUP_EVENT) {
                try {
                    const result = await processChatAudioCleanupEvent(event.payload);
                    this.logger.log(`chat audio cleanup deletedObjects=${result.deletedObjects}`);
                }
                catch (error) {
                    await this.settleOutboxEventFailure(event, error);
                    continue;
                }
            }
            else if (event.type === AGENDA_REFRESH_EVENT) {
                if (agendaRefreshWorkCount >= AGENDA_REFRESH_EVENT_WORK_LIMIT) {
                    await eventOutboxDelivery.releaseClaim({
                        id: event.id,
                        expectedAttemptCount: event.attemptCount,
                        nextAttemptAt: now,
                    });
                    continue;
                }
                const userId = await this.resolveEventUserId(event.payload);
                if (!userId) {
                    this.logger.warn(`agenda refresh missing userId event=${event.id}`);
                }
                else {
                    const result = await this.runWithSyncedUserModelConfig(userId, () => refreshAgendaForUser(userId, {
                        reason: "event",
                    }));
                    this.logger.log(`agenda refresh event user=${userId} skipped=${result.skipped} reason=${result.reason}`);
                }
                agendaRefreshWorkCount += 1;
            }
            else if (event.type === TEACHING_SKILL_INDEX_EVENT) {
                if (teachingSkillIndexWorkCount >= TEACHING_SKILL_INDEX_WORK_LIMIT) {
                    await eventOutboxDelivery.releaseClaim({
                        id: event.id,
                        expectedAttemptCount: event.attemptCount,
                        nextAttemptAt: now,
                    });
                    continue;
                }
                await processTeachingSkillIndexEvent(event.payload);
                teachingSkillIndexWorkCount += 1;
                this.logger.log(`teaching skill index completed event=${event.id}`);
            }
            else if (event.type === UNIT_SECTION_PREFETCH_EVENT) {
                const result = await this.runWithEventUserModelConfig(event.payload, () => processUnitSectionPrefetchEvent({
                    payloadJson: event.payload,
                }));
                this.logger.log(`unit section prefetch event=${event.id} status=${result.status}`);
            }
            else if (event.type === SCENARIO_THEATER_PREPARE_EVENT ||
                event.type === SCENARIO_THEATER_SCENE_PREFETCH_EVENT ||
                event.type === SCENARIO_THEATER_FINALIZE_EVENT) {
                const scenarioTheaterGeneration = this.learningSpaceOrm.scenarioTheaterGeneration;
                if (scenarioTheaterWorkCount >= SCENARIO_THEATER_WORK_LIMIT) {
                    await eventOutboxDelivery.releaseClaim({
                        id: event.id,
                        expectedAttemptCount: event.attemptCount,
                        nextAttemptAt: now,
                    });
                    continue;
                }
                try {
                    const result = await this.runWithEventUserModelConfig(event.payload, async () => {
                        if (event.type === SCENARIO_THEATER_PREPARE_EVENT) {
                            return processScenarioTheaterPrepareEvent({
                                client: scenarioTheaterGeneration,
                                payloadJson: event.payload,
                            });
                        }
                        if (event.type === SCENARIO_THEATER_SCENE_PREFETCH_EVENT) {
                            return processScenarioTheaterScenePrefetchEvent({
                                client: scenarioTheaterGeneration,
                                payloadJson: event.payload,
                            });
                        }
                        return processScenarioTheaterFinalizeEvent({
                            client: scenarioTheaterGeneration,
                            payloadJson: event.payload,
                        });
                    });
                    scenarioTheaterWorkCount += 1;
                    this.logger.log(`scenario theater event=${event.id} unit=${result.unitId} status=${result.status}`);
                }
                catch (error) {
                    await this.settleOutboxEventFailure(event, error);
                    continue;
                }
            }
            else if (event.type === UNIT_LAB_PREPARE_EVENT) {
                if (unitLabWorkCount >= UNIT_LAB_WORK_LIMIT) {
                    await eventOutboxDelivery.releaseClaim({
                        id: event.id,
                        expectedAttemptCount: event.attemptCount,
                        nextAttemptAt: now,
                    });
                    continue;
                }
                try {
                    const result = await this.runWithEventUserModelConfig(event.payload, () => processUnitLabPrepareEvent({
                        client: this.learningSpaceOrm.unitLab,
                        payloadJson: event.payload,
                    }));
                    unitLabWorkCount += 1;
                    this.logger.log(`unit lab event=${event.id} unit=${result.unitId} status=${result.status}`);
                }
                catch (error) {
                    await this.settleOutboxEventFailure(event, error);
                    continue;
                }
            }
            else if (event.type === MODULE_ENTRY_FOUNDATION_GENERATE_EVENT) {
                try {
                    const result = await this.runWithEventUserModelConfig(event.payload, () => processModuleEntryFoundationEvent({
                        payloadJson: event.payload,
                        repository: this.learningSpaceOrm!.moduleEntryFoundationQueue,
                        cognitiveModelInvalidation: this.learningSpaceOrm!.cognitiveModelInvalidation,
                    }));
                    this.logger.log(`module entry foundations event=${event.id} status=${result.status}`);
                }
                catch (error) {
                    const decision = decideCognitiveModelOutboxFailure({
                        error,
                        previousAttemptCount: event.attemptCount - 1,
                    });
                    await eventOutboxDelivery.settleFailure({
                        id: event.id,
                        expectedAttemptCount: event.attemptCount,
                        ...decision.data,
                    });
                    if (decision.terminal) {
                        try {
                            const payload = JSON.parse(event.payload) as {
                                moduleId?: string;
                                token?: string;
                            };
                            if (payload.moduleId && payload.token) {
                                await this.learningSpaceOrm!.moduleEntryFoundationQueue.markFailed({
                                    moduleId: payload.moduleId,
                                    token: payload.token,
                                    message: decision.data.lastError ?? "",
                                });
                            }
                        }
                        catch {
                            // Invalid payloads are already terminally recorded on the outbox.
                        }
                    }
                    this.logger.warn(`module entry foundations failed id=${event.id} terminal=${decision.terminal} error=${decision.data.lastError}`);
                    if (decision.terminal) {
                        await recordBackendError({
                            source: "worker",
                            service: "learning-outbox",
                            error,
                            operation: event.type,
                        }, this.learningSpaceOrm!.observability);
                    }
                    continue;
                }
            }
            else if (event.type === COURSE_MODULE_GENERATE_EVENT) {
                let result: Awaited<ReturnType<typeof processCourseModuleGenerationEvent>>;
                try {
                    result = await this.runWithEventUserModelConfig(event.payload, () => processCourseModuleGenerationEvent({
                        payloadJson: event.payload,
                        allowExpensiveWork: cognitiveModelWorkCount < COGNITIVE_MODEL_EVENT_WORK_LIMIT,
                        moduleGenerationLease: this.learningSpaceOrm!.moduleGenerationLease,
                        deepPlanningResearch: this.learningSpaceOrm!.deepPlanningResearch,
                        preparedModulePublication: this.learningSpaceOrm!.preparedModulePublication,
                        explorationModulePublication: this.learningSpaceOrm!.explorationModulePublication,
                        moduleSliceReconciliation: this.learningSpaceOrm!.moduleSliceReconciliation,
                        cognitiveModelInvalidation: this.learningSpaceOrm!.cognitiveModelInvalidation,
                    }));
                }
                catch (error) {
                    const decision = decideCognitiveModelOutboxFailure({
                        error,
                        previousAttemptCount: event.attemptCount - 1,
                    });
                    await eventOutboxDelivery.settleFailure({
                        id: event.id,
                        expectedAttemptCount: event.attemptCount,
                        ...decision.data,
                    });
                    this.logger.warn(`module generation failed id=${event.id} terminal=${decision.terminal} error=${decision.data.lastError}`);
                    if (decision.terminal) {
                        await recordBackendError({
                            source: "worker",
                            service: "learning-outbox",
                            error,
                            operation: event.type,
                        }, this.learningSpaceOrm!.observability);
                    }
                    continue;
                }
                if (result.status === "deferred") {
                    deferredCognitiveModelCount += 1;
                    await eventOutboxDelivery.releaseClaim({
                        id: event.id,
                        expectedAttemptCount: event.attemptCount,
                        nextAttemptAt: now,
                    });
                    continue;
                }
                if (result.status !== "ignored")
                    cognitiveModelWorkCount += 1;
                this.logger.log(`module generation goal=${result.goalId} module=${result.moduleId} status=${result.status}`);
            }
            else if (event.type === COGNITIVE_MODEL_SKELETON_EVENT ||
                event.type === COGNITIVE_MODEL_EXPAND_NEXT_EVENT) {
                let result: Awaited<ReturnType<typeof processCognitiveModelEvent>>;
                try {
                    result = await this.runWithEventUserModelConfig(event.payload, () => processCognitiveModelEvent({
                        type: event.type,
                        payloadJson: event.payload,
                        allowExpensiveWork: cognitiveModelWorkCount < COGNITIVE_MODEL_EVENT_WORK_LIMIT,
                        foundationMasteryTransition: this.learningSpaceOrm!.foundationMasteryTransition,
                        cognitiveModelExpansionLease: this.learningSpaceOrm!.cognitiveModelExpansionLease,
                        cognitiveModelExpansionContext: this.learningSpaceOrm!.cognitiveModelExpansionContext,
                        cognitiveModelEvent: this.learningSpaceOrm!.cognitiveModelEvent,
                        cognitiveModelGenerationRun: this.learningSpaceOrm!.cognitiveModelGenerationRun,
                        cognitiveModelPublication: this.learningSpaceOrm!.cognitiveModelPublication,
                        cognitiveModelPublicationFinalization: this.learningSpaceOrm!.cognitiveModelPublicationFinalization,
                        projectBlueprint: this.learningSpaceOrm!.projectBlueprint,
                        learnerStateMemoryInvalidation: this.learningSpaceOrm!.learnerStateMemoryInvalidation,
                    }));
                }
                catch (error) {
                    const decision = decideCognitiveModelOutboxFailure({
                        error,
                        previousAttemptCount: event.attemptCount - 1,
                    });
                    await eventOutboxDelivery.settleFailure({
                        id: event.id,
                        expectedAttemptCount: event.attemptCount,
                        ...decision.data,
                    });
                    const message = `cognitive model event failed id=${event.id} ` +
                        `attempt=${decision.attemptCount}/${COGNITIVE_MODEL_OUTBOX_MAX_ATTEMPTS} ` +
                        `terminal=${decision.terminal} error=${decision.data.lastError}`;
                    if (decision.terminal) {
                        this.logger.error(message);
                        try {
                            const payload = JSON.parse(event.payload) as {
                                goalId?: string;
                            };
                            if (payload.goalId) {
                                await this.learningSpaceOrm!.foundationMasteryTransition.markCurrentFailed(payload.goalId, decision.data.lastError ?? "系统掌握准备失败");
                            }
                        }
                        catch {
                            // Invalid event payloads are recorded below; no goal can be
                            // safely associated with them.
                        }
                        await recordBackendError({
                            source: "worker",
                            service: "learning-outbox",
                            error,
                            operation: event.type,
                        }, this.learningSpaceOrm!.observability);
                    }
                    else {
                        this.logger.warn(message);
                    }
                    // A failed cognitive-model event is settled for this poll. Continue
                    // so one provider or validation failure cannot block unrelated work.
                    continue;
                }
                if (result.status === "deferred") {
                    deferredCognitiveModelCount += 1;
                    await eventOutboxDelivery.releaseClaim({
                        id: event.id,
                        expectedAttemptCount: event.attemptCount,
                        nextAttemptAt: now,
                    });
                    // Keep this current event unpublished for the next poll, but continue
                    // through the batch so stale model events and unrelated work do not
                    // sit behind the generation budget.
                    continue;
                }
                if (result.status !== "stale_ignored" &&
                    result.status !== "duplicate_ignored") {
                    cognitiveModelWorkCount += 1;
                }
                this.logger.log(`cognitive model event goal=${result.goalId} expanded=${result.expandedUnitId ?? "none"}`);
                await reconcileReadySequentialModules(this.learningSpaceOrm!.goalModuleRead, result.goalId);
            }
            else if (event.type === GOAL_MODULE_STRUCTURE_DRAFT_PREPARE_EVENT) {
                try {
                    const result = await this.runWithEventUserModelConfig(event.payload, () => processModuleStructureDraftPrepareEvent({
                        payloadJson: event.payload,
                        repos: {
                            drafts: this.learningSpaceOrm!.moduleStructureDraft,
                            moduleStructureQueue: this.learningSpaceOrm!.moduleStructureQueue,
                            moduleGenerationLease: this.learningSpaceOrm!.moduleGenerationLease,
                            deepPlanningResearch: this.learningSpaceOrm!.deepPlanningResearch,
                            preparedModulePublication: this.learningSpaceOrm!.preparedModulePublication,
                            explorationModulePublication: this.learningSpaceOrm!.explorationModulePublication,
                            cognitiveModelInvalidation: this.learningSpaceOrm!.cognitiveModelInvalidation,
                        },
                    }));
                    this.logger.log(`module structure draft prepare goal=${result.goalId} module=${result.moduleId} status=${result.status}`);
                }
                catch (error) {
                    await this.settleOutboxEventFailure(event, error);
                    continue;
                }
            }
            else if (event.type === GOAL_MODULE_STRUCTURE_AUDIT_EVENT) {
                try {
                    const result = await this.runWithEventUserModelConfig(event.payload, () => processModuleStructureAuditEvent({
                        payloadJson: event.payload,
                        repos: {
                            drafts: this.learningSpaceOrm!.moduleStructureDraft,
                            moduleStructureQueue: this.learningSpaceOrm!.moduleStructureQueue,
                            moduleGenerationLease: this.learningSpaceOrm!.moduleGenerationLease,
                            deepPlanningResearch: this.learningSpaceOrm!.deepPlanningResearch,
                            preparedModulePublication: this.learningSpaceOrm!.preparedModulePublication,
                            explorationModulePublication: this.learningSpaceOrm!.explorationModulePublication,
                            cognitiveModelInvalidation: this.learningSpaceOrm!.cognitiveModelInvalidation,
                        },
                    }));
                    this.logger.log(`module structure audit goal=${result.goalId} status=${result.status}`);
                    if (AGENTIC_OUTBOX_HOLD_STATUSES.has(result.status)) {
                        await eventOutboxDelivery.releaseClaim({
                            id: event.id,
                            expectedAttemptCount: event.attemptCount,
                            nextAttemptAt: now,
                        });
                        continue;
                    }
                }
                catch (error) {
                    await this.settleOutboxEventFailure(event, error);
                    continue;
                }
            }
            else if (event.type === GOAL_CREATION_COORDINATE_EVENT) {
                try {
                    const result = await this.runWithEventUserModelConfig(event.payload, () => processGoalCreationCoordinateEvent({
                        payloadJson: event.payload,
                        repos: {
                            drafts: this.learningSpaceOrm!.moduleStructureDraft,
                            moduleStructureQueue: this.learningSpaceOrm!.moduleStructureQueue,
                            moduleGenerationLease: this.learningSpaceOrm!.moduleGenerationLease,
                            deepPlanningResearch: this.learningSpaceOrm!.deepPlanningResearch,
                            preparedModulePublication: this.learningSpaceOrm!.preparedModulePublication,
                            explorationModulePublication: this.learningSpaceOrm!.explorationModulePublication,
                            cognitiveModelInvalidation: this.learningSpaceOrm!.cognitiveModelInvalidation,
                        },
                    }));
                    this.logger.log(`goal creation coordinate goal=${result.goalId} status=${result.status}`);
                    if (AGENTIC_OUTBOX_HOLD_STATUSES.has(result.status)) {
                        await eventOutboxDelivery.releaseClaim({
                            id: event.id,
                            expectedAttemptCount: event.attemptCount,
                            nextAttemptAt: now,
                        });
                        continue;
                    }
                }
                catch (error) {
                    await this.settleOutboxEventFailure(event, error);
                    continue;
                }
            }
            else {
                this.logger.log(`analytics event type=${event.type} payload=${event.payload}`);
            }
            if (hostSettlement === "delete" ||
                event.type === RAG_SCOPE_CLEANUP_EVENT ||
                event.type === CHAT_AUDIO_CLEANUP_EVENT) {
                // Privacy cleanup commands carry durable resource identifiers. Once
                // processed successfully there is no audit value in retaining them.
                await eventOutboxDelivery.deleteClaimed({
                    id: event.id,
                    expectedAttemptCount: event.attemptCount,
                });
            }
            else {
                await eventOutboxDelivery.markPublished({
                    id: event.id,
                    expectedAttemptCount: event.attemptCount,
                    publishedAt: new Date(),
                });
            }
            publishedCount += 1;
        }
        if (publishedCount > 0) {
            this.logger.log(`Processed ${publishedCount} outbox event(s)`);
        }
        if (deferredCognitiveModelCount > 0) {
            this.logger.log(`Deferred ${deferredCognitiveModelCount} current cognitive model event(s) after work budget=${COGNITIVE_MODEL_EVENT_WORK_LIMIT}`);
        }
        try {
            const domainEvents = await processDomainEventBatch(this.learningSpaceOrm!.domainEventDispatch, getDefaultLearningSystemRuntime().registry, { fanoutLimit: 25, deliveryLimit: 25 });
            if (domainEvents.fannedOutEvents > 0 ||
                domainEvents.delivered > 0 ||
                domainEvents.retried > 0 ||
                domainEvents.deadLettered > 0) {
                this.logger.log(`Domain events fanout=${domainEvents.fannedOutEvents} delivered=${domainEvents.delivered} retried=${domainEvents.retried} deadLettered=${domainEvents.deadLettered}`);
            }
        }
        catch (error) {
            this.logger.error(`Domain-event dispatch failed: ${error instanceof Error ? error.message : String(error)}`);
            await recordBackendError({
                source: "worker",
                service: "learning-outbox",
                error,
                operation: "domain-event.dispatch",
            }, this.learningSpaceOrm!.observability);
        }
        return publishedCount;
    }
    protected async settleOutboxEventFailure(event: {
        id: string;
        type: string;
        attemptCount: number;
    }, error: unknown): Promise<void> {
        const decision = decideCognitiveModelOutboxFailure({
            error,
            previousAttemptCount: event.attemptCount - 1,
        });
        await this.learningSpaceOrm!.eventOutboxDelivery.settleFailure({
            id: event.id,
            expectedAttemptCount: event.attemptCount,
            ...decision.data,
        });
        const message = `outbox event failed id=${event.id} type=${event.type} ` +
            `attempt=${decision.attemptCount}/${COGNITIVE_MODEL_OUTBOX_MAX_ATTEMPTS} ` +
            `terminal=${decision.terminal} error=${decision.data.lastError}`;
        if (decision.terminal) {
            this.logger.error(message);
            await recordBackendError({
                source: "worker",
                service: "learning-outbox",
                error,
                operation: event.type,
            }, this.learningSpaceOrm!.observability);
        }
        else {
            this.logger.warn(message);
        }
    }
    protected async cleanupGenerationEvents(): Promise<number> {
        const configured = Number.parseInt(process.env.GENERATION_EVENT_RETENTION_DAYS ?? "7", 10);
        const days = Number.isFinite(configured)
            ? Math.min(365, Math.max(1, configured))
            : 7;
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const deleted = await this.learningSpaceOrm!.analyticsMaintenance.deleteGenerationEvents(cutoff);
        if (deleted > 0) {
            this.logger.log(`Deleted ${deleted} expired generation event(s)`);
        }
        return deleted;
    }
    protected async runCognitiveModelRevisionRetention(): Promise<number> {
        const result = await runCognitiveModelRevisionRetention(this.learningSpaceOrm!.analyticsMaintenance);
        const total = result.deletedSuperseded +
            result.deletedStaleCandidates +
            result.compactedFailed;
        if (total > 0) {
            this.logger.log(`Cognitive model revision retention superseded=${result.deletedSuperseded} staleCandidates=${result.deletedStaleCandidates} compactedFailed=${result.compactedFailed}`);
        }
        return total;
    }
    protected async runObservabilityMaintenance(): Promise<number> {
        const result = await runObservabilityMaintenance(this.learningSpaceOrm!.analyticsMaintenance);
        const total = result.deletedApiLogs +
            result.deletedLlmLogs +
            result.deletedBackendErrorGroups +
            result.prunedBackendErrorGroups +
            result.compressedArtifacts +
            result.uploadedArtifacts +
            result.prunedLocalArtifacts;
        if (total > 0) {
            this.logger.log(`Observability maintenance api=${result.deletedApiLogs} llm=${result.deletedLlmLogs} backendErrors=${result.deletedBackendErrorGroups} cappedBackendErrors=${result.prunedBackendErrorGroups} compressed=${result.compressedArtifacts} uploaded=${result.uploadedArtifacts} pruned=${result.prunedLocalArtifacts}`);
        }
        return total;
    }
    protected async runPerformanceAlertCheck(): Promise<number> {
        const result = await runPerformanceAlertCheck(this.learningSpaceOrm!.requestMetrics);
        if (result.fired.length > 0) {
            this.logger.warn(`Performance alerts fired=${result.fired.map((a) => a.id).join(",")} webhook=${result.webhookDelivered}`);
        }
        return result.fired.length;
    }
    protected async prewarmLearnerStateMemory(): Promise<number> {
        const refreshed = await prewarmLearnerStateMemories(undefined, 5);
        if (refreshed > 0) {
            this.logger.log(`Learner state memory prewarmed users=${refreshed}`);
        }
        return refreshed;
    }
    protected async refreshDueAgendas(): Promise<number> {
        const userIds = await listUsersNeedingAgendaRefresh(AGENDA_REFRESH_USER_LIMIT);
        let refreshed = 0;
        let skipped = 0;
        for (const userId of userIds) {
            try {
                const result = await refreshAgendaForUser(userId, {
                    reason: "daily",
                });
                if (result.skipped) {
                    skipped += 1;
                }
                else {
                    refreshed += 1;
                }
            }
            catch (error) {
                this.logger.error(`Agenda refresh failed for user=${userId}: ${error instanceof Error ? error.message : String(error)}`);
                await recordBackendError({
                    source: "worker",
                    service: "learning-outbox",
                    error,
                    operation: AGENDA_REFRESH_JOB,
                }, this.learningSpaceOrm!.observability);
            }
        }
        if (refreshed > 0 || skipped > 0) {
            this.logger.log(`Agenda refresh users=${userIds.length} refreshed=${refreshed} skipped=${skipped}`);
        }
        return refreshed;
    }
    protected async processMemoryFormation(): Promise<number> {
        const result = await processMemoryFormationCursors(5);
        const indexed = await retryPendingMemoryIndexes(5);
        if (result.processed > 0 || result.failed > 0 || indexed > 0) {
            this.logger.log(`Memory formation processed=${result.processed} failed=${result.failed} indexed=${indexed}`);
        }
        return result.processed + indexed;
    }
    protected getPayloadUserId(payload: unknown): string | null {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            return null;
        }
        const userId = (payload as {
            userId?: unknown;
        }).userId;
        return typeof userId === "string" && userId.length > 0 ? userId : null;
    }
    protected parseEventPayload(payloadJson: string): Record<string, unknown> | null {
        try {
            const payload: unknown = JSON.parse(payloadJson);
            return payload && typeof payload === "object" && !Array.isArray(payload)
                ? (payload as Record<string, unknown>)
                : null;
        }
        catch {
            return null;
        }
    }
    /**
     * Outbox rows frequently carry only goalId. Resolve the durable owner before
     * entering generation so desktop-local and hosted workers use that learner's
     * current provider/model settings instead of process defaults.
     */
    protected async resolveEventUserId(payloadJson: string): Promise<string | null> {
        const payload = this.parseEventPayload(payloadJson);
        const explicitUserId = this.getPayloadUserId(payload);
        if (explicitUserId)
            return explicitUserId;
        const goalId = payload?.goalId;
        if (typeof goalId !== "string" || goalId.length === 0)
            return null;
        const goal = await this.learningSpaceOrm!.cognitiveModelEvent.inspectGoal(goalId);
        return goal?.userId ?? null;
    }
    protected async runWithSyncedUserModelConfig<T>(userId: string | null, work: () => Promise<T>): Promise<T> {
        if (!userId)
            return work();
        return runWithUserId(userId, async () => {
            // The refresh check compares UserSettings.updatedAt, so changes made in
            // another API/desktop request become visible before this job selects a
            // chat or embedding provider.
            await ensureLlmRuntimeConfig(userId);
            return work();
        });
    }
    protected async runWithEventUserModelConfig<T>(payloadJson: string, work: () => Promise<T>): Promise<T> {
        return this.runWithSyncedUserModelConfig(await this.resolveEventUserId(payloadJson), work);
    }
}
