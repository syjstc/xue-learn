import { learningTrajectoryEnabled } from "../../learning-trajectory/persistence.js";
import { resolveOwnedLearningPosition } from "../../learning-trajectory/service.js";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  decodeMultipartFilename,
  localizeBackendMessage,
  localizeBackendPayload,
  tBackend,
} from "../../../../common/src/index.js";
import {
  getCurrentTime as resolveCurrentTime,
  getRecentActivity as fetchRecentActivity,
  searchGoals as queryGoals,
} from "../../assistant/index.js";
import {
  agentSseResponse,
  agentTaskStillOpen,
  clearAgentTraceId,
  createAgentSseStream,
  createInitialGoalState,
  getGlobalBriefing,
  loadCheckpoint,
  resolveAgentTraceId,
  resolveGoalCreationMessageRoute,
  resumeGlobalAssistant,
  resumeGoalCreation,
  runGlobalAssistant,
  runGoalCreationOrchestrator,
  saveCheckpoint,
  shouldRouteToGoalCreation,
  analyzePendingGoalDocuments as analyzeThreadGoalDocuments,
  storePendingGoalDocuments,
  storePendingGoalUrls,
  clearPendingGoalDocuments,
} from "../../agents/index.js";
import {
  anchorContextSnippet,
  parseMaterialAnchor,
} from "../../domain/material-anchor.js";
import { getMaterialFollowUpContext, replyMaterialFollowUp } from "../../graph/material-follow-up.js";
import { runWithLlmTraceAsync } from "../../llm/trace-context.js";
import type {
  AgentPageContext,
  AgentRunContext,
  AgentSseEvent,
  AgentThreadScope,
  AssistantConversationContext,
  LlmMessageRecord,
} from "../../agents/core/types.js";
import type {
  DocumentGoalSeed,
  GoalCreationDraft,
} from "../../agents/index.js";
import { GoalCreationSessionService } from "./goal-creation-session.service.js";
import { LearningSpaceOrmProvider } from "../../learning-spaces/learning-space-orm.provider.js";
import type { LearningSpaceGoalCreationApplication } from "../../learning-spaces/orm-application-service.js";

type AgentRunOptions = {
  clientAction?: string;
  seedTopic?: string;
  documentSeed?: DocumentGoalSeed;
  isSmallCourse?: boolean;
  goalDraft?: GoalCreationDraft;
  learningSpaceApplication?: LearningSpaceGoalCreationApplication;
  microUnitPublication?: LearningSpaceGoalCreationApplication["microUnitPublication"];
};

function conversationContextFromState(
  stateJson: string,
): AssistantConversationContext {
  try {
    const value = JSON.parse(stateJson) as {
      conversationContext?: AssistantConversationContext;
    };
    return value.conversationContext?.kind === "material_follow_up"
      ? value.conversationContext
      : { kind: "normal" };
  } catch {
    return { kind: "normal" };
  }
}

type ActiveAgentRun = {
  controller: AbortController;
  events: AgentSseEvent[];
};

const THREAD_PAGE_DEFAULT = 20;
const THREAD_SCOPES = new Set<AgentThreadScope>([
  "goal_creation",
  "global",
  "goal",
  "unit",
]);

function isScopedAssistantThread(
  scope: string,
): scope is Extract<AgentThreadScope, "goal" | "unit"> {
  return scope === "goal" || scope === "unit";
}
const THREAD_PAGE_MAX = 100;

type MessageCursor = { createdAt: string; id: string };

export type AgentUploadFile = Readonly<{
  originalname: string;
  buffer: Buffer;
}>;

function encodeMessageCursor(message: { createdAt: Date; id: string }) {
  return Buffer.from(
    JSON.stringify({
      createdAt: message.createdAt.toISOString(),
      id: message.id,
    } satisfies MessageCursor),
  ).toString("base64url");
}

function decodeMessageCursor(value?: string): MessageCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as MessageCursor;
    const date = new Date(parsed.createdAt);
    return parsed.id && !Number.isNaN(date.getTime()) ? parsed : null;
  } catch {
    // Compatibility for clients using the previous timestamp-only cursor.
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? null
      : { createdAt: date.toISOString(), id: "" };
  }
}

const activeRuns = new Map<string, ActiveAgentRun>();

