import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@xue-learn/core/ui/button";
import { Card } from "@/components/ui/card";
import {
  useCompleteFlashcardSession,
  useFlashcardDueQueue,
  useSubmitFlashcardReview,
} from "@/hooks/use-flashcards";
import type {
  FlashCardDto,
  FlashcardReviewScope,
  FsrsRating,
} from "@/shared/domain/flashcards";
import {
  formatFlashcardReviewInterval,
  previewFlashcardNextReview,
} from "@/shared/domain/flashcards";
import { FlashcardSourceDialog } from "./flashcard-source-dialog.tsx";
import { FlashcardUnitChip } from "./flashcard-unit-chip.tsx";
import { useT } from "@xue-learn/core/i18n";

type FlashcardStudySessionProps = {
  mode: "unit" | "global";
  scope: FlashcardReviewScope;
  onSessionComplete?: () => void;
  onExit?: () => void;
};

const RATING_BUTTONS: {
  rating: FsrsRating;
  labelKey:
    | "flashcards.ratingAgain"
    | "flashcards.ratingHard"
    | "flashcards.ratingGood"
    | "flashcards.ratingEasy";
  tone: string;
  variant: "default" | "outline" | "destructive" | "secondary";
}[] = [
  {
    rating: "Again",
    labelKey: "flashcards.ratingAgain",
    tone: "text-destructive",
    variant: "destructive",
  },
  {
    rating: "Hard",
    labelKey: "flashcards.ratingHard",
    tone: "text-amber-600 dark:text-amber-400",
    variant: "outline",
  },
  {
    rating: "Good",
    labelKey: "flashcards.ratingGood",
    tone: "text-primary-foreground/80",
    variant: "default",
  },
  {
    rating: "Easy",
    labelKey: "flashcards.ratingEasy",
    tone: "text-emerald-600 dark:text-emerald-400",
    variant: "secondary",
  },
];

