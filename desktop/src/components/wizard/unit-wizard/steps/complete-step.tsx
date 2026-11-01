"use client";
import { useT } from "@xue-learn/core/i18n";

import { Link } from "react-router-dom";
import { Button } from "@xue-learn/core/ui/button";
import type { UnitWizardModel } from "../use-unit-wizard.tsx";

type Props = Pick<
  UnitWizardModel,
  | "unitStatus"
  | "hasReference"
  | "goToStep"
  | "sessionBusy"
  | "isMicro"
  | "completeReturn"
> & {
  preserveImmersive?: boolean;
};

export function CompleteStep({
  unitStatus,
  hasReference,
  goToStep,
  sessionBusy,
  isMicro,
  completeReturn,
  preserveImmersive = false,
}: Props) {
  const t = useT();
  return (
    <div className="space-y-4 rounded-xl border border-[var(--brand-200)] bg-gradient-to-br from-[var(--brand-50)] to-[var(--bg-50)] p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand-100)]">
          <svg
            className="h-5 w-5 text-[var(--brand-600)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-[var(--text-800)]">
            {isMicro
              ? t("desktop.ui.completeStep.shortCourseComplete")
              : t("desktop.ui.completeStep.unitComplete")}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-500)]">
            {isMicro
              ? t(
                  "desktop.ui.completeStep.yourProgressIsSavedSpacedReviewsWill",
                )
              : t(
                  "desktop.ui.completeStep.yourProgressIsSavedSpacedReviewsWill",
                )}
            {unitStatus === "completed_needs_reinforcement" &&
              t("desktop.ui.completeStep.thisUnitNeedsMorePracticeRevisitIt")}
          </p>
        </div>
      </div>
      {hasReference && (
        <p className="rounded-lg bg-[var(--bg-200)] px-3 py-2 text-xs text-[var(--text-600)]">
          {t("desktop.ui.completeStep.theLessonContentAndNotesAreAvailable")}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <Button
          variant="outline"
          className="h-10 w-full"
          onClick={() => void goToStep("active_recall")}
          disabled={sessionBusy}
        >
          {t("desktop.ui.completeStep.practiceAgain")}
        </Button>
        <Link
          to={completeReturn.path}
          state={
            preserveImmersive ? { preserveImmersiveLearning: true } : undefined
          }
          className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[var(--brand-600)] px-4 text-sm font-medium text-white hover:bg-[var(--brand-700)]"
        >
          {completeReturn.label}
        </Link>
      </div>
      {!isMicro && completeReturn.overviewPath !== completeReturn.path && (
        <Link
          to={completeReturn.overviewPath}
          className="block pt-1 text-center text-xs text-[var(--text-400)] transition-colors hover:text-[var(--brand-600)]"
        >
          {completeReturn.overviewLabel}
        </Link>
      )}
    </div>
  );
}
