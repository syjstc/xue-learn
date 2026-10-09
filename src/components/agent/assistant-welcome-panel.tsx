"use client";

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  CreditCard,
  HelpCircle,
  Lightbulb,
  MessageCircleQuestion,
  Plus,
  Sparkles,
} from "lucide-react";
import { useAssistant } from "@/components/agent/assistant-provider";
import { useGlobalBriefing } from "@/hooks/use-agent-thread";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import type {
  AgentPageContext,
  AssistantConversationContext,
} from "@/shared/agent/types";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { supportsFlashcards } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";

type Suggestion = {
  id: string;
  label: string;
  icon?: ReactNode;
  variant?: "primary" | "secondary";
  onClick?: () => void;
  href?: string;
};

function SuggestionButtons({
  suggestions,
  disabled,
  onNavigate,
}: {
  suggestions: Suggestion[];
  disabled?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {suggestions.map((suggestion) => {
        const className = cn(
          "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition",
          suggestion.variant === "secondary"
            ? "border border-border bg-card text-foreground hover:bg-muted"
            : "bg-primary text-primary-foreground shadow-sm hover:brightness-95",
          disabled && "pointer-events-none opacity-50",
        );

        if (suggestion.href) {
          return (
            <Link
              key={suggestion.id}
              to={suggestion.href}
              className={className}
              onClick={() => onNavigate?.()}
            >
              {suggestion.icon}
              {suggestion.label}
            </Link>
          );
        }

        return (
          <button
            key={suggestion.id}
            type="button"
            className={className}
            disabled={disabled}
            onClick={suggestion.onClick}
          >
            {suggestion.icon}
            {suggestion.label}
          </button>
        );
      })}
    </div>
  );
}

