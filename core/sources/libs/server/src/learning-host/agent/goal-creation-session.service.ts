import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import {
  localizeBackendMessage,
  localizeBackendPayload,
  tBackend,
} from "../../../../common/src/index.js";
import {
  createInitialGoalState,
  isGoalCreationClosedWithoutGoal,
} from "../../agents/index.js";
import {
  deleteAllChunksByMetadata,
  deleteGoalCollection,
} from "../../rag/vector-store.js";
import { parseMapPlan } from "../../goals/map-plan.js";
import {
  buildFoundationGoalTitle,
  normalizeFoundationItems,
  parseFoundationGoalItems,
} from "../../goals/foundation-support.js";
import { createGoalRecord } from "../../agents/goal-creation/actions.js";
import { prepareGoalCreationRetryCheckpoint } from "../../agents/goal-creation/retry-checkpoint.js";
import {
  phaseFromGoalCreationCheckpoint,
  shouldCompleteMicroGoalCreationSession,
} from "../../agents/goal-creation/session-phase.js";
import {
  saveCheckpoint,
  type ThreadCheckpoint,
} from "../../agents/core/checkpoint.js";
import { LearningSpaceOrmProvider } from "../../learning-spaces/learning-space-orm.provider.js";

const DELETE_CONFIRM = "DELETE";
const STARTABLE_MODEL_STATUSES = new Set(["expanded", "building"]);
const EVENT_TYPES = new Set([
  "status",
  "phase",
  "reasoning_status",
  "planning_activity",
  "planning_stage",
  "planning_outline",
  "research_query",
  "module_research_progress",
  "planning_warning",
  "tool_ui",
  "interrupt",
  "done",
  "error",
  "cancelled",
  "module_stage",
]);

type Checkpoint = {
  pendingInterrupt?: {
    toolCallId: string;
    toolName: string;
    uiKind: string;
    args?: Record<string, unknown>;
  } | null;
  goalState?: {
    topic?: string;
    goalId?: string;
    currentPhase?: string;
    mapPlanStatus?: string;
    autoApproveWithoutQuestions?: boolean;
    executionMode?: string;
    auditStatus?: string;
    goalApproved?: boolean;
    isSmallCourse?: boolean;
  };
};

function parseCheckpoint(raw: string): Checkpoint {
  try {
    return JSON.parse(raw) as Checkpoint;
  } catch {
    return {};
  }
}