const RESTORABLE_RUN_EVENT_TYPES = new Set<AgentSseEvent["type"]>([
  "status",
  "phase",
  "reasoning_status",
  "planning_activity",
  "planning_stage",
  "planning_outline",
  "research_query",
  "module_research_progress",
  "planning_warning",
  "knowledge_activity",
]);

function activeRunEventKey(event: AgentSseEvent): string | null {
  switch (event.type) {
    case "planning_activity":
      return `${event.type}:${event.id}`;
    case "module_research_progress":
      return `${event.type}:${event.moduleRef ?? event.current}`;
    case "knowledge_activity":
      return `${event.type}:${event.activity.id}`;
    case "planning_warning":
      return `${event.type}:${event.code}`;
    case "status":
    case "phase":
    case "reasoning_status":
    case "planning_stage":
    case "planning_outline":
    case "research_query":
      return event.type;
    default:
      return null;
  }
}

function rememberActiveRunEvent(run: ActiveAgentRun, event: AgentSseEvent) {
  if (!RESTORABLE_RUN_EVENT_TYPES.has(event.type)) return;
  const snapshotKey = activeRunEventKey(event);
  const events = [...run.events];
  const existingIndex = snapshotKey
    ? events.findIndex(
        (candidate) => activeRunEventKey(candidate) === snapshotKey,
      )
    : -1;
  if (existingIndex >= 0) events.splice(existingIndex, 1);
  events.push(event);
  run.events = events.slice(-100);
}

@Injectable()
export class AgentService {
  constructor(
    private readonly goalCreationSessions: GoalCreationSessionService,
    private readonly learningSpaceOrm: LearningSpaceOrmProvider,
  ) {}

  async createThread(
    userId: string,
    body: {
      scope: string;
      scopeId?: string;
      fresh?: boolean;
      conversationContext?: AssistantConversationContext;
    },
  ) {
    if (!THREAD_SCOPES.has(body.scope as AgentThreadScope)) {
      throw new BadRequestException(
        tBackend("error.agent.scopeUnsupported", { scope: body.scope }),
      );
    }
    if (isScopedAssistantThread(body.scope) && !body.scopeId) {
      throw new BadRequestException(
        tBackend("error.agent.scopeUnsupported", { scope: body.scope }),
      );
    }
    if (
      body.scope === "goal" &&
      !(await this.learningSpaceOrm.agentConversation.goalOwnedExists(
        userId,
        body.scopeId!,
      ))
    ) {
      throw new ForbiddenException(tBackend("error.goal.forbidden"));
    }
    if (
      body.scope === "unit" &&
      !(await this.learningSpaceOrm.agentConversation.findOwnedUnit(
        userId,
        body.scopeId!,
      ))
    ) {
      throw new ForbiddenException(tBackend("error.goal.unitForbidden"));
    }

    if (
      !body.fresh &&
      body.conversationContext?.kind !== "material_follow_up"
    ) {
      if (body.scope === "global") {
        const candidates =
          await this.learningSpaceOrm.agentConversation.listActiveGlobalThreads(
            userId,
            20,
          );
        const existing = candidates.find(
          (candidate) =>
            conversationContextFromState(candidate.stateJson).kind === "normal",
        );
        if (existing) {
          return { threadId: existing.id, scope: existing.scope };
        }
      } else if (isScopedAssistantThread(body.scope) && body.scopeId) {
        const listed =
          await this.learningSpaceOrm.agentConversation.listThreads(
            userId,
            body.scope,
            50,
          );
        const existingWithMessages = listed.find(
          (candidate) =>
            candidate.scopeId === body.scopeId &&
            conversationContextFromState(candidate.stateJson).kind ===
              "normal",
        );
        if (existingWithMessages) {
          return {
            threadId: existingWithMessages.id,
            scope: existingWithMessages.scope,
          };
        }
        const active =
          await this.learningSpaceOrm.agentConversation.listActiveThreads(
            userId,
            {
              scope: body.scope,
              scopeId: body.scopeId,
              limit: 20,
            },
          );
        const existing = active.find(
          (candidate) =>
            conversationContextFromState(candidate.stateJson).kind ===
            "normal",
        );
        if (existing) {
          return { threadId: existing.id, scope: existing.scope };
        }
      }
    }

    let conversationContext: AssistantConversationContext =
      body.conversationContext?.kind === "material_follow_up"
        ? body.conversationContext
        : { kind: "normal" };
    if (conversationContext.kind === "material_follow_up") {
      const anchor = parseMaterialAnchor(conversationContext.anchor);
      if (!anchor) {
        throw new ForbiddenException(
          tBackend("error.agent.invalidFollowUpContext"),
        );
      }
      const unit = await this.learningSpaceOrm.agentConversation.findOwnedUnit(
        userId,
        conversationContext.unitId,
      );
      if (
        !unit ||
        (conversationContext.goalId &&
          unit.goalId !== conversationContext.goalId)
      ) {
        throw new ForbiddenException(tBackend("error.goal.unitForbidden"));
      }
      const materialContext = await getMaterialFollowUpContext(userId, unit.id, anchor);
      if (!materialContext) {
        throw new ForbiddenException(
          tBackend("error.learning.materialRequired"),
        );
      }
      const learningLocation = !anchor.reading && learningTrajectoryEnabled() && conversationContext.learningPosition
        ? await resolveOwnedLearningPosition(userId, { ...conversationContext.learningPosition, unitId: unit.id })
        : null;
      conversationContext = {
        kind: "material_follow_up",
        learningPosition: learningLocation?.position,
        activeVisitId: conversationContext.activeVisitId,
        goalId: unit.goalId,
        unitId: unit.id,
        anchor,
        anchorSnippet: materialContext.anchorSnippet ?? (learningLocation?.position.anchorText || anchorContextSnippet(materialContext.material, anchor)),
        contentRevision: unit.contentRevision,
        unitTitle: unit.title,
        goalTitle: unit.goalTitle,
      };
    }

    const initialState =
      body.scope === "goal_creation"
        ? {
            llmMessages: [],
            goalState: createInitialGoalState(),
            conversationContext,
          }
        : { llmMessages: [], conversationContext };

    const thread = await this.learningSpaceOrm.agentConversation.createThread({
      userId,
      scope: body.scope,
      scopeId:
        conversationContext.kind === "material_follow_up"
          ? conversationContext.unitId
          : (body.scopeId ?? null),
      stateJson: JSON.stringify(initialState),
    });

    return { threadId: thread.id, scope: thread.scope };
  }

