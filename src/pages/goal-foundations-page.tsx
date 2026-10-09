import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Check, Layers3, Sparkles } from "lucide-react";
import { Button, buttonVariants } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { Card } from "@/components/ui/card";
import {
  useCreateFoundationGoal,
  useFoundationGoals,
  useGoal,
  useUpgradeFoundationToMastery,
} from "@/hooks/api";
import { cn } from "@xue-learn/core/source/src/lib/utils.ts";
import { isNotFound } from "@/shared/api";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { supportsGoalMasteryTransition } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";

export function GoalFoundationsPage() {
  const t = useT();
  const { goalId = "" } = useParams();
  const navigate = useNavigate();
  const goal = useGoal(goalId);
  const foundations = useFoundationGoals(goalId);
  const createGoal = useCreateFoundationGoal(goalId);
  const upgrade = useUpgradeFoundationToMastery(goalId);
  const available = foundations.data?.uncoveredPrerequisites ?? [];
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    setSelected((current) =>
      current.filter((item) => available.includes(item)),
    );
  }, [available]);

  const allSelected =
    available.length > 0 && available.every((item) => selected.includes(item));
  const existing = foundations.data?.foundationGoals ?? [];
  const statusCopy = useMemo(
    () => ({
      preparing: t("goalDetail.foundations.status.preparing"),
      ready: t("goalDetail.foundations.status.ready"),
      failed: t("goalDetail.foundations.status.failed"),
    }),
    [t],
  );

  if (isNotFound(goal.error) || isNotFound(foundations.error)) {
    return <Navigate to="/404" replace />;
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header>
        <p className="flex items-center gap-2 text-xs font-semibold text-[var(--brand-600)]">
          <Layers3 className="size-4" aria-hidden />
          {goal.data?.title ?? t("goalDetail.learningGoal")}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-[var(--text-800)]">
          {t("goalDetail.foundations.title")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-500)]">
          {t("goalDetail.foundations.description")}
        </p>
      </header>

      {goal.data?.parentGoal ? (
        <Card className="flex-row items-center justify-between p-4">
          <div>
            <p className="text-xs text-[var(--text-400)]">
              {t("goalDetail.foundations.parentGoal")}
            </p>
            <p className="mt-1 font-medium text-[var(--text-800)]">
              {goal.data.parentGoal.title}
            </p>
          </div>
          <Link
            className={buttonVariants({ variant: "outline", size: "sm" })}
            to={`/goals/${goal.data.parentGoal.id}`}
          >
            {t("goalDetail.foundations.backToParent")}
          </Link>
        </Card>
      ) : null}

      {existing.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-[var(--text-800)]">
            {t("goalDetail.foundations.created")}
          </h2>
          {existing.map((item) => (
            <Card className="p-4" key={item.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h3 className="font-semibold text-[var(--text-800)]">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--text-400)]">
                    {statusCopy[item.generationStatus]} · {item.progressPercent}
                    %
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-400)]">
                    {item.learningMode === "mastery"
                      ? t("goalDetail.foundations.mode.mastery")
                      : item.masteryTransition.status === "building" ||
                          item.masteryTransition.status === "queued"
                        ? t("goalDetail.foundations.mode.preparingMastery")
                        : t("goalDetail.foundations.mode.exploration")}
                  </p>
                  <p className="mt-2 text-sm text-[var(--text-500)]">
                    {item.prerequisiteItems.join(" · ")}
                  </p>
                </div>
                <Link
                  className={cn(
                    buttonVariants({ size: "sm" }),
                    "self-start sm:self-auto",
                  )}
                  to={`/goals/${item.id}`}
                >
                  {item.progressPercent > 0
                    ? t("goalDetail.foundations.continue")
                    : t("goalDetail.foundations.enter")}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--bg-300)]">
                <div
                  className="h-full rounded-full bg-[var(--brand-500)]"
                  style={{ width: `${item.progressPercent}%` }}
                />
              </div>
              {supportsGoalMasteryTransition() &&
              item.learningMode === "exploration" &&
              item.canUpgradeToMastery !== false ? (
                <div className="mt-4 border-t border-[var(--border-200)] pt-4">
                  {item.masteryTransition.error ? (
                    <p className="mb-2 text-xs text-destructive">
                      {item.masteryTransition.error}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      upgrade.isPending ||
                      item.masteryTransition.status === "queued" ||
                      item.masteryTransition.status === "building" ||
                      item.generationStatus !== "ready"
                    }
                    onClick={() => {
                      const confirmed = window.confirm(
                        t("goalDetail.foundations.upgradeConfirm"),
                      );
                      if (confirmed) upgrade.mutate(item.id);
                    }}
                  >
                    <Sparkles className="size-4" aria-hidden />
                    {item.masteryTransition.status === "queued" ||
                    item.masteryTransition.status === "building"
                      ? t("goalDetail.foundations.upgradePreparing")
                      : item.masteryTransition.retryable
                        ? t("goalDetail.foundations.upgradeRetry")
                        : t("goalDetail.foundations.upgrade")}
                  </Button>
                </div>
              ) : null}
            </Card>
          ))}
        </section>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-800)]">
            {t("goalDetail.foundations.expected")}
          </h2>
          <p className="mt-1 text-xs text-[var(--text-400)]">
            {t("goalDetail.foundations.assumptionNote")}
          </p>
        </div>
        {foundations.isPending ? (
          <Card className="p-5 text-sm text-[var(--text-400)]">
            {t("goalDetail.loading")}
          </Card>
        ) : foundations.error ? (
          <Card className="p-5 text-sm text-destructive">
            {foundations.error.message}
          </Card>
        ) : available.length === 0 ? (
          <Card className="p-5 text-sm text-[var(--text-500)]">
            {existing.length > 0
              ? t("goalDetail.foundations.emptyCovered")
              : t("goalDetail.foundations.empty")}
          </Card>
        ) : (
          <Card className="p-4">
            <button
              type="button"
              className="mb-3 text-xs font-medium text-[var(--brand-600)]"
              onClick={() => setSelected(allSelected ? [] : [...available])}
            >
              {allSelected
                ? t("goalDetail.foundations.deselectAll")
                : t("goalDetail.foundations.selectAll")}
            </button>
            <div className="space-y-2">
              {available.map((item) => {
                const checked = selected.includes(item);
                return (
                  <button
                    type="button"
                    key={item}
                    onClick={() =>
                      setSelected((current) =>
                        checked
                          ? current.filter((value) => value !== item)
                          : [...current, item],
                      )
                    }
                    className="flex w-full items-start gap-3 rounded-lg border border-[var(--border-200)] p-3 text-left hover:bg-[var(--bg-100)]"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border",
                        checked
                          ? "border-[var(--brand-500)] bg-[var(--brand-500)] text-white"
                          : "border-[var(--border-300)]",
                      )}
                      aria-hidden
                    >
                      {checked ? <Check className="size-3.5" /> : null}
                    </span>
                    <span className="text-sm leading-6 text-[var(--text-700)]">
                      {item}
                    </span>
                  </button>
                );
              })}
            </div>
            {createGoal.error ? (
              <p className="mt-3 text-sm text-destructive">
                {createGoal.error.message}
              </p>
            ) : null}
            <Button
              className="mt-4"
              disabled={selected.length === 0 || createGoal.isPending}
              onClick={() =>
                createGoal.mutate(selected, {
                  onSuccess: () => navigate("/goals/creating"),
                })
              }
            >
              {createGoal.isPending ? "正在创建…" : "创建基础补充目标"}
            </Button>
          </Card>
        )}
      </section>
    </div>
  );
}
