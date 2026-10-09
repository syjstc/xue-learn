"use client";

import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { AiGenStopButton } from "@/components/ai/ai-gen-stop-button";
import { LlmMarkdownInline } from "@/components/markdown/llm-markdown";
import { ProseMarkdown } from "@xue-learn/core/source/src/components/markdown/prose-markdown.tsx";
import { resolveLearningTargetLabels } from "@/shared/domain/learning-targets";
import { FEATURE_FEYNMAN } from "@xue-learn/core/source/src/shared/features.ts";
import { QuizSetDrawer } from "../../quiz-set-drawer.tsx";
import {
  QuizChoiceGroup,
  QuizChoiceOption,
} from "../../quiz-choice-list.tsx";
import { PracticeHub } from "../../practice-hub.tsx";
import { UnitFlashcardPanel } from "../../unit-flashcard-panel.tsx";
import { normalizeSelectedIndices } from "../utils.ts";
import type { UnitWizardModel } from "../use-unit-wizard.tsx";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { supportsFlashcards } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";

type Props = {
  model: UnitWizardModel;
  reviewMode?: boolean;
  conversationMode?: boolean;
};

export function ActiveRecallStep({
  model,
  reviewMode = false,
  conversationMode = false,
}: Props) {
  const t = useT();
  const flashcardsEnabled = supportsFlashcards();
  const {
    unitId,
    practiceTab,
    setPracticeTab,
    sessionBusy,
    isContextLoading,
    renderGenStream,
    callSession,
    quizSets,
    quizSetsLoading,
    activeQuizSetId,
    openQuizSet,
    loadQuiz,
    retryCurrentQuizSet,
    renderQuizGenBox,
    questions,
    quizGenerating,
    genButtonLabel,
    quizReadOnly,
    quizGrade,
    quizExplainByIndex,
    explainQuizQuestion,
    stopQuizExplain,
    answers,
    setAnswers,
    submitQuiz,
    continueAfterQuiz,
    practiceAnotherBatch,
    finishDrills,
    recallProgress,
    quizPostSubmitDismissed,
    quizPlaceholderCount,
    sq,
    assessmentLocked,
  } = model;

  return (
    <div className="space-y-4">
      {assessmentLocked ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {t("wizard.steps.activeRecall.assessmentPreparing")}
        </p>
      ) : null}
      <h2 className="text-lg font-semibold text-[var(--text-800)]">
        {t("wizard.steps.activeRecall.title")}
      </h2>
      <PracticeHub
        activeTab={practiceTab}
        onTabChange={setPracticeTab}
        showFlashcards={flashcardsEnabled}
        flashcards={
          <UnitFlashcardPanel
            unitId={unitId}
            sessionBusy={sessionBusy}
            generating={isContextLoading("flashcards")}
            genStream={renderGenStream("flashcards")}
            onGenerateViaSession={() => void callSession("generate_flashcards")}
          />
        }
        quiz={
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <QuizSetDrawer
                sets={quizSets}
                loading={quizSetsLoading}
                activeQuizSetId={activeQuizSetId}
                onSelect={(set) => void openQuizSet(set, false)}
                onSelectAttempt={
                  reviewMode ? undefined : (set) => void openQuizSet(set, true)
                }
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadQuiz()}
                  disabled={assessmentLocked || isContextLoading("quiz")}
                >
                  {questions.length > 0
                    ? reviewMode
                      ? t("wizard.steps.activeRecall.generateNewQuiz")
                      : t("wizard.steps.common.regenerate")
                    : t("wizard.steps.activeRecall.generateQuestions")}
                </Button>
                {questions.length > 0 &&
                  activeQuizSetId &&
                  (quizGrade || quizReadOnly) &&
                  !reviewMode && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void retryCurrentQuizSet()}
                      disabled={
                        assessmentLocked ||
                        sessionBusy ||
                        isContextLoading("quiz")
                      }
                    >
                      {t("wizard.steps.activeRecall.resetAndRetry")}
                    </Button>
                  )}
              </div>
            </div>
            {renderQuizGenBox("quiz")}

            {questions.length === 0 && !quizGenerating && (
              <div className="space-y-3">
                <p className="text-sm text-[var(--text-400)]">
                  {t("wizard.steps.activeRecall.quizDescription")}
                </p>
                <Button
                  onClick={loadQuiz}
                  disabled={assessmentLocked || isContextLoading("quiz")}
                >
                  {genButtonLabel(
                    "quiz",
                    t("wizard.steps.activeRecall.generateQuiz"),
                  )}
                </Button>
              </div>
            )}

            {quizReadOnly && !reviewMode && (
              <p className="text-sm text-[var(--text-400)]">
                {t("wizard.steps.activeRecall.submittedReadOnly")}
              </p>
            )}

            {quizGrade && !reviewMode && (
              <div className="rounded-lg border border-[var(--brand-200)] bg-[var(--brand-50)] p-4">
                <p className="text-lg font-semibold text-[var(--brand-700)]">
                  {t("wizard.steps.activeRecall.score", {
                    score: Math.round(quizGrade.score * 100),
                    correct: quizGrade.results.filter(
                      (result) => result.status === "correct",
                    ).length,
                    total: quizGrade.results.length,
                  })}
                </p>
                <p className="mt-1 text-sm text-[var(--brand-700)]">
                  {quizReadOnly
                    ? t("wizard.steps.activeRecall.readOnlyResults")
                    : quizGrade.nextStep === "socratic"
                      ? quizGrade.score >= 0.7
                        ? t("wizard.steps.activeRecall.continueToSocratic")
                        : t(
                            "wizard.steps.activeRecall.needsPracticeThenSocratic",
                          )
                      : quizGrade.score >= 0.7
                        ? FEATURE_FEYNMAN
                          ? t("wizard.steps.activeRecall.goodThenFeynman")
                          : t("wizard.steps.activeRecall.goodThenComplete")
                        : t(
                            "wizard.steps.activeRecall.needsPracticeThenSocratic",
                          )}
                </p>
                {recallProgress ? (
                  <div className="mt-3 space-y-1 text-sm text-[var(--brand-700)]">
                    <p>
                      {t("wizard.steps.activeRecall.progress", {
                        completed: recallProgress.completedBatches,
                        total: recallProgress.totalAnswers,
                      })}
                    </p>
                    <p className="text-[var(--text-600)]">
                      {recallProgress.recommendation === "continue_now"
                        ? t("wizard.steps.activeRecall.recommendAnotherBatch")
                        : t("wizard.steps.activeRecall.reviewLater")}
                    </p>
                  </div>
                ) : null}
              </div>
            )}

            {questions.map((q, i) => {
              const graded = quizGrade?.results.find((r) => r.index === i);
              const explainItem = quizExplainByIndex[i];
              const hideQuizReveal =
                reviewMode ||
                (quizGrade?.nextStep === "socratic" &&
                  graded?.status !== "correct");
              const resultToneClass =
                graded && !reviewMode
                  ? graded.status === "correct"
                    ? "border-[var(--quiz-result-correct-border)] bg-[var(--quiz-result-correct-bg)]"
                    : graded.status === "partial"
                      ? "border-[var(--quiz-result-partial-border)] bg-[var(--quiz-result-partial-bg)]"
                      : "border-[var(--quiz-result-incorrect-border)] bg-[var(--quiz-result-incorrect-bg)]"
                  : "border-[var(--border-200)]";

              return (
                <div
                  key={i}
                  className={`rounded-lg border p-4 ${resultToneClass}`}
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base font-medium leading-relaxed text-[var(--course-content)]">
                    <span className="shrink-0 tabular-nums">{i + 1}.</span>
                    <div className="min-w-0 flex-1">
                      <LlmMarkdownInline content={q.question} />
                    </div>
                    {graded && !reviewMode && (
                      <span
                        className={`shrink-0 text-sm font-normal ${
                          graded.status === "correct"
                            ? "text-[var(--quiz-result-correct-text)]"
                            : graded.status === "partial"
                              ? "text-[var(--quiz-result-partial-text)]"
                              : "text-[var(--quiz-result-incorrect-text)]"
                        }`}
                      >
                        {graded.status === "correct"
                          ? t("wizard.steps.activeRecall.correctMark")
                          : graded.status === "partial"
                            ? t("wizard.steps.activeRecall.partialMark")
                            : t("wizard.steps.activeRecall.incorrectMark")}
                      </span>
                    )}
                  </div>
                  {graded &&
                  !reviewMode &&
                  graded.status !== "correct" &&
                  Array.isArray(
                    (q as { learningTargetIds?: string[] }).learningTargetIds,
                  ) &&
                  (q as { learningTargetIds?: string[] }).learningTargetIds!
                    .length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {resolveLearningTargetLabels(
                        (q as { learningTargetIds?: string[] })
                          .learningTargetIds,
                        sq?.learningTargets,
                      ).map((label) => (
                        <span
                          key={label}
                          className="rounded-md border border-[var(--border-200)] bg-[var(--bg-300)]/40 px-2 py-0.5 text-xs text-[var(--text-400)]"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {graded && !reviewMode ? (
                    <div className="mt-3 space-y-2 text-sm text-[var(--text-800)]">
                      <p className="text-[var(--course-content-muted)]">
                        {t("wizard.steps.activeRecall.yourAnswer")}
                        <span className="font-medium text-[var(--text-800)]">
                          <LlmMarkdownInline content={graded.userAnswerLabel} />
                        </span>
                      </p>
                      {!hideQuizReveal && graded.correctAnswerLabel && (
                        <p className="text-[var(--course-content-muted)]">
                          {t("wizard.steps.activeRecall.referenceAnswer")}
                          <span className="font-medium text-[var(--quiz-answer-correct-text)]">
                            <LlmMarkdownInline
                              content={graded.correctAnswerLabel}
                            />
                          </span>
                        </p>
                      )}
                      {!hideQuizReveal &&
                        graded.rubric &&
                        graded.status !== "correct" && (
                          <p className="text-[var(--text-400)]">
                            {t("wizard.steps.activeRecall.rubric")}
                            <LlmMarkdownInline content={graded.rubric} />
                          </p>
                        )}
                      {!hideQuizReveal && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="rounded-full border border-[var(--quiz-ai-button-border)] bg-[var(--quiz-ai-button-bg)] px-3 py-1 text-xs font-medium text-[var(--quiz-ai-button-text)] transition-colors hover:bg-[var(--quiz-ai-button-hover-bg)] disabled:opacity-60"
                            onClick={() => void explainQuizQuestion(i)}
                            disabled={Boolean(explainItem?.loading)}
                          >
                            {explainItem?.loading
                              ? t("wizard.steps.activeRecall.explaining")
                              : explainItem?.text
                                ? t("wizard.steps.activeRecall.explainAgain")
                                : t(
                                    "wizard.steps.activeRecall.viewAiExplanation",
                                  )}
                          </button>
                          {explainItem?.loading && (
                            <AiGenStopButton onStop={stopQuizExplain} />
                          )}
                        </div>
                      )}
                      {!hideQuizReveal &&
                        explainItem &&
                        (explainItem.loading || explainItem.text) && (
                          <div className="mt-3 rounded-lg border border-[var(--quiz-ai-border)] bg-[var(--quiz-ai-bg)] p-4">
                            <p className="text-sm font-semibold text-[var(--quiz-ai-title)]">
                              {t("wizard.steps.activeRecall.aiExplanation")}
                              {explainItem.loading && !explainItem.text && (
                                <span className="ml-2 inline-flex items-center gap-1 font-normal text-[var(--quiz-ai-muted)]">
                                  <span
                                    className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--quiz-ai-pulse)]"
                                    aria-hidden
                                  />
                                  {t("wizard.steps.common.generating")}
                                </span>
                              )}
                            </p>
                            {explainItem.text && (
                              <div className="mt-2">
                                <ProseMarkdown
                                  content={explainItem.text}
                                  variant="compact"
                                />
                              </div>
                            )}
                          </div>
                        )}
                    </div>
                  ) : (
                    <>
                      {q.type === "mcq" && (
                        <QuizChoiceGroup
                          selection="single"
                          hint={t("wizard.steps.activeRecall.singleChoice")}
                        >
                          {(q.options ?? []).map((opt, j) => (
                            <QuizChoiceOption
                              key={j}
                              indicator="radio"
                              selected={answers[i] === j}
                              disabled={quizReadOnly || Boolean(graded)}
                              state={answers[i] === j ? "selected" : "idle"}
                              onSelect={() =>
                                setAnswers({ ...answers, [i]: j })
                              }
                            >
                              <LlmMarkdownInline content={opt} />
                            </QuizChoiceOption>
                          ))}
                        </QuizChoiceGroup>
                      )}
                      {q.type === "mcq_multi" && (
                        <QuizChoiceGroup
                          selection="multiple"
                          hint={t("wizard.steps.activeRecall.multipleChoice")}
                        >
                          {(q.options ?? []).map((opt, j) => {
                            const selected = normalizeSelectedIndices(
                              answers[i],
                            );
                            const checked = selected.includes(j);
                            return (
                              <QuizChoiceOption
                                key={j}
                                indicator="checkbox"
                                selected={checked}
                                disabled={quizReadOnly || Boolean(graded)}
                                state={checked ? "selected" : "idle"}
                                onSelect={() => {
                                  const next = checked
                                    ? selected.filter((index) => index !== j)
                                    : [...selected, j].sort((a, b) => a - b);
                                  setAnswers({ ...answers, [i]: next });
                                }}
                              >
                                <LlmMarkdownInline content={opt} />
                              </QuizChoiceOption>
                            );
                          })}
                        </QuizChoiceGroup>
                      )}
                      {q.type === "true_false" && (
                        <QuizChoiceGroup
                          selection="single"
                          layout="pair"
                          hint={t("wizard.steps.activeRecall.trueFalse")}
                        >
                          {[true, false].map((value) => (
                            <QuizChoiceOption
                              key={String(value)}
                              indicator="radio"
                              selected={answers[i] === value}
                              disabled={quizReadOnly || Boolean(graded)}
                              state={answers[i] === value ? "selected" : "idle"}
                              onSelect={() =>
                                setAnswers({ ...answers, [i]: value })
                              }
                            >
                              {value
                                ? t("wizard.steps.activeRecall.true")
                                : t("wizard.steps.activeRecall.false")}
                            </QuizChoiceOption>
                          ))}
                        </QuizChoiceGroup>
                      )}
                    </>
                  )}
                </div>
              );
            })}

            {quizPlaceholderCount > 0 &&
              Array.from({ length: quizPlaceholderCount }).map((_, i) => (
                <div
                  key={`quiz-placeholder-${questions.length + i}`}
                  className="rounded border border-dashed border-[var(--border-200)] bg-[var(--bg-100)] p-4"
                  aria-hidden
                >
                  <div className="flex items-center gap-2 font-medium text-[var(--text-400)]">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--brand-400)]" />
                    <span className="tabular-nums">
                      {questions.length + i + 1}.
                    </span>
                    <span className="h-4 flex-1 max-w-xs animate-pulse rounded bg-[var(--border-200)]" />
                  </div>
                  <div className="mt-3 space-y-2">
                    {Array.from({ length: 4 }).map((__, optionIndex) => (
                      <div
                        key={optionIndex}
                        className="h-8 animate-pulse rounded bg-[var(--border-200)]/70"
                      />
                    ))}
                  </div>
                </div>
              ))}

            {questions.length > 0 && !quizGrade && !quizReadOnly && (
              <div
                className={
                  conversationMode
                    ? "sticky bottom-3 z-10 space-y-1 rounded-2xl border border-[var(--course-content-border)] bg-[var(--bg-50)]/95 p-3 shadow-lg backdrop-blur"
                    : "space-y-1"
                }
              >
                <Button
                  onClick={submitQuiz}
                  disabled={assessmentLocked || sessionBusy || quizGenerating}
                >
                  {sessionBusy
                    ? t("wizard.steps.activeRecall.grading")
                    : quizGenerating
                      ? t("wizard.steps.activeRecall.preparingPractice")
                      : t("wizard.steps.activeRecall.submitAndGrade")}
                </Button>
                {quizGenerating && (
                  <p className="text-xs text-[var(--text-400)]">
                    {t("wizard.steps.activeRecall.answerWhileGenerating")}
                  </p>
                )}
              </div>
            )}
            {quizGrade &&
              !quizReadOnly &&
              !quizPostSubmitDismissed &&
              (reviewMode ? (
                quizGrade.score < 1 && (
                  <Button onClick={() => continueAfterQuiz("socratic")}>
                    {t("wizard.steps.activeRecall.continueSocratic")}
                  </Button>
                )
              ) : (
                <div
                  className={
                    conversationMode
                      ? "sticky bottom-3 z-10 flex flex-wrap gap-2 rounded-2xl border border-[var(--course-content-border)] bg-[var(--bg-50)]/95 p-3 shadow-lg backdrop-blur"
                      : "flex flex-wrap gap-2"
                  }
                >
                  <Button onClick={() => continueAfterQuiz(quizGrade.nextStep)}>
                    {quizGrade.nextStep === "feynman"
                      ? t("wizard.steps.activeRecall.continueFeynman")
                      : quizGrade.nextStep === "complete"
                        ? t("wizard.steps.activeRecall.continueComplete")
                        : t("wizard.steps.activeRecall.continueSocratic")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void practiceAnotherBatch()}
                    disabled={
                      assessmentLocked ||
                      sessionBusy ||
                      isContextLoading("quiz")
                    }
                  >
                    {t("wizard.steps.activeRecall.anotherBatch")}
                  </Button>
                  {quizGrade.nextStep === "socratic" && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void finishDrills()}
                      disabled={sessionBusy || assessmentLocked}
                    >
                      {t("wizard.steps.activeRecall.skipAndComplete")}
                    </Button>
                  )}
                </div>
              ))}
          </div>
        }
      />
    </div>
  );
}
