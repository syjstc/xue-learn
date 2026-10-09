"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, LoaderCircle, Sparkles, Theater } from "lucide-react";
import { Button } from "@xue-learn/core/ui/button";
import type {
  ScenarioTheaterContent,
  ScenarioTheaterPlayState,
} from "@/shared/domain/scenario-theater";
import { personalizeScenarioTheaterText } from "@/shared/domain/scenario-theater";
import { cn } from "@xue-learn/core/utils";
import { useT } from "@xue-learn/core/i18n";
import {useLearnerDisplayName} from "@/hooks/api/use-learner-profile";
import { ScenarioTheaterStage } from "./scenario-stage.tsx";
import { VisualNovelScenarioTheaterStage } from "./scenario-visual-novel-stage.tsx";

// ── Public types re-exports ─────────────────────────────────────────────────

export type {
  ScenarioResultTransition,
} from "./scenario-theater-helpers.ts";

// ── Props ───────────────────────────────────────────────────────────────────

type Props = {
  content: ScenarioTheaterContent | null;
  play: ScenarioTheaterPlayState | null;
  completedOnce: boolean;
  generating: boolean;
  onGenerate: (force?: boolean) => Promise<unknown>;
  onGenerateScene: (runId: string) => Promise<ScenarioTheaterPlayState | null>;
  onStart: () => Promise<ScenarioTheaterPlayState | null>;
  onChoose: (
    sceneId: string,
    choiceId: string,
  ) => Promise<ScenarioTheaterPlayState | null>;
  onRestart: () => Promise<ScenarioTheaterPlayState | null>;
  onContinue: () => Promise<void>;
  /** Optional escape hatch when theater is shown as a journey activity. */
  onLeave?: () => void;
  /** Local runtimes may replay prepared content without authoring scenes. */
  generationEnabled?: boolean;
};

/**
 * Scenario Theater (会学剧场) — the main entry point for a unit-ending
 * situational decision exercise. This card orchestrates the lifecycle from
 * card display through scene generation to immersive play.
 *
 * V2 definitions render the visual-novel stage with background art and
 * beat-by-beat dialogue; V1 definitions fall back to the legacy stage.
 */
