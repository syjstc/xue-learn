"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Sparkles } from "lucide-react";
import { Button } from "@xue-learn/core/ui/button";
import {
  activeSocraticThread,
  type SocraticMessage,
  type SocraticThread,
} from "@/shared/graph/socratic-threads";
import { cn } from "@xue-learn/core/utils";
import { LlmMarkdownInline } from "@/components/markdown/llm-markdown";
import { ProseMarkdown } from "@xue-learn/core/components/markdown/prose-markdown";
import { useLearnerDisplayName } from "@/hooks/api/use-learner-profile";
import { personalizeLearnerText } from "@/shared/domain/learner-text";
import { SocraticThreadDrawer } from "./socratic-thread-drawer.tsx";
import {
  ConversationTurn,
  ConversationTypingIndicator,
} from "./conversation/learning-conversation-surface.tsx";
import { useT } from "@xue-learn/core/i18n";

const BOTTOM_SCROLL_THRESHOLD = 48;

function isNearBottom(el: HTMLDivElement) {
  return (
    el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SCROLL_THRESHOLD
  );
}

function SocraticMessageBubble({
  message,
  conversationMode = false,
}: {
  message: SocraticMessage;
  conversationMode?: boolean;
}) {
  const learnerName = useLearnerDisplayName();
  const isAssistant = message.role === "assistant";
  const content = isAssistant
    ? personalizeLearnerText(message.content, learnerName)
    : message.content;
  const body = isAssistant ? (
    <ProseMarkdown content={content} className="prose-sm" />
  ) : (
    <p className="whitespace-pre-wrap">{content}</p>
  );

  if (conversationMode) {
    return (
      <ConversationTurn role={isAssistant ? "assistant" : "learner"}>
        {body}
      </ConversationTurn>
    );
  }

  return (
    <div
      className={cn(
        "max-w-[92%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
        isAssistant
          ? "mr-auto bg-[var(--bg-300)] text-[var(--text-800)]"
          : "ml-auto bg-[var(--brand-600)] text-white",
      )}
    >
      {body}
    </div>
  );
}

function QuestionReference({
  question,
  mistakeHint,
}: {
  question: string;
  mistakeHint?: string;
}) {
  const t = useT();
  return (
    <div className="mb-3 shrink-0 rounded-lg border border-[var(--border-200)] bg-[var(--bg-100)] px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-400)]">
        {t("desktop.ui.socraticChatPanel.originalQuestion")}
      </p>
      <div className="mt-1 text-sm leading-relaxed text-[var(--text-800)]">
        <LlmMarkdownInline content={question} />
      </div>
      {mistakeHint && (
        <p className="mt-2 text-xs text-[var(--text-400)]">{mistakeHint}</p>
      )}
    </div>
  );
}

function EmptyChatPrompt({
  bootstrapping,
  onStart,
}: {
  bootstrapping?: boolean;
  onStart: () => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-8 text-center">
      <Sparkles className="h-8 w-8 text-[var(--brand-400)]" aria-hidden />
      {bootstrapping ? (
        <p className="text-sm text-[var(--brand-700)]">
          {t("generation.socratic.preparing")}
        </p>
      ) : (
        <>
          <p className="text-sm text-[var(--text-800)]">
            {t(
              "desktop.ui.socraticChatPanel.selectStartGuidedReviewToPrepareThe",
            )}
          </p>
          <p className="max-w-[16rem] text-xs text-[var(--text-400)]">
            {t(
              "desktop.ui.socraticChatPanel.yourAssistantWillAskQuestionsToHelp",
            )}
          </p>
          <Button onClick={onStart} size="sm">
            {t("desktop.ui.socraticChatPanel.startGuidedReview")}
          </Button>
        </>
      )}
    </div>
  );
}

