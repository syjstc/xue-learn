import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ScenarioTheaterCharacter,
  type ScenarioTheaterChoice,
  type ScenarioTheaterDefinition,
  type ScenarioTheaterDialogueHistorySegment,
  type ScenarioTheaterEnding,
  type ScenarioTheaterRun,
  type ScenarioTheaterScene,
  type ScenarioTheaterStoryBeat,
  personalizeScenarioTheaterText,
  scenarioTheaterDialogueHistory,
  scenarioTheaterSceneBeats,
  scenarioTheaterTransitionBeats,
} from "./scenario-theater.ts";

// ── Shared type for the post-choice transition ──────────────────────────────

export type ScenarioPlaybackTransition = {
  key: string;
  consequence: string;
  reflection?: string;
  effects: Array<{ meterId: string; delta: number }>;
  nextIsEnding: boolean;
};

// ── Return type of the playback hook ────────────────────────────────────────

export type ScenarioPlaybackState = {
  /** The active scene resolved from `run.currentSceneId`. */
  scene: ScenarioTheaterScene | null;
  /** Full beat list for the active scene. */
  beats: ScenarioTheaterStoryBeat[];
  /** Index into `beats` (pre-transition) or `transitionBeats` (mid-transition). */
  beatIndex: number;
  /** The beat currently being shown. */
  currentBeat: ScenarioTheaterStoryBeat | null;
  /** Personalised display text for `currentBeat`. */
  currentText: string;
  /** Whether the user has completed reading `currentText`. */
  lineComplete: boolean;
  /** True when all scene beats are exhausted and choices can appear. */
  choicesReady: boolean;

  /** Non-null when a choice was just made and the transition is in progress. */
  transition: ScenarioPlaybackTransition | null;
  /** Beats synthesised from the transition consequence & reflection. */
  transitionBeats: ScenarioTheaterStoryBeat[];
  /** Index into `transitionBeats`. */
  transitionIndex: number;

  /** The character speaking or narrating the current beat. */
  activeSpeaker: ScenarioTheaterCharacter | null;
  /** Up to 3 characters staged for the current beat (speaker + up to 2 others). */
  stagedCharacters: ScenarioTheaterCharacter[];
  /** True when the current beat is narration (camera/stage direction). */
  isNarration: boolean;
  /** True when a dialogue beat directly addresses the learner. */
  isAddressedToLearner: boolean;

  /** Resolved ending when the run has completed. */
  ending: ScenarioTheaterEnding | null;

  /** Segmented dialogue history, used by the history panel on both platforms. */
  dialogueHistory: ScenarioTheaterDialogueHistorySegment[];
};

export type ScenarioPlaybackActions = {
  /** Advance to the next beat or finish the current transition. */
  advance: () => void;
  /** Select a choice and begin its consequence transition. */
  choose: (choice: ScenarioTheaterChoice) => Promise<void>;
  /** Handle keyboard input: Space/Enter → advance, A/B/C → choose. */
  handleKeyDown: (event: KeyboardEvent) => void;
  /** Reset beat/transition tracking when the scene changes externally. */
  resetScene: () => void;
};

export type ScenarioPlaybackResult = ScenarioPlaybackState & ScenarioPlaybackActions;

// ── Hook ────────────────────────────────────────────────────────────────────