  async storePendingGoalUrls(userId: string, threadId: string, urls: string[]) {
    await this.requireThread(userId, threadId);
    return storePendingGoalUrls(threadId, urls);
  }

  async listThreads(userId: string, scope?: string) {
    const threads = await this.learningSpaceOrm.agentConversation.listThreads(
      userId,
      scope ?? null,
      50,
    );
    return {
      threads: threads.map((t) => ({
        id: t.id,
        scope: t.scope,
        scopeId: t.scopeId,
        status: t.status,
        conversationContext: conversationContextFromState(t.stateJson),
        latestMessage: t.latestMessage
          ? {
              role: t.latestMessage.role,
              content: (
                JSON.parse(t.latestMessage.metadataJson || "{}") as {
                  contextReset?: unknown;
                }
              ).contextReset
                ? localizeBackendMessage(t.latestMessage.content)
                : t.latestMessage.content,
              createdAt: t.latestMessage.createdAt.toISOString(),
            }
          : null,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    };
  }

  async getThread(
    userId: string,
    threadId: string,
    options?: { limit?: number; before?: string },
  ) {
    const thread = await this.requireThread(userId, threadId);
    const limit = Math.min(
      Math.max(options?.limit ?? THREAD_PAGE_DEFAULT, 1),
      THREAD_PAGE_MAX,
    );
    const before = decodeMessageCursor(options?.before);
    const page = await this.learningSpaceOrm.agentConversation.listMessages({
      threadId,
      beforeCreatedAt: before ? new Date(before.createdAt) : null,
      beforeId: before?.id || null,
      limit: limit + 1,
    });
    const rows = [...page.messages];
    const messageCount = page.total;
    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit).reverse();
    const activeRun = activeRuns.get(threadId);
    return {
      thread: {
        id: thread.id,
        scope: thread.scope,
        scopeId: thread.scopeId,
        status: thread.status,
        conversationContext: conversationContextFromState(thread.stateJson),
        stateJson: thread.stateJson,
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
      },
      messages: messages.map((m) => {
        const metadata = JSON.parse(m.metadataJson || "{}") as {
          contextReset?: unknown;
        };
        return {
          id: m.id,
          role: m.role,
          content: metadata.contextReset
            ? localizeBackendMessage(m.content)
            : m.content,
          toolCalls: JSON.parse(m.toolCalls || "[]"),
          toolCallId: m.toolCallId,
          uiPayload: JSON.parse(m.uiPayload || "{}"),
          metadata,
          createdAt: m.createdAt.toISOString(),
        };
      }),
      page: {
        limit,
        hasMore,
        oldestCursor: messages[0] ? encodeMessageCursor(messages[0]) : null,
        messageCount,
      },
      activeRun: activeRun
        ? {
            active: true as const,
            events: activeRun.events.map((event) =>
              localizeBackendPayload(event),
            ),
          }
        : null,
    };
  }

  async getGlobalBriefing(userId: string) {
    return getGlobalBriefing(userId);
  }

  getCurrentTime(timezone?: string) {
    return resolveCurrentTime(timezone);
  }

  searchGoals(userId: string, input: Parameters<typeof queryGoals>[1]) {
    return queryGoals(userId, input);
  }

  getRecentActivity(userId: string, limit?: number) {
    return fetchRecentActivity(userId, { limit });
  }

  async streamMessage(
    userId: string,
    threadId: string,
    message: string,
    res: import("express").Response,
    pageContext?: AgentPageContext,
    options?: AgentRunOptions,
  ) {
    const thread = await this.requireThread(userId, threadId);
    const effectivePageContext = await this.bindThreadPageContext(
      userId,
      thread.scope,
      thread.scopeId,
      pageContext,
    );
    await this.goalCreationSessions.assertThreadMayRun(userId, threadId);
    if (activeRuns.has(threadId)) {
      await this.writeSse(
        createAgentSseStream(async (send) => {
          send({
            type: "error",
            message: tBackend("error.agent.runInProgress"),
          });
        }),
        res,
      );
      return;
    }
    const ac = new AbortController();
    const runOptions = {
      ...options,
      learningSpaceApplication: this.learningSpaceOrm.service,
      microUnitPublication: this.learningSpaceOrm.microUnitPublication,
    };
    const activeRun: ActiveAgentRun = { controller: ac, events: [] };
    activeRuns.set(threadId, activeRun);

    const stream = createAgentSseStream(async (send) => {
      try {
        const checkpoint = await loadCheckpoint(threadId);
        const traceId = await resolveAgentTraceId(threadId, {
          continueTask: Boolean(checkpoint.pendingInterrupt),
        });
        const conversationContext = conversationContextFromState(
          thread.stateJson,
        );
        const operation =
          conversationContext.kind === "material_follow_up"
            ? "unit.material_follow_up"
            : thread.scope === "goal_creation"
              ? "goal.creation"
              : "agent.global";
        await this.goalCreationSessions.markThreadRunStarted(threadId, traceId);

        await runWithLlmTraceAsync(
          {
            traceId,
            meta: {
              scope: "agent",
              scopeId: threadId,
              operation,
            },
          },
          async () => {
            const ctx = this.buildCtx(
              userId,
              threadId,
              traceId,
              send,
              ac.signal,
            );
            if (conversationContext.kind === "material_follow_up") {
              const materialContext = await getMaterialFollowUpContext(
                userId, conversationContext.unitId, conversationContext.anchor,
              );
              if (!materialContext) {
                throw new Error(tBackend("error.learning.materialRequired"));
              }
              const result = await replyMaterialFollowUp({
                userId,
                unitId: conversationContext.unitId,
                unitTitle:
                  conversationContext.unitTitle ??
                  tBackend("label.agent.currentUnit"),
                goalId: conversationContext.goalId,
                goalTitle:
                  conversationContext.goalTitle ??
                  tBackend("label.agent.currentGoal"),
                threadId,
                anchor: conversationContext.anchor,
                learningPosition: !conversationContext.anchor.reading && learningTrajectoryEnabled() && effectivePageContext?.learningPosition?.unitId === conversationContext.unitId
                  ? (await resolveOwnedLearningPosition(userId,effectivePageContext.learningPosition)).position
                  : conversationContext.learningPosition,
                activeVisitId: effectivePageContext?.learningPosition ? effectivePageContext.activeLearningVisitId : conversationContext.activeVisitId,
                anchorSnippet: conversationContext.anchorSnippet,
                userMessage: message,
                quotedText: effectivePageContext?.frontendState?.selectedText,
                traceId,
                materialContext,
                learnerStateMemoryRead:
                  this.learningSpaceOrm.learnerStateMemoryRead,
                signal: ac.signal,
                send: async (event) => {
                  send(event);
                },
              });
              send({
                type: "done",
                threadId: result.threadId,
                conversationKind: "material_follow_up",
              });
            } else if (thread.scope === "goal_creation") {
              await this.routeGoalCreationMessage(
                ctx,
                userId,
                message,
                pageContext,
                runOptions,
                checkpoint,
              );
            } else if (thread.scope === "global") {
              await runGlobalAssistant(
                ctx,
                userId,
                message,
                effectivePageContext,
                runOptions,
              );
            } else if (isScopedAssistantThread(thread.scope)) {
              await runGlobalAssistant(
                ctx,
                userId,
                message,
                effectivePageContext,
                runOptions,
              );
            } else {
              send({
                type: "error",
                message: tBackend("error.agent.scopeUnsupported", {
                  scope: thread.scope,
                }),
              });
            }
          },
        );

        if (!(await agentTaskStillOpen(threadId))) {
          await clearAgentTraceId(threadId);
        }
      } finally {
        if (activeRuns.get(threadId) === activeRun) activeRuns.delete(threadId);
      }
    });

    try {
      await this.writeSse(stream, res);
    } finally {
      if (activeRuns.get(threadId) === activeRun) activeRuns.delete(threadId);
      await this.goalCreationSessions.syncFromThread(threadId).catch(() => {});
    }
  }

  startGoalCreationInBackground(
    userId: string,
    threadId: string,
  ): { started: boolean } {
    if (activeRuns.has(threadId)) return { started: false };
    const ac = new AbortController();
    const activeRun: ActiveAgentRun = { controller: ac, events: [] };
    activeRuns.set(threadId, activeRun);

    void (async () => {
      const stream = createAgentSseStream(async (send) => {
        try {
          const traceId = await resolveAgentTraceId(threadId, {
            continueTask: false,
          });
          await this.goalCreationSessions.markThreadRunStarted(
            threadId,
            traceId,
          );
          await runWithLlmTraceAsync(
            {
              traceId,
              meta: {
                scope: "agent",
                scopeId: threadId,
                operation: "goal.creation",
              },
            },
            async () => {
              const ctx = this.buildCtx(
                userId,
                threadId,
                traceId,
                send,
                ac.signal,
              );
              await runGoalCreationOrchestrator(ctx, userId, undefined, {
                learningSpaceApplication: this.learningSpaceOrm.service,
                microUnitPublication:
                  this.learningSpaceOrm.microUnitPublication,
              });
            },
          );
          if (!(await agentTaskStillOpen(threadId))) {
            await clearAgentTraceId(threadId);
          }
        } catch (error) {
          send({
            type: "error",
            message:
              error instanceof Error
                ? error.message
                : tBackend("error.agent.goalCreationStartFailed"),
          });
        } finally {
          if (activeRuns.get(threadId) === activeRun) {
            activeRuns.delete(threadId);
          }
          await this.goalCreationSessions
            .syncFromThread(threadId)
            .catch(() => {});
        }
      });
      const reader = stream.getReader();
      while (!(await reader.read()).done) {
        // Durable session events are persisted by buildCtx; no HTTP consumer is
        // required for this pre-confirmed creation path.
      }
    })();

    return { started: true };
  }

  private async routeGoalCreationMessage(
    ctx: AgentRunContext,
    userId: string,
    message: string,
    pageContext: AgentPageContext | undefined,
    options: AgentRunOptions | undefined,
    checkpoint: Awaited<ReturnType<typeof loadCheckpoint>>,
  ) {
    const route = resolveGoalCreationMessageRoute(checkpoint, message, {
      clientAction: options?.clientAction,
    });
    if (route.kind === "global") {
      if (checkpoint.goalCreationActive) {
        await runGlobalAssistant(ctx, userId, message, pageContext, options);
      } else {
        await this.runGlobalAssistantInterruption(
          ctx,
          userId,
          message,
          pageContext,
          options,
          checkpoint,
        );
      }
      return;
    }

    if (route.kind === "resume") {
      await resumeGoalCreation(
        ctx,
        userId,
        route.toolCallId,
        {
          answer: message.trim(),
          userResponse: message.trim(),
        },
        {
          embedded: Boolean(checkpoint.goalCreationActive),
          userDisplayText: message.trim(),
          learningSpaceApplication: this.learningSpaceOrm.service,
          microUnitPublication: this.learningSpaceOrm.microUnitPublication,
        },
      );
      return;
    }

    if (
      checkpoint.goalCreationActive ||
      !this.hasLegacyGoalCreationProgress(checkpoint)
    ) {
      await runGlobalAssistant(ctx, userId, message, pageContext, options);
      return;
    }

    await runGoalCreationOrchestrator(ctx, userId, message, {
      learningSpaceApplication: this.learningSpaceOrm.service,
      microUnitPublication: this.learningSpaceOrm.microUnitPublication,
    });
  }

  private hasLegacyGoalCreationProgress(
    checkpoint: Awaited<ReturnType<typeof loadCheckpoint>>,
  ) {
    if (checkpoint.goalCreationActive || checkpoint.pendingInterrupt) {
      return false;
    }
    const state = checkpoint.goalState;
    if (!state || typeof state !== "object") return false;
    const goalState = state as {
      topic?: unknown;
      goalId?: unknown;
      currentSubagent?: unknown;
      mapPlanStatus?: unknown;
    };
    return Boolean(
      (typeof goalState.topic === "string" && goalState.topic.trim()) ||
      (typeof goalState.goalId === "string" && goalState.goalId.trim()) ||
      (typeof goalState.currentSubagent === "string" &&
        goalState.currentSubagent !== "intake") ||
      (typeof goalState.mapPlanStatus === "string" &&
        !["", "pending"].includes(goalState.mapPlanStatus)),
    );
  }

  private async runGlobalAssistantInterruption(
    ctx: AgentRunContext,
    userId: string,
    message: string,
    pageContext: AgentPageContext | undefined,
    options: AgentRunOptions | undefined,
    goalCheckpoint: Awaited<ReturnType<typeof loadCheckpoint>>,
  ) {
    const mainMessages = Array.isArray(goalCheckpoint.mainMessages)
      ? (goalCheckpoint.mainMessages as LlmMessageRecord[])
      : [];
    const restoreCheckpoint = {
      ...goalCheckpoint,
      activeTraceId: ctx.traceId,
    };

    await saveCheckpoint(ctx.threadId, {
      llmMessages: mainMessages,
      activeTraceId: ctx.traceId,
    });

    await runGlobalAssistant(ctx, userId, message, pageContext, options);

    const afterGlobal = await loadCheckpoint(ctx.threadId);
    await saveCheckpoint(ctx.threadId, {
      ...restoreCheckpoint,
      mainMessages: afterGlobal.llmMessages,
      activeTraceId:
        typeof afterGlobal.activeTraceId === "string"
          ? afterGlobal.activeTraceId
          : restoreCheckpoint.activeTraceId,
    });
  }

  async streamResume(
    userId: string,
    threadId: string,
    toolCallId: string,
    result: unknown,
    res: import("express").Response,
  ) {
    const thread = await this.requireThread(userId, threadId);
    await this.goalCreationSessions.assertThreadMayRun(userId, threadId);
    if (activeRuns.has(threadId)) {
      await this.writeSse(
        createAgentSseStream(async (send) => {
          send({
            type: "error",
            message: tBackend("error.agent.runInProgress"),
          });
        }),
        res,
      );
      return;
    }
    const ac = new AbortController();
    const activeRun: ActiveAgentRun = { controller: ac, events: [] };
    activeRuns.set(threadId, activeRun);

    const stream = createAgentSseStream(async (send) => {
      try {
        const traceId = await resolveAgentTraceId(threadId, {
          continueTask: true,
        });
        const operation =
          thread.scope === "goal_creation"
            ? "goal.creation"
            : "agent.global.goal_creation";
        await this.goalCreationSessions.markThreadRunStarted(threadId, traceId);

        await runWithLlmTraceAsync(
          {
            traceId,
            meta: {
              scope: "agent",
              scopeId: threadId,
              operation,
            },
          },
          async () => {
            const ctx = this.buildCtx(
              userId,
              threadId,
              traceId,
              send,
              ac.signal,
            );
            if (thread.scope === "goal_creation") {
              const checkpoint = await loadCheckpoint(threadId);
              await resumeGoalCreation(ctx, userId, toolCallId, result, {
                embedded: Boolean(checkpoint.goalCreationActive),
                learningSpaceApplication: this.learningSpaceOrm.service,
                microUnitPublication:
                  this.learningSpaceOrm.microUnitPublication,
              });
            } else if (
              thread.scope === "global" ||
              isScopedAssistantThread(thread.scope)
            ) {
              const checkpoint = await loadCheckpoint(threadId);
              if (shouldRouteToGoalCreation(checkpoint)) {
                await resumeGoalCreation(ctx, userId, toolCallId, result, {
                  embedded: true,
                  learningSpaceApplication: this.learningSpaceOrm.service,
                  microUnitPublication:
                    this.learningSpaceOrm.microUnitPublication,
                });
              } else {
                await resumeGlobalAssistant(
                  ctx,
                  userId,
                  toolCallId,
                  result,
                  await this.bindThreadPageContext(
                    userId,
                    thread.scope,
                    thread.scopeId,
                    undefined,
                  ),
                  this.learningSpaceOrm.service,
                );
              }
            } else {
              send({
                type: "error",
                message: tBackend("error.agent.resumeScopeUnsupported"),
              });
            }
          },
        );

        if (!(await agentTaskStillOpen(threadId))) {
          await clearAgentTraceId(threadId);
        }
      } finally {
        if (activeRuns.get(threadId) === activeRun) activeRuns.delete(threadId);
      }
    });

    try {
      await this.writeSse(stream, res);
    } finally {
      if (activeRuns.get(threadId) === activeRun) activeRuns.delete(threadId);
      await this.goalCreationSessions.syncFromThread(threadId).catch(() => {});
    }
  }

  private async bindThreadPageContext(
    userId: string,
    scope: string,
    scopeId: string | null,
    pageContext?: AgentPageContext,
  ): Promise<AgentPageContext | undefined> {
    if (!isScopedAssistantThread(scope)) return pageContext;
    if (!scopeId) {
      throw new ForbiddenException(
        tBackend("error.agent.scopeUnsupported", { scope }),
      );
    }

    if (scope === "unit") {
      const unit = await this.learningSpaceOrm.agentConversation.findOwnedUnit(
        userId,
        scopeId,
      );
      if (!unit) {
        throw new ForbiddenException(tBackend("error.goal.unitForbidden"));
      }
      return {
        ...pageContext,
        pathname:
          pageContext?.pathname ?? `/goals/${unit.goalId}/units/${unit.id}`,
        pageKind: "unit",
        contextLabel: pageContext?.contextLabel ?? unit.title,
        goalId: unit.goalId,
        unitId: unit.id,
      };
    }

    if (
      !(await this.learningSpaceOrm.agentConversation.goalOwnedExists(
        userId,
        scopeId,
      ))
    ) {
      throw new ForbiddenException(tBackend("error.goal.forbidden"));
    }
    return {
      ...pageContext,
      pathname: pageContext?.pathname ?? `/goals/${scopeId}`,
      pageKind: pageContext?.pageKind ?? "goal_dashboard",
      goalId: scopeId,
      unitId: undefined,
      focusUnitId: undefined,
    };
  }

  private async writeSse(
    stream: ReadableStream<Uint8Array>,
    res: import("express").Response,
  ) {
    const response = agentSseResponse(stream);
    res.status(200);
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    res.flushHeaders();
    const reader = stream.getReader();
    let detached = false;
    const detach = () => {
      detached = true;
    };
    res.once("close", detach);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // The response is only a view onto durable goal-creation work. Keep
        // draining the producer after navigation or browser closure so the
        // checkpoint and session timeline can finish in the backend.
        if (!detached && !res.writableEnded && !res.destroyed) {
          const canContinue = res.write(value);
          // Force compression/proxy layers to release each small SSE frame.
          (
            res as import("express").Response & { flush?: () => void }
          ).flush?.();
          if (!canContinue) {
            await new Promise<void>((resolve) => {
              const finish = () => {
                res.off("drain", finish);
                res.off("close", finish);
                resolve();
              };
              res.once("drain", finish);
              res.once("close", finish);
            });
          }
        }
      }
    } finally {
      res.off("close", detach);
      if (!detached && !res.writableEnded && !res.destroyed) res.end();
    }
  }

