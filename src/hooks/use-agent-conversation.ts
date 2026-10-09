import { currentLearningPosition, activeLearningVisitId } from "@/features/learning-trajectory/navigation";
import { isDesktopLocalRuntime } from "@xue-learn/core/client-runtime";
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { parseAgentDoneEvent } from "@/shared/agent/done-event";
import type { DocumentGoalSeed } from "@/shared/agent/goal-documents";
import {
  agentQueryKeys,
  createAgentThread,
  deleteAgentThread,
  useAgentThread,
  useAgentThreadList,
} from "@/hooks/use-agent-thread";
import { goalCreationSessionKeys } from "@/hooks/use-goal-creation-session";
import { queryKeys } from "@/shared/api";
import type { AgentClientAction } from "@/shared/agent/client-actions";
import type {
  AssistantConversationContext,
  AgentPageContext,
  AgentThreadScope,
  ChatDisplayMessage,
} from "@/shared/agent/types";
import type { AgentSseEvent } from "@/shared/agent/sse";
import { shouldApplyServerThreadSnapshot } from "@/shared/agent/thread-hydrate";

const GOAL_CREATION_PHASES = new Set([
  "parsing",
  "discovering",
  "collecting",
  "scoping",
  "confirming",
  "ingesting",
  "generating_icon",
  "generating_plan",
  "reviewing_plan",
  "decomposing",
]);

function hasConversationMessages(messages: ChatDisplayMessage[]) {
  return messages.some(
    (m) =>
      m.role === "user" ||
      (m.role === "assistant" && (m.content.trim().length > 0 || m.toolUi)),
  );
}

/**
 * Keep the shared welcome actions visible for an empty scoped unit thread.
 *
 * Hosted unit pages currently use the global assistant scope, which means
 * they render the unit-specific "ask about this lesson" welcome action. The
 * desktop runtime opts into a durable unit scope so the prompt can carry
 * authoritative local unit context; that scope must not remove the same
 * first-use affordance. Goal-scoped and goal-creation conversations have
 * their own flows and intentionally do not render this panel.
 */
export function shouldShowAssistantWelcome(
  initialScope: AgentThreadScope,
  messages: ChatDisplayMessage[],
) {
  if (initialScope !== "global" && initialScope !== "unit") return false;
  return !hasConversationMessages(messages);
}

export function canUseAssistantThreadHistory(
  initialScope: AgentThreadScope,
  initialThreadId?: string,
) {
  if (initialThreadId) return false;
  return (
    initialScope === "global" ||
    initialScope === "unit" ||
    initialScope === "goal"
  );
}

/** Material follow-ups may use the hosted global thread or a desktop-local scoped thread. */
export function supportsContextConversationScope(scope: AgentThreadScope) {
  return scope !== "goal_creation";
}

