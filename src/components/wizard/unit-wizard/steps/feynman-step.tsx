"use client";

import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
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
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[var(--text-800)]">
        输出检验
      </h2>
      <p className="text-sm text-[var(--text-400)]">
        用自己的话讲解「{unitTitle}」，就像教一个完全不懂的人。
      </p>
      <textarea
        className="mt-4 w-full rounded-lg border p-3 text-sm"
        rows={6}
        value={feynmanText}
        onChange={(e) => setFeynmanText(e.target.value)}
        placeholder="开始讲解…"
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={submitFeynman} disabled={sessionBusy}>
          提交讲解
        </Button>
      </div>
      {feedback && (
        <div className="rounded-lg bg-[var(--bg-300)] p-4 text-sm">
          <p>结果：{(feedback.passed as boolean) ? "通过" : "需巩固"}</p>
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
