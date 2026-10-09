"use client";

import { useEffect, useRef, useState } from "react";
import { Quote, X, XCircle } from "lucide-react";
import { Button } from "@xue-learn/core/ui/button";
import { Input } from "@/components/ui/input";
import { ImeSafeForm } from "@/components/ui/ime-safe-form";
import { useImeComposition } from "@/hooks/use-ime-composition";
import type { AgentClientAction } from "@/shared/agent/client-actions";
import { GOAL_CREATION_UI_KINDS } from "@/shared/agent/goal-creation-display";
import { shouldRetainSubmittedToolUi } from "@/shared/agent/tool-ui-submitted";
import type {
  AgentPageContext,
  AssistantConversationContext,
  ChatDisplayMessage,
} from "@/shared/agent/types";
import { parsePythonAskAiMessage } from "@/components/desktop-python-editor/ask-ai";
import { PythonAskAiUserMessage } from "@/components/desktop-python-editor/python-ask-ai-message";
import { AssistantMessageBody } from "@/components/wizard/assistant-message-body";
import { cn } from "@xue-learn/core/utils";
import { useT, type TranslationKey } from "@xue-learn/core/i18n";
import { LlmLoadingStatus } from "@/components/ai/llm-loading-status";
import { AssistantWaitingPlaceholder } from "./assistant-waiting-placeholder.tsx";
import {
  AssistantReviewReminder,
  AssistantWelcomePanel,
} from "./assistant-welcome-panel.tsx";
import { GoalPlanStreamCard } from "./goal-plan-stream-card.tsx";
import { ToolUiRenderer } from "./tool-ui-renderer.tsx";
import { DeepPlanningProgress } from "./deep-planning-progress.tsx";
import { looksLikeGoalPlanStream } from "@/shared/agent/goal-plan-stream-preview";
import type { PlanningProgress } from "@/hooks/use-agent-thread";

export type GoalCreationLiveProgress = {
  active: boolean;
  phaseLabel: string;
  status: string;
  latestEvent?: string;
};

const PHASE_LABEL_KEYS: Record<string, TranslationKey> = {
  parsing: "assistant.creationPhase.intake",
  discovering: "assistant.creationPhase.intake",
  collecting: "assistant.creationPhase.intake",
  scoping: "assistant.creationPhase.goalScope",
  confirming: "assistant.creationPhase.confirmation",
  ingesting: "assistant.creationPhase.ingesting",
  generating_icon: "assistant.creationPhase.icon",
  generating_plan: "assistant.creationPhase.planning",
  reviewing_plan: "assistant.creationPhase.planReview",
  decomposing: "assistant.creationPhase.decomposing",
};

const BOTTOM_SCROLL_THRESHOLD = 48;

function isNearBottom(el: HTMLDivElement) {
  return (
    el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SCROLL_THRESHOLD
  );
}

