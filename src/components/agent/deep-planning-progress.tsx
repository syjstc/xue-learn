import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  Circle,
  LoaderCircle,
  Search,
} from "lucide-react";
import type { PlanningProgress } from "@/hooks/use-agent-thread";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";

export function DeepPlanningProgress({
  progress,
}: {
  progress?: PlanningProgress;
}) {
  const t = useT();
  const stageLabels: Record<NonNullable<PlanningProgress["stage"]>, string> = {
    analyzing_goal: t("planning.stageAnalyzingGoal"),
    searching_web: t("planning.stageSearchingWeb"),
    reading_sources: t("planning.stageReadingSources"),
    cross_checking: t("planning.stageCrossChecking"),
    researching_modules: t("planning.stageResearchingModules"),
    sequencing_modules: t("planning.stageSequencingModules"),
    revising_plan: t("planning.stageRevisingPlan"),
    validating_plan: t("planning.stageValidatingPlan"),
  };
  const moduleStatusLabels = {
    queued: t("planning.moduleQueued"),
    researching: t("planning.moduleResearching"),
    complete: t("planning.moduleComplete"),
    warning: t("planning.moduleWarning"),
  } as const;
  const activityStatusLabels = {
    searching: t("planning.activitySearching"),
    reading: t("planning.activityReading"),
    saving: t("planning.activitySaving"),
    complete: t("planning.activityComplete"),
    error: t("planning.activityError"),
  } as const;
  const updateCategoryLabels = {
    thinking: t("planning.updateThinking"),
    research: t("planning.updateResearch"),
    synthesis: t("planning.updateSynthesis"),
    validation: t("planning.updateValidation"),
  } as const;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, []);

  if (!progress?.active) return null;
  const modulePercent = progress.module?.total
    ? Math.min(100, (progress.module.current / progress.module.total) * 100)
    : 0;
  const reusingSources = progress.outline?.reusedSources === true;
  const moduleStatus = progress.module
    ? progress.module.status === "queued"
      ? t("planning.moduleQueued")
      : progress.module.status === "researching"
        ? t("planning.moduleResearchingIndependent")
        : progress.module.status === "warning"
          ? t("planning.moduleWarning")
          : t("planning.moduleComplete")
    : "";
  const visibleActivities = progress.activities.slice(-8).reverse();
  const completedActivityCount = progress.activities.filter(
    (activity) => activity.status === "complete",
  ).length;
  const activeActivityCount = progress.activities.filter((activity) =>
    ["searching", "reading", "saving"].includes(activity.status),
  ).length;
  const latestUpdate = progress.updates[progress.updates.length - 1];
  const latestLine =
    latestUpdate?.message ||
    progress.stageMessage ||
    (progress.stage
      ? stageLabels[progress.stage]
      : t("planning.preparingResearch"));
  const isRevision = progress.stage === "revising_plan" || reusingSources;

  return (
    <section
      className="rounded-xl border border-[var(--brand-200)] bg-[var(--brand-50)]/70 p-3.5"
      aria-live="polite"
      aria-label={
        isRevision ? t("planning.revisionProgress") : t("planning.progress")
      }
      role="status"
    >
      <button
        type="button"
        className="flex w-full items-start gap-2.5 text-left"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand-100)] text-[var(--brand-700)]">
          <LoaderCircle
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">
              {isRevision ? t("planning.revising") : t("planning.inProgress")}
            </p>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {t("planning.elapsed", { seconds: elapsedSeconds })}
            </span>
          </div>
          <p className="mt-1 text-sm leading-6 text-foreground">{latestLine}</p>
        </div>
        <ChevronDown
          className={cn(
            "mt-1 size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {expanded ? (
      <div className="mt-3 min-w-0 pl-[2.625rem]">
          {progress.stage === "researching_modules" ? (
            <p className="mb-2 text-[11px] text-muted-foreground">
              {t("planning.moduleResearchExplanation")}
            </p>
          ) : null}

          {latestUpdate ? (
            <div
              className="flex w-full items-start gap-2 rounded-lg border border-[var(--brand-200)] bg-card/75 px-2.5 py-2 text-left"
            >
              {latestUpdate?.status === "active" ? (
                <LoaderCircle
                  className="mt-0.5 size-3.5 shrink-0 animate-spin text-[var(--brand-600)] motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <CheckCircle2
                  className="mt-0.5 size-3.5 shrink-0 text-[var(--success-600)]"
                  aria-hidden
                />
              )}
              <span className="min-w-0 flex-1 text-[11px] leading-4">
                  <span className="mr-1.5 shrink-0 font-medium text-[var(--brand-700)]">
                    {t("planning.updates")}
                    {latestUpdate
                      ? ` · ${updateCategoryLabels[latestUpdate.category]}`
                      : ""}
                  </span>
                  {latestUpdate ? (
                    <span className="text-muted-foreground">
                      {latestUpdate.message}
                    </span>
                  ) : null}
              </span>
            </div>
          ) : null}

          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            {progress.query ? (
              <div className="rounded-lg bg-card/75 px-2.5 py-2 text-foreground sm:col-span-2">
                <div className="flex items-center gap-2">
                  <Search
                    className="size-3.5 text-[var(--brand-600)]"
                    aria-hidden
                  />
                  <span>
                    {progress.query.scope === "module"
                      ? t("planning.moduleSearch")
                      : t("planning.goalSearch")}{" "}
                    {progress.query.current}/{progress.query.total}
                  </span>
                </div>
                <p className="mt-1 truncate pl-5.5 text-[11px] text-muted-foreground">
                  {progress.query.text}
                </p>
              </div>
            ) : null}
            {progress.module ? (
              <div className="rounded-lg bg-card/75 px-2.5 py-2 text-foreground">
                <div className="flex items-center gap-2">
                  <BookOpenCheck
                    className="size-3.5 text-[var(--brand-600)]"
                    aria-hidden
                  />
                  <span>
                    {t("planning.modulesDone", {
                      current: progress.module.current,
                      total: progress.module.total,
                    })}
                    {progress.module.sourceCount !== undefined
                      ? ` · ${t("planning.moduleSources", { count: progress.module.sourceCount })}`
                      : ""}
                  </span>
                </div>
                {progress.module.moduleTitle ? (
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    {moduleStatus}：{progress.module.moduleTitle}
                  </p>
                ) : null}
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--brand-100)]">
                  <div
                    className="h-full rounded-full bg-[var(--brand-500)] transition-[width] motion-reduce:transition-none"
                    style={{ width: `${modulePercent}%` }}
                  />
                </div>
              </div>
            ) : null}
          </div>

          {visibleActivities.length ? (
            <div className="mt-3 rounded-lg border border-border/70 bg-card/70 p-2.5">
              <div className="flex items-center justify-between gap-3 px-0.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="relative flex size-2" aria-hidden>
                    {activeActivityCount ? (
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--brand-500)] opacity-50 motion-reduce:animate-none" />
                    ) : null}
                    <span className="relative inline-flex size-2 rounded-full bg-[var(--brand-600)]" />
                  </span>
                  <p className="text-xs font-semibold text-foreground">
                    {t("planning.liveResearch")}
                  </p>
                </div>
                <p className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {t("planning.activitiesDone", {
                    current: completedActivityCount,
                    total: progress.activities.length,
                  })}
                </p>
              </div>
              <div
                className="mt-2 max-h-52 space-y-1.5 overflow-y-auto overscroll-contain pr-1"
                aria-label={t("planning.liveResearch")}
              >
                {visibleActivities.map((activity) => {
                  const busy = ["searching", "reading", "saving"].includes(
                    activity.status,
                  );
                  const sourceSummary = activity.sources
                    ?.slice(0, 2)
                    .map((source) => source.title)
                    .filter(Boolean)
                    .join("、");
                  return (
                    <div
                      key={activity.id}
                      className={cn(
                        "flex items-start gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                        busy ? "bg-[var(--brand-50)]" : "bg-background/50",
                      )}
                    >
                      {busy ? (
                        <LoaderCircle
                          className="mt-0.5 size-3.5 shrink-0 animate-spin text-[var(--brand-600)] motion-reduce:animate-none"
                          aria-hidden
                        />
                      ) : activity.status === "error" ? (
                        <AlertTriangle
                          className="mt-0.5 size-3.5 shrink-0 text-[var(--warning-600)]"
                          aria-hidden
                        />
                      ) : (
                        <CheckCircle2
                          className="mt-0.5 size-3.5 shrink-0 text-[var(--success-600)]"
                          aria-hidden
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="shrink-0 font-medium text-foreground">
                            {activity.mode === "saved_knowledge" &&
                            activity.status === "complete"
                              ? t("planning.reusedSources")
                              : activityStatusLabels[activity.status]}
                          </span>
                          {activity.sourceCount !== undefined ? (
                            <span className="text-[10px] text-muted-foreground">
                              {t("planning.sources", {
                                count: activity.sourceCount,
                              })}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 line-clamp-2 break-words text-[11px] leading-4 text-muted-foreground">
                          {activity.query}
                        </p>
                        {sourceSummary ? (
                          <p className="mt-0.5 truncate text-[10px] text-muted-foreground/80">
                            {t("planning.sourcesPrefix")} {sourceSummary}
                            {(activity.sources?.length ?? 0) > 2
                              ? t("planning.more")
                              : ""}
                          </p>
                        ) : null}
                        {activity.error ? (
                          <p className="mt-0.5 text-[10px] text-[var(--warning-700)]">
                            {activity.error}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              {progress.activities.length > visibleActivities.length ? (
                <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">
                  {t("planning.recentActivities", {
                    shown: visibleActivities.length,
                    total: progress.activities.length,
                  })}
                </p>
              ) : null}
            </div>
          ) : null}

          {progress.modules?.length ? (
            <div
              className="mt-3 space-y-1.5"
              aria-label={t("planning.moduleResearchStatus")}
            >
              {progress.modules.map((module, index) => {
                const complete =
                  module.status === "complete" || module.status === "warning";
                const active = module.status === "researching";
                return (
                  <div
                    key={module.moduleRef}
                    className="flex items-start gap-2 rounded-lg border border-border/70 bg-card/70 px-2.5 py-2 text-xs"
                  >
                    {complete ? (
                      <CheckCircle2
                        className="mt-0.5 size-3.5 shrink-0 text-[var(--success-600)]"
                        aria-hidden
                      />
                    ) : active ? (
                      <LoaderCircle
                        className="mt-0.5 size-3.5 shrink-0 animate-spin text-[var(--brand-600)] motion-reduce:animate-none"
                        aria-hidden
                      />
                    ) : (
                      <Circle
                        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">
                        {t("planning.moduleNumber", { number: index + 1 })} ·{" "}
                        {module.moduleTitle}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {moduleStatusLabels[module.status]}
                        {module.sourceCount !== undefined
                          ? ` · ${t("planning.sources", { count: module.sourceCount })}`
                          : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {progress.outline ? (
            <details
              className="mt-3 rounded-lg border border-border/70 bg-card/70 px-3 py-2"
              open
            >
              <summary className="cursor-pointer text-xs font-semibold text-foreground">
                {t("planning.outlineSummary")}
              </summary>
              <p className="mt-2 text-[11px] font-medium text-[var(--brand-700)]">
                {progress.outline.field}
              </p>
              {progress.outline.topicOverview ? (
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {progress.outline.topicOverview}
                </p>
              ) : null}
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {progress.outline.modeClarification}
              </p>
              {progress.outline.whatYouWillLearn?.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-muted-foreground">
                  {progress.outline.whatYouWillLearn.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {progress.outline.prerequisitesAssumed?.length ? (
                <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                  {t("planning.prerequisitesAssumed")}{" "}
                  {progress.outline.prerequisitesAssumed.join(" · ")}
                </p>
              ) : null}
              <ol className="mt-2 space-y-2">
                {progress.outline.modules.map((module, index) => (
                  <li key={module.moduleRef} className="text-xs">
                    <p className="font-medium text-foreground">
                      {index + 1}. {module.title}
                    </p>
                    <p className="mt-0.5 leading-5 text-muted-foreground">
                      {module.objective}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {t("planning.dependencyBasis")} {module.dependsOnPrevious}
                    </p>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-[10px] text-muted-foreground">
                {t("planning.outlineNote")}
              </p>
            </details>
          ) : null}

          {progress.warnings.map((warning) => (
            <p
              key={warning}
              className="mt-2 flex items-start gap-1.5 text-xs text-[var(--warning-700)]"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{warning}</span>
            </p>
          ))}
      </div>
      ) : null}
    </section>
  );
}
