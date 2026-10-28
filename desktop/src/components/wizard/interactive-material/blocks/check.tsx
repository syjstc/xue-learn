"use client";

import { Check, CircleHelp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { InteractiveBlock } from "@xue-learn/core/schemas";
import {
  anchorForBlock,
  type MaterialAnchor,
} from "@xue-learn/core/shared/domain/material-anchor";
import { resolveMaterialCheckQuestionType } from "@/shared/domain/material-check";
import type { TextHighlightSpan } from "@xue-learn/core/shared/domain/material-highlight";
import type { ContentSource } from "@xue-learn/core/shared/types/content-sources";
import type { MaterialFollowUpHandlers } from "@/hooks/use-material-text-selection";
import { useT } from "@xue-learn/core/i18n";
import {
  QuizChoiceGroup,
  QuizChoiceOption,
  type QuizChoiceState,
} from "../../quiz-choice-list.tsx";
import { Selectable } from "../selectable.tsx";
import type {
  MaterialCheckQuestionType,
  MaterialCheckResult,
  VerifiedMaterialAnswerHandler,
} from "../types.ts";

type CheckBlockType = Extract<InteractiveBlock, { type: "check" }>;

/** Compact graded marker: your pick vs answer key, without text chips. */
function GradeMark({
  kind,
}: {
  kind: "correct" | "incorrect" | "missed";
}) {
  const t = useT();
  if (kind === "incorrect") {
    return (
      <span
        className="inline-flex size-5 shrink-0 items-center justify-center self-center rounded-full bg-[var(--course-content-error-bg)] text-[var(--quiz-result-incorrect-text)]"
        aria-label={t("wizard.material.check.incorrectSelection")}
      >
        <X className="size-3 stroke-[2.5]" aria-hidden />
      </span>
    );
  }
  if (kind === "missed") {
    return (
      <span
        className="inline-flex size-5 shrink-0 items-center justify-center self-center rounded-full border border-dashed border-[var(--course-content-success-border)] text-[var(--quiz-result-correct-text)]"
        aria-label={t("wizard.material.check.missedSelection")}
        title={t("wizard.material.check.missedSelection")}
      >
        <Check className="size-3 stroke-[2.5] opacity-70" aria-hidden />
      </span>
    );
  }
  return (
    <span
      className="inline-flex size-5 shrink-0 items-center justify-center self-center rounded-full bg-[var(--course-content-success-bg)] text-[var(--quiz-result-correct-text)]"
      aria-label={t("wizard.material.check.correct")}
    >
      <Check className="size-3 stroke-[2.5]" aria-hidden />
    </span>
  );
}

function restoreAnswer(
  result: MaterialCheckResult | undefined,
  questionType: MaterialCheckQuestionType,
): number | number[] | boolean | null {
  const value = result?.selectedAnswer;
  if (value == null) return null;
  if (questionType === "true_false") {
    return typeof value === "boolean" ? value : null;
  }
  if (questionType === "mcq_multi") {
    return Array.isArray(value)
      ? value.filter((item): item is number => typeof item === "number")
      : typeof value === "number"
        ? [value]
        : null;
  }
  return typeof value === "number" ? value : null;
}

function choiceState({
  revealAnswer,
  showGrade,
  selected,
  isAnswerKey,
  isWrongSelection,
  missedCorrect,
}: {
  revealAnswer: boolean;
  showGrade: boolean;
  selected: boolean;
  isAnswerKey: boolean;
  isWrongSelection?: boolean;
  missedCorrect?: boolean;
}): QuizChoiceState {
  if (revealAnswer) {
    return isAnswerKey ? "correct" : "dimmed";
  }
  if (!showGrade) {
    return selected ? "selected" : "idle";
  }
  if (missedCorrect) return "missed";
  if (isAnswerKey && selected) return "correct";
  if (isAnswerKey) return "missed";
  if (isWrongSelection || selected) return "incorrect";
  return "dimmed";
}

export function CheckBlock({
  block,
  blockIndex,
  blockKey,
  compact,
  revealAnswer = false,
  publicQuizMode = false,
  deferredSubmit = false,
  followUp,
  highlights,
  sources,
  animateText,
  typewriterResetKey,
  onTextAnimationComplete,
  onAnsweredChange,
  onVerifiedAnswer,
  materialCheckResult,
}: {
  block: CheckBlockType;
  blockIndex: number;
  blockKey: string;
  compact?: boolean;
  revealAnswer?: boolean;
  publicQuizMode?: boolean;
  /** Select locally; parent batch-submits. No reveal until materialCheckResult. */
  deferredSubmit?: boolean;
  followUp?: MaterialFollowUpHandlers;
  highlights: Map<string, TextHighlightSpan[]>;
  sources?: ContentSource[];
  animateText?: boolean;
  typewriterResetKey?: string | number;
  onTextAnimationComplete?: () => void;
  onAnsweredChange?: (answered: boolean) => void;
  onVerifiedAnswer?: VerifiedMaterialAnswerHandler;
  materialCheckResult?: MaterialCheckResult;
}) {
  const t = useT();
  const checkId = typeof block.checkId === "string" ? block.checkId : undefined;
  const questionType = resolveMaterialCheckQuestionType(
    block as Record<string, unknown>,
  );
  const restoredAnswer = restoreAnswer(materialCheckResult, questionType);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    typeof restoredAnswer === "number" ? restoredAnswer : null,
  );
  const [selectedIndices, setSelectedIndices] = useState<number[]>(
    Array.isArray(restoredAnswer) ? restoredAnswer : [],
  );
  const [selectedBoolean, setSelectedBoolean] = useState<boolean | null>(
    typeof restoredAnswer === "boolean" ? restoredAnswer : null,
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const next = restoreAnswer(materialCheckResult, questionType);
    if (typeof next === "number") {
      setSelectedIndex(next);
      setSelectedIndices([]);
      setSelectedBoolean(null);
      return;
    }
    if (Array.isArray(next)) {
      setSelectedIndices(next);
      setSelectedIndex(null);
      setSelectedBoolean(null);
      return;
    }
    if (typeof next === "boolean") {
      setSelectedBoolean(next);
      setSelectedIndex(null);
      setSelectedIndices([]);
    }
  }, [materialCheckResult, questionType]);

  const answered =
    revealAnswer ||
    materialCheckResult != null ||
    (questionType === "mcq"
      ? selectedIndex !== null
      : questionType === "mcq_multi"
        ? selectedIndices.length > 0
        : selectedBoolean !== null);

  const correctIndices =
    questionType === "mcq_multi"
      ? "correctIndices" in block && Array.isArray(block.correctIndices)
        ? block.correctIndices
        : []
      : [];
  const correctIndex =
    questionType === "mcq" && typeof block.correctIndex === "number"
      ? block.correctIndex
      : -1;
  const correctAnswer =
    questionType === "true_false" && typeof block.correctAnswer === "boolean"
      ? block.correctAnswer
      : null;

  const graded = materialCheckResult != null;
  // Multi-select must stay interactive until graded — locking on first pick
  // made "select all that apply" behave like single-choice.
  const showGrade =
    revealAnswer ||
    graded ||
    (!deferredSubmit && questionType !== "mcq_multi" && answered);
  const outcome =
    materialCheckResult?.outcome ??
    (materialCheckResult
      ? materialCheckResult.correct
        ? "correct"
        : "incorrect"
      : null);
  const correct =
    materialCheckResult?.correct ??
    (!deferredSubmit &&
      questionType !== "mcq_multi" &&
      (questionType === "mcq"
        ? selectedIndex === correctIndex
        : selectedBoolean === correctAnswer));

  const locked =
    submitting ||
    revealAnswer ||
    graded ||
    (questionType !== "mcq_multi" &&
      !deferredSubmit &&
      (publicQuizMode ? Boolean(correct) : answered));

  const onAnsweredChangeRef = useRef(onAnsweredChange);
  onAnsweredChangeRef.current = onAnsweredChange;

  useEffect(() => {
    onAnsweredChangeRef.current?.(answered);
  }, [answered]);

  const blockRef = useRef<HTMLDivElement>(null);

  const openAtBlock = (
    anchor: MaterialAnchor,
    extra?: { autoMessage?: string },
  ) => {
    if (!followUp) return;
    const rect = blockRef.current?.getBoundingClientRect();
    followUp.onOpenFollowUp(anchor, {
      rect,
      blockIndex,
      autoMessage: extra?.autoMessage,
    });
  };

  const openWrongFollowUp = () => {
    if (!followUp || correct) return;
    const wrongOptionIndex =
      questionType === "mcq"
        ? selectedIndex
        : questionType === "mcq_multi"
          ? selectedIndices[0]
          : undefined;
    openAtBlock(
      anchorForBlock(block, blockIndex, "check.wrong", {
        ...(typeof wrongOptionIndex === "number"
          ? { wrongOptionIndex }
          : {}),
      }),
      { autoMessage: t("wizard.material.check.wrongAnswerFollowUpPrompt") },
    );
  };

  const openExistingThread = () => {
    if (!followUp?.blockThreadIds.has(blockIndex)) return;
    const threadId = followUp.blockThreadIds.get(blockIndex);
    const anchor = anchorForBlock(block, blockIndex, "check.wrong");
    followUp.onOpenFollowUp(anchor, { blockIndex, threadId });
  };

  const commitAnswer = (answer: number | number[] | boolean) => {
    if (revealAnswer || publicQuizMode) return;
    if (deferredSubmit) {
      void onVerifiedAnswer?.({
        blockIndex,
        checkId,
        answer,
      });
      return;
    }
    if (!onVerifiedAnswer) return;
    setSubmitting(true);
    void Promise.resolve(
      onVerifiedAnswer({
        blockIndex,
        checkId,
        answer,
      }),
    )
      .then((result) => {
        const authoritative = result?.selectedAnswer;
        if (typeof authoritative === "number") {
          setSelectedIndex(authoritative);
        } else if (Array.isArray(authoritative)) {
          setSelectedIndices(authoritative);
        } else if (typeof authoritative === "boolean") {
          setSelectedBoolean(authoritative);
        } else if (!checkId) {
          if (typeof answer === "number") setSelectedIndex(answer);
          else if (Array.isArray(answer)) setSelectedIndices(answer);
          else setSelectedBoolean(answer);
        }
      })
      .finally(() => setSubmitting(false));
  };

  const submitAnswer = (answer: number | number[] | boolean) => {
    if (locked) return;
    if (questionType === "mcq" && typeof answer === "number") {
      setSelectedIndex(answer);
      commitAnswer(answer);
      return;
    }
    if (questionType === "mcq_multi" && Array.isArray(answer)) {
      setSelectedIndices(answer);
      // Deferred batch: keep parent pending in sync while options stay toggleable.
      // Immediate path: wait for the explicit confirm control below.
      if (deferredSubmit) {
        commitAnswer(answer);
      }
      return;
    }
    if (questionType === "true_false" && typeof answer === "boolean") {
      setSelectedBoolean(answer);
      commitAnswer(answer);
    }
  };

  const questionKey = `${blockKey}:check:question`;
  const explanationKey = `${blockKey}:check:explanation`;
  const feedbackTitle =
    revealAnswer
      ? t("wizard.material.check.referenceAnswer")
      : outcome === "correct"
        ? t("wizard.material.check.answerCorrect")
        : outcome === "partial"
          ? t("wizard.material.check.partiallyCorrect")
          : showGrade
            ? t("wizard.material.check.tryAgain")
            : "";

  return (
    <div
      ref={blockRef}
      className={`rounded-lg border border-[var(--course-content-border)] bg-[var(--course-content-surface-muted)] ${compact ? "p-2" : "p-4"}`}
    >
      {followUp?.blockThreadIds.has(blockIndex) && (
        <button
          type="button"
          className="mb-2 flex items-center gap-1 rounded-full bg-[var(--course-content-attention-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--course-content)] hover:bg-[var(--course-content-highlight-bg)]"
          onClick={openExistingThread}
        >
          💬 {t("wizard.material.check.viewFollowUp")}
        </button>
      )}
      <div className="flex items-start gap-1.5 text-base font-medium leading-relaxed text-[var(--course-content)]">
        <span
          className="inline-flex h-[1.625em] shrink-0 items-center"
          aria-hidden
        >
          <CircleHelp className="size-4 text-[var(--course-content-link)]" />
        </span>
        <div className="min-w-0 flex-1">
          <Selectable
            contentKey={questionKey}
            text={block.question}
            highlights={highlights}
            sources={sources}
            followUp={followUp}
            animateText={animateText}
            typewriterResetKey={typewriterResetKey}
            onTextAnimationComplete={onTextAnimationComplete}
          />
        </div>
      </div>

      {questionType === "true_false" ? (
        <QuizChoiceGroup
          selection="single"
          layout="pair"
          hint={t("wizard.material.check.trueFalseQuestion")}
        >
          {[true, false].map((value) => {
            const selected = selectedBoolean === value;
            const isCorrectOption = revealAnswer
              ? value === correctAnswer
              : showGrade && value === correctAnswer;
            const isWrongSelection =
              showGrade && selected && value !== correctAnswer;
            const gradeKind =
              showGrade && !revealAnswer
                ? isCorrectOption
                  ? ("correct" as const)
                  : isWrongSelection
                    ? ("incorrect" as const)
                    : null
                : null;
            return (
              <QuizChoiceOption
                key={String(value)}
                indicator="radio"
                selected={selected}
                disabled={locked}
                state={choiceState({
                  revealAnswer,
                  showGrade,
                  selected,
                  isAnswerKey: Boolean(isCorrectOption),
                  isWrongSelection,
                })}
                onSelect={() => submitAnswer(value)}
                trailing={gradeKind ? <GradeMark kind={gradeKind} /> : null}
              >
                {value
                  ? t("wizard.material.answer.true")
                  : t("wizard.material.answer.false")}
              </QuizChoiceOption>
            );
          })}
        </QuizChoiceGroup>
      ) : (
        <>
          <QuizChoiceGroup
            selection={questionType === "mcq_multi" ? "multiple" : "single"}
            hint={
              questionType === "mcq_multi"
                ? t("wizard.material.check.multiSelectHint")
                : t("wizard.material.check.singleChoice")
            }
          >
            {(block.options ?? []).map((opt, i) => {
              const selected =
                questionType === "mcq_multi"
                  ? selectedIndices.includes(i)
                  : selectedIndex === i;
              const optionCorrect =
                questionType === "mcq_multi"
                  ? correctIndices.includes(i)
                  : i === correctIndex;
              const treatSelectedAsCorrect =
                showGrade &&
                !revealAnswer &&
                outcome === "correct" &&
                selected &&
                questionType !== "mcq_multi";
              const isAnswerKey = optionCorrect || treatSelectedAsCorrect;
              const missedCorrect =
                showGrade &&
                !revealAnswer &&
                questionType === "mcq_multi" &&
                isAnswerKey &&
                !selected;
              const gradeKind =
                showGrade && !revealAnswer
                  ? missedCorrect
                    ? ("missed" as const)
                    : isAnswerKey
                      ? ("correct" as const)
                      : selected
                        ? ("incorrect" as const)
                        : null
                  : null;

              return (
                <QuizChoiceOption
                  key={i}
                  indicator={
                    questionType === "mcq_multi" ? "checkbox" : "radio"
                  }
                  selected={selected}
                  disabled={locked}
                  state={choiceState({
                    revealAnswer,
                    showGrade,
                    selected,
                    isAnswerKey,
                    isWrongSelection: selected && !isAnswerKey && showGrade,
                    missedCorrect,
                  })}
                  onSelect={() => {
                    if (questionType === "mcq_multi") {
                      const next = selected
                        ? selectedIndices.filter((index) => index !== i)
                        : [...selectedIndices, i].sort((a, b) => a - b);
                      submitAnswer(next);
                      return;
                    }
                    submitAnswer(i);
                  }}
                  trailing={gradeKind ? <GradeMark kind={gradeKind} /> : null}
                >
                  <Selectable
                    contentKey={`${blockKey}:check:option:${i}`}
                    text={opt}
                    highlights={highlights}
                    sources={sources}
                    followUp={followUp}
                    markdownVariant="inline"
                  />
                </QuizChoiceOption>
              );
            })}
          </QuizChoiceGroup>
          {questionType === "mcq_multi" &&
          !deferredSubmit &&
          !revealAnswer &&
          !graded &&
          !publicQuizMode ? (
            <button
              type="button"
              disabled={
                locked || selectedIndices.length === 0 || !onVerifiedAnswer
              }
              className="mt-3 min-h-11 w-full rounded-xl border border-[var(--course-content-border-accent)] bg-[var(--course-content-surface-accent)] px-3.5 py-3 text-[0.9375rem] font-medium text-[var(--course-content)] transition hover:border-[var(--course-content-link)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              onClick={() => commitAnswer(selectedIndices)}
            >
              {submitting
                ? t("wizard.material.check.submitting")
                : t("wizard.material.check.confirmSelection")}
            </button>
          ) : null}
        </>
      )}

      {showGrade && feedbackTitle ? (
        <div
          className={`mt-3 rounded-lg p-3 text-sm leading-relaxed ${
            revealAnswer
              ? "bg-[var(--course-content-surface-muted)] text-[var(--course-content)]"
              : outcome === "correct"
                ? "bg-[var(--course-content-success-bg)] text-[var(--course-content)]"
                : outcome === "partial"
                  ? "bg-[var(--course-content-attention-bg)] text-[var(--course-content)]"
                  : "bg-[var(--course-content-attention-bg)] text-[var(--course-content)]"
          }`}
        >
          <p className="font-medium">{feedbackTitle}</p>
          {!publicQuizMode || revealAnswer ? (
            <p className="mt-1">
              <Selectable
                contentKey={explanationKey}
                text={block.explanation}
                highlights={highlights}
                sources={sources}
                followUp={followUp}
              />
            </p>
          ) : null}
          {followUp && !revealAnswer && !correct && !publicQuizMode && (
            <div className="mt-2">
              <button
                type="button"
                className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary-hover"
                onClick={openWrongFollowUp}
              >
                {t("wizard.material.check.whyWrong")}
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
