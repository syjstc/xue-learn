"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, queryKeys } from "@/shared/api";
import { getUserFacingApiErrorMessage } from "@/shared/api/user-facing-error";
import { isAuthenticated } from "@/shared/auth";
import { goalCreationSessionKeys } from "@/hooks/use-goal-creation-session";
import type { AgentClientAction } from "@/shared/agent/client-actions";
import {
  formatGoalCreationUserReply,
  GOAL_CREATION_RESET_UI_KIND,
  GOAL_CREATION_UI_KINDS,
  isGoalCreationHumanTool,
} from "@/shared/agent/goal-creation-display";
import { uploadGoalCreationDocuments } from "@/shared/agent/goal-documents";
import { shouldRetainSubmittedToolUi } from "@/shared/agent/tool-ui-submitted";
import { consumeSsePost } from "@/shared/client/consume-sse";
import type { AgentSseEvent } from "@/shared/agent/sse";
import type { GoalCreationSessionResponse } from "@/shared/agent/goal-creation-session";
import type { KnowledgeActivity } from "@xue-learn/core/domain";
import type {
  AssistantConversationContext,
  AgentMessageRecord,
  AgentMessageContextSnapshot,
  AgentPageContext,
  AgentThreadRecord,
  AgentThreadScope,
  ChatDisplayMessage,
  PendingToolUi,
} from "@/shared/agent/types";
import { orderAgentMessagesForDisplay } from "@/shared/agent/message-order";
import { translateCurrent } from "@xue-learn/core/i18n";

export type AgentSendOptions = {
  clientAction?: AgentClientAction;
  seedTopic?: string;
  documentSeed?: import("@/shared/agent/goal-documents").DocumentGoalSeed;
  isSmallCourse?: boolean;
  goalDraft?: {
    topic?: string;
    level?: "zero" | "basic" | "advanced";
    targetSpaceId?: string;
    targetSpaceItemId?: string;
  };
};

export type PlanningProgress = {
  active: boolean;
  reasoningStatus?: "requested" | "active" | "unsupported";
  reasoningProvider?: string;
  stage?:
    | "analyzing_goal"
    | "searching_web"
    | "reading_sources"
    | "cross_checking"
    | "researching_modules"
    | "sequencing_modules"
    | "revising_plan"
    | "validating_plan";
  stageMessage?: string;
  query?: {
    text: string;
    current: number;
    total: number;
    scope: "goal" | "module";
    moduleRef?: string;
  };
  module?: {
    current: number;
    total: number;
    moduleRef?: string;
    moduleTitle?: string;
    status: "queued" | "researching" | "complete" | "warning";
    sourceCount?: number;
  };
  modules?: Array<{
    moduleRef: string;
    moduleTitle: string;
    status: "queued" | "researching" | "complete" | "warning";
    sourceCount?: number;
  }>;
  outline?: {
    field: string;
    modeClarification: string;
    reusedSources: boolean;
    topicOverview?: string;
    whatYouWillLearn?: string[];
    prerequisitesAssumed?: string[];
    modules: Array<{
      moduleRef: string;
      title: string;
      objective: string;
      dependsOnPrevious: string;
      estimatedUnitCount?: number;
      scopeSize?: "compact" | "standard" | "large";
      progression?: string[];
    }>;
  };
  updates: Array<{
    id: string;
    sequence: number;
    category: "thinking" | "research" | "synthesis" | "validation";
    status: "active" | "complete";
    message: string;
    elapsedSeconds: number;
  }>;
  activities: KnowledgeActivity[];
  warnings: string[];
};

