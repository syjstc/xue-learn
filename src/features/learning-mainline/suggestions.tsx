import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { MainlineDecision } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { apiGet } from "@/shared/api";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { useMainline } from "./provider.tsx";
import { mainlineEnabled } from "./enabled.ts";
import { currentLearningPosition } from "@/features/learning-trajectory/navigation";
export function MainlineSuggestions({
  boundaryKey,
  unitId,
}: {
  boundaryKey: string;
  unitId: string;
}) {
  const mainline = useMainline(),
    navigate = useNavigate(),
    t = useT();
  const [decision, setDecision] = useState<MainlineDecision | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (
      !mainline?.snapshot ||
      mainline.current?.unitId !== unitId ||
      !mainlineEnabled("recommendations")
    )
      return;
    setDecision(null);
    let cancelled = false;
    void apiGet<MainlineDecision>(
      `/api/learning-trajectory/mainline/next?sessionId=${encodeURIComponent(mainline.sessionId)}&boundary=true${mainline.timeLimitMinutes ? `&timeLimitMinutes=${mainline.timeLimitMinutes}` : ""}`,
    )
      .then(async (value) => {
        if (cancelled || !value.optional) return;
        await mainline.command({
          action: "shown",
          timeLimitMinutes: mainline.timeLimitMinutes,
          candidateId: value.optional.id,
          snapshotVersion: value.snapshotVersion,
        });
        if (!cancelled) setDecision(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    boundaryKey,
    mainline?.sessionId,
    Boolean(mainline?.snapshot),
    mainline?.current?.unitId === unitId,
    mainline?.timeLimitMinutes,
  ]);
  const candidate = decision?.optional;
  if (!candidate || !mainline) return null;
  const act = async (action: "start" | "later" | "today") => {
    setBusy(true);
    try {
      if (action === "start" && Date.now() > Date.parse(decision!.expiresAt)) {
        setDecision(null);
        return;
      }
      await mainline.command({
        action,
        timeLimitMinutes: mainline.timeLimitMinutes,
        candidateId: candidate.id,
        snapshotVersion: decision!.snapshotVersion,
        ...(action === "start"
          ? {
              unitId: candidate.unitId,
              goalId: candidate.goalId,
              kind: "review" as const,
              reviewSource: candidate.reviewSource,
              position: mainline.current
                ? currentLearningPosition(mainline.current.position)
                : undefined,
            }
          : { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      setDecision(null);
      if (action === "start")
        navigate(
          candidate.reviewSource === "flashcards"
            ? `/reviews?tab=flashcards&mainlineUnit=${encodeURIComponent(candidate.unitId)}`
            : `/reviews/${candidate.goalId}/${candidate.unitId}`,
          {
            state: { startNewQuiz: true },
          },
        );
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside
      className="rounded-xl border border-border p-4"
      aria-label={t("mainline.reviewSuggestion")}
    >
      <p className="text-sm font-medium">
        {t("mainline.reviewSuggestion")} · {candidate.title}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void act("start").catch(() => setDecision(null))}
        >
          {t("mainline.accept")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void act("later").catch(() => undefined)}
        >
          {t("mainline.later")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void act("today").catch(() => undefined)}
        >
          {t("mainline.today")}
        </Button>
      </div>
    </aside>
  );
}
