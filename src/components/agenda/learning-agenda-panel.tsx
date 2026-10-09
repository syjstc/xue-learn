import { Link } from "react-router-dom";
import {
  AlertCircle,
  BookOpen,
  ChevronRight,
  Clock,
  Loader2,
  PauseCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@xue-learn/core/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useAgenda,
  useAgendaSettings,
  usePatchTodayAgendaCapacity,
  useRefreshAgenda,
  type AgendaDay,
  type AgendaItem,
} from "@/hooks/api/use-agenda";
import {
  useI18n,
  useT,
  type TranslationKey,
  type TranslationParams,
} from "@xue-learn/core/i18n";

type AgendaTranslate = (
  key: TranslationKey,
  params?: TranslationParams,
) => string;

function EstimatedDuration({
  minutes,
  t,
}: {
  minutes: number;
  t: AgendaTranslate;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--bg-200)] px-2 py-1 text-[11px] font-medium text-[var(--text-600)]">
      <Clock className="size-3" aria-hidden="true" />
      {t("agenda.estimatedMinutes", { minutes })}
    </span>
  );
}

function itemTypeLabel(item: AgendaItem, t: AgendaTranslate) {
  return item.itemType === "review"
    ? t("agenda.review")
    : t("agenda.newLearning");
}

function agendaItemNavigation(item: AgendaItem) {
  if (item.itemType === "review") {
    return {
      to: `/reviews/${item.goalId}/${item.unitId}`,
      state: { startNewQuiz: true },
    };
  }

  return {
    to: item.navigationTarget,
    state: undefined,
  };
}