export function FlashcardStudySession({
  mode,
  scope,
  onSessionComplete,
  onExit,
}: FlashcardStudySessionProps) {
  const t = useT();
  const dueQuery = useFlashcardDueQueue(scope);
  const submitReview = useSubmitFlashcardReview();
  const completeSession = useCompleteFlashcardSession();
  const sessionId = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `flashcards-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  const [queue, setQueue] = useState<FlashCardDto[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [pendingAgain, setPendingAgain] = useState(false);
  const [stats, setStats] = useState({
    reviewedCount: 0,
    againCount: 0,
    hardCount: 0,
    weakTopics: [] as string[],
    goalIds: new Set<string>(),
    unitIds: new Set<string>(),
  });

  useEffect(() => {
    if (dueQuery.data?.cards) {
      setQueue(dueQuery.data.cards);
      setIndex(0);
      setFlipped(false);
      setSourceOpen(false);
      setPendingAgain(false);
    }
  }, [dueQuery.data?.cards]);

  const current = queue[index] ?? null;
  const finished =
    !dueQuery.isPending && queue.length > 0 && index >= queue.length;
  const progress =
    queue.length > 0 ? Math.min(100, (index / queue.length) * 100) : 0;
  const nextReviewPreviews = useMemo(() => {
    if (!current) return [];
    const now = new Date();
    return RATING_BUTTONS.map((button) => ({
      ...button,
      interval: formatFlashcardReviewInterval(
        previewFlashcardNextReview(current, button.rating, now),
        now,
      ),
    }));
  }, [current]);

  async function advanceAfterReview(rating: FsrsRating) {
    if (!current) return;
    await submitReview.mutateAsync({ cardId: current.id, rating });

    const weakTopic = current.front.slice(0, 40);
    setStats((prev) => ({
      reviewedCount: prev.reviewedCount + 1,
      againCount: prev.againCount + (rating === "Again" ? 1 : 0),
      hardCount: prev.hardCount + (rating === "Hard" ? 1 : 0),
      weakTopics:
        rating === "Again" || rating === "Hard"
          ? [...prev.weakTopics, weakTopic]
          : prev.weakTopics,
      goalIds: new Set(prev.goalIds).add(current.unit.goal.id),
      unitIds: new Set(prev.unitIds).add(current.unit.id),
    }));

    setFlipped(false);
    setSourceOpen(false);
    setPendingAgain(false);
    setIndex((i) => i + 1);
  }

  async function handleRating(rating: FsrsRating) {
    if (!current) return;

    if (rating === "Again" && !pendingAgain) {
      setFlipped(true);
      setPendingAgain(true);
      await submitReview.mutateAsync({ cardId: current.id, rating });
      setStats((prev) => ({
        ...prev,
        reviewedCount: prev.reviewedCount + 1,
        againCount: prev.againCount + 1,
        weakTopics: [...prev.weakTopics, current.front.slice(0, 40)],
        goalIds: new Set(prev.goalIds).add(current.unit.goal.id),
        unitIds: new Set(prev.unitIds).add(current.unit.id),
      }));
      return;
    }

    if (pendingAgain) {
      setFlipped(false);
      setSourceOpen(false);
      setPendingAgain(false);
      setIndex((i) => i + 1);
      return;
    }

    await advanceAfterReview(rating);
  }

  function handleNextAfterAgain() {
    if (!pendingAgain) return;
    setFlipped(false);
    setSourceOpen(false);
    setPendingAgain(false);
    setIndex((i) => i + 1);
  }

  useEffect(() => {
    if (!finished) return;
    void completeSession.mutateAsync({
      reviewedCount: stats.reviewedCount,
      againCount: stats.againCount,
      hardCount: stats.hardCount,
      sessionId: sessionId.current,
    });
    onSessionComplete?.();
  }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps

  if (dueQuery.isPending) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("flashcards.loadingCards")}
      </p>
    );
  }

  if (!current && !finished) {
    return (
      <Card className="p-6">
        <p className="text-muted-foreground">{t("flashcards.noDueCards")}</p>
        {onExit && (
          <Button variant="outline" className="mt-4" onClick={onExit}>
            {t("flashcards.backAction")}
          </Button>
        )}
      </Card>
    );
  }

  if (finished) {
    return (
      <Card className="p-6 space-y-3">
        <p className="font-medium text-foreground">
          {t("flashcards.sessionComplete")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("flashcards.sessionReviewed", { count: stats.reviewedCount })}
          {stats.againCount > 0 &&
            ` · ${t("flashcards.sessionAgain", { count: stats.againCount })}`}
        </p>
        {onExit && (
          <Button variant="outline" onClick={onExit}>
            {t("flashcards.backAction")}
          </Button>
        )}
      </Card>
    );
  }

  if (!current) return null;

  return (
    <Card className="overflow-hidden p-6 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-300">
      {mode === "global" && (
        <FlashcardUnitChip
          goalTitle={current.unit.goal.title}
          unitTitle={current.unit.title}
        />
      )}

      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            {index + 1} / {queue.length}
            {dueQuery.data && dueQuery.data.total > queue.length
              ? ` (${t("flashcards.queueTotal", { count: dueQuery.data.total })})`
              : ""}
          </span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div
        key={current.id}
        role="button"
        tabIndex={0}
        onClick={() => setFlipped((f) => !f)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setFlipped((f) => !f);
          }
        }}
        className="group mt-5 min-h-[10rem] cursor-pointer rounded-xl border border-border bg-card p-6 text-center shadow-sm transition-all duration-300 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-3 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md active:scale-[0.99]"
      >
        <p
          key={`${current.id}-${flipped ? "back" : "front"}`}
          className="text-lg font-medium text-foreground transition duration-300 animate-in fade-in-0 zoom-in-95"
        >
          {flipped ? current.back : current.front}
        </p>
        <p className="mt-4 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
          {flipped ? t("flashcards.flipFront") : t("flashcards.showAnswer")}
        </p>
      </div>

      <button
        type="button"
        className="mt-3 text-sm font-medium text-primary hover:underline"
        onClick={() => setSourceOpen(true)}
      >
        {t("flashcards.viewSource")}
      </button>

      <FlashcardSourceDialog
        cardId={current.id}
        open={sourceOpen}
        onOpenChange={setSourceOpen}
      />

      {flipped && (
        <div className="mt-6 grid grid-cols-2 gap-2 animate-in fade-in-0 slide-in-from-bottom-2 duration-300 sm:grid-cols-4">
          {pendingAgain ? (
            <Button
              className="col-span-2 transition-transform duration-200 hover:-translate-y-0.5 sm:col-span-4"
              onClick={handleNextAfterAgain}
            >
              {t("flashcards.nextCard")}
            </Button>
          ) : (
            nextReviewPreviews.map(
              ({ rating, labelKey, interval, tone, variant }) => (
                <Button
                  key={rating}
                  variant={variant}
                  size="lg"
                  className="h-auto min-h-14 flex-col gap-0.5 py-2 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
                  disabled={submitReview.isPending}
                  onClick={() => void handleRating(rating)}
                >
                  <span className="text-sm font-semibold leading-none">
                    {t(labelKey)}
                  </span>
                  <span
                    className={`text-[0.7rem] font-medium leading-tight ${tone}`}
                  >
                    {interval}
                  </span>
                </Button>
              ),
            )
          )}
        </div>
      )}

      {onExit && (
        <Button variant="ghost" size="sm" className="mt-4" onClick={onExit}>
          {t("flashcards.endSession")}
        </Button>
      )}
    </Card>
  );
}
