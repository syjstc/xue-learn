"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, queryKeys } from "@/shared/api";
import { consumeSsePost } from "@/shared/client/consume-sse";
import {
  anchorId,
  parseFollowUpMessages,
  type FollowUpMessage,
  type MaterialAnchor,
  type MaterialFollowUpRecord,
} from "@xue-learn/core/source/src/shared/domain/material-anchor.ts";
import type { LearningMaterialContent } from "@xue-learn/core/source/src/shared/llm/schemas.ts";
import {
  createFollowUpPanelState,
  createFollowUpRequestLifecycle,
  reduceFollowUpPanelState,
} from "@/shared/domain/follow-up-panel-state";

import type { PendingToolUi } from "@/shared/agent/types";
import type { KnowledgeActivity } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

export type FollowUpStreamState = {
  messages: FollowUpMessage[];
  assistantContent: string;
  thinking?: boolean;
  pendingToolUi?: PendingToolUi;
  knowledgeActivity?: KnowledgeActivity;
};

export function useMaterialFollowUps(
  unitId: string,
  options?: {
    onMaterialChange?: (material: LearningMaterialContent) => void;
    onMaterialCommitted?: () => void | Promise<void>;
    enabled?: boolean;
  },
) {
  const t = useT();
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [panelState, dispatchPanel] = useReducer(
    reduceFollowUpPanelState<MaterialAnchor, FollowUpStreamState>,
    undefined,
    createFollowUpPanelState<MaterialAnchor, FollowUpStreamState>,
  );
  const { panelOpen, activeAnchor, streamState } = panelState;
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [chatFocusNonce, setChatFocusNonce] = useState(0);
  const requestLifecycleRef = useRef(createFollowUpRequestLifecycle());
  useEffect(() => {
    return () => {
      requestLifecycleRef.current.abortActive();
    };
  }, [unitId]);

  const threadsQuery = useQuery({
    queryKey: queryKeys.units.followUps(unitId),
    queryFn: async () => {
      const data = await apiGet<{ threads?: MaterialFollowUpRecord[] }>(
        `/api/units/${unitId}/follow-ups`,
      );
      return data.threads ?? [];
    },
    enabled: Boolean(unitId) && options?.enabled !== false,
  });
  const threads = useMemo(() => threadsQuery.data ?? [], [threadsQuery.data]);
  const loading = threadsQuery.isPending;

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.units.followUps(unitId),
    });
  }, [queryClient, unitId]);

  const openAnchor = useCallback(
    (anchor: MaterialAnchor, threadId?: string | null) => {
      dispatchPanel({ type: "open-anchor", anchor });
      setActiveThreadId(threadId ?? null);
      setError("");
      setChatFocusNonce((n) => n + 1);
    },
    [],
  );

  const sendMessageForAnchor = useCallback(
    async (
      anchor: MaterialAnchor,
      message: string,
      threadId?: string | null,
      context?: {
        quotedText?: string;
        learningPosition?: import("@xue-learn/core/source/libs/domain/src/index.ts").LearningPosition;
        activeVisitId?: string;
      },
    ): Promise<boolean> => {
      const text = message.trim();
      if (!text || sendingRef.current) return false;
      sendingRef.current = true;

      const history = threadId
        ? (threads.find((t) => t.id === threadId)?.messages ?? [])
        : [];

      const userMsg: FollowUpMessage = {
        role: "user",
        content: text,
        ...(context?.quotedText ? { quotedText: context.quotedText } : {}),
        createdAt: new Date().toISOString(),
      };

      dispatchPanel({
        type: "set-stream",
        streamState: {
          messages: [...history, userMsg],
          assistantContent: "",
        },
      });
      setSending(true);
      setError("");

      const ac = new AbortController();
      requestLifecycleRef.current.register(ac);

      try {
        const done = await consumeSsePost(
          `/api/units/${unitId}/follow-ups/stream`,
          {
            anchor,
            message: text,
            threadId: threadId ?? undefined,
            ...context,
          },
          (event) => {
            // The dedicated endpoint emits `token`; unified assistant threads
            // emit `message`. Accept both so follow-up prose is never held
            // until the terminal payload when routes are shared or migrated.
            if (event.type === "token" || event.type === "message") {
              dispatchPanel({
                type: "update-stream",
                update: (prev) =>
                  prev
                    ? {
                        ...prev,
                        assistantContent: prev.assistantContent + event.delta,
                        thinking: false,
                      }
                    : null,
              });
              return;
            }
            if (event.type === "thinking") {
              dispatchPanel({
                type: "update-stream",
                update: (prev) =>
                  prev
                    ? {
                        ...prev,
                        thinking: true,
                      }
                    : null,
              });
              return;
            }
            if (event.type === "knowledge_activity") {
              dispatchPanel({
                type: "update-stream",
                update: (prev) =>
                  prev ? { ...prev, knowledgeActivity: event.activity } : null,
              });
              return;
            }
            if (event.type === "tool_ui") {
              dispatchPanel({
                type: "update-stream",
                update: (prev) =>
                  prev
                    ? {
                        ...prev,
                        pendingToolUi: {
                          toolCallId: event.toolCallId,
                          toolName: event.toolName,
                          uiKind: event.uiKind,
                          args: event.args,
                        },
                      }
                    : null,
              });
            }
          },
          ac.signal,
        );

        if (done?.type === "done") {
          const resolvedThreadId =
            typeof done.threadId === "string" ? done.threadId : null;
          const messages = parseFollowUpMessages(done.messages);
          if (resolvedThreadId) setActiveThreadId(resolvedThreadId);
          if (messages.length > 0) {
            queryClient.setQueryData<MaterialFollowUpRecord[]>(
              queryKeys.units.followUps(unitId),
              (prev = []) => {
                const id = resolvedThreadId ?? threadId;
                if (!id) return prev;
                const next = prev.filter((t) => t.id !== id);
                const existing = prev.find((t) => t.id === id);
                next.unshift({
                  id,
                  unitId,
                  anchor,
                  messages,
                  createdAt: existing?.createdAt ?? new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                });
                return next;
              },
            );
          } else {
            await refresh();
          }
        }
        return true;
      } catch (e) {
        if (!ac.signal.aborted) {
          setError(e instanceof Error ? e.message : String(e));
        }
        return false;
      } finally {
        sendingRef.current = false;
        dispatchPanel({ type: "set-stream", streamState: null });
        setSending(false);
        requestLifecycleRef.current.release(ac);
      }
    },
    [unitId, threads, refresh, queryClient],
  );

  const sendMessage = useCallback(
    async (message: string) => {
      if (!activeAnchor) return;
      await sendMessageForAnchor(activeAnchor, message, activeThreadId);
    },
    [activeAnchor, activeThreadId, sendMessageForAnchor],
  );

  const openAnchorAndSend = useCallback(
    async (
      anchor: MaterialAnchor,
      message: string,
      threadId?: string | null,
      context?: {
        quotedText?: string;
        learningPosition?: import("@xue-learn/core/source/libs/domain/src/index.ts").LearningPosition;
        activeVisitId?: string;
      },
    ) => {
      if (sendingRef.current) return false;
      dispatchPanel({ type: "open-anchor", anchor });
      setActiveThreadId(threadId ?? null);
      setError("");
      setChatFocusNonce((n) => n + 1);
      return sendMessageForAnchor(anchor, message, threadId ?? null, context);
    },
    [sendMessageForAnchor],
  );

  const removeThread = useCallback(
    async (threadId: string) => {
      setDeletingThreadId(threadId);
      setError("");
      try {
        await apiPost(`/api/units/${unitId}/follow-ups`, {
          action: "delete",
          threadId,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "删除失败");
        return;
      } finally {
        setDeletingThreadId(null);
      }
      if (activeThreadId === threadId) {
        setActiveThreadId(null);
        dispatchPanel({ type: "reset-context" });
      }
      dispatchPanel({ type: "set-stream", streamState: null });
      await refresh();
    },
    [unitId, activeThreadId, refresh],
  );

  const anchorThreadMap = new Map<string, MaterialFollowUpRecord>();
  for (const t of threads) {
    anchorThreadMap.set(anchorId(t.anchor), t);
  }

  const activeThread =
    activeThreadId != null
      ? threads.find((t) => t.id === activeThreadId)
      : undefined;

  const displayMessages = useMemo((): FollowUpMessage[] => {
    if (streamState) {
      const msgs = [...streamState.messages];
      if (
        streamState.assistantContent ||
        streamState.pendingToolUi ||
        sending
      ) {
        msgs.push({
          role: "assistant",
          content: streamState.assistantContent,
          createdAt: new Date().toISOString(),
          thinking: streamState.thinking,
          knowledgeActivity: streamState.knowledgeActivity,
          ...(streamState.pendingToolUi
            ? { toolUi: streamState.pendingToolUi }
            : {}),
        });
      }
      return msgs;
    }
    return activeThread?.messages ?? [];
  }, [streamState, activeThread?.messages, sending]);

  const showPanel = useCallback(() => {
    dispatchPanel({ type: "show" });
  }, []);

  /** Hide the workspace without interrupting an in-flight answer. */
  const hidePanel = useCallback(() => {
    dispatchPanel({ type: "hide" });
  }, []);

  return {
    threads,
    loading,
    sending,
    panelOpen,
    deleting: deletingThreadId != null,
    deletingThreadId,
    error: error || (threadsQuery.error?.message ?? ""),
    activeAnchor,
    activeThreadId,
    activeThread,
    displayMessages,
    streamState,
    anchorThreadMap,
    chatFocusNonce,
    openAnchor,
    openAnchorAndSend,
    showPanel,
    hidePanel,
    sendMessage,
    stop: () => requestLifecycleRef.current.abortActive(),
    removeThread,
    refresh,
    setError,
  };
}