export function useAgentConversation({
  initialScope,
  initialScopeId,
  initialThreadId,
  goalCreationSessionId,
  pageContext,
  onComplete,
}: {
  initialScope: AgentThreadScope;
  initialScopeId?: string;
  initialThreadId?: string;
  goalCreationSessionId?: string;
  pageContext?: AgentPageContext;
  onComplete?: (result: { goalId?: string; navigateTo?: string }) => void;
}) {
  const [threadId, setThreadId] = useState<string | null>(
    initialThreadId ?? null,
  );
  const [ready, setReady] = useState(Boolean(initialThreadId));
  const [initError, setInitError] = useState("");
  const [bootstrapStatus, setBootstrapStatus] = useState("");
  const [bootstrapError, setBootstrapError] = useState("");
  const initRef = useRef(false);
  const localMessageCountRef = useRef(0);
  const queryClient = useQueryClient();

  const agent = useAgentThread(threadId, goalCreationSessionId);
  localMessageCountRef.current = agent.messages.length;
  const threadListQuery = useAgentThreadList(initialScope);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    if (initialThreadId) {
      setThreadId(initialThreadId);
      setReady(true);
      return;
    }
    void (async () => {
      try {
        const { threadId: id } = await createAgentThread(
          initialScope,
          initialScopeId,
        );
        setThreadId(id);
        setReady(true);
      } catch (e) {
        setInitError(e instanceof Error ? e.message : "无法创建对话");
      }
    })();
  }, [initialScope, initialScopeId, initialThreadId]);

  useEffect(() => {
    if (!initialThreadId || initialThreadId === threadId) return;
    setThreadId(initialThreadId);
    setReady(true);
  }, [initialThreadId, threadId]);

  useEffect(() => {
    if (
      !shouldApplyServerThreadSnapshot({
        localStreaming: agent.localStreaming,
        queryPending: agent.threadQuery.isPending,
        serverMessages: agent.threadQuery.data?.messages,
        localMessageCount: localMessageCountRef.current,
      })
    ) {
      return;
    }
    const serverMessages = agent.threadQuery.data?.messages;
    if (!serverMessages) return;
    agent.hydrateFromServer(
      serverMessages,
      agent.threadQuery.data?.thread.stateJson,
      agent.threadQuery.data?.activeRun,
    );
  }, [
    agent.hydrateFromServer,
    agent.localStreaming,
    agent.threadQuery.isPending,
    agent.threadQuery.dataUpdatedAt,
    agent.threadQuery.data?.messages,
    agent.threadQuery.data?.thread.stateJson,
    agent.threadQuery.data?.activeRun,
  ]);

  const showWelcome = useMemo(() => {
    return shouldShowAssistantWelcome(initialScope, agent.messages);
  }, [agent.messages, initialScope]);

  const conversationContext = useMemo<AssistantConversationContext>(() => {
    const raw = agent.threadQuery.data?.thread.stateJson;
    if (!raw) return { kind: "normal" };
    try {
      const parsed = JSON.parse(raw) as {
        conversationContext?: AssistantConversationContext;
      };
      return parsed.conversationContext?.kind === "material_follow_up"
        ? parsed.conversationContext
        : { kind: "normal" };
    } catch {
      return { kind: "normal" };
    }
  }, [agent.threadQuery.data?.thread.stateJson]);

  const handleDone = useCallback(
    (event: AgentSseEvent | null) => {
      if (event?.type === "done") {
        void queryClient.invalidateQueries({
          queryKey: goalCreationSessionKeys.all,
        });
      }
      const parsed = parseAgentDoneEvent(event);
      if (!parsed) return;
      if (parsed.navigateTo?.startsWith("/spaces")) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.learningSpaces.all,
        });
      }
      onComplete?.(parsed);
    },
    [onComplete, queryClient],
  );

  const sendMessage = useCallback(
    async (
      text: string,
      options?: {
        clientAction?: AgentClientAction;
        seedTopic?: string;
        documentSeed?: DocumentGoalSeed;
        isSmallCourse?: boolean;
        pageContextOverride?: AgentPageContext;
        goalDraft?: {
          topic?: string;
          level?: "zero" | "basic" | "advanced";
          targetSpaceId?: string;
          targetSpaceItemId?: string;
        };
      },
    ) => {
      const locationContext = conversationContext.kind === 'material_follow_up' && isDesktopLocalRuntime() ? {
        pathname: window.location.pathname, search: window.location.search, pageKind: 'unit' as const,
        unitId: conversationContext.unitId, goalId: conversationContext.goalId,
        learningPosition: currentLearningPosition(conversationContext.learningPosition), activeLearningVisitId: activeLearningVisitId(),
      } : undefined;
      const effectivePageContext =
        options?.pageContextOverride ?? locationContext ??
        (conversationContext.kind === "normal" &&
        supportsContextConversationScope(initialScope)
          ? pageContext
          : undefined);
      const done = await agent.sendMessage(
        text,
        effectivePageContext,
        options
          ? {
              clientAction: options.clientAction,
              seedTopic: options.seedTopic,
              documentSeed: options.documentSeed,
              isSmallCourse: options.isSmallCourse,
              goalDraft: options.goalDraft,
            }
          : undefined,
      );
      handleDone(done as AgentSseEvent | null);
    },
    [agent, conversationContext.kind, handleDone, initialScope, pageContext],
  );

  const startGoalCreation = useCallback(
    async (
      seedTopic: string,
      options?: {
        documentSeed?: DocumentGoalSeed;
        isSmallCourse?: boolean;
        goalDraft?: {
          topic?: string;
          level?: "zero" | "basic" | "advanced";
          targetSpaceId?: string;
          targetSpaceItemId?: string;
        };
      },
    ) => {
      const topic = seedTopic.trim();
      if (!topic) return null;
      const done = await sendMessage(topic, {
        clientAction: "start_goal_creation",
        seedTopic: topic,
        documentSeed: options?.documentSeed,
        isSmallCourse: options?.isSmallCourse,
        goalDraft: options?.goalDraft,
      });
      return done;
    },
    [sendMessage],
  );

  const resumeTool = useCallback(
    async (toolCallId: string, result: unknown, files?: File[]) => {
      const done = await agent.resumeTool(toolCallId, result, files);
      handleDone(done as AgentSseEvent | null);
    },
    [agent, handleDone],
  );

  const retryLastSend = useCallback(async () => {
    const done = await agent.retryLastSend();
    handleDone(done as AgentSseEvent | null);
  }, [agent, handleDone]);

  const handleClientAction = useCallback((_action: AgentClientAction) => {
    // Goal creation prompts are handled by AssistantProvider (static topic dialog).
  }, []);

  const clearConversationContext = useCallback(async () => {
    await agent.clearContext();
  }, [agent]);

  const exitGoalCreation = useCallback(async () => {
    const done = await agent.exitGoalCreation();
    handleDone(done as AgentSseEvent | null);
  }, [agent, handleDone]);

  const goalCreationActive = useMemo(() => {
    const raw = agent.threadQuery.data?.thread.stateJson;
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw) as {
        goalCreationActive?: boolean;
        goalCreationPaused?: boolean;
        agentRegistry?: { activeAgentId?: string };
      };
      if (parsed.goalCreationActive && !parsed.goalCreationPaused) {
        return true;
      }
      return parsed.agentRegistry?.activeAgentId === "goal_creation";
    } catch {
      return false;
    }
  }, [agent.threadQuery.data?.thread.stateJson]);

  const selectThread = useCallback(
    (id: string) => {
      if (agent.streaming || id === threadId) return;
      setBootstrapError("");
      setBootstrapStatus("");
      setThreadId(id);
      setReady(true);
    },
    [agent.streaming, threadId],
  );

  const createNewConversation = useCallback(async () => {
    if (agent.streaming) return;
    const { threadId: id } = await createAgentThread(
      initialScope,
      initialScopeId,
      { fresh: true },
    );
    setBootstrapError("");
    setBootstrapStatus("");
    setThreadId(id);
    setReady(true);
    await queryClient.invalidateQueries({
      queryKey: agentQueryKeys.threads(initialScope),
    });
  }, [agent.streaming, initialScope, initialScopeId, queryClient]);

  const createContextConversation = useCallback(
    async (conversationContext: AssistantConversationContext) => {
      if (agent.streaming || !supportsContextConversationScope(initialScope)) {
        return;
      }
      const { threadId: id } = await createAgentThread(
        initialScope,
        conversationContext.kind === "material_follow_up"
          ? conversationContext.unitId
          : initialScopeId,
        { fresh: true, conversationContext },
      );
      setBootstrapError("");
      setBootstrapStatus("");
      setThreadId(id);
      setReady(true);
      await queryClient.invalidateQueries({
        queryKey: agentQueryKeys.threads(initialScope),
      });
      return id;
    },
    [agent, initialScope, initialScopeId, queryClient],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      if (agent.streaming) return;

      await deleteAgentThread(id);

      if (id === threadId) {
        setBootstrapError("");
        setBootstrapStatus("");
        setThreadId(null);
        setReady(false);
        try {
          const { threadId: replacementId } = await createAgentThread(
            initialScope,
            initialScopeId,
          );
          setThreadId(replacementId);
          setReady(true);
        } catch (error) {
          setInitError(error instanceof Error ? error.message : "无法创建对话");
        }
      }

      await queryClient.invalidateQueries({
        queryKey: agentQueryKeys.threads(initialScope),
      });
    },
    [agent.streaming, initialScope, initialScopeId, queryClient, threadId],
  );

  return {
    ready,
    threadId,
    threadReady: agent.threadQuery.isFetched,
    initError,
    bootstrapStatus,
    bootstrapError,
    setBootstrapStatus,
    setBootstrapError,
    messages: agent.messages,
    pendingToolUi: agent.pendingToolUi,
    streaming: agent.streaming,
    streamPreview: agent.streamPreview,
    planningProgress: agent.planningProgress,
    phase: agent.phase,
    status: agent.status,
    error: agent.error,
    canRetryLastSend: agent.canRetryLastSend,
    showWelcome,
    agentRegistry: useMemo(() => {
      const raw = agent.threadQuery.data?.thread.stateJson;
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as {
          agentRegistry?: Record<string, unknown>;
        };
        return (
          (parsed.agentRegistry as Record<string, unknown> | undefined) ?? null
        );
      } catch {
        return null;
      }
    }, [agent.threadQuery.data?.thread.stateJson]),
    sendMessage,
    startGoalCreation,
    resumeTool,
    retryLastSend,
    cancel: agent.cancel,
    exitGoalCreation,
    goalCreationActive:
      goalCreationActive || GOAL_CREATION_PHASES.has(agent.phase),
    clearConversationContext,
    selectThread,
    createNewConversation,
    createContextConversation,
    deleteConversation,
    conversationContext,
    threads: threadListQuery.data?.threads ?? [],
    threadsLoading: threadListQuery.isFetching,
    refreshThreads: threadListQuery.refetch,
    loadOlderMessages: agent.loadOlderMessages,
    hasOlderMessages: agent.hasOlderMessages,
    loadingOlderMessages: agent.loadingOlderMessages,
    handleClientAction,
  };
}
