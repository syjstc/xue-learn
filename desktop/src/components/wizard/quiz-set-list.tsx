"use client";
import { translateCurrent } from "@xue-learn/core/i18n";

import { useT, countVariant, getCurrentUiLocale } from "@xue-learn/core/i18n";

import { ClipboardList } from "lucide-react";
import type { QuizSetSummary } from "@/shared/domain/quiz-sets";

function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return translateCurrent("desktop.copy.justNow");
  if (diffMin < 60)
    return new Intl.RelativeTimeFormat(getCurrentUiLocale(), {
      numeric: "auto",
    }).format(-diffMin, "minute");
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)
    return new Intl.RelativeTimeFormat(getCurrentUiLocale(), {
      numeric: "auto",
    }).format(-diffHr, "hour");
  return date.toLocaleDateString(getCurrentUiLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function scoreLabel(score: number | null): string {
  if (score === null) return translateCurrent("desktop.copy.notAnswered");
  return `${Math.round(score * 100)}%`;
}

export function QuizSetList({
  sets,
  loading,
  activeQuizSetId,
  onSelect,
  onSelectAttempt,
  className,
}: {
  sets: QuizSetSummary[];
  loading?: boolean;
  activeQuizSetId?: string | null;
  onSelect: (set: QuizSetSummary) => void;
  onSelectAttempt?: (set: QuizSetSummary) => void;
  className?: string;
}) {
  const t = useT();
  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("desktop.ui.quizSetList.loadingPracticeHistory")}
      </p>
    );
  }

  if (sets.length === 0) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 py-8 text-center ${className ?? ""}`}
      >
        <ClipboardList
          className="h-8 w-8 text-muted-foreground/50"
          aria-hidden
        />
        <p className="text-sm text-muted-foreground">
          {t("desktop.ui.quizSetList.noPracticeSetsYet")}
        </p>
        <p className="max-w-[14rem] text-xs text-muted-foreground/80">
          {t("desktop.ui.quizSetList.generatedPracticeSetsAreSavedHereSo")}
        </p>
      </div>
    );
  }

  return (
    <ul
      className={`space-y-1.5 ${className ?? ""}`}
      aria-label={t("desktop.ui.quizSetList.allPracticeSets")}
    >
      {sets.map((set, index) => {
        const active = set.id === activeQuizSetId;
        const label = t("desktop.i18n.quizSet", {
          number: sets.length - index,
        });
        return (
          <li key={set.id}>
            <div
              className={`rounded-lg border transition-colors ${
                active
                  ? "border-primary/40 bg-primary/10"
                  : "border-transparent hover:border-border hover:bg-muted"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(set)}
                className="w-full px-2.5 py-2 text-left"
                aria-current={active ? "true" : undefined}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] font-medium text-primary">
                    {label}
                  </p>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {formatCreatedAt(set.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-foreground/90">
                  {set.preview}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t(
                    `desktop.i18n.questionCount.${countVariant(set.questionCount)}`,
                    { count: set.questionCount },
                  )}
                  {set.attemptCount > 0
                    ? t("desktop.i18n.quizAttempts", {
                        count: set.attemptCount,
                        score: scoreLabel(set.bestScore),
                      })
                    : t("desktop.ui.quizSetList.notAnswered")}
                </p>
              </button>
              {set.attemptCount > 0 && onSelectAttempt && (
                <div className="flex justify-end border-t border-border px-2 pb-1.5 pt-0">
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectAttempt(set);
                    }}
                  >
                    {t("desktop.ui.quizSetList.viewLatestAttempt")}
                  </button>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
