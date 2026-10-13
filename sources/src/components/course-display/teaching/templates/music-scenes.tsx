import React, { useContext, useMemo } from "react";
import type {MusicPlaybackState, MusicPerformancePlan as TimelineMusicInput} from "../../../../../libs/domain/src/index.js";
import {
  compileMusicTeachingClip,
  type MaterialMusicTeaching,
} from "../../../../../libs/domain/src/index.js";
import {
  MusicTeachingDisplay,
  MusicTimelineContext,
} from "../../music-teaching-display.js";
import { T, type SceneProps } from "./primitives.js";
export type MusicSceneContent = {
  id: string;
  title: string;
  groups: string[][];
  labels: string[];
  beats: 1 | 2;
  range: [string, string];
};
export const MUSIC_SCORE_PRESETS: MusicSceneContent[] = [
  {
    id: "ascending",
    title: "上行乐句 · C 大调",
    groups: ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"].map((p) => [p]),
    labels: [],
    beats: 1,
    range: ["C4", "C5"],
  },
  {
    id: "descending",
    title: "下行乐句 · C 大调",
    groups: ["C5", "B4", "A4", "G4", "F4", "E4", "D4", "C4"].map((p) => [p]),
    labels: [],
    beats: 1,
    range: ["C4", "C5"],
  },
];
export const MUSIC_HARMONY_PRESETS: MusicSceneContent[] = [
  {
    id: "major",
    title: "C 大调 · I — IV — V — I",
    groups: [
      ["C4", "E4", "G4"],
      ["C4", "F4", "A4"],
      ["B3", "D4", "G4"],
      ["C4", "E4", "G4"],
    ],
    labels: ["I", "IV", "V", "I"],
    beats: 2,
    range: ["B3", "C5"],
  },
  {
    id: "minor",
    title: "A 小调 · i — iv — V — i",
    groups: [
      ["A3", "C4", "E4"],
      ["A3", "D4", "F4"],
      ["B3", "E4", "G#4"],
      ["A3", "C4", "E4"],
    ],
    labels: ["i", "iv", "V", "i"],
    beats: 2,
    range: ["A3", "A4"],
  },
];
export function musicBlock(content: MusicSceneContent): MaterialMusicTeaching {
  const notes = content.groups.map((pitches, i) => ({
    id: `note-${i}`,
    pitches,
    beats: content.beats,
  }));
  return {
    type: "music",
    version: 2,
    id: `template-${content.id}`,
    title: content.title,
    layout: "column",
    notes,
    views: [
      {
        id: "staff",
        kind: "staff",
        label: "观察谱面位置与对应琴键",
        notes: notes.map((n) => n.id),
        clef: "treble",
      },
      {
        id: "keyboard",
        kind: "keyboard",
        label: "当前发声音高",
        notes: notes.map((n) => n.id),
        range: content.range,
      },
    ],
    marks: content.labels.map((label, i) => ({
      id: `label-${i}`,
      kind: "label",
      label,
      anchors: [{ viewId: "staff", noteId: notes[i].id }],
    })),
    clips: [
      {
        id: "phrase",
        label: content.title,
        tempo: 60,
        instrument: "piano",
        events: notes.map((n) => ({ notes: [n.id], beats: content.beats })),
      },
    ],
  };
}
const blocks = [
  MUSIC_SCORE_PRESETS.map(musicBlock),
  MUSIC_HARMONY_PRESETS.map(musicBlock),
];
export const getMusicBlock = (id: string, variant = 0) =>
  blocks[id === "music-harmony" ? 1 : 0][Math.abs(variant) % 2];
export function MusicScene({
  content,
  frame,
  fps,
  timelineMusic,
  timelineDriven = false,
  performance,
  activeTargetIds,
  narration,
  interactive = false,
}: SceneProps & { content: MaterialMusicTeaching; interactive?: boolean; timelineMusic?: MusicPlaybackState; timelineDriven?: boolean; performance?: TimelineMusicInput | null; activeTargetIds?: readonly string[]; narration?: {progress: number; previousTargetIds: readonly string[]} }) {
  const inheritedTimeline = useContext(MusicTimelineContext);
  const plan = useMemo(
    () => performance === undefined ? compileMusicTeachingClip(content, "phrase") : performance,
    [content, performance],
  );
  const tick = Math.floor((frame / fps - 2) * 48000);
  const sounding = plan?.notes.filter(
    (n) => tick >= n.startTick && tick < n.startTick + n.durationTicks,
  ) ?? [];
  const music = timelineDriven ? timelineMusic : plan && tick >= 0 && tick < plan.durationTicks ? {
    figureId: content.id,
    clipId: plan.clipId,
    label: plan.label,
    targetIds: sounding.map((n) => n.targetId),
    midi: sounding.map((n) => n.midi),
    elapsedTicks: tick,
  } : undefined;
  return (
    <div
      className="rt-music-scene"
      data-music-tick={timelineDriven ? music?.elapsedTicks ?? -1 : tick}
      style={
        {
          "--music-foreground": T.ink,
          "--music-muted": T.muted,
          "--music-border": T.border,
          "--music-focus": T.accentText,
          "--music-active": T.accent,
          "--music-surface": T.inset,
        } as React.CSSProperties
      }
    >
      <MusicTimelineContext.Provider
        value={{
          ...inheritedTimeline,
          narration: narration ?? inheritedTimeline.narration,
          clocked: !interactive,
          music,
        }}
      >
        <MusicTeachingDisplay block={content} activeTargetIds={activeTargetIds} interactive={interactive} reportRemotionStatus={timelineDriven && !interactive} />
      </MusicTimelineContext.Provider>
    </div>
  );
}
/** Uses the existing sampler/mixer; the Remotion audio track owns playback/seek. */
export async function prepareTemplateAudio(
  block: MaterialMusicTeaching,
  clipId = "phrase",
  repeat = 1,
): Promise<Blob> {
  const [{ renderMusicBuffer }, { musicPcmWav }] = await Promise.all([
    import("../../../../shared/music/clip-player.js"),
    import("../../../../../libs/domain/src/index.js"),
  ]);
  const context = new OfflineAudioContext(1, 1, 48000);
  const buffer = await renderMusicBuffer(
    context,
    compileMusicTeachingClip(block, clipId, repeat),
  );
  const wav = musicPcmWav(buffer.getChannelData(0));
  return new Blob([new Uint8Array(wav)], { type: "audio/wav" });
}
