"use client";
import { useT } from "@xue-learn/core/i18n";

import { Button } from "@xue-learn/core/ui/button";
import type { UnitWizardModel } from "../use-unit-wizard.tsx";

type Props = Pick<
  UnitWizardModel,
  | "unitTitle"
  | "feynmanText"
  | "setFeynmanText"
  | "submitFeynman"
  | "sessionBusy"
  | "feedback"
  | "renderGenStream"
>;

export function FeynmanStep({
  unitTitle,
  feynmanText,
  setFeynmanText,
  submitFeynman,
  sessionBusy,
  feedback,
  renderGenStream,
}: Props) {
  const t = useT();
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[var(--text-800)]">
        {t("learningConversation.outputCheck")}
      </h2>
      <p className="text-sm text-[var(--text-400)]">
        {t("desktop.i18n.feynmanPrompt", { title: unitTitle })}
      </p>
      <textarea
        className="mt-4 w-full rounded-lg border p-3 text-sm"
        rows={6}
        value={feynmanText}
        onChange={(e) => setFeynmanText(e.target.value)}
        placeholder={t("desktop.ui.feynmanStep.startExplaining")}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={submitFeynman} disabled={sessionBusy}>
          {t("desktop.ui.feynmanStep.submitExplanation")}
        </Button>
      </div>
      {feedback && (
        <div className="rounded-lg bg-[var(--bg-300)] p-4 text-sm">
          <p>
            {t("desktop.ui.feynmanStep.result")}
            {(feedback.passed as boolean)
              ? t("desktop.ui.feynmanStep.passed")
              : t("desktop.ui.feynmanStep.needsPractice")}
          </p>
          <ul className="mt-2 list-disc pl-5">
            {(feedback.blindSpots as string[])?.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {renderGenStream("feynman")}
    </div>
  );
}