export function AssistantReviewReminder({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const t = useT();
  const flashcardsEnabled = supportsFlashcards();
  const briefing = useGlobalBriefing();
  const dueCount = briefing.data?.dueCount ?? 0;
  const flashcardDueCount = flashcardsEnabled
    ? (briefing.data?.flashcardDueCount ?? 0)
    : 0;
  const loading = briefing.isLoading && !briefing.data;
  const hasDue = dueCount > 0 || flashcardDueCount > 0;

  if (!loading && !hasDue) return null;

  return (
    <div
      className={cn(
        "shrink-0 rounded-xl border border-primary/15 bg-primary/[0.05] p-1 shadow-sm",
        className,
      )}
    >
      <div className="flex min-h-10 items-center justify-between gap-3 rounded-lg bg-[var(--bg-50)]/80 px-3 py-2 sm:px-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          {loading ? (
            <p className="truncate text-sm font-medium text-muted-foreground">
              {t("assistant.welcome.checkingReviews")}
            </p>
          ) : (
            <p className="truncate text-sm font-semibold text-foreground">
              {t("assistant.welcome.youHave")}{" "}
              {dueCount > 0 ? (
                <>
                  <span className="text-base font-bold tabular-nums text-primary">
                    {dueCount}
                  </span>{" "}
                  {t("assistant.welcome.unitsDue")}
                </>
              ) : null}
              {dueCount > 0 && flashcardDueCount > 0
                ? t("assistant.welcome.dueSeparator")
                : null}
              {flashcardDueCount > 0 ? (
                <>
                  <span className="text-base font-bold tabular-nums text-primary">
                    {flashcardDueCount}
                  </span>{" "}
                  {t("assistant.welcome.cardsDue")}
                </>
              ) : null}
              {t("assistant.welcome.dueSuffix")}
            </p>
          )}
        </div>
        {!loading ? (
          <div className="flex shrink-0 items-center gap-1">
            {dueCount > 0 ? (
              <Link
                to="/reviews"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-semibold text-primary transition hover:bg-primary/10"
                onClick={() => onNavigate?.()}
              >
                {t("assistant.welcome.unitsLink")}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : null}
            {flashcardsEnabled && flashcardDueCount > 0 ? (
              <Link
                to="/flashcards"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-semibold text-primary transition hover:bg-primary/10"
                onClick={() => onNavigate?.()}
              >
                <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                {t("assistant.welcome.cardsLink")}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FollowUpWelcomePanel({
  onSend,
  disabled,
}: {
  onSend: (message: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const suggestions: Suggestion[] = [
    {
      id: "explain",
      label: t("assistant.welcome.followUp.explain"),
      icon: <HelpCircle className="h-3.5 w-3.5" />,
      variant: "primary",
      onClick: () => onSend(t("assistant.welcome.followUp.explainPrompt")),
    },
    {
      id: "example",
      label: t("landing.followup.example"),
      icon: <Lightbulb className="h-3.5 w-3.5" />,
      variant: "secondary",
      onClick: () => onSend(t("assistant.welcome.followUp.examplePrompt")),
    },
    {
      id: "analogy",
      label: t("landing.followup.analogy"),
      icon: <Sparkles className="h-3.5 w-3.5" />,
      variant: "secondary",
      onClick: () => onSend(t("assistant.welcome.followUp.analogyPrompt")),
    },
    {
      id: "misconception",
      label: t("landing.followup.misconception"),
      icon: <MessageCircleQuestion className="h-3.5 w-3.5" />,
      variant: "secondary",
      onClick: () =>
        onSend(t("assistant.welcome.followUp.misconceptionPrompt")),
    },
  ];

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border-200)] bg-[var(--bg-100)] p-4 shadow-sm">
      <div>
        <p className="text-sm font-semibold text-foreground">
          {t("assistant.welcome.followUp.title")}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {t("assistant.welcome.followUp.description")}
        </p>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("assistant.welcome.quickActions")}
        </p>
        <SuggestionButtons suggestions={suggestions} disabled={disabled} />
      </div>
    </div>
  );
}

export function AssistantWelcomePanel({
  onSend,
  disabled,
  onNavigate,
  pageContext,
  conversationContext,
}: {
  onSend: (message: string) => void;
  disabled?: boolean;
  onNavigate?: () => void;
  pageContext?: AgentPageContext;
  conversationContext?: AssistantConversationContext;
}) {
  const t = useT();
  const flashcardsEnabled = supportsFlashcards();
  const { openGoalCreationPrompt } = useAssistant();
  const briefing = useGlobalBriefing();
  const dueCount = briefing.data?.dueCount ?? 0;
  const flashcardDueCount = briefing.data?.flashcardDueCount ?? 0;
  const activeGoalCount = briefing.data?.activeGoalCount ?? 0;
  const isUnitPage = pageContext?.pageKind === "unit";
  const isFollowUp = conversationContext?.kind === "material_follow_up";

  if (isFollowUp) {
    return <FollowUpWelcomePanel onSend={onSend} disabled={disabled} />;
  }

  const suggestions: Suggestion[] = [
    ...(isUnitPage
      ? [
          {
            id: "ask-about-content",
            label: t("assistant.welcome.askAboutLesson"),
            icon: <HelpCircle className="h-3.5 w-3.5" />,
            variant: "primary" as const,
            onClick: () => onSend(t("assistant.welcome.askAboutLessonPrompt")),
          },
        ]
      : [
          {
            id: "create-goal",
            label: t("assistant.welcome.createGoal"),
            icon: <Plus className="h-3.5 w-3.5" />,
            variant: "primary" as const,
            onClick: () => openGoalCreationPrompt(),
          },
          {
            id: "create-micro",
            label: t("assistant.welcome.createMicroCourse"),
            icon: <Sparkles className="h-3.5 w-3.5" />,
            variant: "secondary" as const,
            onClick: () =>
              openGoalCreationPrompt(undefined, { isSmallCourse: true }),
          },
        ]),
    ...(dueCount > 0
      ? [
          {
            id: "start-review",
            label: t("assistant.welcome.startReview"),
            icon: <BookOpen className="h-3.5 w-3.5" />,
            variant: "primary" as const,
            href: "/reviews",
          },
        ]
      : []),
    ...(flashcardsEnabled && flashcardDueCount > 0
      ? [
          {
            id: "start-flashcards",
            label: t("assistant.welcome.reviewCards"),
            icon: <CreditCard className="h-3.5 w-3.5" />,
            variant: "primary" as const,
            href: "/flashcards",
          },
        ]
      : []),
    {
      id: "list-goals",
      label:
        activeGoalCount > 0
          ? t("assistant.welcome.myGoals")
          : t("assistant.welcome.howToStart"),
      icon: <Sparkles className="h-3.5 w-3.5" />,
      variant: "secondary",
      onClick: () =>
        onSend(
          activeGoalCount > 0
            ? t("assistant.welcome.listGoalsPrompt")
            : t("assistant.welcome.howToStartPrompt"),
        ),
    },
  ];

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border-200)] bg-[var(--bg-100)] p-4 shadow-sm">
      <div>
        <p className="text-sm font-semibold text-foreground">
          {isUnitPage
            ? t("assistant.welcome.unitTitle")
            : t("assistant.welcome.title")}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {isUnitPage
            ? t("assistant.welcome.unitDescription")
            : t("assistant.welcome.description")}
        </p>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("assistant.welcome.quickActions")}
        </p>
        <SuggestionButtons
          suggestions={suggestions}
          disabled={disabled}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
}
