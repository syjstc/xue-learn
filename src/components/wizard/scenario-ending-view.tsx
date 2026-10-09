"use client";

import { ArrowRight, Award, History, Lightbulb, MessageCircle, RotateCcw } from "lucide-react";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { cn } from "@xue-learn/core/source/src/lib/utils.ts";
import { coachAvatarSrc } from "./scenario-theater-helpers.ts";
import type { ScenarioTheaterEnding, ScenarioTheaterRun } from "@/shared/domain/scenario-theater";
import type { ScenarioTheaterDefinition } from "@/shared/domain/scenario-theater";

/**
 * Full-screen ending view shown when a scenario run completes.
 * Displays the ending title, summary, coach debrief, meter scores, and
 * the complete decision path so the learner can review their choices.
 */
export function ScenarioEndingView({
  ending,
  meters,
  run,
  coach,
  onContinue,
  onRestart,
}: {
  ending: ScenarioTheaterEnding;
  meters: ScenarioTheaterDefinition["meters"];
  run: ScenarioTheaterRun;
  coach: ScenarioTheaterDefinition["coach"];
  onContinue: () => Promise<void>;
  onRestart: () => Promise<unknown>;
}) {
  const t = useT();
  const endingLabel =
    ending.kind === "strong"
      ? t("scenario.ending.strong")
      : ending.kind === "mixed"
        ? t("scenario.ending.mixed")
        : t("scenario.ending.setback");
  const endingTone =
    ending.kind === "strong"
      ? "border-[var(--success)]/20 bg-[var(--success-soft)] text-[var(--success)]"
      : ending.kind === "mixed"
        ? "border-primary/20 bg-primary/10 text-primary"
        : "border-[var(--warning)]/20 bg-[var(--warning-soft)] text-[var(--warning)]";

  return (
    <section className="scenario-ending-view scenario-view-transition mx-auto w-full max-w-6xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="relative overflow-hidden border-b border-border bg-gradient-to-br from-primary/10 via-card to-card px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
        <div className="pointer-events-none absolute -right-20 -top-36 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative">
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold",
              endingTone,
            )}
          >
            <Award className="h-4 w-4" />
            {t("scenario.ending.completed", { ending: endingLabel })}
          </span>
          <h2 className="mt-5 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {ending.title}
          </h2>
          <p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
            {ending.summary}
          </p>
          <div className="mt-6 grid max-w-2xl grid-cols-2 gap-2 sm:gap-3">
            {meters.map((meter) => {
              const value = run.meters[meter.id] ?? meter.initial;
              const progress =
                ((value - meter.min) / (meter.max - meter.min)) * 100;
              return (
                <div
                  key={meter.id}
                  className="scenario-ending-meter rounded-xl border border-border/80 bg-background/80 px-3 py-3 shadow-sm backdrop-blur-sm sm:px-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs text-muted-foreground">
                      {meter.label}
                    </span>
                    <span className="text-sm font-bold text-foreground">
                      {value}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--ds-progress-track)]">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        meter.tone === "risk"
                          ? "bg-[var(--warning)]"
                          : meter.tone === "positive"
                            ? "bg-[var(--success)]"
                            : "bg-[var(--info)]",
                      )}
                      style={{
                        width: `${Math.max(0, Math.min(100, progress))}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] lg:gap-8 lg:p-10">
        <div>
          <div className="rounded-xl border border-primary/15 bg-primary/5 p-5 sm:p-6">
            <p className="flex items-center gap-2 text-xs font-semibold text-primary">
              <MessageCircle className="h-4 w-4" />
              {t("scenario.ending.coachDebrief", {
                name: coach?.name ?? t("scenario.coach.defaultName"),
              })}
            </p>
            <p className="mt-3 text-base font-medium leading-7 text-foreground">
              {ending.coachDebrief}
            </p>
          </div>
          <div className="mt-4 rounded-xl border border-border p-4">
            <p className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-[var(--info)]" />
              {t("scenario.ending.debriefTip")}
            </p>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <History className="h-4 w-4 text-primary" />
              {t("scenario.ending.path")}
            </p>
            <span className="text-xs text-muted-foreground">
              {t("scenario.ending.choiceCount", { count: run.path.length })}
            </span>
          </div>
          <div className="mt-4 space-y-0">
            {run.path.map((entry, index) => (
              <div
                key={`${entry.sceneId}:${entry.choiceId}:${index}`}
                className="scenario-ending-path relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 pb-5 last:pb-0"
                style={{ animationDelay: `${240 + index * 90}ms` }}
              >
                {index < run.path.length - 1 ? (
                  <span className="absolute bottom-0 left-[0.9375rem] top-8 w-px bg-border" />
                ) : null}
                <span className="relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-xs font-bold text-primary">
                  {index + 1}
                </span>
                <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
                  <p className="text-sm font-medium leading-6 text-foreground">
                    {entry.consequence}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {entry.reflection}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-border bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-8 lg:px-10">
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => void onRestart()}
        >
          <RotateCcw className="h-4 w-4" />
          {t("scenario.ending.restart")}
        </Button>
        <Button className="gap-2" onClick={() => void onContinue()}>
          {t("scenario.ending.continueRecall")}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}
