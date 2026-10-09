"use client";

import { useState, useCallback } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Gauge,
  History,
  Lightbulb,
  MessageCircle,
  Target,
  TrendingUp,
} from "lucide-react";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { cn } from "@xue-learn/core/source/src/lib/utils.ts";
import { coachAvatarSrc } from "./scenario-theater-helpers.ts";
import type { ScenarioTheaterPlayState } from "@/shared/domain/scenario-theater";
import type { ScenarioResultTransition } from "./scenario-theater-helpers.ts";

type Props = {
  transition: ScenarioResultTransition;
  phase: 0 | 1 | 2;
  meters: ScenarioTheaterPlayState["definition"]["meters"];
  coach: ScenarioTheaterPlayState["definition"]["coach"];
  onRevealNext: () => void;
  onContinue: () => void;
};

/**
 * Post-choice result overlay displayed after the user selects an option.
 * Reveals consequence first, then meter changes, then coach reflection,
 * then allows progression to the next scene or ending.
 */
export function ScenarioResultView({
  transition,
  phase,
  meters,
  coach,
  onRevealNext,
  onContinue,
}: Props) {
  const t = useT();
  const meterChanges = meters
    .map((meter) => {
      const effect = transition.effects.find(
        (item) => item.meterId === meter.id,
      );
      if (!effect) return null;
      return {
        ...meter,
        before: transition.beforeMeters[meter.id] ?? meter.initial,
        after: transition.afterMeters[meter.id] ?? meter.initial,
        delta: effect.delta,
      };
    })
    .filter((meter): meter is NonNullable<typeof meter> => Boolean(meter));

  return (
    <>
      <section
        className="space-y-4"
        aria-label={t("scenario.result.ariaLabel")}
      >
        <article className="scenario-result-view scenario-view-transition relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-primary/5 to-card px-4 py-5 sm:px-7 lg:min-h-52 lg:px-9 lg:py-8">
            <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
            <div className="relative z-[1] max-w-3xl pr-0 lg:pr-56">
              <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-primary">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                  <Target className="h-3.5 w-3.5" />
                </span>
                {t("scenario.result.actResult", { act: transition.sceneAct })}
              </p>
              <h2 className="mt-4 text-2xl font-bold leading-tight text-foreground sm:text-3xl lg:text-4xl">
                {transition.consequence}
              </h2>
              <div className="mt-5 inline-flex max-w-full items-center gap-2 rounded-full border border-primary/15 bg-background/75 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">
                  {t("scenario.result.yourChoice", {
                    choice: transition.selectedLabel,
                  })}
                </span>
              </div>
            </div>
            <div className="pointer-events-none absolute bottom-0 right-2 hidden h-full w-52 overflow-hidden lg:block xl:right-8">
              <img
                src={coachAvatarSrc(coach?.avatarCode)}
                alt={t("scenario.coach.named", {
                  name: coach?.name ?? t("scenario.coach.defaultName"),
                })}
                className="scenario-result-character absolute bottom-5 right-5 h-36 w-36 rounded-full border-4 border-background/80 object-cover shadow-lg"
              />
            </div>
          </div>
        </article>

        {phase >= 1 ? (
          <article className="scenario-result-score rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
            <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <TrendingUp className="h-4 w-4 text-primary" />
              {t("scenario.result.meterChanges")}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {meterChanges.map((meter) => (
                <div
                  key={meter.id}
                  className="scenario-result-meter rounded-xl border border-border bg-muted/30 px-4 py-3.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Gauge className="h-4 w-4" />
                      {meter.label}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-1 text-xs font-semibold",
                        meter.delta > 0
                          ? "bg-[var(--success-soft)] text-[var(--success)]"
                          : "bg-[var(--warning-soft)] text-[var(--warning)]",
                      )}
                    >
                      {meter.delta > 0 ? "+" : ""}
                      {meter.delta}
                    </span>
                  </div>
                  <p className="mt-3 flex items-baseline gap-2 text-xl font-bold text-foreground">
                    <span className="text-sm font-medium text-muted-foreground">
                      {meter.before}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    {meter.after}
                  </p>
                </div>
              ))}
            </div>
          </article>
        ) : null}

        {phase >= 2 ? (
          <>
            <article className="scenario-feedback rounded-2xl border border-primary/15 bg-primary/5 p-4 shadow-sm sm:p-6">
              <p className="flex items-center gap-2 text-xs font-semibold text-primary">
                <MessageCircle className="h-4 w-4" />
                {t("scenario.result.coachFeedback")}
              </p>
              <p className="mt-3 text-base font-medium leading-7 text-foreground">
                {transition.reflection}
              </p>
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-background/70 px-3 py-2.5 text-sm leading-6 text-[var(--info)]">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{t("scenario.result.reflectionPrompt")}</p>
              </div>
            </article>

            <details className="group rounded-xl border border-border bg-card px-4 py-3 text-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-muted-foreground marker:hidden">
                <span className="inline-flex items-center gap-2">
                  <History className="h-4 w-4" />
                  {t("scenario.result.reviewChoice")}
                </span>
                <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
              </summary>
              <p className="mt-3 border-t border-border pt-3 leading-6 text-foreground">
                {transition.selectedLabel}
              </p>
            </details>
          </>
        ) : null}

        <p className="sr-only" aria-live="polite">
          {phase === 0
            ? t("scenario.result.liveResult", {
                result: transition.consequence,
              })
            : phase === 1
              ? t("scenario.result.liveMeterChanges", {
                  changes: meterChanges
                    .map((meter) =>
                      t("scenario.result.liveMeterChange", {
                        label: meter.label,
                        before: meter.before,
                        after: meter.after,
                      }),
                    )
                    .join(t("scenario.listSeparator")),
                })
              : t("scenario.result.liveFeedback", {
                  feedback: transition.reflection,
                })}
        </p>
      </section>

      <div className="scenario-result-actions flex min-h-16 items-center justify-end pt-2">
        {phase < 2 ? (
          <Button
            className="min-h-12 w-full gap-2 shadow-sm sm:w-auto sm:min-w-48"
            onClick={onRevealNext}
          >
            {phase === 0
              ? t("scenario.result.viewMeters")
              : t("scenario.result.viewFeedback")}
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            className="min-h-12 w-full gap-2 shadow-sm sm:w-auto sm:min-w-48"
            onClick={onContinue}
          >
            {transition.nextIsEnding
              ? t("scenario.result.viewEnding")
              : t("scenario.result.nextAct")}
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </>
  );
}
