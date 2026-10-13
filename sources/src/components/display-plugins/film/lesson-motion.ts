import type {CompiledVideoTimelineV1} from './timeline.js';
import type {RemotionLessonSceneV1} from "./types.js";

export const ease = (value: number) => {const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t);};

/** All animation state is rebuilt from the timeline, including on reverse seek. */
export function sampleLessonMotion(scene: RemotionLessonSceneV1, timeline: CompiledVideoTimelineV1, tick: number) {
  const start = timeline.scenes.find(item => item.id === scene.id)?.startTick ?? 0;
  const cues = scene.beats.map(beat => {const track = timeline.tracks.find(track => track.kind === 'caption' && track.beatId === beat.id); return {...beat, start: track?.startTick ?? Infinity, duration: track?.durationTicks ?? 48_000};});
  const history = cues.filter(cue => cue.start <= tick);
  const active = history[history.length - 1];
  const previous = history[history.length - 2];
  const seconds = Math.max(0, tick - start) / 48_000;
  const progress = active ? ease((tick - active.start) / 43_200) : 0;
  const targets = active?.targetIds ?? [];
  const revealOnly = cues[0]?.action === 'reveal' && !history.some(cue => cue.action === 'overview');
  const seen = new Set(history.flatMap(cue => cue.targetIds));
  const opacity = (id: string) => revealOnly && !seen.has(id) ? 0 : targets.length && !targets.includes(id) ? .43 : 1;
  let separation = 0;
  for (const cue of history) {
    if (cue.action === 'separate' || cue.action === 'assemble') {
      const target = cue.action === 'separate' ? 1 : 0;
      separation += (target - separation) * ease((tick - cue.start) / 52_800);
    }
  }
  return {seconds, activeSeconds: active ? Math.max(0, tick - active.start) / 48_000 : 0, progress, active, previous, targets, opacity, separation, entrance: ease(seconds / .85)};
}
export type LessonMotion = ReturnType<typeof sampleLessonMotion>;
