import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  ChevronRight,
  FolderOpen,
  Plus,
  Sparkles,
  Target,
} from "lucide-react";
import { ApiErrorNotice } from "@/components/ui/api-error-notice";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import {
  EmptyRoadmapIllustration,
  SPACE_ACCENT_STYLE,
  SpaceIdentityDialog,
} from "@/components/spaces/learning-space-dialogs";
import {
  useCreateLearningSpace,
  useGoals,
  useLearningSpaces,
} from "@/hooks/api";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";

function SpaceCardSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden rounded-2xl border border-[var(--border-200)] bg-[var(--bg-50)] p-5">
      <div className="h-1 w-20 rounded-full bg-[var(--bg-300)]" />
      <div className="mt-5 h-5 w-1/2 rounded bg-[var(--bg-300)]" />
      <div className="mt-3 h-4 w-4/5 rounded bg-[var(--bg-200)]" />
      <div className="mt-8 space-y-2">
        <div className="h-8 rounded-lg bg-[var(--bg-200)]" />
        <div className="h-8 rounded-lg bg-[var(--bg-200)]" />
      </div>
    </div>
  );
}

export function LearningSpacesPage() {
  const t = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const portfolio = useLearningSpaces();
  const goals = useGoals();
  const create = useCreateLearningSpace();
  const [creating, setCreating] = useState(params.get("create") === "1");
  const goalDetails = useMemo(
    () => new Map((goals.data ?? []).map((goal) => [goal.id, goal])),
    [goals.data],
  );

  useEffect(() => {
    if (params.get("create") === "1") setCreating(true);
  }, [params]);

  function setCreateOpen(open: boolean) {
    setCreating(open);
    if (!open && params.has("create")) setParams({}, { replace: true });
  }

  const totalGoals =
    portfolio.data?.spaces.reduce(
      (count, space) =>
        count + space.items.filter((item) => item.goalId).length,
      0,
    ) ?? 0;
  const totalPlanned =
    portfolio.data?.spaces.reduce(
      (count, space) =>
        count +
        space.items.filter((item) => item.itemType === "planned_goal").length,
      0,
    ) ?? 0;

  return (
    <div className="space-y-8 sm:space-y-10">
      <header className="relative overflow-hidden rounded-3xl border border-[var(--border-200)] bg-[var(--bg-50)] px-5 py-6 sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -right-12 -top-20 size-56 rounded-full bg-[var(--brand-50)] opacity-80 blur-2xl" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-600)]">
              <FolderOpen className="size-4" />
              {t("spaces.workspace")}
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--text-900)] sm:text-4xl">
              {t("spaces.title")}
            </h1>
            <p className="mt-3 text-sm leading-6 text-[var(--text-500)] sm:text-base">
              {t("spaces.description")}
            </p>
            {portfolio.data && (totalGoals > 0 || totalPlanned > 0) ? (
              <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--text-500)]">
                <span>
                  <strong className="text-[var(--text-800)]">
                    {portfolio.data.spaces.length}
                  </strong>{" "}
                  {t("spaces.spaceCountLabel")}
                </span>
                <span>
                  <strong className="text-[var(--text-800)]">
                    {totalGoals}
                  </strong>{" "}
                  {t("spaces.goals")}
                </span>
                <span>
                  <strong className="text-[var(--text-800)]">
                    {totalPlanned}
                  </strong>{" "}
                  {t("spaces.planned")}
                </span>
              </div>
            ) : null}
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            size="lg"
            className="min-h-11 w-full rounded-xl px-4 sm:w-auto"
          >
            <Plus className="size-4" /> {t("spaces.new")}
          </Button>
        </div>
      </header>

      {portfolio.error ? <ApiErrorNotice error={portfolio.error} /> : null}

      {portfolio.isPending ? (
        <div
          className="grid gap-4 md:grid-cols-2"
          aria-label={t("spaces.loading")}
        >
          <SpaceCardSkeleton />
          <SpaceCardSkeleton />
        </div>
      ) : null}

      {portfolio.data?.spaces.length ? (
        <section aria-labelledby="space-list-heading">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2
                id="space-list-heading"
                className="text-lg font-semibold text-[var(--text-850)]"
              >
                {t("spaces.yourDirections")}
              </h2>
              <p className="mt-1 text-sm text-[var(--text-400)]">
                {t("spaces.yourDirectionsDescription")}
              </p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {portfolio.data.spaces.map((space) => {
              const realItems = space.items.filter((item) => item.goalId);
              const plannedItems = space.items.filter(
                (item) => item.itemType === "planned_goal",
              );
              const progressValues = realItems.flatMap((item) => {
                const value = item.goalId
                  ? goalDetails.get(item.goalId)?.progressPercent
                  : undefined;
                return typeof value === "number" ? [value] : [];
              });
              const averageProgress = progressValues.length
                ? Math.round(
                    progressValues.reduce((sum, value) => sum + value, 0) /
                      progressValues.length,
                  )
                : 0;
              return (
                <Link
                  key={space.id}
                  to={`/spaces/${space.id}`}
                  className="group relative overflow-hidden rounded-2xl border border-[var(--border-200)] bg-[var(--bg-50)] p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-[var(--brand-200)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-500)] focus-visible:ring-offset-2 sm:p-6"
                >
                  <span
                    className={cn(
                      "absolute inset-x-0 top-0 h-1",
                      SPACE_ACCENT_STYLE.line,
                    )}
                  />
                  <div className="flex items-start gap-4">
                    <div
                      className={cn(
                        "flex size-12 shrink-0 items-center justify-center rounded-2xl",
                        SPACE_ACCENT_STYLE.soft,
                        SPACE_ACCENT_STYLE.text,
                      )}
                    >
                      <FolderOpen className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-lg font-semibold text-[var(--text-850)]">
                            {space.name}
                          </h3>
                          <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-[var(--text-400)]">
                            {space.purpose || t("spaces.addPurpose")}
                          </p>
                        </div>
                        <ChevronRight className="mt-1 size-5 shrink-0 text-[var(--text-300)] transition group-hover:translate-x-0.5 group-hover:text-[var(--brand-600)]" />
                      </div>

                      <div className="mt-5 flex items-center gap-3">
                        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--bg-200)]">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              SPACE_ACCENT_STYLE.line,
                            )}
                            style={{ width: `${averageProgress}%` }}
                          />
                        </div>
                        <span className="shrink-0 text-xs font-medium text-[var(--text-500)]">
                          {averageProgress}%
                        </span>
                      </div>

                      {space.items.length ? (
                        <ol
                          className="mt-5 space-y-2"
                          aria-label={t("spaces.roadmapPreview")}
                        >
                          {space.items.slice(0, 3).map((item, index) => (
                            <li
                              key={item.id}
                              className="flex min-w-0 items-center gap-2 text-xs text-[var(--text-500)]"
                            >
                              <span
                                className={cn(
                                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                                  item.itemType === "planned_goal"
                                    ? "border border-dashed border-[var(--border-300)] text-[var(--text-400)]"
                                    : SPACE_ACCENT_STYLE.soft,
                                  item.itemType === "goal" &&
                                    SPACE_ACCENT_STYLE.text,
                                )}
                              >
                                {index + 1}
                              </span>
                              <span className="truncate">
                                {item.goal?.title || item.plannedTitle}
                              </span>
                              {item.itemType === "planned_goal" ? (
                                <Sparkles className="size-3 shrink-0 text-[var(--brand-500)]" />
                              ) : null}
                            </li>
                          ))}
                          {space.items.length > 3 ? (
                            <li className="pl-7 text-xs text-[var(--text-300)]">
                              {t("spaces.moreItems", {
                                count: space.items.length - 3,
                              })}
                            </li>
                          ) : null}
                        </ol>
                      ) : (
                        <p className="mt-5 rounded-xl border border-dashed border-[var(--border-200)] px-3 py-2.5 text-xs text-[var(--text-400)]">
                          {t("spaces.emptyRoadmapShort")}
                        </p>
                      )}

                      <div className="mt-5 flex items-center gap-4 border-t border-[var(--border-100)] pt-4 text-xs text-[var(--text-400)]">
                        <span>
                          {t("spaces.goalsCount", { count: realItems.length })}
                        </span>
                        <span>
                          {t("spaces.plannedCount", {
                            count: plannedItems.length,
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {portfolio.data ? (
        <section aria-labelledby="unorganized-heading">
          <Link
            to="/spaces/unorganized"
            className="group flex flex-col gap-4 rounded-2xl border border-dashed border-[var(--border-300)] bg-[var(--bg-100)] p-5 transition hover:border-[var(--brand-300)] hover:bg-[var(--bg-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-500)] sm:flex-row sm:items-center sm:justify-between sm:p-6"
          >
            <div className="flex items-start gap-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--bg-200)] text-[var(--text-500)]">
                <Target className="size-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2
                    id="unorganized-heading"
                    className="font-semibold text-[var(--text-800)]"
                  >
                    {t("spaces.unorganized")}
                  </h2>
                  <span className="rounded-full bg-[var(--bg-200)] px-2 py-0.5 text-xs font-semibold text-[var(--text-500)]">
                    {portfolio.data.unorganizedGoals.length}
                  </span>
                </div>
                <p className="mt-1 text-sm text-[var(--text-400)]">
                  {portfolio.data.unorganizedGoals.length
                    ? t("spaces.unorganizedActionDescription")
                    : t("spaces.unorganizedEmptyDescription")}
                </p>
              </div>
            </div>
            <span className="inline-flex min-h-11 items-center gap-1 self-end text-sm font-medium text-[var(--brand-700)] sm:self-auto">
              {t("spaces.openInbox")}{" "}
              <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </span>
          </Link>
        </section>
      ) : null}

      {!portfolio.isPending &&
      portfolio.data?.spaces.length === 0 &&
      portfolio.data.unorganizedGoals.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-[var(--border-200)] bg-[var(--bg-50)] px-6 py-12 text-center sm:py-16">
          <EmptyRoadmapIllustration />
          <h2 className="mt-5 text-xl font-semibold text-[var(--text-850)]">
            {t("spaces.emptyTitle")}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--text-400)]">
            {t("spaces.emptyDescription")}
          </p>
          <Button
            onClick={() => setCreateOpen(true)}
            className="mt-6 min-h-11 rounded-xl px-4"
          >
            <Plus className="size-4" /> {t("spaces.createFirst")}
          </Button>
        </section>
      ) : null}

      <SpaceIdentityDialog
        open={creating}
        mode="create"
        pending={create.isPending}
        error={create.error}
        onOpenChange={setCreateOpen}
        onSubmit={async (value) => {
          const created = await create.mutateAsync(value);
          setCreating(false);
          navigate(`/spaces/${created.id}`);
        }}
      />
    </div>
  );
}