  cancel(userId: string, threadId: string) {
    void userId;
    const activeRun = activeRuns.get(threadId);
    if (activeRun) {
      activeRun.controller.abort();
      activeRuns.delete(threadId);
    }
    return { ok: true };
  }

  isThreadRunning(threadId: string) {
    return activeRuns.has(threadId);
  }

  abortThreadRun(threadId: string) {
    const activeRun = activeRuns.get(threadId);
    if (!activeRun) return false;
    activeRun.controller.abort();
    activeRuns.delete(threadId);
    return true;
  }

  async storePendingGoalDocuments(
    userId: string,
    threadId: string,
    files: readonly AgentUploadFile[],
  ) {
    await this.requireThread(userId, threadId);
    if (files.length === 0) {
      clearPendingGoalDocuments(threadId);
      return { fileCount: 0 };
    }
    return storePendingGoalDocuments(
      threadId,
      files.map((file) => ({
        filename: decodeMultipartFilename(file.originalname),
        buffer: file.buffer,
      })),
    );
  }

  async analyzePendingGoalDocuments(userId: string, threadId: string) {
    await this.requireThread(userId, threadId);
    return analyzeThreadGoalDocuments(threadId);
  }

  async clearThread(userId: string, threadId: string) {
    const thread = await this.requireThread(userId, threadId);
    const activeRun = activeRuns.get(threadId);
    if (activeRun) {
      activeRun.controller.abort();
      activeRuns.delete(threadId);
    }
    clearPendingGoalDocuments(threadId);
    const resetState =
      thread.scope === "goal_creation"
        ? { llmMessages: [], goalState: createInitialGoalState() }
        : { llmMessages: [] };
    await this.learningSpaceOrm.agentConversation.clearThread(
      threadId,
      JSON.stringify(resetState),
    );
    return { ok: true };
  }