export function reducePlanningProgressEvent(
  current: PlanningProgress,
  event: AgentSseEvent,
): PlanningProgress {
  switch (event.type) {
    case "reasoning_status":
      return {
        ...current,
        active: true,
        reasoningStatus: event.status,
        reasoningProvider: event.provider,
      };
    case "planning_stage":
      return {
        ...current,
        active: true,
        stage: event.stage,
        stageMessage: event.message,
      };
    case "planning_outline":
      return {
        ...current,
        active: true,
        outline: {
          field: event.field,
          modeClarification: event.modeClarification,
          reusedSources: event.reusedSources,
          topicOverview: event.topicOverview,
          whatYouWillLearn: event.whatYouWillLearn,
          prerequisitesAssumed: event.prerequisitesAssumed,
          modules: event.modules,
        },
      };
    case "research_query":
      return {
        ...current,
        active: true,
        query: {
          text: event.query,
          current: event.current,
          total: event.total,
          scope: event.scope,
          moduleRef: event.moduleRef,
        },
      };
    case "module_research_progress": {
      const moduleRef = event.moduleRef ?? `module_${event.current + 1}`;
      const moduleTitle = event.moduleTitle ?? moduleRef;
      const modules = [...(current.modules ?? [])];
      const existingIndex = modules.findIndex(
        (module) => module.moduleRef === moduleRef,
      );
      const nextModule = {
        moduleRef,
        moduleTitle,
        status: event.status,
        sourceCount: event.sourceCount,
      };
      if (existingIndex >= 0) modules[existingIndex] = nextModule;
      else modules.push(nextModule);
      modules.sort((a, b) => a.moduleRef.localeCompare(b.moduleRef));
      return {
        ...current,
        active: true,
        module: {
          current: event.current,
          total: event.total,
          moduleRef: event.moduleRef,
          moduleTitle: event.moduleTitle,
          status: event.status,
          sourceCount: event.sourceCount,
        },
        modules,
      };
    }
    case "planning_warning":
      return {
        ...current,
        active: true,
        warnings: current.warnings.includes(event.message)
          ? current.warnings
          : [...current.warnings, event.message],
      };
    case "knowledge_activity": {
      const activities = [...current.activities];
      const existingIndex = activities.findIndex(
        (activity) => activity.id === event.activity.id,
      );
      if (existingIndex >= 0) activities[existingIndex] = event.activity;
      else activities.push(event.activity);
      return {
        ...current,
        active: true,
        // A deep plan can issue many queries. Keep enough completed work to
        // make progress tangible without retaining an unbounded SSE history.
        activities: activities.slice(-24),
      };
    }
    case "planning_activity": {
      const updates = [...current.updates];
      const existingIndex = updates.findIndex(
        (update) => update.id === event.id,
      );
      const nextUpdate = {
        id: event.id,
        sequence: event.sequence,
        category: event.category,
        status: event.status,
        message: event.message,
        elapsedSeconds: event.elapsedSeconds,
      };
      if (existingIndex >= 0) updates[existingIndex] = nextUpdate;
      else updates.push(nextUpdate);
      return { ...current, active: true, updates: updates.slice(-18) };
    }
    default:
      return current;
  }
}

type LastSend =
  | {
      kind: "message";
      text: string;
      pageContext?: AgentPageContext;
      options?: AgentSendOptions;
    }
  | {
      kind: "resume";
      toolCallId: string;
      toolName?: string;
      result: unknown;
      files?: File[];
    };

function isGoalCreationResetMarker(message: AgentMessageRecord): boolean {
  return message.uiPayload?.uiKind === GOAL_CREATION_RESET_UI_KIND;
}

function isHiddenGoalCreationHistoryMessage(
  message: AgentMessageRecord,
): boolean {
  if (message.role === "tool") return true;
  if (isGoalCreationResetMarker(message)) return false;
  if (message.role === "assistant" && message.toolCalls?.length) {
    return message.toolCalls.some((tc) => isGoalCreationHumanTool(tc.name));
  }
  if (
    message.role === "assistant" &&
    message.uiPayload?.uiKind &&
    GOAL_CREATION_UI_KINDS.has(String(message.uiPayload.uiKind))
  ) {
    return true;
  }
  return false;
}

function isInternalPlanningKnowledgeCard(
  uiKind: string,
  args: Record<string, unknown> | undefined,
): boolean {
  if (uiKind !== "knowledge_activity") return false;
  const activity = args?.activity;
  if (!activity || typeof activity !== "object" || Array.isArray(activity)) {
    return false;
  }
  const reason = String((activity as { reason?: unknown }).reason ?? "");
  return (
    [
      "为学习计划补充当前资料",
      "为学习地图和目标补充当前资料",
      "为深度学习规划精读并交叉验证权威资料",
    ].includes(reason) || reason.startsWith("为模块“")
  );
}

function filterMessagesAfterGoalCreationReset(
  serverMessages: AgentMessageRecord[],
): AgentMessageRecord[] {
  let lastResetIndex = -1;
  for (let i = serverMessages.length - 1; i >= 0; i -= 1) {
    if (isGoalCreationResetMarker(serverMessages[i]!)) {
      lastResetIndex = i;
      break;
    }
  }
  if (lastResetIndex < 0) return serverMessages;

  const kept: AgentMessageRecord[] = [];
  for (let i = 0; i < serverMessages.length; i += 1) {
    const message = serverMessages[i]!;
    if (i < lastResetIndex && isHiddenGoalCreationHistoryMessage(message)) {
      continue;
    }
    kept.push(message);
  }
  return kept;
}

export const agentQueryKeys = {
  thread: (id: string) => ["agent", "thread", id] as const,
  threads: (scope: AgentThreadScope) => ["agent", "threads", scope] as const,
  briefing: () => ["agent", "global", "briefing"] as const,
};

type AgentThreadResponse = {
  thread: {
    id: string;
    scope: AgentThreadScope;
    status: string;
    stateJson?: string;
    conversationContext?: AssistantConversationContext;
  };
  messages: AgentMessageRecord[];
  activeRun?: {
    active: true;
    events: AgentSseEvent[];
  } | null;
  page?: {
    limit: number;
    hasMore: boolean;
    oldestCursor: string | null;
    messageCount: number;
  };
};

