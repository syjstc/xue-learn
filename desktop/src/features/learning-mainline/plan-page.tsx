import { mainlineTeachingIntent } from "./plan-projection.ts";
import { useEffect, useRef } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { MainlineDecision } from "@xue-learn/core/domain";
import { apiGet } from "@/shared/api";
import { useGoal, useLearnerDisplayName } from "@/hooks/api";
import { personalizeLearnerText } from "@/shared/domain/learner-text";
import { useT } from "@xue-learn/core/i18n";
import { Button } from "@xue-learn/core/ui/button";
import { ApiErrorNotice } from "@/components/ui/api-error-notice";
import { LlmMarkdown } from "@/components/markdown/llm-markdown";
import { useMainline } from "./provider.tsx";

export function MainlinePlanPage() {
  const { goalId = "" } = useParams(),
    [params] = useSearchParams(),
    navigate = useNavigate(),
    t = useT();
  const mainline = useMainline(),
    goal = useGoal(goalId);
  const learnerName = useLearnerDisplayName();
  const continued = params.get("continue") === "1",
    plan = params.get("view") === "plan";
  const restored = useRef("");
  const decision = useQuery({
    queryKey: ["mainline-next", goalId, mainline?.current?.id, continued],
    queryFn: () =>
      apiGet<MainlineDecision>(
        `/api/learning-trajectory/mainline/next?sessionId=${encodeURIComponent(mainline!.sessionId)}&goalId=${encodeURIComponent(goalId)}`,
      ),
    enabled: Boolean(mainline?.snapshot),
    refetchInterval: 5000,
  });
  const latest = mainline?.snapshot?.activities.find(
    (a) => a.goalId === goalId && a.state !== "ended",
  );
  useEffect(() => {
    if (!mainline || !goal.data || plan || restored.current === goalId) return;
    if (continued) {
      if (!decision.data) return;
      const next = decision.data.primary;
      if (next?.kind === "lesson" && next.goalId === goalId) {
        restored.current = goalId;
        navigate(`/goals/${goalId}/units/${next.unitId}`, { replace: true });
      }
    } else if (latest) {
      restored.current = goalId;
      void mainline.resume(latest);
    }
  }, [
    mainline,
    goal.data,
    plan,
    continued,
    decision.data,
    goalId,
    latest,
    navigate,
  ]);
  if (goal.error || decision.error)
    return (
      <ApiErrorNotice
        error={goal.error ?? decision.error}
        fallback={t("mainline.loadError")}
        onRetry={() => {
          void goal.refetch();
          void decision.refetch();
        }}
      />
    );
  if (!goal.data) return <p role="status">{t("mainline.preparing")}</p>;
  const value = goal.data;
  const intent = mainlineTeachingIntent(value.generationOptions);
  const levelLabel = (level: string | undefined) =>
    level === "zero" || level === "basic" || level === "advanced"
      ? t(`goals.level.${level}`)
      : level;
  const modules = [...(value.modules ?? [])].sort(
    (a, b) => a.orderIndex - b.orderIndex,
  );
  const next = decision.data?.primary;
  const start = next?.kind === "lesson" && next.goalId === goalId ? next : null;
  const preference = mainline?.snapshot?.preferences.find(
    (p) => p.goalId === goalId,
  ) ?? {
    newLearning: "active" as const,
    reviews: true,
    priority: 0,
    revision: 0,
  };
  const currentModule =
    modules.find((m) => m.id === value.currentModuleId) ??
    modules.find((m) => m.status === "active");
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 pb-8" data-mainline-plan>
      <header className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">
          {t("mainline.plan")}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {value.title}
        </h1>
        {value.topicOverview ? (
          <LlmMarkdown
            content={personalizeLearnerText(value.topicOverview, learnerName)}
            variant="muted"
          />
        ) : null}
        {intent.startingLevel || intent.targetLevel ? (
          <p className="text-sm text-muted-foreground">
            {t("mainline.startingLevel")}：
            {levelLabel(intent.startingLevel) ?? "—"}
            {intent.targetLevel ? ` → ${levelLabel(intent.targetLevel)}` : ""}
          </p>
        ) : null}
        {intent.outcomes.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {intent.outcomes.map((outcome, i) => (
              <li key={i}>{outcome}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          {latest ? (
            <Button
              disabled={mainline?.busy}
              onClick={() => void mainline?.resume(latest)}
            >
              {t("mainline.continue")}
            </Button>
          ) : start ? (
            <Button
              onClick={() => navigate(`/goals/${goalId}/units/${start.unitId}`)}
            >
              {t("mainline.start")}
            </Button>
          ) : (
            <Button disabled>{t("mainline.preparing")}</Button>
          )}
          <Link
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            to={`/goals/${goalId}?view=catalog`}
          >
            {t("mainline.catalog")}
          </Link>
        </div>
        {start ? (
          <p className="text-sm text-muted-foreground">
            {t("mainline.nextTopic", { title: start.title })}
          </p>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {t(
              decision.data?.reason === "none"
                ? "mainline.noNext"
                : "mainline.wait",
            )}
          </p>
        )}
      </header>
      <ol className="space-y-3">
        {modules.map((module) => (
          <li
            key={module.id}
            className={`rounded-2xl border p-5 ${module.id === currentModule?.id ? "border-primary bg-primary/5" : "border-border"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-medium">{module.title}</h2>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t(
                  module.status === "completed"
                    ? "mainline.finished"
                    : module.id === currentModule?.id
                      ? "mainline.currentStage"
                      : "mainline.planned",
                )}
              </span>
            </div>
            {module.objective || module.summary ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {module.objective || module.summary}
              </p>
            ) : null}
            {module.plannedOutcomes.length ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                {module.plannedOutcomes.map((outcome, i) => (
                  <li key={i}>{outcome}</li>
                ))}
              </ul>
            ) : null}
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                {t("mainline.stageDetails")}
              </summary>
              <ul className="mt-3 space-y-2">
                {(module.unitOutline ?? []).map((unit, i) => (
                  <li key={unit.id ?? i}>{unit.title}</li>
                ))}
              </ul>
              <Link
                className="mt-3 inline-block underline"
                to={`/goals/${goalId}/modules/${module.id}`}
              >
                {t("mainline.catalog")}
              </Link>
            </details>
          </li>
        ))}
        {!modules.length
          ? value.units
              .filter((u) => u.unitKind === "lesson")
              .map((u) => (
                <li className="rounded-xl border border-border p-4" key={u.id}>
                  {u.title}
                </li>
              ))
          : null}
      </ol>
      <details className="border-t border-border pt-4 text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          {t("mainline.preferences")}
        </summary>
        <div className="mt-4 flex flex-wrap gap-5">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={preference.newLearning === "active"}
              onChange={(e) =>
                void mainline
                  ?.command({
                    action: "preference",
                    goalId,
                    preference: {
                      ...preference,
                      newLearning: e.target.checked ? "active" : "paused",
                    },
                  })
                  .catch(() => undefined)
              }
            />
            {t("mainline.newLearning")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={preference.reviews}
              onChange={(e) =>
                void mainline
                  ?.command({
                    action: "preference",
                    goalId,
                    preference: { ...preference, reviews: e.target.checked },
                  })
                  .catch(() => undefined)
              }
            />
            {t("mainline.reviews")}
          </label>
          <label className="flex items-center gap-2">
            {t("mainline.priority")}
            <select
              value={preference.priority}
              className="rounded border border-border bg-background p-1"
              onChange={(e) =>
                void mainline
                  ?.command({
                    action: "preference",
                    goalId,
                    preference: {
                      ...preference,
                      priority: Number(e.target.value),
                    },
                  })
                  .catch(() => undefined)
              }
            >
              {[0, 1, 2, 3].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            {t("mainline.timeBudget")}
            <input
              type="number"
              min={1}
              max={1440}
              className="w-20 rounded border border-border bg-background p-1"
              value={mainline?.timeLimitMinutes ?? ""}
              onChange={(e) =>
                mainline?.setTimeLimitMinutes(
                  e.target.value
                    ? Math.max(1, Math.min(1440, Number(e.target.value)))
                    : undefined,
                )
              }
            />
          </label>
          <Link to={`/goals/${goalId}/plan`} className="underline">
            {t("mainline.adjust")}
          </Link>
        </div>
      </details>
    </div>
  );
}