export function ScenarioTheaterCard({
  content,
  play,
  completedOnce,
  generating,
  onGenerate,
  onGenerateScene,
  onStart,
  onChoose,
  onRestart,
  onContinue,
  onLeave,
  generationEnabled = true,
}: Props) {
  const t = useT();
  const learnerName = useLearnerDisplayName();
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [sceneRetry, setSceneRetry] = useState(0);
  const requestedScenes = useRef(new Set<string>());
  const sceneRetryTimers = useRef(new Map<string, number>());

  const definition = play?.definition ?? content?.definition ?? null;
  const isV2 = definition?.version === 2;

  // ── Scene prefetch ────────────────────────────────────────────────────────
  const activePlay = (play ?? content) as ScenarioTheaterPlayState | null;

  const requestCurrentScene = useCallback(
    async (nextPlay: ScenarioTheaterPlayState) => {
      if (
        !nextPlay.run.currentSceneId ||
        !["pending", "building"].includes(
          nextPlay.currentSceneStatus ?? "",
        )
      ) {
        return;
      }
      const key = `${nextPlay.run.id}:${nextPlay.run.runVersion}:${nextPlay.run.currentSceneId}`;
      if (requestedScenes.current.has(key)) return;
      requestedScenes.current.add(key);

      const scheduleRetry = () => {
        if (sceneRetryTimers.current.has(key)) return;
        const timer = window.setTimeout(() => {
          sceneRetryTimers.current.delete(key);
          setSceneRetry((v) => v + 1);
        }, 1_500);
        sceneRetryTimers.current.set(key, timer);
      };

      const result = await onGenerateScene(nextPlay.run.id);
      if (
        !result?.currentSceneStatus ||
        ["pending", "building"].includes(result.currentSceneStatus)
      ) {
        // Scene generation reported as incomplete — schedule a retry.
        scheduleRetry();
      }
    },
    [onGenerateScene],
  );

  useEffect(() => {
    if (!activePlay) return;
    void requestCurrentScene(activePlay);
  }, [activePlay, sceneRetry, requestCurrentScene]);

  // ── Escape key to close ───────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // ── Lifecycle actions ─────────────────────────────────────────────────────
  const start = async () => {
    const next = await onStart();
    if (next) {
      setOpen(true);
    }
  };

  const generate = async () => {
    const result = await onGenerate(content?.status === "failed");
    if (result) {
      const next = await onStart();
      if (next) {
        setOpen(true);
      }
    }
  };

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const result = await onGenerate(true);
      if (!result) return;
      const next = await onStart();
      if (next) {
        setOpen(true);
      }
    } finally {
      setRegenerating(false);
    }
  };

  // ── Scene status ──────────────────────────────────────────────────────────
  const scenePending =
    activePlay?.currentSceneStatus === "pending" ||
    activePlay?.currentSceneStatus === "building";

  // ── Card UI (theater not yet open) ────────────────────────────────────────
  if (!open) {
    return (
      <section
        className={cn(
          "scenario-card relative isolate overflow-hidden rounded-2xl border bg-card shadow-sm",
          "bg-gradient-to-br from-card via-card to-primary/[0.03]",
          "transition-all duration-300 hover:shadow-lg",
        )}
        aria-label={t("scenario.card.eyebrow")}
      >
        {/* Background decorative elements */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/5 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-primary/5 blur-2xl" />

        <div className="relative z-[1] p-5 sm:p-7">
          {/* Brand header */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Theater className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-[0.1em] text-primary">
                {t("scenario.card.eyebrow")}
              </p>
              <p className="text-xs font-medium text-muted-foreground">
                {t("scenario.card.defaultDescription")}
              </p>
            </div>
          </div>

          {/* Title */}
          <h3 className="mt-4 text-xl font-bold leading-snug text-foreground">
            {definition?.title ?? content?.recommendation ?? t("scenario.card.defaultTitle")}
          </h3>

          {/* Premise */}
          {definition?.premise || content?.definition?.premise ? (
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {personalizeScenarioTheaterText(
                definition?.premise ?? content!.definition!.premise,
                learnerName,
              )}
            </p>
          ) : content?.recommendation && !definition ? (
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {content.recommendation}
            </p>
          ) : null}

          {/* Meta */}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{t("scenario.card.duration")}</span>
            <span className="h-1 w-1 rounded-full bg-border" />
            <span>{t("scenario.card.autosave")}</span>
            {completedOnce ? (
              <>
                <span className="h-1 w-1 rounded-full bg-border" />
                <span className="font-semibold text-[var(--success)]">
                  {t("scenario.card.completedOnce")}
                </span>
              </>
            ) : null}
          </div>

          {/* Actions */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {content &&
            ["prepared", "ready"].includes(content.status) ? (
              <Button
                disabled={choosing}
                className="gap-2"
                onClick={() => void start()}
              >
                <Sparkles className="h-4 w-4" />
                {play
                  ? t("scenario.card.continue")
                  : completedOnce
                    ? t("scenario.card.generate")
                    : t("scenario.card.enter")}
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                disabled={
                  choosing ||
                  generating ||
                  regenerating ||
                  content?.status === "preparing"
                }
                className="gap-2"
                onClick={() => void generate()}
              >
                {generating || content?.status === "preparing" ? (
                  <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {generating || content?.status === "preparing"
                  ? t("scenario.card.summoning")
                  : content?.status === "failed"
                    ? t("scenario.card.regenerate")
                    : t("scenario.card.generate")}
              </Button>
            )}

            {definition && completedOnce ? (
              <Button
                variant="outline"
                disabled={regenerating}
                className="gap-2"
                onClick={() => void regenerate()}
              >
                {regenerating ? (
                  <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {t("scenario.card.regenerate")}
              </Button>
            ) : null}

            {onLeave ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={onLeave}
              >
                {t("scenario.card.backToLearning")}
              </Button>
            ) : null}
          </div>

          {/* Status hints */}
          {content?.status === "preparing" ? (
            <p className="mt-3 text-xs text-primary">
              {t("scenario.card.preparing")}
            </p>
          ) : content?.status === "prepared" ? (
            <p className="mt-3 text-xs text-primary">
              {t("scenario.card.prepared")}
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  // ── Theater open: delegate to the appropriate stage ──────────────────────
  if (!activePlay) return null;

  if (isV2) {
    return (
      <VisualNovelScenarioTheaterStage
        play={activePlay}
        busy={choosing}
        scenePending={scenePending}
        onChoose={async (sceneId, choiceId) => {
          setChoosing(true);
          try {
            const next = await onChoose(sceneId, choiceId);
            if (next) void requestCurrentScene(next);
            return next;
          } finally {
            setChoosing(false);
          }
        }}
        onRestart={onRestart}
        onContinue={onContinue}
      />
    );
  }

  return (
    <ScenarioTheaterStage
      play={activePlay}
      busy={choosing}
      scenePending={scenePending}
      onChoose={async (sceneId, choiceId) => {
        setChoosing(true);
        try {
          const next = await onChoose(sceneId, choiceId);
          if (next) void requestCurrentScene(next);
          return next;
        } finally {
          setChoosing(false);
        }
      }}
      onRestart={onRestart}
      onContinue={onContinue}
    />
  );
}