// This is an informational response when a second request reaches a thread
// while its original run is still finishing. It is not a failed goal-creation
// run, so it must not outlive the active run that caused it.
const ACTIVE_RUN_BUSY_MESSAGE = "上一条请求还在处理中，请稍等。";

export function useAgentThread(
  threadId: string | null,
  goalCreationSessionId?: string,
) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatDisplayMessage[]>([]);
  const [pendingToolUi, setPendingToolUi] = useState<PendingToolUi | null>(
    null,
  );
  const [streaming, setStreaming] = useState(false);
  const [restoredRunActive, setRestoredRunActive] = useState(false);
  const [streamPreview, setStreamPreview] = useState("");
  const [planningProgress, setPlanningProgress] = useState<PlanningProgress>({
    active: false,
    updates: [],
    activities: [],
    warnings: [],
  });
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [phase, setPhase] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [canRetryLastSend, setCanRetryLastSend] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const planningActiveRef = useRef(false);
  const goalPlanPhaseRef = useRef(false);
  const lastSendRef = useRef<LastSend | null>(null);
  const messagesRef = useRef<ChatDisplayMessage[]>([]);
  messagesRef.current = messages;

  useEffect(() => {
    setMessages([]);
    setPendingToolUi(null);
    setStreaming(false);
    setRestoredRunActive(false);
    setLoadingOlderMessages(false);
    setStreamPreview("");
    setPlanningProgress({
      active: false,
      updates: [],
      activities: [],
      warnings: [],
    });
    planningActiveRef.current = false;
    goalPlanPhaseRef.current = false;
    setPhase("");
    setStatus("");
    setError("");
    setCanRetryLastSend(false);
  }, [threadId]);

  const threadQuery = useQuery({
    queryKey: agentQueryKeys.thread(threadId ?? ""),
    queryFn: async () => {
      const data = await apiGet<AgentThreadResponse>(
        `/api/agent/threads/${threadId}?limit=20`,
      );
      return data;
    },
    enabled: Boolean(threadId),
    refetchInterval: (query) =>
      query.state.data?.activeRun?.active ? 1500 : false,
  });

  const hydrateFromServer = useCallback(
    (
      serverMessages: AgentMessageRecord[],
      stateJson?: string,
      activeRun?: AgentThreadResponse["activeRun"],
    ) => {
      const visibleMessages = orderAgentMessagesForDisplay(
        filterMessagesAfterGoalCreationReset(serverMessages),
      );
      const display: ChatDisplayMessage[] = [];
      const toolSubmissions = new Map<string, Record<string, unknown>>();

      for (const m of visibleMessages) {
        if (
          m.role === "tool" &&
          m.toolCallId &&
          m.uiPayload &&
          Object.keys(m.uiPayload).length > 0
        ) {
          toolSubmissions.set(m.toolCallId, m.uiPayload);
        }
      }

      for (const m of visibleMessages) {
        // role "tool" is LLM transcript only (tool results, etc.) — never shown.
        if (m.role === "user" || m.role === "system") {
          const contextSnapshot = m.metadata?.contextSnapshot as
            AgentMessageContextSnapshot | undefined;
          display.push({
            id: m.id,
            role: m.role === "system" ? "system" : "user",
            content: m.content,
            contextSnapshot: m.role === "user" ? contextSnapshot : undefined,
          });
          continue;
        }

        if (m.role === "assistant") {
          const uiKind = String(m.uiPayload?.uiKind ?? "");
          const persistedToolCall = m.toolCalls?.[0];
          const payloadToolCallId = String(
            m.uiPayload?.toolCallId ?? persistedToolCall?.id ?? "",
          );
          const payloadToolName = String(
            m.uiPayload?.toolName ?? persistedToolCall?.name ?? "",
          );
          const toolUi =
            payloadToolCallId && uiKind
              ? {
                  toolCallId: payloadToolCallId,
                  toolName: payloadToolName,
                  uiKind,
                  args:
                    (m.uiPayload?.args as Record<string, unknown>) ??
                    persistedToolCall?.args ??
                    {},
                  submitted: toolSubmissions.get(payloadToolCallId),
                }
              : undefined;
          if (
            toolUi &&
            isInternalPlanningKnowledgeCard(toolUi.uiKind, toolUi.args)
          ) {
            continue;
          }
          // Keep streamed prose on the same turn as the tool card (onboarding-style).
          if (m.content?.trim() || toolUi) {
            display.push({
              id: m.id,
              role: "assistant",
              content: m.content ?? "",
              toolUi,
            });
          }
        }
      }

      let pending: PendingToolUi | null = null;
      if (stateJson) {
        try {
          const checkpoint = JSON.parse(stateJson) as {
            pendingInterrupt?: {
              toolCallId: string;
              toolName: string;
              uiKind: string;
              args: Record<string, unknown>;
            } | null;
            goalState?: {
              mapPlan?: Record<string, unknown> | null;
            };
          };
          const interrupt = checkpoint.pendingInterrupt;
          if (interrupt?.toolCallId && interrupt.uiKind) {
            const args = {
              ...(interrupt.args ?? {}),
              ...(interrupt.uiKind === "plan_editor" &&
              !interrupt.args?.plan &&
              checkpoint.goalState?.mapPlan
                ? { plan: checkpoint.goalState.mapPlan }
                : {}),
            };
            pending = {
              toolCallId: interrupt.toolCallId,
              toolName: interrupt.toolName,
              uiKind: interrupt.uiKind,
              args,
            };
            const alreadyShown = display.find(
              (m) => m.toolUi?.toolCallId === interrupt.toolCallId,
            );
            if (alreadyShown?.toolUi) {
              alreadyShown.toolUi = {
                ...alreadyShown.toolUi,
                args,
              };
            }
            if (!alreadyShown) {
              display.push({
                id: `tool-${interrupt.toolCallId}`,
                role: "assistant",
                content: "",
                toolUi: {
                  ...pending,
                  submitted: toolSubmissions.get(interrupt.toolCallId),
                },
              });
            }
          }
        } catch {
          // ignore malformed checkpoint
        }
      }

      const activePendingId = pending?.toolCallId;
      const latestActionId = [...display]
        .reverse()
        .find(
          (m) =>
            m.toolUi &&
            !m.toolUi.submitted &&
            !isGoalCreationHumanTool(m.toolUi.toolName),
        )?.toolUi?.toolCallId;
      const activeToolUiId = activePendingId ?? latestActionId;
      const normalizedDisplay = display
        .filter((m) => {
          if (!m.toolUi) return true;
          if (shouldRetainSubmittedToolUi(m.toolUi.uiKind)) return true;
          if (m.toolUi.submitted) {
            return (
              shouldRetainSubmittedToolUi(m.toolUi.uiKind) ||
              Boolean(m.content.trim())
            );
          }
          return m.toolUi.toolCallId === activeToolUiId;
        })
        .map((m) => {
          if (!m.toolUi?.submitted) return m;
          if (shouldRetainSubmittedToolUi(m.toolUi.uiKind)) return m;
          return { ...m, toolUi: undefined };
        });

      setMessages(normalizedDisplay);
      setPendingToolUi(pending);

      const restoredProgress = (activeRun?.events ?? []).reduce(
        (current, event) => {
          if (event.type === "knowledge_activity" && !current.active) {
            return current;
          }
          return reducePlanningProgressEvent(current, event);
        },
        {
          active: false,
          updates: [],
          activities: [],
          warnings: [],
        } as PlanningProgress,
      );
      const restoredPhase = [...(activeRun?.events ?? [])]
        .reverse()
        .find((event) => event.type === "phase");
      const restoredStatus = [...(activeRun?.events ?? [])]
        .reverse()
        .find((event) => event.type === "status");
      setRestoredRunActive(Boolean(activeRun?.active));
      if (!activeRun?.active) {
        setError((current) =>
          current === ACTIVE_RUN_BUSY_MESSAGE ? "" : current,
        );
      }
      setPlanningProgress(restoredProgress);
      planningActiveRef.current = restoredProgress.active;
      goalPlanPhaseRef.current =
        restoredPhase?.type === "phase" &&
        restoredPhase.phase === "generating_plan";
      setPhase(restoredPhase?.type === "phase" ? restoredPhase.phase : "");
      setStatus(
        restoredStatus?.type === "status" ? restoredStatus.message : "",
      );
    },
    [],
  );

  const handleEvent = useCallback(
    (event: AgentSseEvent, assistantMsgId: string) => {
      if (event.type === "message") {
        setMessages((prev) => {
          const existing = prev.find((m) => m.id === assistantMsgId);
          if (existing) {
            return prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: m.content + event.delta,
                    streaming: true,
                    thinking: false,
                  }
                : m,
            );
          }
          return [
            ...prev,
            {
              id: assistantMsgId,
              role: "assistant" as const,
              content: event.delta,
              streaming: true,
              thinking: false,
            },
          ];
        });
      }
      if (event.type === "thinking") {
        setMessages((prev) => {
          const existing = prev.find((m) => m.id === assistantMsgId);
          if (existing) {
            return prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    streaming: true,
                    thinking: true,
                    thinkingContent: (
                      (m.thinkingContent ?? "") + (event.delta ?? "")
                    ).slice(-12000),
                  }
                : m,
            );
          }
          return [
            ...prev,
            {
              id: assistantMsgId,
              role: "assistant" as const,
              content: "",
              streaming: true,
              thinking: true,
              thinkingContent: (event.delta ?? "").slice(-12000),
            },
          ];
        });
      }
      if (event.type === "reasoning_status") {
        planningActiveRef.current = true;
        setPlanningProgress((current) =>
          reducePlanningProgressEvent(current, event),
        );
      }
      if (event.type === "planning_activity") {
        planningActiveRef.current = true;
        setPlanningProgress((current) =>
          reducePlanningProgressEvent(current, event),
        );
      }
      if (event.type === "planning_stage") {
        planningActiveRef.current = true;
        setPlanningProgress((current) =>
          reducePlanningProgressEvent(current, event),
        );
      }
      if (event.type === "planning_outline") {
        planningActiveRef.current = true;
        setPlanningProgress((current) =>
          reducePlanningProgressEvent(current, event),
        );
      }
      if (event.type === "research_query") {
        planningActiveRef.current = true;
        setPlanningProgress((current) =>
          reducePlanningProgressEvent(current, event),
        );
      }
      if (event.type === "module_research_progress") {
        setPlanningProgress((current) =>
          reducePlanningProgressEvent(current, event),
        );
      }
      if (event.type === "planning_warning") {
        setPlanningProgress((current) =>
          reducePlanningProgressEvent(current, event),
        );
      }
      if (event.type === "knowledge_activity") {
        // Goal planning can run many goal- and module-scoped searches. Their
        // live state belongs in the single planning progress card; rendering
        // each query as a full assistant tool card makes the planner appear
        // blocked and floods the thread. Standalone searches still arrive as
        // tool_ui events and retain their normal source card.
        if (planningActiveRef.current) {
          setPlanningProgress((current) =>
            reducePlanningProgressEvent(current, event),
          );
        } else if (goalPlanPhaseRef.current) {
          // Fast and docs-first planning can still look up supporting context,
          // but that does not make them deep-planning runs. Keep those
          // internal lookups out of the assistant tool-card lane.
        } else {
          setPendingToolUi({
            toolCallId: event.activity.id,
            toolName: "search_web_knowledge",
            uiKind: "knowledge_activity",
            args: { activity: event.activity },
          });
        }
      }
      if (event.type === "tool_ui") {
        setStreamPreview("");
        setPendingToolUi({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          uiKind: event.uiKind,
          args: event.args,
        });
        setMessages((prev) => {
          const toolUi = {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            uiKind: event.uiKind,
            args: event.args,
          };
          const withoutStalePending = prev.filter((m) => {
            if (m.toolUi?.submitted) {
              return (
                shouldRetainSubmittedToolUi(m.toolUi.uiKind) ||
                Boolean(m.content.trim())
              );
            }
            if (!m.toolUi) return true;
            if (m.toolUi.toolCallId === event.toolCallId) return true;
            return !isGoalCreationHumanTool(m.toolUi.toolName);
          });
          const alreadyShown = withoutStalePending.some(
            (m) => m.toolUi?.toolCallId === event.toolCallId,
          );
          if (alreadyShown) {
            return withoutStalePending.map((m) =>
              m.id === assistantMsgId
                ? { ...m, streaming: false, thinking: false }
                : m,
            );
          }
          // Attach the card to the streamed assistant turn so prose stays visible.
          const host = withoutStalePending.find((m) => m.id === assistantMsgId);
          if (host) {
            return withoutStalePending.map((m) =>
              m.id === assistantMsgId
                ? { ...m, streaming: false, thinking: false, toolUi }
                : m,
            );
          }
          return [
            ...withoutStalePending,
            {
              id: assistantMsgId,
              role: "assistant" as const,
              content: "",
              toolUi,
            },
          ];
        });
      }
      if (event.type === "token") {
        // Goal planning streams structured JSON. Keep enough of the prefix for
        // the JIT preview to retain earlier domain/outcome sections as modules
        // arrive, while still bounding memory for other structured generations.
        setStreamPreview((prev) => (prev + event.delta).slice(-24000));
      }
      if (event.type === "tool_call") {
        if (event.status === "started") {
          setStreamPreview("");
        }
        if (event.status === "completed" || event.status === "error") {
          setStreamPreview("");
        }
      }
      if (event.type === "phase") {
        setPhase(event.phase);
        goalPlanPhaseRef.current = event.phase === "generating_plan";
        if (event.phase === "generating_plan") {
          planningActiveRef.current = true;
          setPlanningProgress((current) => ({
            ...current,
            active: true,
          }));
        }
      }
      if (event.type === "subagent" && event.name === "global") {
        goalPlanPhaseRef.current = false;
        setPhase("");
        setPendingToolUi(null);
      }
      if (event.type === "status") {
        setStatus(event.message);
        if (
          goalPlanPhaseRef.current ||
          event.phase === "plan" ||
          event.phase === "generating_plan"
        ) {
          planningActiveRef.current = true;
          setPlanningProgress((current) => ({
            ...current,
            active: true,
            stageMessage: event.message,
          }));
        }
        if (event.phase === "goal_creation") {
          if (event.reset) {
            setPendingToolUi(null);
          }
          if (threadId) {
            void queryClient.refetchQueries({
              queryKey: agentQueryKeys.thread(threadId),
            });
          }
        }
      }
      if (event.type === "done") {
        const context = threadId
          ? queryClient.getQueryData<AgentThreadResponse>(
              agentQueryKeys.thread(threadId),
            )?.thread.conversationContext
          : undefined;
        if (context?.kind === "material_follow_up")
          void queryClient.invalidateQueries({
            queryKey: queryKeys.units.followUps(context.unitId),
          });
        planningActiveRef.current = false;
        goalPlanPhaseRef.current = false;
        setPendingToolUi(null);
        setStreamPreview("");
        setStatus("");
        setPlanningProgress({
          active: false,
          updates: [],
          activities: [],
          warnings: [],
        });
        setMessages((prev) =>
          prev.map((m) => ({ ...m, streaming: false, thinking: false })),
        );
        if (typeof event.goalId === "string") {
          void queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
          void queryClient.invalidateQueries({
            queryKey: queryKeys.agenda.all,
          });
        }
      }
      if (event.type === "error") {
        planningActiveRef.current = false;
        goalPlanPhaseRef.current = false;
        setError(event.message);
      }
    },
    [queryClient, threadId],
  );

  const runSse = useCallback(
    async (
      url: string,
      body: Record<string, unknown>,
      assistantMsgId: string,
    ) => {
      setStreaming(true);
      setRestoredRunActive(false);
      setError("");
      setStreamPreview("");
      setStatus("");
      setPlanningProgress({
        active: false,
        updates: [],
        activities: [],
        warnings: [],
      });
      planningActiveRef.current = false;
      goalPlanPhaseRef.current = false;
      const ac = new AbortController();
      abortRef.current = ac;
      let done = null as Awaited<ReturnType<typeof consumeSsePost>>;

      try {
        done = await consumeSsePost(
          url,
          body,
          (event) => handleEvent(event as AgentSseEvent, assistantMsgId),
          ac.signal,
        );
      } catch (e) {
        setError(
          getUserFacingApiErrorMessage(
            e,
            e instanceof Error ? e.message : undefined,
          ),
        );
        setStreamPreview("");
        setStatus("");
        setMessages((prev) =>
          prev.map((m) => ({ ...m, streaming: false, thinking: false })),
        );
        return null;
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
      if (threadId) {
        await queryClient.refetchQueries(
          { queryKey: agentQueryKeys.thread(threadId) },
          { cancelRefetch: true },
        );
        await queryClient.invalidateQueries({
          queryKey: agentQueryKeys.threads("global"),
        });
      }
      return done;
    },
    [handleEvent, queryClient, threadId],
  );

  const loadOlderMessages = useCallback(async () => {
    if (!threadId || streaming || loadingOlderMessages) return;
    const current = queryClient.getQueryData<AgentThreadResponse>(
      agentQueryKeys.thread(threadId),
    );
    const cursor =
      current?.page?.oldestCursor ?? current?.messages[0]?.createdAt;
    if (!cursor || current?.page?.hasMore === false) return;
    setLoadingOlderMessages(true);
    try {
      const older = await apiGet<AgentThreadResponse>(
        `/api/agent/threads/${threadId}?limit=20&before=${encodeURIComponent(cursor)}`,
      );
      queryClient.setQueryData<AgentThreadResponse>(
        agentQueryKeys.thread(threadId),
        (old) => {
          if (!old) return older;
          const seen = new Set(old.messages.map((m) => m.id));
          const prepend = older.messages.filter((m) => !seen.has(m.id));
          const merged = {
            ...old,
            messages: [...prepend, ...old.messages],
            page: {
              limit: old.page?.limit ?? older.page?.limit ?? 20,
              hasMore: older.page?.hasMore ?? false,
              oldestCursor:
                older.page?.oldestCursor ?? old.page?.oldestCursor ?? null,
              messageCount:
                older.page?.messageCount ??
                old.page?.messageCount ??
                old.messages.length,
            },
          };
          hydrateFromServer(
            merged.messages,
            merged.thread.stateJson,
            merged.activeRun,
          );
          return merged;
        },
      );
    } finally {
      setLoadingOlderMessages(false);
    }
  }, [
    hydrateFromServer,
    loadingOlderMessages,
    queryClient,
    streaming,
    threadId,
  ]);

  const sendMessage = useCallback(
    async (
      text: string,
      pageContext?: AgentPageContext,
      options?: AgentSendOptions,
    ) => {
      if (!threadId || !text.trim()) return null;
      const trimmed = text.trim();
      lastSendRef.current = {
        kind: "message",
        text: trimmed,
        pageContext,
        options,
      };
      setCanRetryLastSend(true);
      const userMsg: ChatDisplayMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: trimmed,
        contextSnapshot: pageContext
          ? {
              pageKind: pageContext.pageKind,
              contextLabel: pageContext.contextLabel,
              goalId: pageContext.goalId,
              unitId: pageContext.unitId,
              focusUnitId: pageContext.focusUnitId,
              currentStep: pageContext.frontendState?.currentStep,
              selectedText: pageContext.frontendState?.selectedText
                ?.trim()
                .slice(0, 240),
            }
          : undefined,
      };
      setMessages((prev) => {
        const withSubmitted = prev.map((m) => {
          if (m.toolUi?.uiKind !== "text_input" || m.toolUi.submitted) return m;
          return {
            ...m,
            toolUi: {
              ...m.toolUi,
              submitted: { answer: trimmed, userResponse: trimmed },
            },
          };
        });
        return [...withSubmitted, userMsg];
      });
      setPendingToolUi(null);
      const assistantMsgId = `assistant-${Date.now()}`;
      const commandBase = goalCreationSessionId
        ? `/api/agent/goal-creation-sessions/${encodeURIComponent(goalCreationSessionId)}`
        : `/api/agent/threads/${encodeURIComponent(threadId)}`;
      return runSse(
        `${commandBase}/message`,
        {
          message: trimmed,
          pageContext,
          clientAction: options?.clientAction,
          seedTopic: options?.seedTopic,
          documentSeed: options?.documentSeed,
          isSmallCourse: options?.isSmallCourse,
          goalDraft: options?.goalDraft,
        },
        assistantMsgId,
      );
    },
    [goalCreationSessionId, runSse, threadId],
  );

  const resumeTool = useCallback(
    async (toolCallId: string, result: unknown, files?: File[]) => {
      if (!threadId) return null;
      const toolMsg = messagesRef.current.find(
        (m) => m.toolUi?.toolCallId === toolCallId,
      );
      const previousSend = lastSendRef.current;
      const toolName =
        toolMsg?.toolUi?.toolName ??
        (pendingToolUi?.toolCallId === toolCallId
          ? pendingToolUi.toolName
          : undefined) ??
        (previousSend?.kind === "resume" &&
        previousSend.toolCallId === toolCallId
          ? previousSend.toolName
          : undefined) ??
        "";
      lastSendRef.current = {
        kind: "resume",
        toolCallId,
        toolName,
        result,
        files,
      };
      setCanRetryLastSend(true);
      try {
        const action =
          typeof result === "object" && result !== null
            ? String((result as Record<string, unknown>).action ?? "")
            : "";
        const shouldRefreshLearningSpaces =
          (toolName === "propose_learning_space_organization" &&
            action === "apply") ||
          (toolName === "review_goal_scope" &&
            (action === "apply_roadmap" || action === "open_existing"));
        const userDisplay = isGoalCreationHumanTool(toolName)
          ? formatGoalCreationUserReply(toolName, result, toolMsg?.toolUi?.args)
          : null;
        if (toolName === "collect_form" && files && files.length > 0) {
          await uploadGoalCreationDocuments(
            threadId,
            files,
            goalCreationSessionId,
          );
        }

        setMessages((prev) =>
          prev
            .map((m) => {
              if (m.toolUi?.toolCallId !== toolCallId) return m;
              if (shouldRetainSubmittedToolUi(m.toolUi.uiKind)) {
                const submitted =
                  typeof result === "object" && result
                    ? (result as Record<string, unknown>)
                    : { value: result };
                return {
                  ...m,
                  streaming: false,
                  toolUi: { ...m.toolUi, submitted },
                };
              }
              return { ...m, toolUi: undefined, streaming: false };
            })
            .filter((m) => Boolean(m.content.trim()) || Boolean(m.toolUi))
            .concat(
              userDisplay
                ? [
                    {
                      id: `user-${Date.now()}`,
                      role: "user" as const,
                      content: userDisplay,
                    },
                  ]
                : [],
            ),
        );
        setPendingToolUi(null);
        const assistantMsgId = `assistant-${Date.now()}`;
        const commandBase = goalCreationSessionId
          ? `/api/agent/goal-creation-sessions/${encodeURIComponent(goalCreationSessionId)}`
          : `/api/agent/threads/${encodeURIComponent(threadId)}`;
        const donePromise = runSse(
          goalCreationSessionId
            ? `${commandBase}/resume-interaction`
            : `${commandBase}/resume`,
          { toolCallId, result },
          assistantMsgId,
        );
        const revisingPlan =
          toolName === "review_plan" &&
          typeof result === "object" &&
          result !== null &&
          (result as { approved?: boolean }).approved === false &&
          typeof (result as { feedback?: unknown }).feedback === "string" &&
          Boolean((result as { feedback: string }).feedback.trim());
        if (revisingPlan) {
          const message = translateCurrent("planning.revising");
          goalPlanPhaseRef.current = true;
          planningActiveRef.current = true;
          setPhase("generating_plan");
          setStatus(message);
          setPlanningProgress({
            active: true,
            stage: "revising_plan",
            stageMessage: message,
            updates: [],
            activities: [],
            warnings: [],
          });
        }
        if (
          revisingPlan ||
          (toolName === "show_confirmation" &&
            typeof result === "object" &&
            result &&
            (result as { approved?: boolean }).approved)
        ) {
          queryClient.setQueriesData<GoalCreationSessionResponse>(
            { queryKey: goalCreationSessionKeys.all },
            (current) => {
              if (!current?.session) return current;
              const expectedTool = revisingPlan
                ? "review_plan"
                : "show_confirmation";
              const expectedPhase = revisingPlan
                ? "plan_review"
                : "confirmation";
              if (
                current.session.pendingInteraction?.toolName !== expectedTool &&
                current.session.phase !== expectedPhase
              ) {
                return current;
              }
              return {
                ...current,
                session: {
                  ...current.session,
                  status: "running",
                  phase: revisingPlan ? "planning" : "goal_creation",
                  pendingInteraction: null,
                },
              };
            },
          );
        }
        const done = await donePromise;
        if (shouldRefreshLearningSpaces) {
          await queryClient.invalidateQueries({
            queryKey: queryKeys.learningSpaces.all,
          });
        }
        return done;
      } catch (e) {
        setError(e instanceof Error ? e.message : "操作失败");
        return null;
      }
    },
    [goalCreationSessionId, pendingToolUi, queryClient, runSse, threadId],
  );

  const retryLastSend = useCallback(async () => {
    const last = lastSendRef.current;
    if (!last || streaming) return null;
    if (last.kind === "message") {
      return sendMessage(last.text, last.pageContext, last.options);
    }
    return resumeTool(last.toolCallId, last.result, last.files);
  }, [resumeTool, sendMessage, streaming]);

  const exitGoalCreation = useCallback(async () => {
    if (!threadId) return null;
    abortRef.current?.abort();
    if (threadId) {
      await apiPost(`/api/agent/threads/${threadId}/cancel`, {}).catch(
        () => {},
      );
    }
    setStreaming(false);
    setPendingToolUi(null);
    setPhase("");
    const assistantMsgId = `assistant-${Date.now()}`;
    return runSse(
      `/api/agent/threads/${threadId}/message`,
      {
        message: "",
        clientAction: "exit_goal_creation",
      },
      assistantMsgId,
    );
  }, [runSse, threadId]);

  const cancel = useCallback(async () => {
    abortRef.current?.abort();
    if (threadId) {
      await apiPost(`/api/agent/threads/${threadId}/cancel`, {});
    }
    setStreaming(false);
  }, [threadId]);

  const clearContext = useCallback(async () => {
    if (!threadId) return;
    abortRef.current?.abort();
    setStreaming(false);
    setPendingToolUi(null);
    setCanRetryLastSend(false);
    setError("");
    setPhase("");
    setStatus("");
    await apiPost(`/api/agent/threads/${threadId}/context/clear`, {});
    await queryClient.invalidateQueries({
      queryKey: agentQueryKeys.thread(threadId),
    });
    await queryClient.invalidateQueries({
      queryKey: agentQueryKeys.threads("global"),
    });
  }, [queryClient, threadId]);

  return {
    threadQuery,
    messages,
    setMessages,
    hydrateFromServer,
    pendingToolUi,
    streaming: streaming || restoredRunActive,
    localStreaming: streaming,
    streamPreview,
    planningProgress,
    phase,
    status,
    error,
    canRetryLastSend,
    sendMessage,
    retryLastSend,
    resumeTool,
    cancel,
    exitGoalCreation,
    clearContext,
    loadOlderMessages,
    loadingOlderMessages,
    hasOlderMessages: Boolean(threadQuery.data?.page?.hasMore),
  };
}

