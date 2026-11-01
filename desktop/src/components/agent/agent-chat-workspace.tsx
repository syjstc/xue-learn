"use client";
import { getCurrentUiLocale, translateCurrent } from "@xue-learn/core/i18n";

import {
  AgentChat,
  type GoalCreationLiveProgress,
} from "@/components/agent/agent-chat";
import { AgentRegistryDebug } from "@/components/agent/agent-registry-debug";
import type {
  PendingGoalStart,
  PendingMaterialFollowUp,
  PendingMicroExpand,
} from "@/components/agent/assistant-provider";
import { AiGeneratedNotice } from "@/components/ui/ai-generated-notice";
import { useTeachingPersonas } from "@/hooks/api/use-teaching-personas";
import {
  canUseAssistantThreadHistory,
  useAgentConversation,
} from "@/hooks/use-agent-conversation";
import { useConfirm } from "@/hooks/use-confirm";
import {
  goalCreationRequestFromClientAction,
  type AgentClientAction,
} from "@/shared/agent/client-actions";
import {
  analyzeGoalCreationDocuments,
  uploadGoalCreationDocuments,
  uploadGoalCreationUrls,
} from "@/shared/agent/goal-documents";
import type {
  AgentPageContext,
  AgentThreadScope,
  PendingToolUi,
} from "@/shared/agent/types";
import { FEATURE_GOAL_CREATION } from "@xue-learn/core/features";
import { useI18n } from "@xue-learn/core/i18n";
import { teachingPersonaAvatarSrc } from "@/shared/teaching-persona-avatar";
import { localizeTeachingPersonaName } from "@/shared/teaching-persona-i18n";
import { cn } from "@xue-learn/core/utils";
import {
  BookOpenText,
  Eraser,
  History,
  MessageSquare,
  MessageSquarePlus,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";

const EMPTY_HINTS: Record<AgentThreadScope, string> = {
  get global() {
    return translateCurrent(
      "desktop.copy.askAboutYourLearningGoalsOrReviewsOrSayCreate",
    );
  },
  get goal_creation() {
    return translateCurrent(
      "desktop.copy.forExampleIWantToLearnPythonDataAnalysisIn",
    );
  },
  goal: "",
  unit: "",
};

const FALLBACK_AVATAR_CODE = "xiaohui_female";

function formatThreadTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(getCurrentUiLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function threadPreview(content: string) {
  const text = content.trim().replace(/\s+/g, " ");
  return text || translateCurrent("desktop.copy.newConversation");
}

export function AgentChatWorkspace({
  variant,
  initialScope,
  initialScopeId,
  initialThreadId,
  goalCreationSessionId,
  pageContext,
  onComplete,
  onClose,
  pendingGoalStart = null,
  onPendingGoalStartConsumed,
  pendingToolUiFallback = null,
  pendingMicroExpand = null,
  onPendingMicroExpandConsumed,
  pendingContextQuestion = null,
  onPendingContextQuestionConsumed,
  pendingMaterialFollowUp = null,
  onPendingMaterialFollowUpConsumed,
  contextLabel,
  headerActions,
  surfaceActions,
  onHeaderPointerDown,
  onOpenGoalCreation,
  onResponseReady,
  readOnly = false,
  goalCreationProgress,
  className,
}: {
  variant: "page" | "panel" | "modal";
  initialScope: AgentThreadScope;
  initialScopeId?: string;
  initialThreadId?: string;
  goalCreationSessionId?: string;
  pageContext?: AgentPageContext;
  onComplete?: (result: { goalId?: string; navigateTo?: string }) => void;
  onClose?: () => void;
  pendingGoalStart?: PendingGoalStart | null;
  onPendingGoalStartConsumed?: () => void;
  pendingToolUiFallback?: PendingToolUi | null;
  pendingMicroExpand?: PendingMicroExpand | null;
  onPendingMicroExpandConsumed?: () => void;
  pendingContextQuestion?: {
    id: number;
    message: string;
    pageContext: AgentPageContext;
  } | null;
  onPendingContextQuestionConsumed?: () => void;
  pendingMaterialFollowUp?: PendingMaterialFollowUp | null;
  onPendingMaterialFollowUpConsumed?: () => void;
  contextLabel?: string;
  headerActions?: ReactNode;
  surfaceActions?: ReactNode;
  onHeaderPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onOpenGoalCreation?: (seedTopic?: string) => void;
  onResponseReady?: () => void;
  readOnly?: boolean;
  goalCreationProgress?: GoalCreationLiveProgress;
  className?: string;
}) {
  const { t } = useI18n();
  const { alert, confirm } = useConfirm();
  const [historyOpen, setHistoryOpen] = useState(false);
  const pendingFollowUpRequestRef = useRef<number | null>(null);
  const pendingFollowUpFirstMessageRef = useRef<{
    threadId: string;
    message: string;
  } | null>(null);
  const historyPopoverRef = useRef<HTMLElement>(null);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const personas = useTeachingPersonas({ goalId: pageContext?.goalId });
  const avatarCode = personas.data?.current.avatarCode ?? FALLBACK_AVATAR_CODE;
  const avatarName = localizeTeachingPersonaName(personas.data?.current, t);
  const assistantAvatarSrc = teachingPersonaAvatarSrc(avatarCode);
  const assistantAvatarAlt = t("onboarding.ai.assistantAlt", {
    name: avatarName,
  });
  const panelHeader = variant === "panel";
  const conversation = useAgentConversation({
    initialScope,
    initialScopeId,
    initialThreadId,
    goalCreationSessionId,
    pageContext,
    onComplete,
  });

  const startNewChat = useCallback(() => {
    const context = conversation.conversationContext;
    if (context.kind === "material_follow_up") {
      void conversation.createContextConversation({
        kind: "material_follow_up",
        goalId: context.goalId,
        unitId: context.unitId,
        anchor: context.anchor,
        learningPosition: context.learningPosition,
        activeVisitId: context.activeVisitId,
        anchorSnippet: context.anchorSnippet,
        contentRevision: context.contentRevision,
        unitTitle: context.unitTitle,
        goalTitle: context.goalTitle,
      });
      return;
    }
    void conversation.createNewConversation();
  }, [conversation]);

  useEffect(() => {
    if (
      !pendingMaterialFollowUp ||
      !conversation.ready ||
      conversation.streaming ||
      pendingFollowUpRequestRef.current === pendingMaterialFollowUp.requestId
    ) {
      return;
    }
    pendingFollowUpRequestRef.current = pendingMaterialFollowUp.requestId;
    if (pendingMaterialFollowUp.threadId) {
      conversation.selectThread(pendingMaterialFollowUp.threadId);
      onPendingMaterialFollowUpConsumed?.();
      return;
    }
    void conversation
      .createContextConversation({
        kind: "material_follow_up",
        goalId: pendingMaterialFollowUp.goalId,
        unitId: pendingMaterialFollowUp.unitId,
        anchor: pendingMaterialFollowUp.anchor,
        learningPosition: pendingMaterialFollowUp.learningPosition,
        activeVisitId: pendingMaterialFollowUp.activeVisitId,
        anchorSnippet: "",
      })
      .then((threadId) => {
        if (threadId && pendingMaterialFollowUp.initialMessage?.trim()) {
          pendingFollowUpFirstMessageRef.current = {
            threadId,
            message: pendingMaterialFollowUp.initialMessage.trim(),
          };
        }
        onPendingMaterialFollowUpConsumed?.();
      })
      .catch((error) => {
        conversation.setBootstrapError(
          error instanceof Error
            ? error.message
            : translateCurrent(
                "desktop.copy.couldNotStartAFollowUpConversation",
              ),
        );
      });
  }, [
    conversation,
    onPendingMaterialFollowUpConsumed,
    pendingMaterialFollowUp,
  ]);

  useEffect(() => {
    const pending = pendingFollowUpFirstMessageRef.current;
    if (
      !pending ||
      pending.threadId !== conversation.threadId ||
      conversation.streaming
    ) {
      return;
    }
    pendingFollowUpFirstMessageRef.current = null;
    void conversation.sendMessage(pending.message);
  }, [conversation]);
  const bootstrapRunRef = useRef(0);
  const wasStreamingRef = useRef(false);
  const startGoalCreationRef = useRef(conversation.startGoalCreation);
  const sendMessageRef = useRef(conversation.sendMessage);
  sendMessageRef.current = conversation.sendMessage;
  const setBootstrapStatusRef = useRef(conversation.setBootstrapStatus);
  const setBootstrapErrorRef = useRef(conversation.setBootstrapError);
  startGoalCreationRef.current = conversation.startGoalCreation;
  setBootstrapStatusRef.current = conversation.setBootstrapStatus;
  setBootstrapErrorRef.current = conversation.setBootstrapError;

  useEffect(() => {
    if (conversation.streaming) {
      wasStreamingRef.current = true;
      return;
    }
    if (!wasStreamingRef.current) return;
    wasStreamingRef.current = false;
    onResponseReady?.();
  }, [conversation.streaming, onResponseReady]);

  useEffect(() => {
    if (!conversation.ready || !pendingGoalStart || !conversation.threadId) {
      return;
    }
    if (!conversation.threadReady) {
      return;
    }

    const runId = ++bootstrapRunRef.current;
    const threadId = conversation.threadId;
    const goalStart = pendingGoalStart;
    const isActive = () => runId === bootstrapRunRef.current;

    void (async () => {
      try {
        const { topic, files, urls, isSmallCourse, goalDraft } = goalStart;

        if (files.length > 0 || urls.length > 0) {
          if (files.length > 0) {
            setBootstrapStatusRef.current(
              t("assistant.workspace.uploadingMaterials"),
            );
            await uploadGoalCreationDocuments(
              threadId,
              files,
              goalCreationSessionId,
            );
          }
          if (urls.length > 0) {
            setBootstrapStatusRef.current(
              t("assistant.workspace.readingUrls", { count: urls.length }),
            );
            const extracted = await uploadGoalCreationUrls(
              threadId,
              urls,
              goalCreationSessionId,
            );
            if (
              !extracted.results.some((item) => item.status === "success") &&
              files.length === 0
            ) {
              throw new Error(
                extracted.results
                  .map((item) => item.error)
                  .filter(Boolean)
                  .join("；") ||
                  translateCurrent("desktop.copy.couldNotReadTheUrl"),
              );
            }
            const urlErrors = extracted.results
              .filter((item) => item.status === "error")
              .map(
                (item) =>
                  `${item.url}：${item.error || translateCurrent("desktop.copy.couldNotRead")}`,
              );
            const urlWarnings = extracted.results
              .filter((item) => item.status === "success" && item.warning)
              .map((item) => `${item.title || item.url}：${item.warning}`);
            if (urlErrors.length > 0 || urlWarnings.length > 0) {
              setBootstrapErrorRef.current(
                [...urlErrors, ...urlWarnings].join("\n"),
              );
            }
            const successCount = extracted.results.filter(
              (item) => item.status === "success",
            ).length;
            setBootstrapStatusRef.current(
              t("assistant.workspace.writingMaterials", {
                success: successCount,
                total: urls.length,
              }),
            );
          }
          if (!isActive()) return;

          setBootstrapStatusRef.current(
            isSmallCourse
              ? t("assistant.workspace.analyzingMaterialsMicro")
              : t("assistant.workspace.analyzingMaterialsGoal"),
          );
          const analysis = await analyzeGoalCreationDocuments(
            threadId,
            goalCreationSessionId,
          );
          if (!isActive()) return;

          const seed =
            topic?.trim() ||
            analysis.refinedTitle?.trim() ||
            analysis.topic.trim();
          const message = !topic?.trim()
            ? t("desktop.i18n.learnFromMaterials", {
                topic: seed,
                files: analysis.filenames.join(", "),
              })
            : seed;
          setBootstrapStatusRef.current(
            isSmallCourse
              ? t("assistant.workspace.startingMicro")
              : t("assistant.workspace.startingGoal"),
          );
          await startGoalCreationRef.current(message, {
            documentSeed: analysis,
            isSmallCourse,
            goalDraft,
          });
        } else if (topic?.trim()) {
          await startGoalCreationRef.current(topic, {
            isSmallCourse,
            goalDraft,
          });
        }
      } catch (error) {
        if (!isActive()) return;
        setBootstrapErrorRef.current(
          error instanceof Error
            ? error.message
            : translateCurrent(
                "desktop.copy.couldNotCreateALearningGoalFromTheseMaterials",
              ),
        );
      } finally {
        if (!isActive()) return;
        setBootstrapStatusRef.current("");
        onPendingGoalStartConsumed?.();
      }
    })();
  }, [
    conversation.ready,
    conversation.threadId,
    conversation.threadReady,
    goalCreationSessionId,
    onPendingGoalStartConsumed,
    pendingGoalStart,
    t,
  ]);

  useEffect(() => {
    if (!conversation.ready || !pendingMicroExpand || !conversation.threadId) {
      return;
    }

    const runId = ++bootstrapRunRef.current;
    const isActive = () => runId === bootstrapRunRef.current;
    const expand = pendingMicroExpand;

    void (async () => {
      try {
        setBootstrapStatusRef.current(
          t("assistant.workspace.connectingAssistant"),
        );
        await sendMessageRef.current(
          t("desktop.i18n.expandMicroCourse", {
            unit: expand.unitTitle,
            goal: expand.goalTitle,
          }),
        );
      } catch (error) {
        if (!isActive()) return;
        setBootstrapErrorRef.current(
          error instanceof Error
            ? error.message
            : translateCurrent(
                "desktop.copy.couldNotStartTheMicroCourseExpansionConversation",
              ),
        );
      } finally {
        if (!isActive()) return;
        setBootstrapStatusRef.current("");
        onPendingMicroExpandConsumed?.();
      }
    })();
  }, [
    conversation.ready,
    conversation.threadId,
    onPendingMicroExpandConsumed,
    pendingMicroExpand,
    t,
  ]);

  useEffect(() => {
    if (
      !conversation.ready ||
      !pendingContextQuestion ||
      !conversation.threadId
    ) {
      return;
    }
    const runId = ++bootstrapRunRef.current;
    void sendMessageRef
      .current(pendingContextQuestion.message, {
        pageContextOverride: pendingContextQuestion.pageContext,
      })
      .finally(() => {
        if (runId !== bootstrapRunRef.current) return;
        onPendingContextQuestionConsumed?.();
      });
  }, [
    conversation.ready,
    conversation.threadId,
    onPendingContextQuestionConsumed,
    pendingContextQuestion,
  ]);

  const handleClientAction = (action: AgentClientAction) => {
    if (action === "open_goal_creation" && onOpenGoalCreation) {
      onOpenGoalCreation();
      return;
    }
    if (!FEATURE_GOAL_CREATION) {
      conversation.handleClientAction(action);
      return;
    }

    const goalCreationRequest = goalCreationRequestFromClientAction(action);
    if (goalCreationRequest) {
      if (onOpenGoalCreation) {
        onOpenGoalCreation(goalCreationRequest.options.seedTopic);
        return;
      }
      void conversation.sendMessage(
        goalCreationRequest.message,
        goalCreationRequest.options,
      );
      return;
    }

    conversation.handleClientAction(action);
  };

  const handleResume = useCallback(
    (toolCallId: string, result: unknown, files?: File[]) => {
      void conversation.resumeTool(toolCallId, result, files);
    },
    [conversation],
  );

  const handleExitGoalCreation = useCallback(() => {
    void conversation.exitGoalCreation();
  }, [conversation]);

  const isModal = variant === "modal";
  const canUseThreadHistory = canUseAssistantThreadHistory(
    initialScope,
    initialThreadId,
  );
  const sortedThreads = useMemo(
    () =>
      [...conversation.threads]
        .filter(
          (thread) => !initialScopeId || thread.scopeId === initialScopeId,
        )
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        ),
    [conversation.threads, initialScopeId],
  );

  useEffect(() => {
    if (!historyOpen) return;
    const closeHistory = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setHistoryOpen(false);
        return;
      }
      if (
        !(event.target as HTMLElement).closest(
          '[aria-controls="assistant-thread-history"]',
        ) &&
        historyPopoverRef.current &&
        !historyPopoverRef.current.contains(event.target as Node)
      ) {
        setHistoryOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeHistory);
    window.addEventListener("keydown", closeHistory);
    return () => {
      window.removeEventListener("pointerdown", closeHistory);
      window.removeEventListener("keydown", closeHistory);
    };
  }, [historyOpen]);

  if (conversation.initError) {
    return (
      <div className="rounded-xl border border-[var(--course-content-error-border)] bg-[var(--course-content-error-bg)] p-4 text-sm text-foreground">
        {conversation.initError}
      </div>
    );
  }

  if (!conversation.ready) {
    return (
      <div className="rounded-xl border border-[var(--border-200)] bg-surface p-4 text-sm text-text-secondary shadow-card">
        {conversation.bootstrapStatus ||
          (initialScope === "goal_creation"
            ? t("goalCreation.preparingWorkspace")
            : t("assistant.workspace.loading"))}
      </div>
    );
  }

  if (conversation.bootstrapError) {
    return (
      <div className="rounded-xl border border-[var(--course-content-error-border)] bg-[var(--course-content-error-bg)] p-4 text-sm text-foreground">
        {conversation.bootstrapError}
      </div>
    );
  }

  const emptyHint = EMPTY_HINTS[initialScope] || EMPTY_HINTS.global;
  const pendingToolUi =
    conversation.pendingToolUi ?? pendingToolUiFallback ?? null;
  const showAgentRegistryDebug =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("agentDebug");

  const chat = (
    <>
      {showAgentRegistryDebug ? (
        <AgentRegistryDebug registry={conversation.agentRegistry} />
      ) : null}
      <AgentChat
        messages={conversation.messages}
        pendingToolUi={pendingToolUi}
        streaming={
          conversation.streaming || Boolean(conversation.bootstrapStatus)
        }
        streamPreview={conversation.streamPreview}
        planningProgress={conversation.planningProgress}
        phase={conversation.phase}
        status={conversation.bootstrapStatus || conversation.status}
        error={conversation.error || conversation.bootstrapError}
        canRetry={conversation.canRetryLastSend}
        disabled={readOnly}
        emptyHint={
          conversation.messages.length === 0 &&
          !pendingToolUi &&
          !pendingGoalStart
            ? emptyHint
            : undefined
        }
        showWelcome={conversation.showWelcome && !pendingGoalStart}
        allowMessageQuotes={initialScope !== "goal_creation"}
        hideDeepPlanningProgress={
          initialScope === "goal_creation" || Boolean(goalCreationSessionId)
        }
        onSend={(msg, quotedText) => {
          const trimmedQuote = quotedText?.trim();
          if (!trimmedQuote) {
            void conversation.sendMessage(msg);
            return;
          }
          const currentPageContext: AgentPageContext = pageContext ?? {
            pathname: window.location.pathname,
            search: window.location.search,
            pageKind: "unknown",
          };
          void conversation.sendMessage(msg, {
            pageContextOverride: {
              ...currentPageContext,
              frontendState: {
                ...currentPageContext.frontendState,
                selectedText: trimmedQuote,
              },
            },
          });
        }}
        onResume={handleResume}
        onRetry={() => void conversation.retryLastSend()}
        onCancel={
          initialThreadId ? undefined : () => void conversation.cancel()
        }
        onLoadMore={() => conversation.loadOlderMessages()}
        hasMore={conversation.hasOlderMessages}
        loadingMore={conversation.loadingOlderMessages}
        goalCreationActive={conversation.goalCreationActive}
        onExitGoalCreation={
          initialThreadId ? undefined : handleExitGoalCreation
        }
        onCancelPlan={initialThreadId ? undefined : handleExitGoalCreation}
        onClientAction={handleClientAction}
        onNavigate={onClose}
        pageContext={pageContext}
        conversationContext={conversation.conversationContext}
        assistantAvatarSrc={assistantAvatarSrc}
        assistantAvatarAlt={assistantAvatarAlt}
        goalCreationProgress={goalCreationProgress}
      />
    </>
  );

  if (variant === "page") {
    return (
      <section
        className={cn(
          "mx-auto flex h-[calc(100vh-8rem)] min-h-[560px] max-w-5xl flex-col overflow-hidden rounded-xl border border-[var(--border-200)] bg-surface shadow-card",
          className,
        )}
      >
        <div className="border-b border-[var(--border-200)] bg-[var(--bg-50)] px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-600)]">
                {t("desktop.ui.agentChatWorkspace.aiLearningPlanner")}
              </p>
              <h1 className="mt-1 text-2xl font-semibold leading-8 text-text-primary">
                {t("desktop.ui.agentChatWorkspace.describeWhatYouWantToLearn")}
              </h1>
              <p className="mt-1 text-sm text-text-secondary">
                {t(
                  "desktop.ui.agentChatWorkspace.workWithYourAssistantToDefineA",
                )}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--course-content-border-accent)] bg-[var(--course-content-surface-accent)] px-3 py-2 text-xs font-medium text-primary">
              {t("desktop.ui.agentChatWorkspace.newGoal")}
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 bg-[var(--bg-300)] px-4 py-4 sm:px-6">
          <div className="h-full">{chat}</div>
        </div>
      </section>
    );
  }

  return (
    <div
      className={cn("relative flex min-h-0 flex-1 flex-col", className)}
      data-assistant-companion
    >
      <div
        onPointerDown={onHeaderPointerDown}
        className={cn(
          "flex min-h-0 shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5 sm:min-h-16 sm:px-4 sm:py-2",
          isModal &&
            "border-[var(--border-200)]/80 bg-[var(--bg-50)]/95 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-md",
          panelHeader
            ? "border-[var(--border-200)]/80 bg-[var(--bg-50)]/96 backdrop-blur-md"
            : null,
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
          <img
            src={assistantAvatarSrc}
            alt=""
            className="size-8 shrink-0 rounded-xl object-cover shadow-sm sm:size-9"
          />
          <div className="min-w-0">
            <h2
              className="truncate whitespace-nowrap text-[15px] font-semibold leading-tight text-[var(--text-800)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {avatarName}
            </h2>
            <p className="mt-0.5 hidden truncate whitespace-nowrap text-[11px] leading-tight text-[var(--text-400)] sm:block">
              {t("assistant.workspace.subtitle")}
            </p>
            <AiGeneratedNotice
              kind="assistant"
              className="mt-0.5 px-1.5 py-0 text-[9px] sm:mt-1 sm:px-2 sm:py-0.5 sm:text-[10px]"
            />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {canUseThreadHistory ? (
            <>
              <button
                type="button"
                onClick={() => {
                  startNewChat();
                  setHistoryOpen(false);
                }}
                disabled={conversation.streaming}
                className={cn(
                  "flex shrink-0 items-center justify-center text-[var(--text-500)] transition-colors hover:bg-primary/10 hover:text-primary disabled:pointer-events-none disabled:opacity-40",
                  panelHeader ? "size-9 rounded-xl" : "size-11 rounded-lg",
                )}
                aria-label={t("assistant.workspace.newChat")}
                title={t("assistant.workspace.newChat")}
              >
                <MessageSquarePlus className="size-[18px]" />
              </button>
              <button
                type="button"
                onClick={() => setHistoryOpen((open) => !open)}
                disabled={conversation.streaming}
                className={cn(
                  "flex shrink-0 items-center justify-center text-[var(--text-500)] transition-colors hover:bg-[var(--bg-300)] hover:text-[var(--text-700)] disabled:pointer-events-none disabled:opacity-40",
                  panelHeader ? "size-9 rounded-xl" : "size-11 rounded-lg",
                  historyOpen && "bg-[var(--bg-300)] text-[var(--text-700)]",
                )}
                aria-label={t("assistant.workspace.historyAndFollowUps")}
                title={t("assistant.workspace.historyAndFollowUps")}
                aria-expanded={historyOpen}
                aria-controls="assistant-thread-history"
              >
                <History className="size-[18px]" />
              </button>
            </>
          ) : null}
          {panelHeader ? headerActions : null}
          {!panelHeader ? surfaceActions : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className={cn(
                "flex shrink-0 items-center justify-center text-[var(--text-500)] transition-colors hover:bg-[var(--bg-300)] hover:text-[var(--text-700)]",
                panelHeader ? "size-9 rounded-xl" : "size-11 rounded-lg",
              )}
              aria-label={
                panelHeader
                  ? t("assistant.companion.collapse")
                  : t("assistant.workspace.close")
              }
              title={
                panelHeader
                  ? t("assistant.companion.collapse")
                  : t("assistant.workspace.close")
              }
            >
              <X className={panelHeader ? "size-[18px]" : "size-4"} />
            </button>
          ) : null}
        </div>
      </div>
      {conversation.conversationContext.kind === "material_follow_up" ? (
        <div className="shrink-0 border-b border-[var(--border-200)]/70 bg-[var(--bg-100)] px-3 py-2 sm:px-4">
          <div className="max-w-full rounded-xl border border-primary/15 bg-primary/[0.06] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[11px] font-semibold text-primary">
                {t("assistant.workspace.followUp")} ·{" "}
                {conversation.conversationContext.unitTitle ??
                  t("assistant.workspace.currentLearningContent")}
              </p>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-600)]">
              “
              {conversation.conversationContext.anchor.reading
                ? (conversation.conversationContext.anchor.selectedText ??
                  conversation.conversationContext.anchorSnippet)
                : conversation.conversationContext.anchorSnippet}
              ”
            </p>
          </div>
        </div>
      ) : contextLabel ? (
        <div className="shrink-0 border-b border-[var(--border-200)]/70 bg-[var(--bg-100)] px-3 py-1 sm:px-4 sm:py-2">
          <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary/[0.08] px-2 py-0.5 text-[11px] font-medium text-primary sm:px-2.5 sm:py-1">
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="truncate">
              {t("assistant.workspace.currentContext", {
                context: contextLabel,
              })}
            </span>
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col px-3 pb-3 sm:px-4 sm:pb-4",
          isModal && "bg-[var(--bg-100)]",
        )}
      >
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            isModal && "overflow-hidden bg-transparent",
          )}
        >
          {chat}
        </div>
      </div>
      {canUseThreadHistory && historyOpen ? (
        <section
          id="assistant-thread-history"
          ref={historyPopoverRef}
          aria-label={t("assistant.workspace.history")}
          className="absolute top-[3.75rem] right-3 z-20 flex max-h-[min(26rem,calc(100%-4.5rem))] w-[min(20rem,calc(100%-1.5rem))] min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border-200)]/90 bg-[var(--bg-50)]/98 shadow-[0_18px_50px_rgba(58,45,38,0.18)] backdrop-blur-xl sm:right-4"
        >
          <div className="flex h-12 shrink-0 items-center gap-1 border-b border-[var(--border-200)]/70 px-2">
            <h3 className="min-w-0 flex-1 truncate px-2 text-sm font-semibold text-foreground">
              {t("assistant.workspace.history")}
            </h3>
            <button
              type="button"
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:pointer-events-none disabled:opacity-40"
              disabled={conversation.streaming}
              onClick={() => {
                startNewChat();
                setHistoryOpen(false);
              }}
              aria-label={t("assistant.workspace.newChat")}
              title={t("assistant.workspace.newChat")}
            >
              <Plus className="size-4" />
            </button>
            {conversation.conversationContext.kind === "normal" ? (
              <button
                type="button"
                className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--bg-300)] hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                disabled={conversation.streaming || conversation.showWelcome}
                onClick={() => {
                  void (async () => {
                    const ok = await confirm({
                      title: t("assistant.workspace.clearContextTitle"),
                      description: t(
                        "assistant.workspace.clearContextDescription",
                      ),
                      confirmLabel: t(
                        "assistant.workspace.clearContextConfirm",
                      ),
                    });
                    if (!ok) return;
                    await conversation.clearConversationContext();
                    setHistoryOpen(false);
                  })();
                }}
                aria-label={t("assistant.workspace.clearContextAria")}
                title={t("assistant.workspace.clearContextTooltip")}
              >
                <Eraser className="size-4" />
              </button>
            ) : null}
            <button
              type="button"
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--bg-300)] hover:text-foreground"
              onClick={() => setHistoryOpen(false)}
              aria-label={t("assistant.workspace.closeHistory")}
              title={t("assistant.workspace.close")}
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto p-1.5">
            {sortedThreads.length === 0 && conversation.threadsLoading ? (
              <p className="px-3 py-2 text-sm text-[var(--text-400)]">
                {t("assistant.workspace.loading")}
              </p>
            ) : null}
            {sortedThreads.length === 0 && !conversation.threadsLoading ? (
              <p className="px-3 py-5 text-center text-sm text-[var(--text-400)]">
                {t("assistant.workspace.noHistory")}
              </p>
            ) : null}
            {sortedThreads.map((thread) => {
              const active = thread.id === conversation.threadId;
              const latest = thread.latestMessage;
              return (
                <div
                  key={thread.id}
                  className={cn(
                    "group relative flex w-full items-stretch rounded-lg transition-colors hover:bg-[var(--bg-300)]",
                    active &&
                      "bg-[var(--brand-500)]/[0.08] text-[var(--brand-600)] hover:bg-[var(--brand-500)]/[0.08]",
                  )}
                >
                  {active ? (
                    <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />
                  ) : null}
                  <button
                    type="button"
                    disabled={
                      conversation.streaming || Boolean(deletingThreadId)
                    }
                    onClick={() => {
                      conversation.selectThread(thread.id);
                      setHistoryOpen(false);
                    }}
                    className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-3 py-2.5 text-left disabled:pointer-events-none disabled:opacity-50"
                  >
                    {thread.conversationContext?.kind ===
                    "material_follow_up" ? (
                      <BookOpenText className="mt-0.5 size-4 shrink-0 text-primary opacity-80" />
                    ) : (
                      <MessageSquare className="mt-0.5 size-4 shrink-0 opacity-70" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {threadPreview(latest?.content ?? "")}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-[var(--text-400)]">
                        {thread.conversationContext?.kind ===
                        "material_follow_up"
                          ? t("desktop.i18n.followUpThread", {
                              title:
                                thread.conversationContext.unitTitle ??
                                t("course.learningContent"),
                            })
                          : ""}
                        {formatThreadTime(
                          latest?.createdAt ?? thread.updatedAt,
                        )}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={
                      conversation.streaming || Boolean(deletingThreadId)
                    }
                    onClick={() => {
                      void (async () => {
                        const ok = await confirm({
                          title: t("assistant.workspace.deleteThreadTitle"),
                          description: t(
                            "assistant.workspace.deleteThreadDescription",
                          ),
                          confirmLabel: t("common.delete"),
                          variant: "destructive",
                        });
                        if (!ok) return;
                        setDeletingThreadId(thread.id);
                        try {
                          await conversation.deleteConversation(thread.id);
                        } catch (error) {
                          await alert({
                            title: t("assistant.workspace.deleteThreadFailed"),
                            description:
                              error instanceof Error
                                ? error.message
                                : t("assistant.workspace.deleteThreadFailed"),
                          });
                        } finally {
                          setDeletingThreadId(null);
                        }
                      })();
                    }}
                    className="my-1.5 mr-1.5 flex w-9 shrink-0 items-center justify-center rounded-lg text-[var(--text-400)] opacity-70 transition-colors hover:bg-destructive/10 hover:text-destructive focus:opacity-100 disabled:pointer-events-none disabled:opacity-30 sm:opacity-0 sm:group-hover:opacity-100"
                    aria-label={t("assistant.workspace.deleteThread")}
                    title={t("assistant.workspace.deleteThread")}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
