import { Link, useSearchParams } from "react-router-dom";
import { CreditCard, RotateCcw } from "lucide-react";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { useDueReviews, usePracticeUnits } from "@/hooks/api";
import { Card, CardTitle } from "@/components/ui/card";
import { cognitivePercent } from "@/shared/domain/cognitive-model";
import { FlashcardsPage } from "@/pages/flashcards-page";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import { useT, type TranslationKey } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { supportsFlashcards } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";

function evidenceLabelKey(value: number): TranslationKey {
  if (value <= 0) return "reviews.evidence.none";
  if (value < 0.35) return "reviews.evidence.limited";
  if (value < 0.7) return "reviews.evidence.growing";
  return "reviews.evidence.sufficient";
}

export function ReviewsPage() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const flashcardsEnabled = supportsFlashcards();
  const activeTab =
    flashcardsEnabled && searchParams.get("tab") === "flashcards"
      ? "flashcards"
      : "due";
  const dueQuery = useDueReviews();
  const practiceQuery = usePracticeUnits();

  const cards = dueQuery.data ?? [];
  const practiceUnits = practiceQuery.data ?? [];
  const active = cards[0];

  if (activeTab === "due" && (dueQuery.isPending || practiceQuery.isPending)) {
    return <p className="text-muted-foreground">{t("reviews.loading")}</p>;
  }

  const tabs = [
    { key: "due" as const, label: t("reviews.tabDue"), icon: RotateCcw },
    ...(flashcardsEnabled
      ? [
          {
            key: "flashcards" as const,
            label: t("reviews.tabFlashcards"),
            icon: CreditCard,
          },
        ]
      : []),
  ];

  if (activeTab === "flashcards") {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <ReviewHubHeader
          activeTab={activeTab}
          tabs={tabs}
          onChange={(tab) =>
            setSearchParams(tab === "due" ? {} : { tab }, { replace: true })
          }
        />
        <FlashcardsPage embedded />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <ReviewHubHeader
        activeTab={activeTab}
        tabs={tabs}
        onChange={(tab) =>
          setSearchParams(tab === "due" ? {} : { tab }, { replace: true })
        }
      />

      <section className="mx-auto max-w-2xl space-y-4">
        <h2 className="text-lg font-semibold text-foreground">
          {t("reviews.dueTitle")}
        </h2>
        {cards.length === 0 ? (
          <Card>
            <p className="text-muted-foreground">{t("reviews.dueEmpty")}</p>
          </Card>
        ) : (
          <Card>
            <p className="text-xs text-muted-foreground">{active.goal.title}</p>
            <CardTitle className="mt-1">{active.entity.title}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {active.entity.explanation}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>
                {t(`learningState.status.${active.status}` as TranslationKey)}
              </span>
              <span>
                {t("reviews.stateEstimate")}{" "}
                {active.estimate == null
                  ? t("learningState.status.unobserved")
                  : `${cognitivePercent(active.estimate)}%`}
              </span>
              <span>
                {t(evidenceLabelKey(active.evidenceSufficiency))}{" "}
                {cognitivePercent(active.evidenceSufficiency)}%
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {t("reviews.deliberateFlow")}
            </p>

            <div className="mt-4">
              <p className="rounded-lg border border-[var(--course-content-attention-border)] bg-[var(--course-content-attention-bg)] p-4 text-sm font-medium text-foreground">
                {t("reviews.cue", { title: active.entity.title })}
              </p>
              <div className="mt-4">
                <Link
                  to={`/reviews/${active.goal.id}/${active.representativeUnit.id}`}
                  state={{ startNewQuiz: true }}
                >
                  <Button>{t("reviews.startDeliberate")}</Button>
                </Link>
              </div>
            </div>

            {cards.length > 1 && (
              <p className="mt-4 text-sm text-muted-foreground">
                {t("reviews.queueRemaining", { count: cards.length - 1 })}
              </p>
            )}
          </Card>
        )}
      </section>

      <section className="mx-auto max-w-2xl space-y-4">
        <h2 className="text-lg font-semibold text-foreground">
          {t("reviews.practiceTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("reviews.practiceDescription")}
        </p>
        {practiceUnits.length === 0 ? (
          <Card>
            <p className="text-muted-foreground">
              {t("reviews.practiceEmpty")}
            </p>
          </Card>
        ) : (
          <ul className="space-y-2">
            {practiceUnits.map((u) => (
              <li key={u.id}>
                <Link
                  to={`/reviews/${u.goal.id}/${u.id}`}
                  state={{ startNewQuiz: true }}
                  className="group flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3 text-sm transition-colors hover:border-[var(--course-content-border-accent)] hover:bg-[var(--course-content-surface-accent)]"
                >
                  <span className="min-w-0">
                    <span className="text-muted-foreground">
                      {u.goal.title} ·{" "}
                    </span>
                    <span className="font-medium text-foreground">
                      {u.title}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium text-primary transition-colors group-hover:text-primary-hover">
                    {t("reviews.start")} →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ReviewHubHeader({
  activeTab,
  tabs,
  onChange,
}: {
  activeTab: "due" | "flashcards";
  tabs: Array<{
    key: "due" | "flashcards";
    label: string;
    icon: typeof RotateCcw;
  }>;
  onChange: (tab: "due" | "flashcards") => void;
}) {
  const t = useT();

  return (
    <header className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t("reviews.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("reviews.description")}
        </p>
      </div>
      <nav
        className="inline-flex rounded-xl border border-[var(--border-200)] bg-[var(--bg-200)] p-1"
        aria-label={t("reviews.modeAria")}
      >
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className={cn(
              "flex min-h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors",
              activeTab === key
                ? "bg-[var(--bg-50)] text-[var(--brand-700)] shadow-sm"
                : "text-[var(--text-500)] hover:text-[var(--text-800)]",
            )}
            aria-current={activeTab === key ? "page" : undefined}
            onClick={() => onChange(key)}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </nav>
    </header>
  );
}