export async function createAgentThread(
  scope: AgentThreadScope,
  scopeId?: string,
  options?: {
    fresh?: boolean;
    conversationContext?: AssistantConversationContext;
  },
) {
  return apiPost<{ threadId: string }>("/api/agent/threads", {
    scope,
    scopeId,
    fresh: options?.fresh,
    conversationContext: options?.conversationContext,
  });
}

export async function deleteAgentThread(threadId: string) {
  return apiDelete<{ ok: true }>(
    `/api/agent/threads/${encodeURIComponent(threadId)}`,
  );
}

export function useAgentThreadList(scope: AgentThreadScope) {
  return useQuery({
    queryKey: agentQueryKeys.threads(scope),
    queryFn: () =>
      apiGet<{ threads: AgentThreadRecord[] }>(
        `/api/agent/threads?scope=${encodeURIComponent(scope)}`,
      ),
    enabled: scope === "global" || scope === "unit" || scope === "goal",
  });
}

export function useGlobalBriefing() {
  return useQuery({
    queryKey: agentQueryKeys.briefing(),
    queryFn: () =>
      apiGet<{
        dueCount: number;
        flashcardDueCount: number;
        activeGoalCount: number;
      }>("/api/agent/threads/global/briefing"),
    enabled: isAuthenticated(),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}
