"use client";

import { useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { Button } from "@xue-learn/core/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  discoveryAnswersFromSubmitted,
  discoveryQuestionsWereSkipped,
} from "@/shared/agent/tool-ui-submitted";
import {
  commitDiscoveryAnswer,
  customInputValue,
  visibleChoiceLabels,
} from "@/shared/agent/custom-choice";
import { cn } from "@xue-learn/core/utils";
import { useI18n } from "@xue-learn/core/i18n";

type Question = {
  id: string;
  text: string;
  hint?: string;
  answerKind: "text" | "single_choice" | "multi_choice";
  choices?: string[];
};

function getChoices(question: Question): string[] {
  return visibleChoiceLabels(
    Array.isArray(question.choices) ? question.choices : [],
  );
}

function hasAnswer(
  question: Question,
  answers: Record<string, string | string[]>,
  draft: string | undefined,
): boolean {
  const next = commitDiscoveryAnswer(question, answers, draft);
  const value = next[question.id];
  if (question.answerKind === "multi_choice") {
    return Array.isArray(value) && value.length > 0;
  }
  return typeof value === "string" && value.trim().length > 0;
}

export function DiscoveryQuestionsCard({
  questions,
  disabled,
  submitted,
  onSubmit,
  onSkip,
}: {
  questions: Question[];
  disabled?: boolean;
  submitted?: Record<string, unknown>;
  onSubmit: (answers: Array<{ questionId: string; answer: string | string[] }>) => void;
  onSkip?: () => void;
}) {
  const { t } = useI18n();
  const savedAnswers = discoveryAnswersFromSubmitted(submitted);
  const skipped = discoveryQuestionsWereSkipped(submitted);
  const locked = Boolean(savedAnswers) || skipped;
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [customDrafts, setCustomDrafts] = useState<Record<string, string>>({});
  const displayAnswers = savedAnswers ?? answers;
  const readOnly = disabled || locked;
  const activeQuestion = questions[Math.min(activeIndex, questions.length - 1)];
  const fallbackChoices = [
    t("assistant.discovery.unsure"),
    t("assistant.discovery.decideForMe"),
  ];

  function submitAnswers(nextAnswers: Record<string, string | string[]>) {
    onSubmit(
      questions.map((q) => ({
        questionId: q.id,
        answer: nextAnswers[q.id] ?? (q.answerKind === "multi_choice" ? [] : ""),
      })),
    );
  }

  function goBack() {
    if (!activeQuestion || activeIndex <= 0) return;
    const next = commitDiscoveryAnswer(
      activeQuestion,
      answers,
      customDrafts[activeQuestion.id],
    );
    setAnswers(next);
    setActiveIndex((index) => index - 1);
  }

  function goForward() {
    if (!activeQuestion) return;
    const next = commitDiscoveryAnswer(
      activeQuestion,
      answers,
      customDrafts[activeQuestion.id],
    );
    setAnswers(next);
    if (activeIndex >= questions.length - 1) {
      submitAnswers(next);
      return;
    }
    setActiveIndex((index) => index + 1);
  }

  function toggleMultiChoice(questionId: string, choice: string) {
    if (readOnly) return;
    setAnswers((prev) => {
      const current = Array.isArray(prev[questionId]) ? prev[questionId] : [];
      const next = current.includes(choice)
        ? current.filter((item) => item !== choice)
        : [...current, choice];
      return { ...prev, [questionId]: next };
    });
  }

  function chooseSingle(questionId: string, choice: string) {
    if (readOnly) return;
    setCustomDrafts((prev) => ({ ...prev, [questionId]: "" }));
    setAnswers((prev) => ({ ...prev, [questionId]: choice }));
  }

  function updateDraft(question: Question, value: string) {
    setCustomDrafts((prev) => ({ ...prev, [question.id]: value }));
    if (question.answerKind === "multi_choice") return;
    setAnswers((prev) => ({ ...prev, [question.id]: value }));
  }

  if (questions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card/80 p-3 text-sm text-muted-foreground">
        {t("assistant.discovery.noQuestions")}
        <Button
          type="button"
          size="sm"
          className="mt-2"
          disabled={readOnly}
          onClick={() => onSubmit([])}
        >
          {t("assistant.discovery.continue")}
        </Button>
      </div>
    );
  }

  const chips = activeQuestion
    ? getChoices(activeQuestion).length > 0
      ? getChoices(activeQuestion)
      : fallbackChoices
    : [];
  const inputValue = activeQuestion
    ? (customDrafts[activeQuestion.id] ??
      customInputValue(
        activeQuestion.choices,
        displayAnswers[activeQuestion.id],
      ))
    : "";
  const canGoForward = Boolean(
    activeQuestion &&
      hasAnswer(activeQuestion, answers, customDrafts[activeQuestion.id]),
  );

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--border-200)] bg-[var(--bg-50)] p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MessageCircleQuestion className="size-4" aria-hidden="true" />
          </span>
          <p className="text-xs font-medium text-muted-foreground">
            {t("assistant.discovery.quickAnswer")}
          </p>
        </div>
        {questions.length > 1 ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {Math.min(activeIndex, questions.length - 1) + 1}/{questions.length}
          </span>
        ) : null}
      </div>
      {skipped ? (
        <p className="rounded-lg bg-card px-3 py-2 text-sm text-muted-foreground ring-1 ring-border">
          {t("assistant.discovery.skipped")}
        </p>
      ) : locked ? (
        questions.map((q) => (
          <div key={q.id} className="space-y-1.5">
            <Label>{q.text}</Label>
            <div className="rounded-lg bg-card px-3 py-2 text-sm text-foreground ring-1 ring-border">
              {Array.isArray(displayAnswers[q.id])
                ? (displayAnswers[q.id] as string[]).join("、")
                : String(displayAnswers[q.id] ?? "")}
            </div>
          </div>
        ))
      ) : activeQuestion ? (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <Label htmlFor={`discovery-${activeQuestion.id}`}>
              {activeQuestion.text}
            </Label>
            {activeQuestion.answerKind === "multi_choice" ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {t("assistant.discovery.multipleChoice")}
              </span>
            ) : null}
          </div>
          {chips.length ? (
            <div className="flex flex-wrap gap-2">
              {chips.map((c) => {
                const answer = displayAnswers[activeQuestion.id];
                const selected =
                  activeQuestion.answerKind === "multi_choice"
                    ? Array.isArray(answer) && answer.includes(c)
                    : answer === c;
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={readOnly}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium ring-1",
                      selected
                        ? "bg-primary text-primary-foreground ring-primary"
                        : "bg-card text-foreground ring-border transition-colors hover:bg-muted",
                    )}
                    onClick={() =>
                      activeQuestion.answerKind === "multi_choice"
                        ? toggleMultiChoice(activeQuestion.id, c)
                        : chooseSingle(activeQuestion.id, c)
                    }
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          ) : null}
          <Input
            id={`discovery-${activeQuestion.id}`}
            placeholder={
              activeQuestion.hint ?? t("assistant.discovery.otherPlaceholder")
            }
            value={inputValue}
            disabled={readOnly}
            onChange={(e) => updateDraft(activeQuestion, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (canGoForward) goForward();
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            {questions.length > 1 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={readOnly || activeIndex <= 0}
                onClick={goBack}
              >
                {t("assistant.discovery.back")}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              disabled={readOnly || !canGoForward}
              onClick={goForward}
            >
              {activeIndex >= questions.length - 1
                ? t("assistant.discovery.submit")
                : t("assistant.discovery.next")}
            </Button>
          </div>
          {onSkip ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={readOnly}
              onClick={onSkip}
            >
              {t("assistant.discovery.skip")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