export function useScenarioPlayback(params: {
  definition: ScenarioTheaterDefinition;
  run: ScenarioTheaterRun;
  learnerName?: string;
  onChoose: (sceneId: string, choiceId: string) => Promise<{
    definition: ScenarioTheaterDefinition;
    run: ScenarioTheaterRun;
  } | null>;
}): ScenarioPlaybackResult {
  const { definition, run, learnerName, onChoose } = params;

  // ── Resolved entities ────────────────────────────────────────────────────
  const scene = useMemo(
    () => definition.scenes.find((s) => s.id === run.currentSceneId) ?? null,
    [definition.scenes, run.currentSceneId],
  );
  const beats = useMemo(() => (scene ? scenarioTheaterSceneBeats(scene) : []), [scene]);
  const ending = useMemo(
    () =>
      definition.endings.find((e) => e.id === run.endingId) ?? null,
    [definition.endings, run.endingId],
  );

  // ── Playback position state ──────────────────────────────────────────────
  const [beatIndex, setBeatIndex] = useState(0);
  const [lineComplete, setLineComplete] = useState(false);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);

  // ── Transition state (post-choice) ────────────────────────────────────────
  const [transition, setTransition] = useState<ScenarioPlaybackTransition | null>(null);
  const [transitionIndex, setTransitionIndex] = useState(0);

  // Reset scene-local state when the active scene changes.
  useEffect(() => {
    setBeatIndex(0);
    setLineComplete(false);
    setSelectedChoiceId(null);
  }, [run.currentSceneId]);

  // Reset transition-step state when a new transition begins.
  useEffect(() => {
    setTransitionIndex(0);
    setLineComplete(false);
  }, [transition]);

  // ── Derived: current beat / text ──────────────────────────────────────────
  const currentBeat = useMemo<ScenarioTheaterStoryBeat | null>(() => {
    if (transition) {
      const tBeats = buildTransitionBeats(transition);
      return tBeats[transitionIndex] ?? null;
    }
    return beats[beatIndex] ?? null;
  }, [beats, beatIndex, transition, transitionIndex]);

  const currentText = useMemo(
    () => personalizeScenarioTheaterText(currentBeat?.text ?? "", learnerName),
    [currentBeat, learnerName],
  );

  const choicesReady = Boolean(!transition && scene && beatIndex >= beats.length);
  const isNarration = currentBeat?.kind === "narration";
  const isAddressedToLearner =
    currentBeat?.kind === "dialogue" && currentBeat.addressee === "learner";

  // ── Speaker resolution ────────────────────────────────────────────────────
  const [lastDialogueSpeakerId, setLastDialogueSpeakerId] = useState<string | null>(null);

  const activeSpeaker = useMemo(() => {
    if (currentBeat?.kind === "dialogue") {
      return definition.characters.find((c) => c.id === currentBeat.speakerId) ?? null;
    }
    return null;
  }, [currentBeat, definition.characters]);

  useEffect(() => {
    if (activeSpeaker) {
      setLastDialogueSpeakerId(activeSpeaker.id);
    }
  }, [activeSpeaker]);

  const stagedSpeaker = useMemo(
    () =>
      activeSpeaker ??
      definition.characters.find((c) => c.id === lastDialogueSpeakerId) ?? null,
    [activeSpeaker, definition.characters, lastDialogueSpeakerId],
  );

  const stagedCharacters = useMemo(() => {
    if (!stagedSpeaker) return [];
    return [
      stagedSpeaker,
      ...definition.characters
        .filter((c) => c.id !== stagedSpeaker.id)
        .slice(0, 2),
    ];
  }, [definition.characters, stagedSpeaker]);

  // ── Dialogue history ──────────────────────────────────────────────────────
  const transitionBeatsList = useMemo(
    () => (transition ? buildTransitionBeats(transition) : []),
    [transition],
  );

  const dialogueHistory = useMemo(
    () =>
      scenarioTheaterDialogueHistory({
        definition,
        run,
        activeSceneBeatCount: transition ? undefined : beatIndex + 1,
        pendingTransitionBeats: transition
          ? transitionBeatsList.slice(0, transitionIndex + 1)
          : undefined,
        includePendingScene: !transition,
      }),
    [beatIndex, definition, run, transition, transitionBeatsList, transitionIndex],
  );

  // ── Actions ───────────────────────────────────────────────────────────────

  const advance = useCallback(() => {
    if (!currentBeat) return;
    // If line not yet complete, complete it first.
    if (!lineComplete) {
      setLineComplete(true);
      return;
    }
    // Mid-transition: advance through transition beats.
    if (transition) {
      if (transitionIndex + 1 < transitionBeatsList.length) {
        setTransitionIndex((i) => i + 1);
        setLineComplete(false);
      } else {
        // Transition finished; hand back to scene.
        setTransition(null);
      }
      return;
    }
    // Normal scene: advance to next beat.
    if (beatIndex < beats.length) {
      setBeatIndex((i) => i + 1);
      setLineComplete(false);
    }
  }, [beatIndex, beats.length, currentBeat, lineComplete, transition, transitionBeatsList.length, transitionIndex]);

  const choose = useCallback(
    async (choice: ScenarioTheaterChoice) => {
      if (!scene) return;
      setSelectedChoiceId(choice.id);
      const next = await onChoose(scene.id, choice.id);
      if (!next) {
        setSelectedChoiceId(null);
        return;
      }
      const nextScene = next.definition.scenes.find(
        (s) => s.id === next.run.currentSceneId,
      );
      const transitionLines = scenarioTheaterTransitionBeats({
        choice,
        currentAct: scene.act,
        nextAct: nextScene?.act,
      });
      setTransition({
        key: `${next.run.id}:${next.run.runVersion}:${choice.id}`,
        consequence: transitionLines[0]!.text,
        reflection: transitionLines[1]?.text,
        effects: choice.effects,
        nextIsEnding: next.run.status === "completed",
      });
    },
    [onChoose, scene],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Ignore if focus is in an input, or modifier keys are held.
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
        // Space/Enter → advance
        event.preventDefault();
        advance();
        return;
      }

      // A/B/C/D → choose when choices are ready
      if (choicesReady && scene) {
        const index = event.key.toUpperCase().charCodeAt(0) - 65;
        const choice = scene.choices[index];
        if (choice) {
          event.preventDefault();
          void choose(choice);
        }
      }
    },
    [advance, choicesReady, choose, scene],
  );

  const resetScene = useCallback(() => {
    setBeatIndex(0);
    setLineComplete(false);
    setSelectedChoiceId(null);
    setTransition(null);
    setTransitionIndex(0);
  }, []);

  return {
    scene,
    beats,
    beatIndex,
    currentBeat,
    currentText,
    lineComplete,
    choicesReady,
    transition,
    transitionBeats: transitionBeatsList,
    transitionIndex,
    activeSpeaker,
    stagedCharacters,
    isNarration,
    isAddressedToLearner,
    ending,
    dialogueHistory,
    advance,
    choose,
    handleKeyDown,
    resetScene,
  };
}

// ── Internal helper ─────────────────────────────────────────────────────────

function buildTransitionBeats(
  transition: ScenarioPlaybackTransition,
): ScenarioTheaterStoryBeat[] {
  const result: ScenarioTheaterStoryBeat[] = [
    { kind: "narration", tone: "transition", text: transition.consequence },
  ];
  if (transition.reflection) {
    result.push({ kind: "narration", tone: "observation", text: transition.reflection });
  }
  return result;
}