  async clearThreadContext(userId: string, threadId: string) {
    const thread = await this.requireThread(userId, threadId);
    const activeRun = activeRuns.get(threadId);
    if (activeRun) {
      activeRun.controller.abort();
      activeRuns.delete(threadId);
    }
    const previousContext = conversationContextFromState(thread.stateJson);
    const resetState =
      thread.scope === "goal_creation"
        ? {
            llmMessages: [],
            goalState: createInitialGoalState(),
            conversationContext: previousContext,
          }
        : { llmMessages: [], conversationContext: previousContext };
    await this.learningSpaceOrm.agentConversation.resetThreadContext(
      threadId,
      JSON.stringify(resetState),
      tBackend("status.agent.contextCleared"),
      JSON.stringify({ contextReset: true }),
    );
    clearPendingGoalDocuments(threadId);
    return { ok: true };
  }

  async deleteThread(userId: string, threadId: string) {
    await this.requireThread(userId, threadId);
    await this.goalCreationSessions.preventDedicatedThreadDelete(threadId);
    const activeRun = activeRuns.get(threadId);
    if (activeRun) {
      activeRun.controller.abort();
      activeRuns.delete(threadId);
    }
    clearPendingGoalDocuments(threadId);
    await this.learningSpaceOrm.agentConversation.deleteThread(threadId);
    return { ok: true };
  }

  private buildCtx(
    userId: string,
    threadId: string,
    traceId: string,
    send: (event: AgentSseEvent) => void,
    signal: AbortSignal,
  ): AgentRunContext {
    return {
      userId,
      threadId,
      traceId,
      signal,
      send: async (event) => {
        await this.goalCreationSessions
          .appendEventForThread(threadId, event)
          .catch(() => {});
        const activeRun = activeRuns.get(threadId);
        if (activeRun) rememberActiveRunEvent(activeRun, event);
        send(event);
      },
    };
  }

  private async requireThread(userId: string, threadId: string) {
    const thread =
      await this.learningSpaceOrm.agentConversation.findThread(threadId);
    if (!thread) {
      throw new NotFoundException(tBackend("error.agent.threadNotFound"));
    }
    if (thread.userId !== userId) {
      throw new ForbiddenException(tBackend("error.agent.threadForbidden"));
    }
    return thread;
  }
}
