"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ChevronRight,
  LoaderCircle,
  Sparkles,
  X,
} from "lucide-react";
import type {
  ScenarioTheaterCharacter,
  ScenarioTheaterDefinitionV2,
  ScenarioTheaterPlayState,
} from "@/shared/domain/scenario-theater";
import {
  scenarioTheaterBackgrounds,
  personalizeScenarioTheaterText,
} from "@/shared/domain/scenario-theater";
import { useScenarioPlayback } from "@/shared/domain/scenario-theater-player";
import { cn } from "@xue-learn/core/utils";
import { useT } from "@xue-learn/core/i18n";
import { useLearnerDisplayName } from "@/hooks/api/use-learner-profile";
import {
  scenarioAvatarSrc,
  scenarioStandingSrc,
  coachAvatarSrc,
  coachStandingSrc,
} from "./scenario-theater-helpers.ts";
import { ScenarioTheaterMarkdown } from "./scenario-dialogue.tsx";
import { ScenarioEndingView } from "./scenario-ending-view.tsx";
import type { StoryTransition } from "./scenario-theater-types.ts";

/**
 * Immersive V2 visual-novel stage with background art, character standing sprites,
 * beat-by-beat dialogue/narration, and in-line choices.
 */
export function VisualNovelScenarioTheaterStage({
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
  const learnerName = useLearnerDisplayName();
  const { definition, run } = play;
  const scene = definition.scenes.find(
    (item) => item.id === run.currentSceneId,
  ) as ScenarioTheaterDefinitionV2["scenes"][number] | undefined;
  const ending =
    play.ending ??
    definition.endings.find((item) => item.id === run.endingId) ??
    null;

  // ── Shared playback state machine ──────────────────────────────────────────
  const playback = useScenarioPlayback({
    definition,
    run,
    learnerName,
    onChoose: useCallback(
      async (sceneId: string, choiceId: string) => {
        const next = await onChoose(sceneId, choiceId);
        return next ?? null;
      },
      [onChoose],
    ),
  });

  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  // Track the last active dialogue speaker so we keep them on stage during narration.
  const lastDialogueSpeakerId = useRef<string | null>(null);

  useEffect(() => {
    if (playback.activeSpeaker) {
      lastDialogueSpeakerId.current = playback.activeSpeaker.id;
    }
  }, [playback.activeSpeaker]);

  const stagedSpeaker =
    playback.activeSpeaker ??
    definition.characters.find(
      (character) => character.id === lastDialogueSpeakerId.current,
    ) ??
    null;

  const stagedCharacters = useMemo(() => {
    if (!stagedSpeaker) return [];
    return [
      stagedSpeaker,
      ...definition.characters
        .filter((character) => character.id !== stagedSpeaker.id)
        .slice(0, 2),
    ];
  }, [definition.characters, stagedSpeaker]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    if (!playback.currentBeat || !playback.lineComplete) return;
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
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        playback.advance();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playback]);

  useEffect(() => {
    if (!scene || busy || !playback.choicesReady) return;
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
      setSelectedChoiceId(choice.id);
      void playback.choose(choice);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, playback, scene]);

  // Reset selected choice when choices finish (transition starts)
  useEffect(() => {
    if (playback.transition) setSelectedChoiceId(null);
  }, [playback.transition]);

  // ── Ending view ───────────────────────────────────────────────────────────
  if (playback.ending && !playback.transition) {
    return (
      <main className="scenario-dialog-viewport mx-auto flex w-full max-w-7xl items-center px-4 py-6 sm:px-8">
        <ScenarioEndingView
          ending={playback.ending}
          meters={definition.meters}
          run={run}
          coach={definition.coach}
          onContinue={onContinue}
          onRestart={onRestart}
        />
      </main>
    );
  }

  // ── Scene loading state ───────────────────────────────────────────────────
  if (scenePending && !playback.transition) {
    return (
      <main className="scenario-dialog-viewport flex items-center justify-center px-4">
        <div
          className="rounded-[var(--theater-radius-dialogue)] border border-[var(--theater-panel-border)] bg-[var(--theater-panel-strong-background)] p-10 text-center text-[var(--theater-foreground)] shadow-2xl"
          aria-live="polite"
        >
          <LoaderCircle className="mx-auto h-8 w-8 animate-spin text-[var(--theater-accent)] motion-reduce:animate-none" />
          <h2 className="mt-4 text-xl font-semibold">
            {t("scenario.stage.buildingTitle")}
          </h2>
          <p className="mt-2 text-sm text-[var(--theater-muted)]">
            {t("scenario.stage.buildingDialogue")}
          </p>
        </div>
      </main>
    );
  }

  if (!scene && !playback.transition) {
    return (
      <p className="mx-auto p-8 text-muted-foreground">
        {t("scenario.stage.unavailable")}
      </p>
    );
  }

  // ── Active scene rendering ───────────────────────────────────────────────
  const meterEffects = playback.transition?.effects ?? [];
  const activeBackground =
    definition.background ??
    scene?.background ??
    (playback.transition?.nextIsEnding ? "outcome" : "conversation");
  const backgroundPresentation = scenarioTheaterBackgrounds[activeBackground as keyof typeof scenarioTheaterBackgrounds] ??
    scenarioTheaterBackgrounds.conversation;
  const stagePanelClass =
    "border-[var(--theater-panel-border)] bg-[var(--theater-panel-background)] text-[var(--theater-foreground)] shadow-xl";
  const stageMutedTextClass = "text-[var(--theater-muted)]";
  const stageScrim =
    backgroundPresentation.scrimStrength === "strong"
      ? "var(--theater-scrim-heavy)"
      : "var(--theater-scrim-light)";

  return (
    <main
      className={cn(
        "scenario-dialog-viewport relative isolate overflow-hidden bg-[var(--theater-stage-background)] text-[var(--theater-foreground)]",
        scene?.effect === "shake" && "scenario-effect-shake",
        scene?.effect === "pulse" && "scenario-effect-pulse",
      )}
    >
      {/* Background art */}
      <picture aria-hidden className="absolute inset-0">
        <source
          media="(max-width: 640px) and (orientation: portrait)"
          srcSet={`/scenario-theater/backgrounds/${backgroundPresentation.assetStem}-portrait.webp`}
        />
        <img
          src={`/scenario-theater/backgrounds/${backgroundPresentation.assetStem}.webp`}
          alt=""
          className={cn(
            "h-full w-full object-cover transition-all duration-700 ease-out motion-reduce:transition-none",
            playback.isNarration && "scale-[1.012] blur-[0.75px] saturate-[0.82]",
          )}
          style={{ objectPosition: backgroundPresentation.wideFocus }}
        />
      </picture>
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(to bottom, ${stageScrim}, transparent 42%, ${stageScrim})`,
        }}
      />

      {/* Narration cover layer */}
      <div
        aria-hidden
        className={cn(
          "scenario-narration-cover absolute inset-0 z-[1] overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          playback.isNarration
            ? "translate-y-0 opacity-100"
            : "-translate-y-full opacity-0",
        )}
        style={{
          background:
            "radial-gradient(ellipse at 50% 43%, rgba(255, 199, 166, 0.12) 0%, rgba(26, 29, 34, 0.42) 38%, rgba(14, 16, 20, 0.76) 100%)",
        }}
      >
        <div className="absolute inset-x-0 top-0 h-[22%] bg-gradient-to-b from-[rgba(7,8,11,0.58)] to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-[34%] bg-gradient-to-t from-[rgba(7,8,11,0.78)] to-transparent" />
        <div className="absolute left-1/2 top-[12%] h-[58%] w-[min(72vw,48rem)] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(ellipse,rgba(255,188,151,0.13),transparent_70%)] blur-2xl" />
      </div>

      <div className="scenario-dialog-viewport relative z-[2] flex flex-col">
        {/* Narration badge */}
        <div
          aria-hidden={!playback.isNarration}
          className={cn(
            "pointer-events-none absolute left-1/2 top-[5.8rem] z-10 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-[rgba(255,218,199,0.48)] bg-[rgba(24,26,31,0.88)] px-3 py-1.5 text-[10px] font-semibold tracking-[0.12em] text-[var(--theater-accent)] shadow-[0_10px_32px_rgba(8,9,12,0.38)] backdrop-blur-md transition-all duration-500 ease-out sm:top-5 sm:gap-2 sm:tracking-[0.16em]",
            playback.isNarration
              ? "translate-y-0 opacity-100"
              : "-translate-y-8 opacity-0",
          )}
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span className="sm:hidden">
            {t("scenario.stage.narrationCoach", {
              name: definition.coach?.name ?? t("scenario.coach.defaultName"),
            })}
          </span>
          <span className="hidden sm:inline">
            {t("scenario.stage.narrationPaused")}
          </span>
          <span className="hidden h-1 w-1 rounded-full bg-[var(--theater-accent)] opacity-70 sm:block" />
          <span className="hidden font-normal tracking-normal text-[var(--theater-muted)] sm:inline">
            {t("scenario.stage.observation")}
          </span>
        </div>

        {/* HUD — scene title + meters + history button */}
        <div className="flex items-start justify-between gap-4 p-3 sm:p-5">
          <div
            className={cn(
              "max-w-xl rounded-xl border px-3 py-2 backdrop-blur-md",
              stagePanelClass,
            )}
          >
            <p
              className={cn(
                "text-[10px] font-semibold tracking-[0.18em]",
                "text-[var(--theater-accent)]",
              )}
            >
              {scene
                ? t("scenario.stage.actTitle", {
                    act: scene.act,
                    title: scene.title,
                  })
                : t("scenario.stage.finalAct")}
            </p>
            <p className={cn("mt-1 line-clamp-1 text-xs", stageMutedTextClass)}>
              {definition.objective}
            </p>
          </div>
          <div className="flex items-start gap-2">
            <div className="hidden gap-2 sm:flex">
              {definition.meters.map((meter) => {
                const effect = meterEffects.find(
                  (item) => item.meterId === meter.id,
                );
                return (
                  <div
                    key={meter.id}
                    className={cn(
                      "min-w-28 rounded-xl border px-3 py-2 backdrop-blur-md",
                      stagePanelClass,
                    )}
                  >
                    <div className="flex justify-between gap-3 text-[11px]">
                      <span className={stageMutedTextClass}>{meter.label}</span>
                      <span className="font-semibold">
                        {run.meters[meter.id] ?? meter.initial}
                        {effect ? (
                          <span
                            className={cn(
                              "ml-1",
                              effect.delta > 0
                                ? "text-[var(--theater-positive)]"
                                : "text-[var(--theater-risk)]",
                            )}
                          >
                            {effect.delta > 0 ? "+" : ""}
                            {effect.delta}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setHistoryOpen((value) => !value)}
              className={cn(
                "rounded-xl border p-2.5 backdrop-blur-md",
                stagePanelClass,
                "hover:bg-[var(--theater-panel-strong-background)]",
              )}
              aria-label={t("scenario.history.open")}
              aria-expanded={historyOpen}
            >
              <BookOpen className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* History panel */}
        {historyOpen ? (
          <div className="absolute right-4 top-16 z-20 max-h-[60vh] w-[min(28rem,calc(100%-2rem))] overflow-y-auto rounded-[var(--theater-radius-dialogue)] border border-[var(--theater-panel-border)] bg-[var(--theater-panel-strong-background)] p-4 text-[var(--theater-foreground)] shadow-2xl backdrop-blur-xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">
                {t("scenario.history.title")}
              </p>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="rounded-full p-1 text-[var(--theater-muted)] hover:bg-[var(--theater-accent-soft)]"
                aria-label={t("scenario.history.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              {playback.dialogueHistory.map((segment, segmentIndex) => (
                <div key={`${segment.sceneId}:${segmentIndex}`}>
                  {segmentIndex > 0 ? (
                    <div
                      className="mb-4 border-t border-[var(--theater-panel-border)]"
                      role="separator"
                    />
                  ) : null}
                  <p className="mb-3 text-[10px] font-semibold tracking-[0.18em] text-[var(--theater-accent)]">
                    {t("scenario.stage.actTitle", {
                      act: segment.act,
                      title: segment.title,
                    })}
                  </p>
                  <div className="space-y-3">
                    {segment.beats.map((beat, index) => {
                      const character =
                        beat.kind === "dialogue"
                          ? definition.characters.find(
                              (item) => item.id === beat.speakerId,
                            )
                          : null;
                      return (
                        <div
                          key={`${beat.kind}:${segment.sceneId}:${index}`}
                          className={cn(
                            "border-l-2 border-[var(--theater-panel-border)] pl-3 text-sm",
                            beat.kind === "dialogue" &&
                              beat.addressee === "learner" &&
                              "border-[var(--theater-accent)]",
                          )}
                        >
                          <p className="text-xs font-semibold text-[var(--theater-accent)]">
                            {character?.name ??
                              t("scenario.coach.named", {
                                name:
                                  definition.coach?.name ??
                                  t("scenario.coach.defaultName"),
                              })}
                          </p>
                          <ScenarioTheaterMarkdown
                            content={personalizeScenarioTheaterText(
                              beat.text,
                              learnerName,
                            )}
                            className="mt-1 text-sm leading-6 text-[var(--theater-foreground)]"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Character sprites & dialogue area */}
        <div className="relative flex flex-1 items-end justify-center px-3 pb-4 sm:px-8 sm:pb-7">
          {/* Character sprites */}
          <div
            className="pointer-events-none absolute inset-x-1 bottom-44 z-[1] flex items-end justify-center px-1 sm:inset-x-6 sm:px-4"
            aria-hidden
          >
            {/* Coach standing */}
            <div
              className={cn(
                "absolute bottom-0 left-1/2 z-[2] flex -translate-x-1/2 items-center justify-center transition-all duration-700 ease-out motion-reduce:transition-none",
                coachStandingSrc(definition.coach?.avatarCode)
                  ? "h-[min(50vh,34rem)] w-[min(82vw,24rem)] sm:h-[min(68vh,48rem)] sm:w-[min(62vw,34rem)]"
                  : "h-[min(38vh,22rem)] w-[min(72vw,22rem)] sm:h-[min(46vh,31rem)] sm:w-[min(46vh,31rem)]",
                playback.isNarration
                  ? "translate-y-0 scale-100 opacity-100"
                  : "-translate-y-12 scale-[0.92] opacity-0",
              )}
            >
              <div
                className={cn(
                  "absolute rounded-full bg-[radial-gradient(circle,rgba(255,202,174,0.52)_0%,rgba(255,166,128,0.2)_42%,transparent_72%)] blur-2xl",
                  coachStandingSrc(definition.coach?.avatarCode) ? "inset-x-[4%] inset-y-[14%]" : "inset-[4%]",
                )}
              />
              {coachStandingSrc(definition.coach?.avatarCode) ? (
                <img
                  src={coachStandingSrc(definition.coach?.avatarCode)!}
                  alt=""
                  className="scenario-avatar relative h-full w-full object-contain object-bottom drop-shadow-[0_22px_32px_rgba(0,0,0,0.48)]"
                />
              ) : (
                <>
                  <div className="absolute inset-[13%] rounded-full border border-[rgba(255,217,197,0.66)] bg-[rgba(40,27,31,0.18)] shadow-[0_18px_56px_rgba(44,24,26,0.36)] backdrop-blur-[2px]" />
                  <div className="relative flex h-[78%] w-[78%] items-center justify-center overflow-hidden rounded-full border-2 border-[rgba(255,227,211,0.8)] bg-[rgba(255,237,226,0.2)] shadow-[0_18px_34px_rgba(0,0,0,0.36)]">
                    <img
                      src={coachAvatarSrc(definition.coach?.avatarCode)}
                      alt=""
                      className="h-full w-full scale-125 object-cover object-top"
                    />
                  </div>
                </>
              )}
              <div className="absolute -bottom-1 hidden rounded-full border border-[rgba(255,218,199,0.62)] bg-[rgba(43,29,34,0.8)] px-3 py-1 text-[10px] font-semibold tracking-[0.16em] text-[var(--theater-accent)] shadow-lg backdrop-blur-md sm:block">
                {t("scenario.coach.narrator", {
                  name:
                    definition.coach?.name ?? t("scenario.coach.defaultName"),
                })}
              </div>
            </div>

            {/* Story character standing sprites */}
            <div
              className={cn(
                "absolute inset-0 origin-bottom transition-all duration-700 ease-out motion-reduce:transition-none",
                playback.isNarration
                  ? "translate-y-1 scale-[0.985] opacity-20 blur-[1.5px] grayscale-[0.35]"
                  : "translate-y-0 scale-100 opacity-100",
              )}
            >
              {stagedCharacters.map((character) => {
                const isSpeaking = character.id === stagedSpeaker?.id;
                const supportingCharacters = stagedCharacters.filter(
                  (item) => item.id !== stagedSpeaker?.id,
                );
                const supportingIndex = supportingCharacters.findIndex(
                  (item) => item.id === character.id,
                );
                const isOnlySupportingCharacter =
                  supportingCharacters.length === 1;
                const supportingPosition =
                  isOnlySupportingCharacter && stagedSpeaker
                    ? stagedCharacters.indexOf(character) <
                      stagedCharacters.indexOf(stagedSpeaker)
                      ? "18%"
                      : "82%"
                    : `${((supportingIndex + 0.5) / supportingCharacters.length) * 100}%`;
                return (
                  <div
                    key={character.id}
                    className={cn(
                      "absolute bottom-0 flex items-end justify-center transition-all duration-500 ease-out motion-reduce:transition-none",
                      isSpeaking
                        ? "left-1/2 z-[2] h-[68vh] w-[min(68vw,34rem)] -translate-x-1/2 opacity-100"
                        : "z-[1] h-[47vh] w-[min(34vw,19rem)] -translate-x-1/2 opacity-42 saturate-[0.78]",
                    )}
                    style={
                      isSpeaking ? undefined : { left: supportingPosition }
                    }
                  >
                    <img
                      src={scenarioStandingSrc(
                        character.avatar,
                        character.appearance?.assetCode,
                      )}
                      alt=""
                      className={cn(
                        "scenario-avatar h-full w-full object-contain object-bottom",
                        isSpeaking
                          ? "brightness-110 contrast-110 saturate-110 drop-shadow-[0_22px_32px_rgba(0,0,0,0.52)]"
                          : "brightness-75 contrast-105 blur-[0.35px] drop-shadow-[0_14px_22px_rgba(0,0,0,0.42)]",
                      )}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Dialogue / Choice panel */}
          <div className="relative z-[3] w-full max-w-6xl 2xl:max-w-[1280px]">
            {playback.currentBeat ? (
              <>
                <button
                  key={`${scene?.id}:surface:${playback.transition ? playback.transitionIndex : playback.beatIndex}`}
                  type="button"
                  onClick={playback.advance}
                  className={cn(
                    "scenario-dialogue-surface relative block min-h-[10.5rem] w-full overflow-hidden rounded-[var(--theater-radius-dialogue)] border p-4 text-left shadow-2xl backdrop-blur-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--theater-focus)] focus-visible:ring-offset-2 sm:min-h-44 sm:p-5 lg:min-h-48 lg:p-6",
                    playback.currentBeat.kind === "narration"
                      ? "scenario-narration-surface border-[var(--theater-accent)] bg-[var(--theater-narration-background)] text-[var(--theater-narration-foreground)]"
                      : "border-[var(--theater-panel-border)] bg-[var(--theater-panel-background)] text-[var(--theater-foreground)]",
                    playback.isAddressedToLearner &&
                      "scenario-direct-address border-2 border-[var(--theater-accent)]",
                  )}
                >
                  {/* Speaker name */}
                  <div className="mb-2 flex items-center gap-2">
                    <img
                      src={scenarioAvatarSrc(
                        playback.activeSpeaker?.avatar,
                        playback.activeSpeaker?.appearance?.assetCode,
                      )}
                      alt=""
                      className={cn(
                        "h-10 w-10 rounded-full border object-cover",
                        playback.currentBeat.kind === "narration"
                          ? "border-[var(--theater-accent)] ring-1 ring-[var(--theater-accent-soft)]"
                          : "border-[var(--theater-panel-border)]",
                      )}
                    />
                    <div>
                      <p
                        className={cn(
                          "text-sm font-semibold",
                          playback.currentBeat.kind === "narration"
                            ? "text-[var(--theater-narration-foreground)]"
                            : "text-[var(--theater-accent)]",
                        )}
                      >
                        {playback.activeSpeaker?.name ??
                          definition.coach?.name ??
                          t("scenario.coach.defaultName")}
                      </p>
                      <p className="text-[11px] text-[var(--theater-muted)]">
                        {playback.activeSpeaker?.role ??
                          (playback.currentBeat.kind === "narration"
                            ? t("scenario.coach.narratorRole")
                            : "")}
                      </p>
                    </div>
                    {playback.isAddressedToLearner ? (
                      <span className="ml-auto rounded-full bg-[var(--theater-accent)] px-2.5 py-0.5 text-[10px] font-bold text-white">
                        {t("scenario.dialogue.addressingYou")}
                      </span>
                    ) : null}
                  </div>

                  {/* Beat text */}
                  <ScenarioTheaterMarkdown
                    content={playback.currentText}
                    className={cn(
                      "mt-1 text-[15px] leading-7 sm:text-base",
                      playback.currentBeat.kind === "narration"
                        ? "text-[var(--theater-narration-foreground)]"
                        : "text-[var(--theater-foreground)]",
                    )}
                  />

                  {/* Advance hint */}
                  {playback.lineComplete ? (
                    <p className="mt-3 text-right text-[11px] text-[var(--theater-muted)]">
                      {t("scenario.dialogue.continueHint")}
                    </p>
                  ) : null}
                </button>
              </>
            ) : null}

            {/* Choices panel */}
            {playback.choicesReady && scene ? (
              <div className="scenario-choices mt-3">
                <p className="mb-2 text-sm font-semibold text-[var(--theater-foreground)]">
                  {t("scenario.choices.actionPrompt")}
                </p>
                <div className="grid gap-2.5 lg:grid-cols-2">
                  {scene.choices.map((choice, index) => (
                    <button
                      key={choice.id}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setSelectedChoiceId(choice.id);
                        void playback.choose(choice);
                      }}
                      className={cn(
                        "scenario-choice group relative flex min-h-14 w-full items-center gap-3 overflow-hidden rounded-[var(--theater-radius-choice)] border bg-[var(--theater-panel-background)] px-4 py-3 text-left shadow-sm backdrop-blur-md transition duration-200 hover:-translate-y-0.5 hover:border-[var(--theater-accent)] hover:bg-[var(--theater-accent-soft)] hover:shadow-md active:translate-y-0 active:scale-[0.99] disabled:pointer-events-none motion-reduce:transform-none motion-reduce:transition-none",
                        selectedChoiceId === choice.id
                          ? "border-[var(--theater-accent)] bg-[var(--theater-accent-soft)]"
                          : "border-[var(--theater-panel-border)]",
                        busy &&
                          selectedChoiceId !== choice.id &&
                          "scale-[0.98] opacity-40",
                      )}
                      style={{ animationDelay: `${index * 90}ms` }}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--theater-accent-soft)] text-sm font-semibold text-[var(--theater-accent)]">
                        {busy && selectedChoiceId === choice.id ? (
                          <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                        ) : (
                          String.fromCharCode(65 + index)
                        )}
                      </span>
                      <ScenarioTheaterMarkdown
                        content={choice.label}
                        variant="inline"
                        className="flex-1 text-sm leading-6 text-[var(--theater-foreground)]"
                      />
                      {busy && selectedChoiceId === choice.id ? (
                        <span className="text-xs font-medium text-[var(--theater-accent)]">
                          {t("scenario.legacy.advancing")}
                        </span>
                      ) : (
                        <ChevronRight className="h-5 w-5 text-[var(--theater-muted)] transition group-hover:translate-x-1 group-hover:text-[var(--theater-accent)] motion-reduce:transform-none" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
