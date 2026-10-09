import { useMainline } from "@/features/learning-mainline/provider";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { Button } from "@xue-learn/core/ui/button";
import { ApiErrorNotice } from "@/components/ui/api-error-notice";
import { UnitWizard } from "@/components/wizard/unit-wizard";
import { useDueReviews, useSubmitReview, useUnitPage } from "@/hooks/api";
import { isNotFound } from "@/shared/api";
import { useT } from "@xue-learn/core/i18n";

export function ReviewSessionPage() {
  const t = useT();
  const mainline = useMainline();
  const returnsToActivity = mainline?.current?.kind === "review" && Boolean(mainline.current.returnActivityId);
  const { goalId = "", unitId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const submitReview = useSubmitReview();
  const autoSubmittedUnitsRef = useRef(new Set<string>());
  const [reviewScore, setReviewScore] = useState<number | null>(null);
  const [reviewReady, setReviewReady] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const handleReviewScoreChange = useCallback((score: number | null) => {
    setReviewScore(score);
  }, []);
  const handleReviewReadyChange = useCallback((ready: boolean) => {
    setReviewReady(ready);
  }, []);
  useEffect(() => {
    setReviewScore(null);
    setReviewReady(false);
    setReviewSubmitted(false);
  }, [unitId]);
  const navigationEntry = performance.getEntriesByType(
    "navigation",
  )[0] as PerformanceNavigationTiming | undefined;
  const startReview =
    navigationEntry?.type !== "reload" &&
    Boolean(
      (location.state as { startNewQuiz?: boolean } | null)?.startNewQuiz,
    );
  const unitQuery = useUnitPage(unitId, goalId);
  const dueQuery = useDueReviews();
  const dueTasks = dueQuery.data ?? [];
  const currentTask = dueTasks.find(
    (task) => task.representativeUnit.id === unitId,
  );
  const currentIndex = dueTasks.findIndex(
    (task) => task.representativeUnit.id === unitId,
  );
  const nextTask =
    currentIndex >= 0
      ? dueTasks[currentIndex + 1]
      : dueTasks.find((task) => task.representativeUnit.id !== unitId);

  useEffect(() => {
    if (
      !reviewReady ||
      reviewScore === 1 ||
      !currentTask ||
      autoSubmittedUnitsRef.current.has(unitId)
    ) {
      return;
    }
    autoSubmittedUnitsRef.current.add(unitId);
    void submitReview
      .mutateAsync({ cardId: currentTask.id, grade: 4 })
      .then(() => setReviewSubmitted(true))
      .catch(() => autoSubmittedUnitsRef.current.delete(unitId));
  }, [currentTask, reviewReady, reviewScore, submitReview, unitId]);

  if (isNotFound(unitQuery.error)) return <Navigate to="/reviews" replace />;
  if (!unitQuery.data || dueQuery.isPending) {
    return unitQuery.error ? (
      <ApiErrorNotice
        error={unitQuery.error}
        fallback={t("assessment.review.loadError")}
        onRetry={() => {
          void unitQuery.refetch();
        }}
      />
    ) : (
      <p className="text-muted-foreground">{t("assessment.review.loading")}</p>
    );
  }

  const { unit, goal } = unitQuery.data;

  const nextAction = () =>
    returnsToActivity ? (
      <Button variant="outline" onClick={() => void mainline!.returnToSource().catch(() => undefined)}>{t("mainline.return")}</Button>
    ) : nextTask ? (
      <Link
        to={`/reviews/${nextTask.goal.id}/${nextTask.representativeUnit.id}`}
        state={{ startNewQuiz: true }}
      >
        <Button variant="outline">
          {t("assessment.review.skipNext")}
          <ArrowRight aria-hidden />
        </Button>
      </Link>
    ) : (
      <Link to="/reviews">
        <Button variant="outline">{t("assessment.review.backToList")}</Button>
      </Link>
    );

  async function completeReview() {
    if (!reviewReady) return;
    if (currentTask && !reviewSubmitted) {
      await submitReview.mutateAsync({
        cardId: currentTask.id,
        grade: reviewScore === 1 ? 5 : 4,
      });
    }
    if (returnsToActivity) { await mainline!.returnToSource(); return; }
    navigate(
      nextTask
        ? `/reviews/${nextTask.goal.id}/${nextTask.representativeUnit.id}`
        : "/reviews",
      nextTask ? { state: { startNewQuiz: true } } : undefined,
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <Link
            to="/reviews"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {t("assessment.review.label")}
          </Link>
          <h1 className="truncate text-xl font-bold text-foreground">
            {unit.title}
          </h1>
          <p className="text-sm text-muted-foreground">{goal.title}</p>
        </div>

        {nextAction()}
      </header>

      <UnitWizard
        key={unitId}
        unitId={unitId}
        goalId={goalId}
        unitTitle={unit.title}
        domainTag={goal.domainTag}
        initialStep="active_recall"
        startNewQuiz={startReview}
        reviewMode
        onReviewScoreChange={handleReviewScoreChange}
        onReviewReadyChange={handleReviewReadyChange}
      />

      <footer className="flex justify-end border-t border-border pt-5">
        <Button
          size="lg"
          onClick={() => void completeReview()}
          disabled={!reviewReady || submitReview.isPending}
        >
          {returnsToActivity && reviewReady ? t("mainline.return") : submitReview.isPending
            ? t("assessment.review.submitting")
            : reviewSubmitted
              ? nextTask
                ? t("assessment.review.completedNext")
                : t("assessment.review.completed")
            : reviewReady
              ? nextTask
                ? t("assessment.review.completeAndNext")
                : t("assessment.review.complete")
              : t("assessment.review.passQuizFirst")}
          {reviewReady && nextTask && <ArrowRight aria-hidden />}
        </Button>
      </footer>
    </div>
  );
}
