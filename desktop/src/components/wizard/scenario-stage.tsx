"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, LoaderCircle, MessageCircle } from "lucide-react";
import type { ScenarioTheaterDefinitionV1, ScenarioTheaterPlayState } from "@/shared/domain/scenario-theater";
import { cn } from "@xue-learn/core/utils";
import { useT } from "@xue-learn/core/i18n";
import { AiGeneratedNotice } from "@/components/ui/ai-generated-notice";
import { scenarioAvatarSrc, scenarioStandingSrc, type ScenarioResultTransition } from "./scenario-theater-helpers.ts";
import { ScenarioDialogue, ScenarioTheaterMarkdown } from "./scenario-dialogue.tsx";
import { ScenarioResultView } from "./scenario-result-view.tsx";
import { ScenarioEndingView } from "./scenario-ending-view.tsx";

/**
 * Legacy V1 scenario stage — single-body-per-scene format.
 * Kept for backward compatibility with existing definitions.
 */
export function ScenarioTheaterStage({
  play,
  busy,
  scenePending,
  onChoose,
  onRestart,
  onContinue,
}: {
  play: ScenarioTheaterPlayState;
  busy: boolean;
  scenePending: boolean;
  onChoose: (
    sceneId: string,
    choiceId: string,
  ) => Promise<ScenarioTheaterPlayState | null>;
  onRestart: () => Promise<ScenarioTheaterPlayState | null>;
  onContinue: () => Promise<void>;
}) {
  const t = useT();
  const { definition, run } = play;
  const scene = definition.scenes.find(
    (item) => item.id === run.currentSceneId,
  ) as ScenarioTheaterDefinitionV1["scenes"][number] | undefined;
  const ending =
    play.ending ??
    definition.endings.find((item) => item.id === run.endingId) ??
    null;
  const speaker = scene?.speakerId
    ? definition.characters.find((item) => item.id === scene.speakerId)
    : null;
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [dialogueComplete, setDialogueComplete] = useState(false);
  const [pendingResult, setPendingResult] =
    useState<ScenarioResultTransition | null>(null);
  const [resultPhase, setResultPhase] = useState<0 | 1 | 2>(0);
  const revealChoices = useCallback(() => setDialogueComplete(true), []);

  useEffect(() => {
    setSelectedChoiceId(null);
    setDialogueComplete(false);
  }, [run.currentSceneId, run.runVersion]);

  useEffect(() => {
    setResultPhase(0);
  }, [pendingResult]);

  const choose = useCallback(
    async (
      currentScene: NonNullable<typeof scene>,
      choice: (typeof currentScene.choices)[number],
    ) => {
      setSelectedChoiceId(choice.id);
      const beforeMeters = { ...run.meters };
      const next = await onChoose(currentScene.id, choice.id);
      if (!next) return;
      setPendingResult({
        key: `${next.run.id}:${next.run.runVersion}:${currentScene.id}:${choice.id}`,
        sceneAct: currentScene.act,
        selectedLabel: choice.label,
        consequence: choice.consequence,
        reflection: choice.reflection,
        beforeMeters,
        afterMeters: { ...next.run.meters },
        effects: choice.effects,
        nextIsEnding: next.run.status === "completed",
      });
    },
    [onChoose, run.meters],
  );

  useEffect(() => {
    if (!scene || busy || !dialogueComplete) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }
      const index = event.key.toUpperCase().charCodeAt(0) - 65;
      const choice = scene.choices[index];
      if (!choice) return;
      event.preventDefault();
      void choose(scene, choice);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, choose, dialogueComplete, scene]);

  const meters = useMemo(
    () =>
      definition.meters.map((meter) => ({
        ...meter,
        value:
          pendingResult && resultPhase === 0
            ? (pendingResult.beforeMeters[meter.id] ?? meter.initial)
            : (run.meters[meter.id] ?? meter.initial),
        delta:
          pendingResult && resultPhase >= 1
            ? (pendingResult.effects.find(
                (effect) => effect.meterId === meter.id,
              )?.delta ?? 0)
            : 0,
      })),
    [definition.meters, pendingResult, resultPhase, run.meters],
  );

  return (
    <main className="scenario-dialog-viewport mx-auto flex w-full max-w-7xl flex-col px-4 py-3 sm:px-8 sm:py-5">
      <AiGeneratedNotice className="sticky top-3 z-50 mb-3" />
      <div className="scenario-hud mb-4 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(25rem,1fr)] lg:items-center lg:px-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-primary">
              {t("scenario.legacy.currentTask", {
                role: definition.learnerRole,
              })}
            </p>
            <p className="mt-1 line-clamp-2 text-sm leading-5 text-foreground">
              {definition.objective}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {meters.map((meter) => {
              const value =
                ((meter.value - meter.min) / (meter.max - meter.min)) * 100;
              return (
                <div
                  key={meter.id}
                  className={cn(
                    "relative rounded-lg bg-muted px-3 py-2 transition-colors duration-500",
                    meter.delta && resultPhase >= 1 && "scenario-meter-flash",
                  )}
                >
                  <div className="mb-1 flex justify-between gap-2 text-xs">
                    <span className="truncate text-muted-foreground">
                      {meter.label}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 font-semibold text-foreground">
                      {meter.delta ? (
                        <span
                          className={cn(
                            "scenario-meter-delta rounded-full px-1.5 py-0.5 text-[10px]",
                            meter.delta > 0
                              ? "bg-[var(--success-soft)] text-[var(--success)]"
                              : "bg-[var(--warning-soft)] text-[var(--warning)]",
                          )}
                        >
                          {meter.delta > 0 ? "+" : ""}
                          {meter.delta}
                        </span>
                      ) : null}
                      {meter.value}
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-[var(--ds-progress-track)]">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-700 motion-reduce:transition-none",
                        meter.tone === "risk"
                          ? "bg-[var(--warning)]"
                          : meter.tone === "positive"
                            ? "bg-[var(--success)]"
                            : "bg-[var(--info)]",
                      )}
                      style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {pendingResult ? (
        <ScenarioResultView
          key={pendingResult.key}
          meters={definition.meters}
          phase={resultPhase}
          transition={pendingResult}
          coach={definition.coach}
          onRevealNext={() =>
            setResultPhase((current) => (current === 0 ? 1 : 2))
          }
          onContinue={() => setPendingResult(null)}
        />
      ) : ending ? (
        <ScenarioEndingView
          ending={ending}
          meters={definition.meters}
          run={run}
          coach={definition.coach}
          onContinue={onContinue}
          onRestart={onRestart}
        />
      ) : scenePending ? (
        <div className="mx-auto w-full max-w-xl">
          <div
            className="flex flex-col items-center rounded-xl border border-border bg-card p-10 text-center shadow-sm"
            aria-live="polite"
          >
            <LoaderCircle className="h-8 w-8 animate-spin text-primary motion-reduce:animate-none" />
            <h2 className="mt-4 text-xl font-semibold">
              {t("scenario.stage.buildingTitle")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("scenario.stage.buildingChoices")}
            </p>
          </div>
        </div>
      ) : scene ? (
        <div
          key={`${scene.id}:${run.runVersion}`}
          className={cn(
            "mx-auto w-full animate-in fade-in slide-in-from-bottom-4 duration-500 motion-reduce:animate-none",
            scene.effect === "shake" && "scenario-effect-shake",
            scene.effect === "pulse" && "scenario-effect-pulse",
          )}
        >
          <div className="scenario-stage-grid overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:grid lg:min-h-[430px] lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.55fr)]">
            <div className="relative min-h-28 overflow-hidden border-b border-border bg-primary/5 lg:min-h-0 lg:border-b-0 lg:border-r">
              <div className="absolute inset-x-0 bottom-0 hidden justify-center lg:flex">
                <img
                  src={scenarioStandingSrc(
                    speaker?.avatar,
                    speaker?.appearance?.assetCode,
                  )}
                  alt={
                    speaker
                      ? t("scenario.legacy.characterArt", {
                          name: speaker.name,
                        })
                      : t("scenario.legacy.sceneCharacterArt")
                  }
                  className="scenario-avatar h-[410px] w-full object-contain object-bottom"
                />
              </div>
              <div className="flex items-center gap-3 px-4 py-3 lg:absolute lg:inset-x-0 lg:bottom-0 lg:z-[1] lg:bg-background/90 lg:backdrop-blur-sm">
                <img
                  src={scenarioAvatarSrc(
                    speaker?.avatar,
                    speaker?.appearance?.assetCode,
                  )}
                  alt=""
                  aria-hidden
                  className="h-14 w-14 rounded-full border border-border object-cover lg:hidden"
                />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-primary">
                    {speaker?.name ?? t("scenario.legacy.sceneCharacter")}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {speaker?.role ?? definition.learnerRole}
                  </p>
                </div>
              </div>
            </div>
            <div className="relative flex min-w-0 flex-col">
              {play.currentSceneStatus === "fallback" ? (
                <span className="absolute right-3 top-3 z-[1] inline-flex rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  {t("scenario.legacy.simpleScene")}
                </span>
              ) : null}
              <div className="p-4 sm:p-6 lg:p-8">
                <div className="flex items-center gap-2 text-xs font-medium text-primary">
                  <MessageCircle className="h-3.5 w-3.5" />
                  <span>{t("scenario.stage.act", { act: scene.act })}</span>
                </div>
                <h2 className="mt-1 text-xl font-bold sm:text-2xl">
                  {scene.title}
                </h2>
                {speaker ? (
                  <p className="mt-1 hidden text-xs text-muted-foreground lg:block">
                    {speaker.name} · {speaker.role}
                  </p>
                ) : null}
              </div>
              <div className="scenario-dialogue-copy flex min-h-[150px] flex-1 items-center border-t border-border/70 px-4 py-6 sm:px-6 lg:px-8">
                <ScenarioDialogue
                  key={`${scene.id}:${run.runVersion}`}
                  text={scene.body}
                  onComplete={revealChoices}
                />
              </div>
            </div>
          </div>
          {dialogueComplete ? (
            <div className="scenario-choices">
              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">
                  {t("scenario.choices.actionPrompt")}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t("scenario.choices.keyboardHint")}
                </p>
              </div>
              <div className="mt-2 grid gap-2.5 lg:grid-cols-2">
                {scene.choices.map((choice, index) => (
                  <button
                    key={choice.id}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void choose(scene, choice);
                    }}
                    className={cn(
                      "scenario-choice group relative flex min-h-14 w-full items-center gap-3 overflow-hidden rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-primary hover:bg-primary/5 hover:shadow-md active:translate-y-0 active:scale-[0.99] disabled:pointer-events-none motion-reduce:transform-none motion-reduce:transition-none",
                      selectedChoiceId === choice.id
                        ? "border-primary bg-primary/10"
                        : "border-border",
                      busy &&
                        selectedChoiceId !== choice.id &&
                        "scale-[0.98] opacity-40",
                    )}
                    style={{ animationDelay: `${index * 90}ms` }}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {busy && selectedChoiceId === choice.id ? (
                        <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                      ) : (
                        String.fromCharCode(65 + index)
                      )}
                    </span>
                    <ScenarioTheaterMarkdown
                      content={choice.label}
                      variant="inline"
                      className="flex-1 text-sm leading-6 text-foreground"
                    />
                    {busy && selectedChoiceId === choice.id ? (
                      <span className="text-xs font-medium text-primary">
                        {t("scenario.legacy.advancing")}
                      </span>
                    ) : (
                      <ChevronRight className="h-5 w-5 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary motion-reduce:transform-none" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
              <span className="scenario-waiting-dot h-1.5 w-1.5 rounded-full bg-primary" />
              {t("scenario.legacy.chooseAfterDialogue")}
            </div>
          )}
        </div>
      ) : (
        <p className="mx-auto text-muted-foreground">
          {t("scenario.stage.unavailable")}
        </p>
      )}
    </main>
  );
}
