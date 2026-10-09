import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Brain, CheckCircle2 } from "lucide-react";
import { LlmMarkdownInline } from "@/components/markdown/llm-markdown";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { Card, CardTitle } from "@/components/ui/card";
import { apiGet, apiPost } from "@/shared/api/http";
import { consumeSsePost } from "@/shared/client/consume-sse";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { useQueryClient } from "@tanstack/react-query";
import type {
  CognitiveDimension,
  LearningTarget,
} from "@/shared/domain/cognitive-model";
import {
  ConversationActivity,
  ConversationTurn,
  LearningConversationSurface,
} from "@/components/wizard/conversation/learning-conversation-surface";
import { useLearningViewSettings } from "@/hooks/api/use-settings";
import { useTeachingPersonas } from "@/hooks/api/use-teaching-personas";
import { teachingPersonaAvatarSrc } from "@/shared/teaching-persona-avatar";
import { localizeTeachingPersonaName } from "@/shared/teaching-persona-i18n";
import { AiGeneratedNotice } from "@/components/ui/ai-generated-notice";
import { diagnosticCompletionPath } from "@/shared/domain/diagnostic-navigation";

type QuizQuestion = {
  type: "mcq" | "mcq_multi";
  question: string;
  options: string[];
  learningTargetIds: string[];
  primaryLearningTargetId: string;
  evidenceDimension: Extract<
    CognitiveDimension,
    "memory" | "understanding" | "application" | "transfer"
  >;
  criterionRef: string;
  contextDistance: "same" | "near" | "far";
};

type DiagnosticState = {
  eligible: boolean;
  unitStatus: string;
  completionMethod?: string | null;
  remediationUnitId?: string | null;
  learningTargets: LearningTarget[];
  latestAttempt?: {
    id: string;
    status: "ready" | "submitted";
    questions: QuizQuestion[];
    overallScore?: number | null;
    passed?: boolean | null;
    perLearningTargetResults?: TargetResult[];
  } | null;
};

type TargetResult = {
  learningTargetId: string;
  title: string;
  score: number;
  questionCount?: number;
  passed: boolean;
  failures?: Array<{
    dimension: CognitiveDimension;
    reason:
      "unobserved" | "insufficient_evidence" | "below_threshold" | "revalidate";
  }>;
};

type DiagnosticResult = {
  overallScore: number;
  passed: boolean;
  perLearningTargetResults: TargetResult[];
  nextStep: "complete" | "weak_point_focus";
  nextUnitId?: string | null;
  remediationUnitId?: string | null;
};

function remainingEvidenceDimensions(row: TargetResult): CognitiveDimension[] {
  return [...new Set((row.failures ?? []).map((failure) => failure.dimension))];
}

function hasQuizGap(result: DiagnosticResult): boolean {
  return result.perLearningTargetResults.some((row) => {
    const failures = row.failures ?? [];
    if (failures.length === 0) {
      return (row.questionCount ?? 1) > 0 && row.score < 0.7;
    }
    return failures.some(
      (failure) =>
        failure.dimension === "memory" || failure.dimension === "understanding",
    );
  });
}

function DiagnosticPresentation({
  chat,
  persona,
  intro,
  label,
  children,
}: {
  chat: boolean;
  persona: { name: string; avatarSrc?: string };
  intro: string;
  label: string;
  children: ReactNode;
}) {
  if (!chat) return children;
  return (
    <LearningConversationSurface persona={persona}>
      <ConversationTurn role="assistant">{intro}</ConversationTurn>
      <ConversationActivity label={label}>{children}</ConversationActivity>
    </LearningConversationSurface>
  );
}

