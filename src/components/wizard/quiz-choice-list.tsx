"use client";

import type { ReactNode } from "react";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";

export type QuizChoiceState =
  | "idle"
  | "selected"
  | "correct"
  | "incorrect"
  | "missed"
  | "dimmed";

export function quizChoiceSurfaceClass(state: QuizChoiceState): string {
  switch (state) {
    case "selected":
      return "border-[var(--course-content-border-accent)] bg-[var(--course-content-surface-accent)] shadow-[inset_0_0_0_1px_var(--course-content-border-accent)]";
    case "correct":
      return "border-[var(--course-content-success-border)] bg-[var(--course-content-success-bg)]";
    case "incorrect":
      return "border-[var(--course-content-error-border)] bg-[var(--course-content-error-bg)]";
    case "missed":
      return "border-dashed border-[var(--course-content-success-border)] bg-[var(--course-content-success-bg)]/55";
    case "dimmed":
      return "border-[var(--course-content-border)] bg-[var(--course-content-surface)] text-[var(--course-content-muted)]";
    default:
      return "border-[var(--course-content-border)] bg-[var(--course-content-surface)] hover:border-[var(--course-content-border-accent)] hover:bg-[var(--course-content-surface-accent)]";
  }
}

export function quizChoiceIndicatorClass(
  indicator: "radio" | "checkbox",
  state: QuizChoiceState,
  selected: boolean,
): string {
  const shape = indicator === "checkbox" ? "rounded-[5px]" : "rounded-full";
  if (state === "correct" && selected) {
    return `${shape} border-[var(--quiz-result-correct-text)] bg-[var(--quiz-result-correct-text)] text-[var(--course-content-surface)]`;
  }
  if (state === "incorrect" && selected) {
    return `${shape} border-[var(--quiz-result-incorrect-text)] bg-[var(--quiz-result-incorrect-text)] text-[var(--course-content-surface)]`;
  }
  if (state === "missed") {
    return `${shape} border-dashed border-[var(--course-content-success-border)] bg-[var(--course-content-surface)] text-transparent`;
  }
  if (state === "correct") {
    return `${shape} border-[var(--quiz-result-correct-text)] bg-[var(--course-content-surface)] text-transparent`;
  }
  if (selected) {
    if (indicator === "radio") {
      return `${shape} border-[var(--primary)] bg-[var(--course-content-surface)] text-[var(--primary)]`;
    }
    return `${shape} border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]`;
  }
  return `${shape} border-[var(--course-content-border)] bg-[var(--course-content-surface)] text-transparent`;
}

export function QuizChoiceGroup({
  hint,
  selection,
  layout = "stack",
  children,
}: {
  hint?: ReactNode;
  selection: "single" | "multiple";
  layout?: "stack" | "pair";
  children: ReactNode;
}) {
  return (
    <div className="mt-3 space-y-2">
      {hint ? (
        <p className="text-sm font-medium leading-5 text-[var(--muted-foreground)]">
          {hint}
        </p>
      ) : null}
      <div
        role={selection === "single" ? "radiogroup" : "group"}
        className={
          layout === "pair"
            ? "grid grid-cols-1 gap-2 sm:grid-cols-2"
            : "grid grid-cols-1 gap-2"
        }
      >
        {children}
      </div>
    </div>
  );
}

export function QuizChoiceOption({
  indicator,
  selected,
  disabled,
  state = "idle",
  onSelect,
  children,
  trailing,
}: {
  indicator: "radio" | "checkbox";
  selected: boolean;
  disabled?: boolean;
  state?: QuizChoiceState;
  onSelect: () => void;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      role={indicator === "radio" ? "radio" : "checkbox"}
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full min-h-11 touch-manipulation items-start gap-3 rounded-xl border px-3.5 py-3 text-left text-[0.9375rem] leading-6 text-[var(--course-content)] transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
        "disabled:cursor-not-allowed disabled:hover:border-[inherit] disabled:hover:bg-[inherit]",
        quizChoiceSurfaceClass(state),
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center border-2 text-[11px] font-bold leading-none",
          quizChoiceIndicatorClass(indicator, state, selected),
        )}
      >
        {indicator === "checkbox" ? "✓" : selected ? (
          <span className="size-2 rounded-full bg-current" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">
        {children}
      </span>
      {trailing}
    </button>
  );
}