export function SocraticChatPanel({
  threads,
  activeThreadId,
  initializing,
  bootstrapping,
  sending,
  streamingAssistantText,
  onSend,
  onSelectThread,
  onFinish,
  finishLabel,
  canFinish = true,
  questionReference,
  conversationMode = false,
}: {
  threads: SocraticThread[];
  activeThreadId?: string | null;
  initializing?: boolean;
  bootstrapping?: boolean;
  sending?: boolean;
  streamingAssistantText?: string;
  onSend: (answer: string) => void;
  onSelectThread: (threadId: string) => void;
  onFinish: () => void;
  finishLabel: string;
  canFinish?: boolean;
  /** Fallback quiz stem when thread.questionText is missing (legacy sessions). */
  questionReference?: string | null;
  conversationMode?: boolean;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastScrollTopRef = useRef(0);

  const activeThread = activeSocraticThread(
    threads,
    activeThreadId ?? undefined,
  );
  const referenceQuestion =
    activeThread?.questionText?.trim() || questionReference?.trim() || "";
  const messages = activeThread?.messages ?? [];
  const needsBootstrap = Boolean(
    activeThread &&
    !activeThread.done &&
    messages.length === 0 &&
    !streamingAssistantText?.trim() &&
    !bootstrapping,
  );
  const canReply = Boolean(
    activeThread && !activeThread.done && !needsBootstrap && !initializing,
  );
  const showStreamingBubble = Boolean(
    streamingAssistantText?.trim() && activeThread && !activeThread.done,
  );

  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el || !shouldAutoScrollRef.current) return;
    el.scrollTop = el.scrollHeight;
    lastScrollTopRef.current = el.scrollTop;
  }, [
    messages,
    sending,
    activeThread?.id,
    bootstrapping,
    streamingAssistantText,
  ]);

  function handleMessagesScroll() {
    const el = messagesScrollRef.current;
    if (!el) return;
    const scrollingUp = el.scrollTop < lastScrollTopRef.current;
    shouldAutoScrollRef.current =
      sending && scrollingUp ? false : isNearBottom(el);
    lastScrollTopRef.current = el.scrollTop;
  }

  function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed || !canReply || sending) return;
    onSend(trimmed);
    setDraft("");
    shouldAutoScrollRef.current = true;
  }

  const doneCount = threads.filter((t) => t.done).length;
  const nextIncompleteThread = activeThread?.done
    ? threads.find((thread) => !thread.done)
    : undefined;

  return (
    <div
      className={cn(
        "flex min-h-[20rem] flex-col overflow-hidden",
        conversationMode
          ? "max-h-[min(42rem,calc(100dvh-10rem))]"
          : "max-h-[min(36rem,calc(100dvh-12rem))] rounded-xl border border-[var(--border-200)] bg-[var(--bg-50)]",
      )}
    >
      <div
        className={cn(
          "shrink-0",
          conversationMode
            ? "border-b border-[var(--course-content-border)] pb-3"
            : "border-b border-[var(--border-200)] px-3 py-2.5",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3
              className={
                conversationMode
                  ? "text-lg font-semibold text-[var(--text-800)]"
                  : "text-sm font-semibold text-[var(--text-800)]"
              }
            >
              {t("learningJourney.correction")}
            </h3>
            <p
              className={
                conversationMode
                  ? "mt-1 text-sm text-[var(--text-400)]"
                  : "mt-0.5 text-[11px] text-[var(--text-400)]"
              }
            >
              {t(
                "desktop.ui.socraticChatPanel.eachMissedQuestionHasItsOwnConversation",
              )}
            </p>
          </div>
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
            {threads.length > 0 && (
              <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-400)]">
                {doneCount}/{threads.length} {t("spaces.completed")}
              </span>
            )}
            <SocraticThreadDrawer
              threads={threads}
              activeThreadId={activeThreadId}
              initializing={initializing}
              onSelect={onSelectThread}
              className="min-w-0 flex-1 sm:flex-none"
            />
          </div>
        </div>
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          conversationMode ? "pt-4" : "px-3 py-3",
        )}
      >
        {!activeThread ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
            <MessageCircle
              className="h-8 w-8 text-[var(--text-400)]/50"
              aria-hidden
            />
            <p className="text-sm text-[var(--text-400)]">
              {t("desktop.ui.socraticChatPanel.selectAMissedQuestionToReview")}
            </p>
            <SocraticThreadDrawer
              threads={threads}
              activeThreadId={activeThreadId}
              initializing={initializing}
              onSelect={onSelectThread}
            />
          </div>
        ) : (
          <>
            {referenceQuestion ? (
              <QuestionReference
                question={referenceQuestion}
                mistakeHint={activeThread.mistakeHint}
              />
            ) : (
              <p className="mb-2 shrink-0 text-xs font-medium text-[var(--brand-700)]">
                {activeThread.label}
                {activeThread.done
                  ? t("desktop.ui.socraticChatPanel.completed")
                  : ""}
              </p>
            )}

            {needsBootstrap ? (
              <EmptyChatPrompt
                bootstrapping={bootstrapping}
                onStart={() => onSelectThread(activeThread.id)}
              />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div
                  ref={messagesScrollRef}
                  onScroll={handleMessagesScroll}
                  className={cn(
                    "min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1",
                    conversationMode ? "space-y-5" : "space-y-3",
                  )}
                >
                  {messages.map((message, index) => (
                    <SocraticMessageBubble
                      key={`${message.createdAt}-${index}`}
                      message={message}
                      conversationMode={conversationMode}
                    />
                  ))}
                  {showStreamingBubble && (
                    <SocraticMessageBubble
                      message={{
                        role: "assistant",
                        content: streamingAssistantText ?? "",
                        createdAt: "streaming",
                      }}
                      conversationMode={conversationMode}
                    />
                  )}
                  {sending && !showStreamingBubble ? (
                    conversationMode ? (
                      <ConversationTypingIndicator>
                        {t("generation.socratic.preparing")}
                      </ConversationTypingIndicator>
                    ) : (
                      <p className="text-xs text-[var(--text-400)]">
                        {t("generation.socratic.preparing")}
                      </p>
                    )
                  ) : null}
                </div>

                <div
                  className={cn(
                    "mt-3 shrink-0 space-y-2 pt-3",
                    conversationMode
                      ? "border-t border-[var(--course-content-border)]"
                      : "border-t border-[var(--border-200)]",
                  )}
                >
                  {activeThread.done ? (
                    <p className="text-xs text-[var(--text-400)]">
                      {nextIncompleteThread
                        ? t(
                            "desktop.ui.socraticChatPanel.thisReviewIsCompleteSelectNextQuestion",
                          )
                        : t(
                            "desktop.ui.socraticChatPanel.youHaveReviewedEveryMissedQuestionSelect",
                          )}
                    </p>
                  ) : (
                    <textarea
                      className="w-full rounded-lg border border-[var(--border-200)] bg-[var(--bg-100)] p-3 text-sm text-[var(--text-800)] placeholder:text-[var(--text-400)]"
                      rows={3}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={t(
                        "desktop.ui.socraticChatPanel.writeYourThoughts",
                      )}
                      disabled={!canReply || sending}
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    {activeThread.done ? (
                      <Button
                        onClick={() =>
                          nextIncompleteThread
                            ? onSelectThread(nextIncompleteThread.id)
                            : onFinish()
                        }
                        disabled={
                          (!nextIncompleteThread && !canFinish) ||
                          initializing ||
                          bootstrapping ||
                          sending
                        }
                      >
                        {nextIncompleteThread
                          ? t("assistant.discovery.next")
                          : t("spaces.resume")}
                      </Button>
                    ) : (
                      <Button
                        onClick={handleSend}
                        disabled={!canReply || sending || !draft.trim()}
                      >
                        {sending
                          ? t("sharedGoal.share.submitting")
                          : t("desktop.ui.socraticChatPanel.answer")}
                      </Button>
                    )}
                    {!activeThread.done && (
                      <Button
                        variant="outline"
                        onClick={onFinish}
                        disabled={
                          !canFinish || initializing || bootstrapping || sending
                        }
                      >
                        {finishLabel}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