export function UnitDiagnosticPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const { goalId = "", unitId = "", moduleId = "" } = useParams();
  const isModuleDiagnostic = Boolean(moduleId);
  const endpointBase = isModuleDiagnostic
    ? `/api/goals/${goalId}/modules/${moduleId}/diagnostic`
    : `/api/units/${unitId}/diagnostic`;
  const [state, setState] = useState<DiagnosticState | null>(null);
  const [attemptId, setAttemptId] = useState("");
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, number | number[]>>({});
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const learningView = useLearningViewSettings();
  const personas = useTeachingPersonas({ goalId });
  const chatMode = (learningView.data?.mode ?? "chat") === "chat";
  const persona = {
    name: localizeTeachingPersonaName(personas.data?.current, t),
    avatarSrc: teachingPersonaAvatarSrc(
      personas.data?.current.avatarCode ?? "xiaohui_female",
    ),
  };

  useEffect(() => {
    void apiGet<DiagnosticState & { capabilities?: LearningTarget[] }>(
      endpointBase,
    )
      .then((raw) => {
        const data = {
          ...raw,
          learningTargets: raw.learningTargets ?? raw.capabilities ?? [],
        };
        setState(data);
        if (data.latestAttempt?.status === "ready") {
          setAttemptId(data.latestAttempt.id);
          setQuestions(data.latestAttempt.questions);
        } else if (data.latestAttempt?.status === "submitted") {
          setResult({
            overallScore: data.latestAttempt.overallScore ?? 0,
            passed: Boolean(data.latestAttempt.passed),
            perLearningTargetResults:
              data.latestAttempt.perLearningTargetResults ?? [],
            nextStep: data.latestAttempt.passed
              ? "complete"
              : "weak_point_focus",
            remediationUnitId: data.remediationUnitId,
          });
        }
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : t("assessment.diagnostic.loadError"),
        ),
      )
      .finally(() => setLoading(false));
  }, [endpointBase]);

  const answeredCount = useMemo(
    () =>
      questions.filter((_, index) => {
        const value = answers[String(index)];
        return Array.isArray(value)
          ? value.length > 0
          : typeof value === "number";
      }).length,
    [answers, questions],
  );

  async function generate() {
    setError("");
    setLoading(true);
    setStatus(t("diagnostic.generating"));
    try {
      const done = await consumeSsePost(
        `${endpointBase}/stream`,
        {},
        (event) => {
          const row = event as unknown as {
            type: string;
            message?: string;
            questions?: QuizQuestion[];
            artifactKind?: string;
            patches?: Array<{ index: number; content: unknown }>;
          };
          if (row.type === "status" && row.message) setStatus(row.message);
          if (row.type === "quiz_partial" && row.questions)
            setQuestions(row.questions);
          if (
            row.type === "content_repair" &&
            row.artifactKind === "assessment" &&
            row.patches
          ) {
            setQuestions((current) => {
              const next = [...current];
              for (const patch of row.patches ?? []) {
                if (patch.index >= 0 && patch.index < next.length) {
                  next[patch.index] = patch.content as QuizQuestion;
                }
              }
              return next;
            });
          }
        },
      );
      const payload = done as unknown as {
        attemptId?: string;
        questions?: QuizQuestion[];
      };
      if (!payload?.attemptId || !payload.questions)
        throw new Error(t("assessment.diagnostic.generateError"));
      setAttemptId(payload.attemptId);
      setQuestions(payload.questions);
      setAnswers({});
      setResult(null);
      setStatus("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("assessment.diagnostic.generateError"),
      );
      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!attemptId || answeredCount !== questions.length) return;
    setLoading(true);
    setError("");
    try {
      const raw = await apiPost<
        DiagnosticResult & {
          perCapabilityResults?: TargetResult[];
          nextModuleId?: string | null;
        }
      >(`${endpointBase}/${attemptId}/submit`, { answers });
      const data: DiagnosticResult = {
        ...raw,
        perLearningTargetResults:
          raw.perLearningTargetResults ?? raw.perCapabilityResults ?? [],
        nextStep: raw.passed ? "complete" : "weak_point_focus",
        nextUnitId: isModuleDiagnostic ? raw.nextModuleId : raw.nextUnitId,
      };
      setResult(data);
      void queryClient.invalidateQueries({
        queryKey: ["profile", "learning-state"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["units", unitId, "learning-targets"],
      });
      void queryClient.invalidateQueries({ queryKey: ["cognition"] });
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes("cognitive-model"),
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("assessment.diagnostic.submitError"),
      );
    } finally {
      setLoading(false);
    }
  }

  function toggleMulti(questionIndex: number, optionIndex: number) {
    setAnswers((current) => {
      const key = String(questionIndex);
      const selected = Array.isArray(current[key])
        ? (current[key] as number[])
        : [];
      return {
        ...current,
        [key]: selected.includes(optionIndex)
          ? selected.filter((value) => value !== optionIndex)
          : [...selected, optionIndex].sort((a, b) => a - b),
      };
    });
  }

  if (loading && !state && questions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("assessment.diagnostic.loading")}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-12">
      <AiGeneratedNotice />
      <Link
        to={
          isModuleDiagnostic
            ? `/goals/${goalId}/modules/${moduleId}`
            : `/goals/${goalId}/units/${unitId}`
        }
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />{" "}
        {t(
          isModuleDiagnostic
            ? "assessment.diagnostic.backModule"
            : "assessment.diagnostic.backUnit",
        )}
      </Link>

      <div>
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Brain className="size-4" /> {t("diagnostic.title")}
        </div>
        <h1 className="mt-1 text-2xl font-bold">
          {isModuleDiagnostic
            ? t("assessment.diagnostic.moduleTest")
            : t("diagnostic.testOut")}
        </h1>
        {!chatMode ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {t("diagnostic.intro")}
          </p>
        ) : null}
      </div>

      <DiagnosticPresentation
        chat={chatMode}
        persona={persona}
        intro={t("diagnostic.intro")}
        label={t("diagnostic.title")}
      >
        <div className="space-y-5">
          {error && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}
          {status && (
            <p className="rounded-lg bg-muted p-3 text-sm">{status}</p>
          )}

          {state?.learningTargets?.length ? (
            <Card>
              <CardTitle>{t("assessment.diagnostic.targetsTitle")}</CardTitle>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {state.learningTargets.map((point) => (
                  <li key={point.id} className="rounded-lg border p-3 text-sm">
                    <p className="font-medium">{point.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {point.learningObjective}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {!questions.length && !result && state?.eligible !== false ? (
            <Button onClick={() => void generate()} disabled={loading}>
              {loading ? t("diagnostic.generating") : t("diagnostic.start")}
            </Button>
          ) : null}

          {!questions.length && !result && state?.eligible === false ? (
            <Card>
              <CardTitle>{t("diagnostic.notNeededTitle")}</CardTitle>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("diagnostic.notNeededBody")}
              </p>
              <Link
                className="mt-4 inline-block"
                to={
                  isModuleDiagnostic
                    ? `/goals/${goalId}/modules/${moduleId}`
                    : `/goals/${goalId}/units/${unitId}`
                }
              >
                <Button>
                  {t(
                    isModuleDiagnostic
                      ? "diagnostic.goBackModule"
                      : "diagnostic.goBackUnit",
                  )}
                </Button>
              </Link>
            </Card>
          ) : null}

          {!result && questions.length > 0 ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("assessment.diagnostic.answered", {
                  answered: answeredCount,
                  total: questions.length,
                })}
              </p>
              {questions.map((question, questionIndex) => (
                <Card key={`${questionIndex}-${question.question}`}>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-medium">
                    <span className="shrink-0 tabular-nums">
                      {questionIndex + 1}.
                    </span>
                    <div className="min-w-0 flex-1">
                      <LlmMarkdownInline content={question.question} />
                    </div>
                  </div>
                  {question.type === "mcq_multi" && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("diagnostic.multi")}
                    </p>
                  )}
                  <div className="mt-3 space-y-2">
                    {question.options.map((option, optionIndex) => {
                      const value = answers[String(questionIndex)];
                      const checked = Array.isArray(value)
                        ? value.includes(optionIndex)
                        : value === optionIndex;
                      return (
                        <label
                          key={optionIndex}
                          className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/50"
                        >
                          <input
                            type={
                              question.type === "mcq_multi"
                                ? "checkbox"
                                : "radio"
                            }
                            name={`question-${questionIndex}`}
                            checked={checked}
                            onChange={() =>
                              question.type === "mcq_multi"
                                ? toggleMulti(questionIndex, optionIndex)
                                : setAnswers((current) => ({
                                    ...current,
                                    [String(questionIndex)]: optionIndex,
                                  }))
                            }
                            className="mt-1"
                          />
                          <span className="text-sm">
                            <LlmMarkdownInline content={option} />
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </Card>
              ))}
              <Button
                className={
                  chatMode
                    ? "sticky bottom-3 z-10 w-full rounded-xl shadow-lg sm:w-auto"
                    : undefined
                }
                onClick={() => void submit()}
                disabled={loading || answeredCount !== questions.length}
              >
                {loading ? t("diagnostic.scoring") : t("diagnostic.submit")}
              </Button>
            </div>
          ) : null}

          {result ? (
            <Card
              className={
                result.passed
                  ? "border-green-300 bg-green-50"
                  : "border-amber-300 bg-amber-50"
              }
            >
              <div className="flex items-start gap-3">
                <CheckCircle2
                  className={
                    result.passed ? "text-green-700" : "text-amber-700"
                  }
                />
                <div className="min-w-0 flex-1">
                  <CardTitle>
                    {t(
                      result.passed ? "diagnostic.passed" : "diagnostic.failed",
                    )}
                  </CardTitle>
                  <p className="mt-1 text-sm">
                    {t("assessment.diagnostic.totalScore", {
                      score: Math.round(result.overallScore * 100),
                    })}
                  </p>
                  {!result.passed ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {t("diagnostic.evidenceBoundary")}
                    </p>
                  ) : null}
                  <ul className="mt-3 space-y-1 text-sm">
                    {result.perLearningTargetResults.map((row) => {
                      const remaining = remainingEvidenceDimensions(row).map(
                        (dimension) => t(`diagnostic.dimension.${dimension}`),
                      );
                      return (
                        <li key={row.learningTargetId}>
                          {row.passed ? "✓" : "·"} {row.title}
                          {row.questionCount === 0
                            ? `：${t("diagnostic.alreadyVerified")}`
                            : `：${t("diagnostic.closedBookScore", {
                                score: Math.round(row.score * 100),
                              })}`}
                          {remaining.length
                            ? ` · ${t("diagnostic.remainingEvidence", {
                                evidence: remaining.join("、"),
                              })}`
                            : ""}
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      to={diagnosticCompletionPath({
                        goalId,
                        unitId,
                        moduleId,
                        isModuleDiagnostic,
                        passed: result.passed,
                        nextId: result.nextUnitId,
                        remediationUnitId: result.remediationUnitId,
                      })}
                    >
                      <Button>
                        {result.passed && result.nextUnitId
                          ? t(
                              isModuleDiagnostic
                                ? "assessment.diagnostic.nextModule"
                                : "assessment.diagnostic.nextUnit",
                            )
                          : t(
                              result.passed
                                ? "uiChrome.goalLayout.journey"
                                : "diagnostic.learnWeak",
                            )}
                      </Button>
                    </Link>
                    {!result.passed && hasQuizGap(result) && (
                      <Button
                        variant="outline"
                        onClick={() => void generate()}
                        disabled={loading}
                      >
                        {t("diagnostic.retest")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ) : null}
        </div>
      </DiagnosticPresentation>
    </div>
  );
}