function jsonText(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function phaseFromCheckpoint(checkpoint: Checkpoint): string {
  return phaseFromGoalCreationCheckpoint(checkpoint);
}

@Injectable()
export class GoalCreationSessionService implements OnModuleInit {
  constructor(private readonly learningSpaceOrm: LearningSpaceOrmProvider) {}

  async onModuleInit() {
    await this.learningSpaceOrm.initialize();
    const interrupted =
      await this.learningSpaceOrm.agentConversation.recoverInterruptedGoalCreationSessions(
        tBackend("error.generation.interrupted"),
      );
    for (const sessionId of interrupted) {
      await this.appendEvent(sessionId, {
        type: "error",
        code: "GENERATION_INTERRUPTED",
        message: tBackend("error.generation.interrupted"),
      }).catch(() => {});
    }
  }

  async createOrGet(userId: string) {
    const existing =
      await this.learningSpaceOrm.agentConversation.findGoalCreationSessionByActiveSlot(
        userId,
      );
    if (existing) {
      await this.reconcile(existing.id);
      const stillActive =
        await this.learningSpaceOrm.agentConversation.findGoalCreationSessionByActiveSlot(
          userId,
        );
      if (
        stillActive &&
        stillActive.status !== "stopped" &&
        stillActive.status !== "completed"
      ) {
        return this.snapshot(userId, stillActive.id, false);
      }
      if (stillActive) {
        await this.learningSpaceOrm.agentConversation.stopGoalCreationSession(
          stillActive.id,
          new Date(),
        );
      }
    }

    const adopted = await this.adoptLegacySession(userId);
    if (adopted) return this.snapshot(userId, adopted.id, false);

    const initialState = {
      llmMessages: [],
      goalState: createInitialGoalState(),
    };
    const created =
      await this.learningSpaceOrm.agentConversation.createGoalCreationSession({
        userId,
        stateJson: JSON.stringify(initialState),
        phase: "intake",
      });
    if (!created.raced) {
      await this.appendEvent(created.session.id, {
        type: "session_created",
        phase: "intake",
        message: tBackend("status.agent.goalCreationReady"),
      });
    }
    return this.snapshot(userId, created.session.id, !created.raced);
  }

  async createFoundationOrGet(
    userId: string,
    parentGoalId: string,
    prerequisiteItems: unknown,
    requestedLearningMode: unknown = "exploration",
  ) {
    const active = await this.getActive(userId);
    if (active.session) {
      return { ...active, created: false, activeCreationExists: true };
    }
    const adopted = await this.adoptLegacySession(userId);
    if (adopted) {
      return {
        ...(await this.snapshot(userId, adopted.id, false)),
        created: false,
        activeCreationExists: true,
      };
    }

    const parent =
      await this.learningSpaceOrm.agentConversation.findFoundationParent(
        userId,
        parentGoalId,
      );
    if (!parent) throw new NotFoundException(tBackend("error.goal.notFound"));
    if (
      parent.goalKind === "micro" ||
      parent.parentGoalId ||
      parent.goalRelationType === "foundation_support"
    ) {
      throw new ConflictException(
        tBackend("error.agent.foundationGoalUnsupported"),
      );
    }
    const plan = parseMapPlan(parent.mapPlanJson);
    const available = new Set(plan?.prerequisitesAssumed ?? []);
    const selected = normalizeFoundationItems(prerequisiteItems);
    const learningMode =
      requestedLearningMode === "mastery" ? "mastery" : "exploration";
    if (
      selected.length === 0 ||
      selected.some((item) => !available.has(item))
    ) {
      throw new ConflictException(
        tBackend("error.agent.foundationSelectionStale"),
      );
    }
    const existing =
      await this.learningSpaceOrm.agentConversation.listFoundationRelationContexts(
        userId,
        parentGoalId,
      );
    const covered = new Set(
      existing.flatMap((context) => parseFoundationGoalItems(context)),
    );
    if (selected.some((item) => covered.has(item))) {
      throw new ConflictException(tBackend("error.agent.foundationGoalExists"));
    }

    const title = buildFoundationGoalTitle(selected);
    const initialGoalState: ReturnType<typeof createInitialGoalState> = {
      ...createInitialGoalState(),
      topic: title,
      refinedTitle: title,
      intentAnalysis: `将选定的基础分别作为独立学习分支，补充“${parent.title}”可能需要的基础`,
      discoverySkipped: true,
      level: "zero",
      contentLanguage: parent.contentLanguage,
      generationOptions: [
        "[System-created optional foundation goal — authoritative]",
        "Independent foundation strands in this goal:",
        ...selected.map((item) => `- ${item}`),
        `Relationship context only; never use as curriculum scope: ${parent.title}`,
        "Build only the independent foundation strands above. Do not recreate, summarize, extend, or teach the parent learning goal.",
        "The strands are mostly independent: do not invent conceptual dependencies between them. Use a compact curriculum, keep each strand visibly distinct, and order them only for navigation.",
        "This goal is optional and must not gate the parent goal.",
        "The selected foundations are curriculum outcomes, not prerequisitesAssumed or module entryFoundationBriefs.",
      ].join("\n"),
      planningMode: "fast" as const,
      learningMode,
      collectedFields: [
        "level",
        "contentLanguage",
        "generationOptions",
        "isSmallCourse",
        "documents",
      ],
      autoApproveWithoutQuestions: true,
      parentGoalId,
      goalRelationType: "foundation_support",
      goalRelationContext: {
        prerequisiteItems: selected,
        parentTitleAtCreation: parent.title,
      },
      currentPhase: "generating_plan" as const,
      currentSubagent: "plan" as const,
    };
    const initialState = { llmMessages: [], goalState: initialGoalState };

    const created =
      await this.learningSpaceOrm.agentConversation.createGoalCreationSession({
        userId,
        stateJson: JSON.stringify(initialState),
        phase: "goal_creation",
      });
    if (created.raced) {
      return {
        ...(await this.snapshot(userId, created.session.id, false)),
        created: false,
        activeCreationExists: true,
      };
    }

    let createdGoalId = "";
    try {
      const { goalId } = await createGoalRecord(userId, initialGoalState, {
        threadId: created.session.threadId,
        learningSpaceApplication: this.learningSpaceOrm.service,
      });
      createdGoalId = goalId;
      const runningState = {
        ...initialState,
        goalState: { ...initialGoalState, goalId },
      };
      await this.learningSpaceOrm.agentConversation.bindGoalCreationSessionGoal(
        {
          sessionId: created.session.id,
          threadId: created.session.threadId,
          goalId,
          phase: "planning",
          stateJson: JSON.stringify(runningState),
        },
      );
      await this.appendEvent(created.session.id, {
        type: "session_created",
        phase: "planning",
        message: tBackend("status.agent.foundationPlanningStarted"),
      });
      return {
        ...(await this.snapshot(userId, created.session.id, true)),
        created: true,
        activeCreationExists: false,
      };
    } catch (error) {
      await this.learningSpaceOrm.agentConversation
        .deleteGoalCreationSession(created.session.id)
        .catch(() => {});
      if (createdGoalId) {
        await this.learningSpaceOrm.agentConversation
          .deleteFoundationGoal({
            goalId: createdGoalId,
            userId,
            parentGoalId,
          })
          .catch(() => {});
      }
      throw error;
    }
  }

  private async adoptLegacySession(userId: string) {
    const threads =
      await this.learningSpaceOrm.agentConversation.listLegacyGoalCreationThreads(
        userId,
        10,
      );
    for (const thread of threads) {
      const checkpoint = parseCheckpoint(thread.stateJson) as Checkpoint & {
        goalCreationActive?: boolean;
        goalCreationPaused?: boolean;
        goalCreationMessages?: unknown[];
      };
      const state = checkpoint.goalState;
      const hasProgress = Boolean(
        checkpoint.goalCreationActive ||
        checkpoint.goalCreationMessages?.length ||
        state?.topic?.trim() ||
        state?.goalId ||
        state?.mapPlanStatus === "ready",
      );
      if (!hasProgress || state?.currentPhase === "completed") continue;
      if (state?.goalId) {
        const goalStillExists =
          await this.learningSpaceOrm.agentConversation.goalOwnedExists(
            userId,
            state.goalId,
          );
        if (!goalStillExists) continue;
      }
      const session =
        await this.learningSpaceOrm.agentConversation.adoptLegacyGoalCreationSession(
          {
            userId,
            threadId: thread.id,
            goalId: state?.goalId || null,
            status:
              checkpoint.goalCreationPaused || checkpoint.pendingInterrupt
                ? "waiting_user"
                : "running",
            phase: phaseFromCheckpoint(checkpoint),
            checkpointJson: jsonText(checkpoint),
          },
        );
      if (session) {
        await this.appendEvent(session.id, {
          type: "legacy_session_adopted",
          message: tBackend("status.agent.goalCreationRestored"),
        });
        return session;
      }
    }
    return null;
  }

  async getActive(userId: string) {
    let session =
      await this.learningSpaceOrm.agentConversation.findGoalCreationSessionByActiveSlot(
        userId,
      );
    if (!session) return { session: null };
    await this.reconcile(session.id);
    session =
      await this.learningSpaceOrm.agentConversation.findGoalCreationSessionByActiveSlot(
        userId,
      );
    if (!session) return { session: null };
    if (session.status === "stopped" || session.status === "completed") {
      return { session: null };
    }
    return this.snapshot(userId, session.id, false);
  }

  async getByGoal(userId: string, goalId: string) {
    const session =
      await this.learningSpaceOrm.agentConversation.findGoalCreationSessionByGoalId(
        goalId,
      );
    if (!session) return { session: null };
    return this.snapshot(userId, session.id, false);
  }

  async snapshot(userId: string, sessionId: string, created = false) {
    await this.requireOwned(userId, sessionId);
    await this.reconcile(sessionId);
    const session =
      await this.learningSpaceOrm.agentConversation.findGoalCreationSessionById(
        sessionId,
      );
    if (!session) throw new NotFoundException();
    const thread = await this.learningSpaceOrm.agentConversation.findThread(
      session.threadId,
    );
    if (!thread) throw new NotFoundException();
    const resources =
      await this.learningSpaceOrm.agentConversation.listGoalCreationResources(
        session.id,
        ["ready", "ingested", "failed"],
      );
    const checkpoint = parseCheckpoint(thread.stateJson);
    const flowMode = checkpoint.goalState?.autoApproveWithoutQuestions
      ? "automatic"
      : checkpoint.goalState?.executionMode === "agentic"
        ? "agentic"
        : "guided";
    const pending = checkpoint.pendingInterrupt ?? null;
    const journey = session.goalId
      ? await this.resolveJourney(session.goalId)
      : null;
    const draftProgress =
      flowMode === "agentic" && session.goalId
        ? await this.learningSpaceOrm.moduleStructureDraft.progressForGoal(
            session.goalId,
          )
        : null;
    const stopped = session.status === "stopped";
    const completed = session.status === "completed";
    return {
      created,
      session: {
        id: session.id,
        threadId: session.threadId,
        goalId:
          session.goalId || checkpoint.goalState?.goalId?.trim() || null,
        status: session.status,
        phase: phaseFromCheckpoint(checkpoint),
        flowMode,
        version: session.version,
        currentRunId: session.currentRunId,
        firstUnitId: session.firstUnitId || journey?.firstReadyUnitId || null,
        lastError:
          session.status === "needs_attention"
            ? tBackend("error.generation.failedFriendly")
            : null,
        pendingInteraction: pending
          ? {
              toolCallId: pending.toolCallId,
              toolName: pending.toolName,
              uiKind: pending.uiKind,
              args: pending.args ?? {},
            }
          : null,
        progress: journey
          ? {
              ...journey,
              preparedModuleCount:
                draftProgress?.preparedModuleCount ?? journey.readyModuleCount,
              publishedModuleCount:
                draftProgress?.publishedModuleCount ?? journey.readyModuleCount,
              failedModuleCount: draftProgress?.failedModuleCount ?? 0,
              auditStatus: checkpoint.goalState?.auditStatus ?? "idle",
              modules:
                draftProgress?.modules.map((module) => ({
                  id: module.id,
                  title:
                    journey.modules.find((item) => item.id === module.id)
                      ?.title ?? module.id,
                  status: module.status,
                  attemptCount: module.attemptCount,
                })) ?? journey.modules,
            }
          : null,
        resources: resources.map((resource) => ({
          id: resource.id,
          kind: resource.kind,
          filename: resource.filename,
          status: resource.status,
          warning: resource.warning
            ? localizeBackendMessage(resource.warning)
            : resource.warning,
          error: resource.error
            ? localizeBackendMessage(resource.error)
            : resource.error,
        })),
        actions: {
          canRetry: session.status === "needs_attention",
          canStop: !stopped && !completed,
          canDelete: stopped,
        },
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        stoppedAt: session.stoppedAt?.toISOString() ?? null,
        completedAt: session.completedAt?.toISOString() ?? null,
      },
    };
  }

  async listEvents(userId: string, sessionId: string, after = 0) {
    await this.requireOwned(userId, sessionId);
    const events =
      await this.learningSpaceOrm.agentConversation.listGoalCreationEvents(
        sessionId,
        Math.max(0, after),
        250,
      );
    return {
      events: events.map((event) => ({
        sequence: event.sequence,
        type: event.type,
        payload: localizeBackendPayload(event.payload),
        createdAt: event.createdAt.toISOString(),
      })),
      cursor: events.at(-1)?.sequence ?? after,
    };
  }

  async retry(userId: string, sessionId: string) {
    const session = await this.requireOwned(userId, sessionId);
    if (session.status !== "needs_attention") {
      throw new ConflictException(
        tBackend("error.agent.goalCreationRetryNotNeeded"),
      );
    }
    const thread = await this.learningSpaceOrm.agentConversation.findThread(
      session.threadId,
    );
    if (!thread) throw new NotFoundException();
    const checkpoint = parseCheckpoint(thread.stateJson);
    const goalId = checkpoint.goalState?.goalId || session.goalId;
    const goal = goalId
      ? await this.learningSpaceOrm.learningGoalPlan.findOwnedContext(
          userId,
          goalId,
        )
      : null;
    const prepared = prepareGoalCreationRetryCheckpoint(
      checkpoint as ThreadCheckpoint,
      goal ? parseMapPlan(goal.mapPlanJson) : null,
    );
    if (prepared !== checkpoint) {
      await saveCheckpoint(session.threadId, prepared);
    }
    await this.learningSpaceOrm.agentConversation.retryGoalCreationSession(
      sessionId,
      prepared.pendingInterrupt ? "waiting_user" : "running",
    );
    if (session.goalId && prepared.goalState?.executionMode === "agentic") {
      await this.learningSpaceOrm.moduleStructureDraft.requeueFailedWork({
        goalId: session.goalId,
        sessionId,
      });
    }
    await this.appendEvent(sessionId, {
      type: "retried",
      message: tBackend("status.agent.goalCreationRetrying"),
    });
    return this.snapshot(userId, sessionId);
  }

  async stop(userId: string, sessionId: string) {
    const session = await this.requireOwned(userId, sessionId);
    if (session.status === "completed") {
      throw new ConflictException(
        tBackend("error.agent.completedGoalCreationCannotStop"),
      );
    }
    const now = new Date();
    const alreadyStopped = session.status === "stopped";
    await this.learningSpaceOrm.agentConversation.stopGoalCreationSession(
      sessionId,
      now,
    );
    if (!alreadyStopped) {
      await this.appendEvent(sessionId, {
        type: "stopped",
        message: tBackend("status.agent.goalCreationStopped"),
      });
    }
    return this.snapshot(userId, sessionId);
  }

  async remove(userId: string, sessionId: string, confirm: string) {
    if (confirm !== DELETE_CONFIRM) {
      throw new ConflictException(
        tBackend("error.agent.deleteConfirmRequired"),
      );
    }
    const session = await this.requireOwned(userId, sessionId);
    if (session.status !== "stopped") {
      throw new ConflictException(
        tBackend("error.agent.stopGoalCreationFirst"),
      );
    }
    const { goalId, threadId } = session;
    if (goalId) {
      await this.learningSpaceOrm.goalTreeDeletion.deleteOwnedGoalTree({
        userId,
        goalId,
      });
    } else {
      await this.learningSpaceOrm.agentConversation.deleteGoalCreationSession(
        sessionId,
      );
    }
    await this.learningSpaceOrm.agentConversation.deleteThread(threadId);
    if (goalId) {
      await deleteGoalCollection(goalId);
      try {
        await deleteAllChunksByMetadata("web_knowledge", userId, { goalId });
      } catch {
        // Durable outbox cleanup above remains the source of recovery.
      }
    }
    return { ok: true, deletedGoalId: goalId ?? null };
  }

  async appendEventForThread(threadId: string, event: { type: string }) {
    if (!EVENT_TYPES.has(event.type)) return;
    const session =
      await this.learningSpaceOrm.agentConversation.findGoalCreationSessionByThreadId(
        threadId,
      );
    if (!session || session.status === "stopped") return;
    await this.appendEvent(session.id, event);
    if (event.type === "error") {
      const message = String(
        (event as { message?: unknown }).message ??
          tBackend("error.generation.failed"),
      );
      await this.learningSpaceOrm.agentConversation.markGoalCreationSessionError(
        session.id,
        message,
      );
    }
  }

  async markThreadRunStarted(threadId: string, runId: string) {
    await this.learningSpaceOrm.agentConversation.markGoalCreationRunStarted(
      threadId,
      runId,
    );
  }

  async syncFromThread(threadId: string, error?: string) {
    const session =
      await this.learningSpaceOrm.agentConversation.findGoalCreationSessionByThreadId(
        threadId,
      );
    if (!session || ["stopped", "completed"].includes(session.status)) return;
    const thread =
      await this.learningSpaceOrm.agentConversation.findThread(threadId);
    if (!thread) return;
    const checkpoint = parseCheckpoint(thread.stateJson);
    const goalId = checkpoint.goalState?.goalId?.trim() || session.goalId;
    if (
      !goalId &&
      isGoalCreationClosedWithoutGoal(checkpoint as Record<string, unknown>)
    ) {
      await this.learningSpaceOrm.agentConversation.deleteGoalCreationSession(
        session.id,
      );
      return;
    }
    if (error) {
      if (
        await this.completeMicroSessionIfReady(session.id, checkpoint, goalId)
      ) {
        return;
      }
      await this.learningSpaceOrm.agentConversation.syncGoalCreationSession({
        sessionId: session.id,
        goalId: goalId || null,
        phase: phaseFromCheckpoint(checkpoint),
        checkpointJson: jsonText(checkpoint),
        status: "needs_attention",
        error,
      });
      return;
    }
    if (session.status === "needs_attention") {
      await this.learningSpaceOrm.agentConversation.syncGoalCreationSession({
        sessionId: session.id,
        goalId: goalId || null,
        phase: phaseFromCheckpoint(checkpoint),
        checkpointJson: jsonText(checkpoint),
      });
      return;
    }
    await this.learningSpaceOrm.agentConversation.syncGoalCreationSession({
      sessionId: session.id,
      goalId: goalId || null,
      phase: phaseFromCheckpoint(checkpoint),
      status: checkpoint.pendingInterrupt ? "waiting_user" : "running",
      checkpointJson: jsonText(checkpoint),
      error: "",
    });
    await this.reconcile(session.id);
  }

  private async appendEvent(sessionId: string, event: Record<string, unknown>) {
    await this.learningSpaceOrm.agentConversation.appendGoalCreationEvent(
      sessionId,
      { type: String(event.type ?? "status"), payload: event },
    );
  }

  private async reconcile(sessionId: string) {
    const session =
      await this.learningSpaceOrm.agentConversation.findGoalCreationSessionById(
        sessionId,
      );
    if (!session || !session.goalId) return;
    if (["stopped", "completed"].includes(session.status)) {
      return;
    }
    const thread = await this.learningSpaceOrm.agentConversation.findThread(
      session.threadId,
    );
    const checkpoint = thread ? parseCheckpoint(thread.stateJson) : {};
    if (
      await this.completeMicroSessionIfReady(
        session.id,
        checkpoint,
        session.goalId,
      )
    ) {
      return;
    }
    if (checkpoint.goalState?.executionMode === "agentic") {
      const drafts =
        await this.learningSpaceOrm.moduleStructureDraft.progressForGoal(
          session.goalId,
        );
      const total = drafts.modules.length;
      const journey = await this.resolveJourney(session.goalId);
      if (journey.firstReadyUnitId && !session.firstUnitId &&
          await this.learningSpaceOrm.agentConversation.markGoalCreationFirstUnitReady(sessionId, journey.firstReadyUnitId)) {
        await this.appendEvent(sessionId, {type: "first_unit_ready", message: tBackend("status.agent.firstLessonReady"),
          goalId: session.goalId, firstUnitId: journey.firstReadyUnitId,
          navigateTo: `/goals/${session.goalId}/units/${journey.firstReadyUnitId}`});
      }
      if (total > 0 && drafts.publishedModuleCount === total && journey.firstReadyUnitId) {
        const completed =
          await this.learningSpaceOrm.agentConversation.completeGoalCreationSession(
            sessionId,
            journey.firstReadyUnitId ?? "",
            new Date(),
          );
        if (completed) {
          await this.appendEvent(sessionId, {
            type: "completed",
            message: tBackend("status.agent.firstLessonReady"),
            firstUnitId: journey.firstReadyUnitId,
          });
        }
      }
      return;
    }
    const journey = await this.resolveJourney(session.goalId);
    if (journey.firstReadyUnitId) {
      const completed =
        await this.learningSpaceOrm.agentConversation.completeGoalCreationSession(
          sessionId,
          journey.firstReadyUnitId,
          new Date(),
        );
      if (completed) {
        await this.appendEvent(sessionId, {
          type: "completed",
          message: tBackend("status.agent.firstLessonReady"),
          firstUnitId: journey.firstReadyUnitId,
        });
      }
      return;
    }
    if (journey.moduleCount > 0) {
      await this.learningSpaceOrm.agentConversation.advanceGoalCreationSessionToFirstUnit(
        sessionId,
        journey.learningMode === "exploration"
          ? "first_unit"
          : "first_unit_kacom",
      );
    }
  }

  private async completeMicroSessionIfReady(
    sessionId: string,
    checkpoint: Checkpoint,
    goalId: string | null,
  ): Promise<boolean> {
    if (!goalId) return false;
    const session =
      await this.learningSpaceOrm.agentConversation.findGoalCreationSessionById(
        sessionId,
      );
    if (!session) return false;
    let goalKind: string | undefined;
    if (checkpoint.goalState?.isSmallCourse !== true) {
      const goal = await this.learningSpaceOrm.learningGoal.findOwnedById(
        session.userId,
        goalId,
      );
      goalKind = goal?.goalKind;
    }
    if (
      !shouldCompleteMicroGoalCreationSession({
        status: session.status,
        goalId,
        isSmallCourse: checkpoint.goalState?.isSmallCourse,
        goalKind,
      })
    ) {
      return false;
    }
    const journey = await this.resolveJourney(goalId);
    const completed =
      await this.learningSpaceOrm.agentConversation.completeGoalCreationSession(
        sessionId,
        journey.firstReadyUnitId ?? "",
        new Date(),
      );
    if (completed) {
      await this.appendEvent(sessionId, {
        type: "completed",
        message: tBackend("status.agent.firstLessonReady"),
        firstUnitId: journey.firstReadyUnitId,
        goalId,
        navigateTo: journey.firstReadyUnitId
          ? `/goals/${goalId}/units/${journey.firstReadyUnitId}`
          : `/goals/${goalId}`,
      });
    }
    return true;
  }

  private async resolveJourney(goalId: string) {
    const journey =
      await this.learningSpaceOrm.agentConversation.readGoalCreationJourney(
        goalId,
      );
    const requiresCognitiveModel = journey.learningMode !== "exploration";
    const modules = journey.modules;
    const units = modules.flatMap((module) =>
      module.units.map((unit) => ({ ...unit, moduleOrder: module.orderIndex })),
    );
    units.sort(
      (a, b) => a.moduleOrder - b.moduleOrder || a.orderIndex - b.orderIndex,
    );
    const isReady = (unit: { cognitiveModelStatus: string }) =>
      !requiresCognitiveModel ||
      STARTABLE_MODEL_STATUSES.has(unit.cognitiveModelStatus);
    const firstReady = units[0] && isReady(units[0]) ? units[0] : undefined;
    return {
      moduleCount: modules.length,
      readyModuleCount: modules.filter(
        (module) => module.generationStatus === "ready",
      ).length,
      unitCount: units.length,
      readyUnitCount: units.filter(isReady).length,
      firstReadyUnitId: firstReady?.id ?? null,
      firstReadyUnitTitle: firstReady?.title ?? null,
      learningMode: journey.learningMode,
      modules: modules.map((module) => ({
        id: module.id,
        title: module.title,
        status: module.generationStatus,
      })),
    };
  }

  private async requireOwned(userId: string, sessionId: string) {
    const session =
      await this.learningSpaceOrm.agentConversation.findGoalCreationSessionById(
        sessionId,
      );
    if (!session) {
      throw new NotFoundException(tBackend("error.agent.goalCreationNotFound"));
    }
    if (session.userId !== userId) {
      throw new ForbiddenException(
        tBackend("error.agent.goalCreationForbidden"),
      );
    }
    return session;
  }

  async assertThreadMayRun(userId: string, threadId: string) {
    const session =
      await this.learningSpaceOrm.agentConversation.findGoalCreationSessionByThreadId(
        threadId,
      );
    if (!session) return;
    if (session.userId !== userId) {
      throw new ForbiddenException(tBackend("error.agent.threadForbidden"));
    }
    if (session.status === "stopped") {
      throw new ConflictException(tBackend("error.agent.goalCreationStopped"));
    }
  }

  async preventDedicatedThreadDelete(threadId: string) {
    const session =
      await this.learningSpaceOrm.agentConversation.findGoalCreationSessionByThreadId(
        threadId,
      );
    if (session) {
      throw new ConflictException(
        tBackend("error.agent.deleteDedicatedThreadFromGoalCreation"),
      );
    }
  }

  async requireThreadId(userId: string, sessionId: string) {
    const session = await this.requireOwned(userId, sessionId);
    return session.threadId;
  }
}
