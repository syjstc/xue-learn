/** Sample-clocked musical facts shared by learning displays and export hosts. */
export const MUSIC_SAMPLE_RATE = 48_000 as const;
export type MusicPerformancePlan = Readonly<{
  figureId: string; clipId: string; label: string; durationTicks: number;
  notes: readonly Readonly<{
    targetId: string; midi: number; instrument: string; velocity: number;
    startTick: number; durationTicks: number;
  }>[];
}>;
/** A host-supplied playback position; no film, cast or export state is required. */
export type MusicPlaybackState = Readonly<{
  figureId: string; clipId: string; label: string;
  targetIds: readonly string[]; midi: readonly number[]; elapsedTicks?: number;
}>;