export function AgentChat({
  messages,
  pendingToolUi,
  streaming,
  streamPreview,
  planningProgress,
  phase,
  status,
  error,
  canRetry,
  disabled,
  emptyHint,
  showWelcome,
  onSend,
  onResume,
  onRetry,
  onCancel,
  onLoadMore,
  hasMore,
  loadingMore,
  onCancelPlan,
  goalCreationActive,
  onExitGoalCreation,
  onClientAction,
  onNavigate,
  pageContext,
  conversationContext,
  assistantAvatarSrc,
  assistantAvatarAlt = "",
  allowMessageQuotes = false,
  hideDeepPlanningProgress = false,
  goalCreationProgress,
}: {
  messages: ChatDisplayMessage[];
  pendingToolUi: {
    toolCallId: string;
    toolName: string;
    uiKind: string;
    args: Record<string, unknown>;
  } | null;
  streaming: boolean;
  streamPreview?: string;
  planningProgress?: PlanningProgress;
  phase: string;
  status?: string;
  error: string;
  canRetry?: boolean;
  disabled?: boolean;
  emptyHint?: string;
  showWelcome?: boolean;
  onSend: (message: string, quotedText?: string) => void;
  onResume: (toolCallId: string, result: unknown, files?: File[]) => void;
  onRetry?: () => void;
  onCancel?: () => void;
  onLoadMore?: () => Promise<void> | void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onCancelPlan?: () => void;
  goalCreationActive?: boolean;
  onExitGoalCreation?: () => void;
  onClientAction?: (action: AgentClientAction) => void;
  onNavigate?: () => void;
  pageContext?: AgentPageContext;
  conversationContext?: AssistantConversationContext;
  assistantAvatarSrc?: string;
  assistantAvatarAlt?: string;
  allowMessageQuotes?: boolean;
  hideDeepPlanningProgress?: boolean;
  goalCreationProgress?: GoalCreationLiveProgress;
}) {
  const t = useT();
  const isFollowUp = conversationContext?.kind === "material_follow_up";
  const [draft, setDraft] = useState("");
  const [quotedSelection, setQuotedSelection] = useState<{
    messageId: string;
    text: string;
  } | null>(null);
  const [selectionAction, setSelectionAction] = useState<{
    messageId: string;
    text: string;
    left: number;
    top: number;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const restoreScrollHeightRef = useRef<number | null>(null);
  const loadingMoreRef = useRef(false);
  const shouldAutoScrollRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const lastMessageIdRef = useRef<string | null>(null);
  const { compositionProps, onEnterKeyDown } = useImeComposition();
  const phaseLabel = PHASE_LABEL_KEYS[phase]
    ? t(PHASE_LABEL_KEYS[phase])
    : t("assistant.creationStatus.processing");
  const activeToolUi =
    pendingToolUi ??
    [...messages]
      .reverse()
      .find((message) => message.toolUi && !message.toolUi.submitted)?.toolUi ??
    null;
  const toolUiWaiting =
    Boolean(goalCreationActive) &&
    activeToolUi !== null &&
    GOAL_CREATION_UI_KINDS.has(activeToolUi.uiKind) &&
    !streaming;
  const planEditorLeadMessageIds = new Set<string>();
  messages.forEach((message, index) => {
    if (message.toolUi?.uiKind !== "plan_editor") return;
    planEditorLeadMessageIds.add(message.id);
    const previous = messages[index - 1];
    if (
      previous?.role === "assistant" &&
      !previous.toolUi &&
      previous.content.trim()
    ) {
      planEditorLeadMessageIds.add(previous.id);
    }
  });
  if (
    activeToolUi?.uiKind === "plan_editor" &&
    !messages.some(
      (message) => message.toolUi?.toolCallId === activeToolUi.toolCallId,
    )
  ) {
    const previous = messages.at(-1);
    if (
      previous?.role === "assistant" &&
      !previous.toolUi &&
      previous.content.trim()
    ) {
      planEditorLeadMessageIds.add(previous.id);
    }
  }
  const goalCreationStatus =
    toolUiWaiting && activeToolUi?.uiKind !== "plan_editor"
      ? t("assistant.creationStatus.waitingAction")
      : phaseLabel;
  const hasStreamingAssistantMessage = messages.some(
    (m) => m.role === "assistant" && m.streaming,
  );
  const hasGoalPlanStreamPreview = Boolean(
    streamPreview &&
    (phase === "generating_plan" || looksLikeGoalPlanStream(streamPreview)),
  );
  const showPlanningProgress =
    !hideDeepPlanningProgress &&
    streaming &&
    (Boolean(planningProgress?.active) ||
      phase === "generating_plan" ||
      Boolean(status));
  const showReplyPlaceholder =
    streaming &&
    !hasStreamingAssistantMessage &&
    !pendingToolUi &&
    !hasGoalPlanStreamPreview &&
    !showPlanningProgress &&
    !toolUiWaiting;

  useEffect(() => {
    const lastMessage = messages.at(-1);
    if (!lastMessage || lastMessage.id === lastMessageIdRef.current) return;

    lastMessageIdRef.current = lastMessage.id;
    // Some conversations (selected-text follow-ups and assistant shortcuts) send
    // without going through this component's composer. Treat their user turn the
    // same as a local submit so its reply is kept in view.
    if (lastMessage.role === "user") {
      shouldAutoScrollRef.current = true;
    }
  }, [messages]);

  useEffect(() => {
    if (
      quotedSelection &&
      !messages.some((message) => message.id === quotedSelection.messageId)
    ) {
      setQuotedSelection(null);
    }
  }, [messages, quotedSelection]);

  useEffect(() => {
    if (!allowMessageQuotes || toolUiWaiting) {
      setSelectionAction(null);
    }
  }, [allowMessageQuotes, toolUiWaiting]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restoreScrollHeightRef.current !== null) {
      el.scrollTop = el.scrollHeight - restoreScrollHeightRef.current;
      restoreScrollHeightRef.current = null;
      loadingMoreRef.current = false;
      shouldAutoScrollRef.current = isNearBottom(el);
      lastScrollTopRef.current = el.scrollTop;
      return;
    }
    if (!shouldAutoScrollRef.current) return;
    el.scrollTop = el.scrollHeight;
    lastScrollTopRef.current = el.scrollTop;
  }, [messages, streaming, pendingToolUi, status, phase, streamPreview]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let frame: number | null = null;
    const keepLatestMessageInView = () => {
      if (
        !shouldAutoScrollRef.current ||
        loadingMoreRef.current ||
        restoreScrollHeightRef.current !== null
      ) {
        return;
      }
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        if (!shouldAutoScrollRef.current) return;
        el.scrollTop = el.scrollHeight;
        lastScrollTopRef.current = el.scrollTop;
      });
    };

    // Markdown, streamed prose, tool cards, and images can change height after
    // the message state effect above has run. Follow those layout-affecting DOM
    // updates as long as the learner has not deliberately scrolled upward.
    const observer = new MutationObserver(keepLatestMessageInView);
    observer.observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    el.addEventListener("load", keepLatestMessageInView, true);

    return () => {
      observer.disconnect();
      el.removeEventListener("load", keepLatestMessageInView, true);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (!root || !sentinel || !hasMore || !onLoadMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void loadMoreFromCurrentScroll();
      },
      { root, rootMargin: "160px 0px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  async function loadMoreFromCurrentScroll() {
    const el = scrollRef.current;
    if (
      !el ||
      !hasMore ||
      loadingMore ||
      loadingMoreRef.current ||
      !onLoadMore
    ) {
      return;
    }
    loadingMoreRef.current = true;
    restoreScrollHeightRef.current = el.scrollHeight;
    await onLoadMore();
  }

  async function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setSelectionAction(null);

    const scrollingUp = el.scrollTop < lastScrollTopRef.current;
    shouldAutoScrollRef.current =
      streaming && scrollingUp ? false : isNearBottom(el);
    lastScrollTopRef.current = el.scrollTop;

    if (el.scrollTop > BOTTOM_SCROLL_THRESHOLD) return;
    await loadMoreFromCurrentScroll();
  }

  function submit() {
    const text = draft.trim();
    if (!text || disabled || streaming) return;
    shouldAutoScrollRef.current = true;
    setDraft("");
    const quotedText = quotedSelection?.text;
    setQuotedSelection(null);
    setSelectionAction(null);
    window.getSelection()?.removeAllRanges();
    onSend(text, quotedText);
  }

  function handleMessageSelection() {
    if (!allowMessageQuotes || toolUiWaiting) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSelectionAction(null);
      return;
    }

    const anchor =
      selection.anchorNode?.nodeType === Node.TEXT_NODE
        ? selection.anchorNode.parentElement
        : (selection.anchorNode as Element | null);
    const focus =
      selection.focusNode?.nodeType === Node.TEXT_NODE
        ? selection.focusNode.parentElement
        : (selection.focusNode as Element | null);
    const anchorMessage = anchor?.closest<HTMLElement>(
      "[data-chat-message-content]",
    );
    const focusMessage = focus?.closest<HTMLElement>(
      "[data-chat-message-content]",
    );
    if (!anchorMessage || anchorMessage !== focusMessage) {
      setSelectionAction(null);
      return;
    }

    const text = selection.toString().trim().slice(0, 240);
    if (!text) {
      setSelectionAction(null);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const width = 88;
    setSelectionAction({
      messageId: anchorMessage.dataset.chatMessageContent ?? "",
      text,
      left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.left)),
      top: Math.max(8, rect.top - 44),
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!isFollowUp ? (
        <AssistantReviewReminder className="mb-2.5" onNavigate={onNavigate} />
      ) : null}
      <div
        ref={scrollRef}
        onScroll={() => void handleScroll()}
        onMouseUp={handleMessageSelection}
        className="-mx-3 min-h-0 flex-1 space-y-3 overflow-x-clip overflow-y-auto bg-transparent px-3 py-3 sm:-mx-4 sm:px-4 sm:py-4"
      >
        {hasMore ? (
          <div ref={loadMoreSentinelRef} className="flex justify-center">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={loadingMore}
              onClick={() => void loadMoreFromCurrentScroll()}
            >
              {loadingMore ? "加载中…" : "加载更早消息"}
            </Button>
          </div>
        ) : null}

        {showWelcome ? (
          <AssistantWelcomePanel
            disabled={disabled || streaming}
            onSend={onSend}
            onNavigate={onNavigate}
            pageContext={pageContext}
            conversationContext={conversationContext}
          />
        ) : messages.length === 0 && emptyHint ? (
          <div className="rounded-lg border border-dashed border-[var(--border-200)] bg-[var(--bg-100)] px-3 py-2 text-sm text-text-secondary">
            {emptyHint}
          </div>
        ) : null}

        {messages
          .filter((m) => {
            const hasVisibleText =
              !planEditorLeadMessageIds.has(m.id) &&
              (Boolean(m.content.trim()) ||
                (m.role === "assistant" && Boolean(m.streaming)));
            if (m.role !== "assistant") return true;
            if (hasVisibleText) return true;
            if (!m.toolUi) return false;
            if (shouldRetainSubmittedToolUi(m.toolUi.uiKind)) return true;
            return (
              !m.toolUi.submitted &&
              m.toolUi.toolCallId === activeToolUi?.toolCallId
            );
          })
          .map((m) => {
            const showToolUi = Boolean(
              m.toolUi &&
              (shouldRetainSubmittedToolUi(m.toolUi.uiKind) ||
                (!m.toolUi.submitted &&
                  m.toolUi.toolCallId === activeToolUi?.toolCallId)),
            );
            const showText =
              !planEditorLeadMessageIds.has(m.id) &&
              (Boolean(m.content.trim()) ||
                (m.role === "assistant" && Boolean(m.streaming)));
            const toolOnly = showToolUi && !showText;
            const pythonAskAi =
              m.role === "user" ? parsePythonAskAiMessage(m.content) : null;
            return (
              <div
                key={m.id}
                style={{
                  contentVisibility: "auto",
                  containIntrinsicSize: "auto 96px",
                }}
                className={cn(
                  "flex w-full min-w-0 max-w-full",
                  m.role === "user"
                    ? "justify-end"
                    : m.role === "system"
                      ? "justify-center"
                      : "items-start gap-2.5",
                )}
              >
                {m.role === "assistant" && assistantAvatarSrc ? (
                  <img
                    src={assistantAvatarSrc}
                    alt={assistantAvatarAlt}
                    className="size-9 shrink-0 rounded-xl object-cover shadow-sm"
                  />
                ) : null}
                <div
                  className={cn(
                    "flex min-w-0 max-w-full flex-col gap-2",
                    // User column needs a definite width so bubble max-width % resolves;
                    // otherwise CJK + w-fit/min-w-0 collapses the bubble to ~1 char.
                    m.role === "user" || toolOnly || m.role === "assistant"
                      ? "w-full max-w-[min(88%,40rem)]"
                      : "max-w-full",
                    m.role === "user" && "items-end",
                  )}
                >
                  {showText ? (
                    <div
                      data-chat-message-content={m.id}
                      className={cn(
                        "max-w-full rounded-[18px] px-3.5 py-2.5 text-[13px] leading-relaxed",
                        m.role === "user"
                          ? "w-max bg-primary text-primary-foreground shadow-sm"
                          : m.role === "system"
                            ? "mx-auto max-w-none rounded-xl border border-[var(--course-content-callout-warning-border)] bg-[var(--course-content-callout-warning-bg)] text-[var(--course-content-callout-warning-text)]"
                            : "min-w-0 w-fit rounded-none bg-transparent px-0 py-1 text-foreground shadow-none",
                      )}
                    >
                      {m.role === "user" &&
                      !pythonAskAi &&
                      m.contextSnapshot?.selectedText ? (
                        <div className="mb-2 flex max-w-sm items-start gap-1.5 rounded-lg bg-primary-foreground/10 px-2 py-1.5 text-left text-primary-foreground/80">
                          <Quote
                            className="mt-0.5 size-3 shrink-0"
                            aria-hidden
                          />
                          <p className="line-clamp-2 min-w-0 text-[10px] leading-4">
                            {m.contextSnapshot.selectedText}
                          </p>
                        </div>
                      ) : null}
                      {m.role === "assistant" ? (
                        <AssistantMessageBody
                          content={m.content}
                          showCursor={Boolean(m.streaming)}
                          thinking={m.thinking}
                          onNavigate={onNavigate}
                          variant="compact"
                        />
                      ) : pythonAskAi ? (
                        <PythonAskAiUserMessage payload={pythonAskAi} />
                      ) : (
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      )}
                    </div>
                  ) : null}
                  {showToolUi && m.toolUi ? (
                    <div className="w-full max-w-none">
                      <ToolUiRenderer
                        toolUi={m.toolUi}
                        disabled={
                          disabled ||
                          streaming ||
                          (m.toolUi.toolName ===
                            "propose_learning_space_organization" &&
                            pendingToolUi?.toolCallId !== m.toolUi.toolCallId)
                        }
                        onResume={onResume}
                        onCancelPlan={onCancelPlan}
                        onClientAction={onClientAction}
                        onNavigate={onNavigate}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}

        {pendingToolUi &&
        !messages.some(
          (m) => m.toolUi?.toolCallId === pendingToolUi.toolCallId,
        ) ? (
          <div className="w-full">
            <div className="w-full">
              <ToolUiRenderer
                toolUi={pendingToolUi}
                disabled={disabled || streaming}
                onResume={onResume}
                onCancelPlan={onCancelPlan}
                onClientAction={onClientAction}
                onNavigate={onNavigate}
              />
            </div>
          </div>
        ) : null}

        {showReplyPlaceholder ? (
          <AssistantWaitingPlaceholder
            label={t("assistant.chat.waiting")}
            avatarSrc={assistantAvatarSrc}
            avatarAlt={assistantAvatarAlt}
          />
        ) : null}

        {showPlanningProgress ? (
          <DeepPlanningProgress
            progress={
              planningProgress?.active
                ? planningProgress
                : {
                    active: true,
                    stageMessage: status || phaseLabel,
                    updates: [],
                    activities: [],
                    warnings: [],
                  }
            }
          />
        ) : null}

        {goalCreationProgress?.active &&
        !streaming &&
        !hasStreamingAssistantMessage &&
        !toolUiWaiting ? (
          <div
            className="flex w-full min-w-0 items-start gap-2.5"
            role="status"
            aria-live="polite"
          >
            {assistantAvatarSrc ? (
              <img
                src={assistantAvatarSrc}
                alt=""
                className="size-9 shrink-0 rounded-xl object-cover shadow-sm"
              />
            ) : null}
            <div className="min-w-0 max-w-[min(92%,42rem)] rounded-2xl rounded-tl-md border border-primary/15 bg-primary/[0.06] px-4 py-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                {goalCreationProgress.phaseLabel}
              </p>
              <LlmLoadingStatus
                live={false}
                className="mt-1 text-base font-medium leading-7 text-foreground"
              >
                {goalCreationProgress.latestEvent ||
                  goalCreationProgress.status}
              </LlmLoadingStatus>
              {goalCreationProgress.latestEvent &&
              goalCreationProgress.latestEvent !==
                goalCreationProgress.status ? (
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {goalCreationProgress.status}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {streaming &&
        streamPreview &&
        hasGoalPlanStreamPreview &&
        !planningProgress?.active ? (
          <GoalPlanStreamCard source={streamPreview} />
        ) : null}

        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--course-content-error-border)] bg-[var(--course-content-error-bg)] p-2.5 text-sm text-foreground">
            <p>{error}</p>
            {canRetry && onRetry ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={disabled || streaming}
                onClick={onRetry}
              >
                {t("errors.retry")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {goalCreationActive && onExitGoalCreation ? (
        <div
          className={cn(
            "mt-2.5 flex items-center gap-2",
            activeToolUi?.uiKind === "plan_editor" && !streaming
              ? "justify-end"
              : "justify-between rounded-xl border border-[var(--border-200)] bg-[var(--bg-100)] px-3 py-2",
          )}
        >
          {activeToolUi?.uiKind === "plan_editor" && !streaming ? null : (
            <p className="text-[13px] text-muted-foreground">
              {goalCreationStatus}
            </p>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={onExitGoalCreation}
          >
            <XCircle className="size-4" />
            退出目标创建
          </Button>
        </div>
      ) : null}

      {toolUiWaiting ? null : (
        <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--border-200)] bg-[var(--bg-50)] shadow-sm">
          {quotedSelection ? (
            <div className="flex items-start gap-2 border-b border-[var(--border-200)] bg-[var(--bg-100)] px-3 py-2">
              <Quote
                className="mt-0.5 size-3.5 shrink-0 text-primary"
                aria-hidden
              />
              <p className="line-clamp-2 min-w-0 flex-1 text-xs leading-5 text-muted-foreground">
                {quotedSelection.text}
              </p>
              <button
                type="button"
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-[var(--bg-300)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setQuotedSelection(null)}
                aria-label={t("assistant.chat.removeQuote")}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          ) : null}
          <ImeSafeForm
            className="flex gap-2 px-2.5 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Input
              className="min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
              placeholder={t("assistant.chat.placeholder")}
              value={draft}
              disabled={disabled || streaming}
              onChange={(e) => setDraft(e.target.value)}
              {...compositionProps}
              onKeyDown={onEnterKeyDown((e) => {
                e.preventDefault();
                submit();
              })}
            />
            <Button
              type="submit"
              size="sm"
              disabled={disabled || streaming || !draft.trim()}
            >
              {t("assistant.chat.send")}
            </Button>
            {streaming && onCancel ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onCancel}
              >
                {t("assistant.chat.stop")}
              </Button>
            ) : null}
          </ImeSafeForm>
        </div>
      )}

      {selectionAction ? (
        <button
          type="button"
          className="fixed z-popover flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border-200)] bg-[var(--bg-50)] px-3 text-xs font-medium text-foreground shadow-lg hover:bg-[var(--bg-100)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ left: selectionAction.left, top: selectionAction.top }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setQuotedSelection({
              messageId: selectionAction.messageId,
              text: selectionAction.text,
            });
            setSelectionAction(null);
            window.getSelection()?.removeAllRanges();
          }}
        >
          <Quote className="size-3.5" aria-hidden />
          {t("assistant.chat.quote")}
        </button>
      ) : null}
    </div>
  );
}
