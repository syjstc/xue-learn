"use client";

import type {
  LearnerStateStatus,
  LearnerStateTargetSummary,
  LearningStateSummary,
} from "@/shared/domain/learning-state-memory";
import { useLearningState } from "@/hooks/api/use-learning-state";
import { useT } from "@xue-learn/core/i18n";

const STATUS_ORDER: LearnerStateStatus[] = [
  "forming",
  "demonstrated",
  "robust",
  "revalidate",
  "unobserved",
];

function formatPercent(value: number | null) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function TargetList({
  title,
  items,
}: {
  title: string;
  items: LearnerStateTargetSummary[];
}) {
  const t = useT();
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("learningState.emptySection")}
        </p>
      ) : (
        <div className="grid gap-2">
          {items.map((target) => (
            <article
              key={`${target.goalId}:${target.learningTargetId}`}
              className="rounded-lg border border-border/70 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{target.title}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {target.goalTitle}
                    {target.unitTitle ? ` · ${target.unitTitle}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-semibold">
                    {formatPercent(target.overallEstimate)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t(`learningState.status.${target.status}`)}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {target.reason ? (
                  <span>{t(`learningState.reason.${target.reason}`)}</span>
                ) : null}
                <span>
                  {t("learningState.evidence")}:{" "}
                  {formatPercent(target.evidenceSufficiency)}
                </span>
                <span>
                  {target.dimensions
                    .map((item) =>
                      t(`learningState.dimension.${item.dimension}`),
                    )
                    .join(" · ")}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SummaryBody({ state }: { state: LearningStateSummary }) {
  const t = useT();
  const hours = Math.floor(state.totalActiveSeconds / 3600);
  const minutes = Math.floor((state.totalActiveSeconds % 3600) / 60);
  const duration =
    hours > 0
      ? t("learningState.durationHoursMinutes", { hours, minutes })
      : t("learningState.durationMinutes", { minutes });
  return (
    <div className="space-y-6">
      {state.stale ? (
        <div className="rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {t("learningState.stale")}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-muted/50 p-3">
          <div className="text-xs text-muted-foreground">
            {t("learningState.activeTime")}
          </div>
          <div className="mt-1 text-xl font-semibold">
            {duration}
          </div>
        </div>
        {STATUS_ORDER.map((status) => (
          <div key={status} className="rounded-lg bg-muted/50 p-3">
            <div className="text-xs text-muted-foreground">
              {t(`learningState.status.${status}`)}
            </div>
            <div className="mt-1 text-xl font-semibold">
              {state.counts[status]}
            </div>
          </div>
        ))}
      </div>

      {state.goals.length === 0 ? (
        <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
          {t("learningState.empty")}
        </p>
      ) : (
        <>
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">
              {t("learningState.byGoal")}
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {state.goals.map((goal) => (
                <article
                  key={goal.goalId}
                  className="rounded-lg border border-border/70 p-3"
                >
                  <div className="font-medium">{goal.goalTitle}</div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {STATUS_ORDER.map((status) => (
                      <span key={status}>
                        {t(`learningState.status.${status}`)}{" "}
                        {goal.counts[status]}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
          <TargetList
            title={t("learningState.practiceNeeded")}
            items={state.practiceNeeded}
          />
          <TargetList
            title={t("learningState.evidenceNeeded")}
            items={state.evidenceNeeded}
          />
          <TargetList
            title={t("learningState.revalidationDue")}
            items={state.revalidationDue}
          />
          <TargetList
            title={t("learningState.demonstrated")}
            items={state.demonstrated}
          />
          <p className="text-xs text-muted-foreground">
            {t("learningState.asOf", {
              time: new Date(state.asOf).toLocaleString(),
            })}
          </p>
        </>
      )}
    </div>
  );
}

export function LearnerStateSummary({
  hideSectionHeader = false,
}: {
  hideSectionHeader?: boolean;
} = {}) {
  const t = useT();
  const query = useLearningState();

  if (query.isPending) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("learningState.loading")}
      </p>
    );
  }
  if (query.error || !query.data) {
    return (
      <p className="text-sm text-destructive">
        {query.error?.message || t("learningState.loadFailed")}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {hideSectionHeader ? null : (
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {t("learningState.sectionTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("learningState.sectionDescription")}
          </p>
        </div>
      )}
      <SummaryBody state={query.data.learningState} />
    </div>
  );
}