function AgendaItemRow({ item, t }: { item: AgendaItem; t: AgendaTranslate }) {
  const navigation = agendaItemNavigation(item);

  return (
    <div className="group flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border-100)] bg-[var(--bg-50)] px-3 py-2.5 transition-colors hover:border-[var(--brand-200)] sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-[var(--text-400)]">
          <span className="truncate">{item.goalTitle}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{itemTypeLabel(item, t)}</span>
        </div>
        <Link
          to={navigation.to}
          state={navigation.state}
          className="mt-0.5 block line-clamp-2 text-sm font-medium text-[var(--text-700)] hover:text-[var(--brand-600)]"
        >
          {item.sectionTitle ?? item.unitTitle}
        </Link>
        {item.explanation ? (
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-[var(--text-400)]">
            {item.explanation}
          </p>
        ) : null}
      </div>
      <div className="flex w-full shrink-0 items-center justify-between gap-2 sm:w-auto sm:justify-end">
        <EstimatedDuration minutes={item.estimatedMinutes} t={t} />
        <Link
          to={navigation.to}
          state={navigation.state}
          className="ml-1 rounded-md p-1 transition-colors hover:bg-[var(--brand-50)] hover:text-[var(--brand-600)]"
          aria-label={item.unitTitle}
        >
          <ChevronRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}

function UpcomingDayCard({
  day,
  locale,
  t,
}: {
  day: AgendaDay;
  locale: string;
  t: AgendaTranslate;
}) {
  const items = [...day.newLearning, ...day.reviews]
    .filter((item) => !item.completedAt)
    .sort((a, b) => a.sortIndex - b.sortIndex);
  const visibleMinutes = items.reduce(
    (total, item) => total + item.estimatedMinutes,
    0,
  );

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--border-100)] bg-[var(--bg-50)]">
      <header className="flex items-baseline justify-between gap-3 border-b border-[var(--border-100)] bg-[var(--bg-200)]/70 px-3 py-2.5">
        <h3 className="text-xs font-semibold text-[var(--text-700)]">
          {formatAgendaDate(day.date, locale, t)}
        </h3>
        <span className="text-[11px] text-[var(--text-400)]">
          {t("agenda.daySummary", {
            items: items.length,
            minutes: visibleMinutes,
          })}
        </span>
      </header>
      <div className="divide-y divide-[var(--border-100)]">
        {items.map((item) => (
          <Link
            key={item.id}
            {...agendaItemNavigation(item)}
            className="group block px-3 py-3 transition-colors hover:bg-[var(--brand-50)]"
          >
            <p className="truncate text-[11px] text-[var(--text-400)]">
              {item.goalTitle}
            </p>
            <div className="mt-1 flex min-w-0 items-start justify-between gap-3">
              <p className="line-clamp-2 min-w-0 text-sm font-medium leading-5 text-[var(--text-700)] group-hover:text-[var(--brand-700)]">
                {item.sectionTitle ?? item.unitTitle}
              </p>
              <ChevronRight className="mt-0.5 size-4 shrink-0 text-[var(--text-300)] group-hover:text-[var(--brand-600)]" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[var(--bg-200)] px-2 py-1 text-[11px] font-medium text-[var(--text-500)]">
                {itemTypeLabel(item, t)}
              </span>
              <EstimatedDuration minutes={item.estimatedMinutes} t={t} />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function primaryActionLabel(item: AgendaItem, t: AgendaTranslate) {
  if (item.explanationCode === "continue_in_progress") {
    return t("agenda.continue");
  }
  if (item.itemType === "review") {
    return t("agenda.review");
  }
  return t("agenda.start");
}

export function LearningAgendaPanel({
  goalId,
  variant = "full",
}: {
  goalId?: string;
  variant?: "compact" | "full";
}) {
  const uiT = useT();
  const { locale } = useI18n();
  const {
    data: agenda,
    isPending,
    isFetching,
    error,
    refetch,
  } = useAgenda(goalId);
  const refresh = useRefreshAgenda();
  const settings = useAgendaSettings();
  const patchTodayCapacity = usePatchTodayAgendaCapacity();

  if (isPending) {
    return (
      <Card className="border-[var(--border-200)] bg-[var(--bg-50)]">
        <CardContent className="flex items-center gap-2 px-4 py-3 text-sm text-[var(--text-400)]">
          <Loader2 className="size-4 animate-spin" />
          {uiT("agenda.loading")}
        </CardContent>
      </Card>
    );
  }

  if (error || !agenda) {
    return (
      <Card className="border-[var(--border-200)] bg-[var(--bg-50)]">
        <CardContent className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-[var(--text-500)]">
          <span className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0 text-amber-600" />
            {uiT("agenda.refreshError")}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCw
              className={`mr-1 size-3.5 ${isFetching ? "animate-spin" : ""}`}
            />
            {uiT("agenda.refresh")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const t: AgendaTranslate = uiT;
  const today = agenda.days.find((day) => day.isToday);
  const todayItems = today
    ? [...today.newLearning, ...today.reviews].filter(
        (item) => !item.completedAt && item.id !== agenda.continueItem?.id,
      )
    : [];
  const upcoming = agenda.days
    .filter(
      (day) =>
        !day.isToday &&
        [...day.newLearning, ...day.reviews].some((item) => !item.completedAt),
    )
    .slice(0, 3);

  if (variant === "compact") {
    const nextItem = agenda.continueItem;
    const navigation = nextItem ? agendaItemNavigation(nextItem) : null;

    return (
      <Card className="overflow-hidden border-[var(--border-200)] bg-[var(--bg-50)]">
        <CardContent className="p-4 sm:p-5">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-50)] text-[var(--brand-600)]">
                <BookOpen className="size-4" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-sm">
                    {t("agenda.nextLabel")}
                  </CardTitle>
                  {today?.totalMinutes ? (
                    <span className="text-xs text-[var(--text-400)]">
                      {t("agenda.totalMinutes", {
                        minutes: today.totalMinutes,
                      })}
                    </span>
                  ) : null}
                </div>
                {nextItem ? (
                  <>
                    <p className="mt-1 truncate text-xs text-[var(--text-400)]">
                      {nextItem.goalTitle}
                    </p>
                    <p className="mt-1 line-clamp-2 font-semibold leading-6 text-[var(--text-800)]">
                      {nextItem.sectionTitle ?? nextItem.unitTitle}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[var(--bg-200)] px-2 py-1 text-[11px] font-medium text-[var(--text-600)]">
                        {itemTypeLabel(nextItem, t)}
                      </span>
                      <EstimatedDuration
                        minutes={nextItem.estimatedMinutes}
                        t={t}
                      />
                    </div>
                    {nextItem.explanation ? (
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--text-500)]">
                        {nextItem.explanation}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-1 text-sm text-[var(--text-500)]">
                    {agenda.paused
                      ? t("agenda.pausedDescription")
                      : t("agenda.emptyToday")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-stretch">
              {nextItem && navigation ? (
                <Link {...navigation} className="flex-1">
                  <Button className="w-full rounded-lg" size="sm">
                    {primaryActionLabel(nextItem, t)}
                    <ChevronRight className="ml-1 size-3.5" />
                  </Button>
                </Link>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  function handleRefresh() {
    refresh.mutate(true);
  }

  return (
    <Card className="overflow-hidden border-[var(--border-200)] bg-[var(--bg-50)]">
      <CardHeader className="px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-50)] text-[var(--brand-600)]">
              <BookOpen className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle
                  className="text-sm"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {t("agenda.title")}
                </CardTitle>
                {agenda.paused ? (
                  <span className="flex items-center gap-1 rounded-full bg-[var(--bg-300)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-500)]">
                    <PauseCircle className="size-3" />
                    {t("agenda.paused")}
                  </span>
                ) : null}
                {agenda.stale && !agenda.refreshing ? (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    {t("agenda.stale")}
                  </span>
                ) : null}
              </div>
              {today && today.totalMinutes > 0 ? (
                <p className="mt-0.5 text-xs text-[var(--text-400)]">
                  {t("agenda.totalMinutes", { minutes: today.totalMinutes })}
                </p>
              ) : null}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleRefresh}
            disabled={refresh.isPending || agenda.refreshing}
            aria-label={t("agenda.refresh")}
            title={t("agenda.refresh")}
            className="shrink-0 text-[var(--text-400)] hover:text-[var(--text-700)]"
          >
            <RefreshCw
              className={`size-3.5 ${refresh.isPending || agenda.refreshing ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 px-4 pb-4 pt-0 sm:px-5">
        {today ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--bg-200)] px-3 py-2">
            <span className="text-xs text-[var(--text-500)]">
              {t("agenda.todayCapacity", { minutes: today.capacityMinutes })}
            </span>
            <div
              className="flex flex-wrap gap-1"
              aria-label={t("agenda.adjustTodayCapacity")}
            >
              {[15, 30, 45, 60].map((minutes) => (
                <Button
                  key={minutes}
                  size="xs"
                  variant={
                    settings.data?.todayCapacityOverrideMin === minutes
                      ? "default"
                      : "ghost"
                  }
                  disabled={patchTodayCapacity.isPending}
                  onClick={() => patchTodayCapacity.mutate(minutes)}
                >
                  {minutes}
                </Button>
              ))}
              {settings.data?.todayCapacityOverrideMin != null ? (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={patchTodayCapacity.isPending}
                  onClick={() => patchTodayCapacity.mutate(null)}
                >
                  {t("agenda.restoreDefault")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {agenda.continueItem ? (
          <div className="rounded-xl border border-[var(--brand-200)] bg-[var(--brand-50)] p-3.5 sm:p-4">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] font-medium">
                  <span className="rounded-full bg-[var(--brand-100)] px-2 py-1 text-[var(--brand-700)]">
                    {t("agenda.nextLabel")}
                  </span>
                  <span className="truncate text-[var(--text-500)]">
                    {agenda.continueItem.goalTitle}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-base font-semibold leading-6 text-[var(--text-800)]">
                  {agenda.continueItem.sectionTitle ??
                    agenda.continueItem.unitTitle}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[var(--bg-50)] px-2 py-1 text-[11px] font-medium text-[var(--text-600)]">
                    {itemTypeLabel(agenda.continueItem, t)}
                  </span>
                  <EstimatedDuration
                    minutes={agenda.continueItem.estimatedMinutes}
                    t={t}
                  />
                </div>
                {agenda.continueItem.explanation ? (
                  <p className="mt-2 text-xs leading-5 text-[var(--text-500)]">
                    <span className="font-medium text-[var(--text-600)]">
                      {t("agenda.reasonLabel")}：
                    </span>
                    {agenda.continueItem.explanation}
                  </p>
                ) : null}
              </div>
              <Link
                className="shrink-0"
                {...agendaItemNavigation(agenda.continueItem)}
              >
                <Button size="sm" className="w-full rounded-lg sm:w-auto">
                  {primaryActionLabel(agenda.continueItem, t)}
                  <ChevronRight className="ml-1 size-3.5" />
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-200)] px-3 py-2.5 text-sm text-[var(--text-400)]">
            <AlertCircle className="size-4 shrink-0" />
            {agenda.paused
              ? t("agenda.pausedDescription")
              : t("agenda.emptyToday")}
          </div>
        )}

        {todayItems.length > 0 ? (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-500)]">
                {t("agenda.todayLabel")}
              </p>
              <span className="text-[11px] text-[var(--text-400)]">
                {todayItems.length} {t("agenda.items")}
              </span>
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              {todayItems.map((item) => (
                <AgendaItemRow key={item.id} item={item} t={t} />
              ))}
            </div>
          </div>
        ) : null}

        {upcoming.length > 0 ? (
          <div className="border-t border-[var(--border-100)] pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-500)]">
              {t("agenda.upcomingLabel")}
            </p>
            <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
              {upcoming.map((day) => (
                <UpcomingDayCard
                  key={day.date}
                  day={day}
                  locale={locale}
                  t={t}
                />
              ))}
            </div>
          </div>
        ) : null}

        {refresh.error ? (
          <p className="text-xs text-destructive">{t("agenda.refreshError")}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatAgendaDate(isoDate: string, locale: string, t: AgendaTranslate) {
  const date = new Date(`${isoDate}T00:00:00`);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  if (date.toDateString() === now.toDateString()) {
    return t("agenda.todayLabel");
  }
  if (date.toDateString() === tomorrow.toDateString()) {
    return t("agenda.tomorrowLabel");
  }

  return date.toLocaleDateString(locale === "other" ? undefined : locale, {
    month: "short",
    day: "numeric",
    weekday: "short",
  });
}
