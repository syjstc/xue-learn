import type {CompiledVideoTimelineV1} from './timeline.js';
import type {RemotionFormulaComponent, RemotionLessonSceneV1} from "./types.js";

/** A note-only or repeated equation cue holds the same formula; reverse seeks rebuild it. */
export function sampleFormulaBoard(props: RemotionFormulaComponent['props'], scene: RemotionLessonSceneV1, timeline: CompiledVideoTimelineV1, tick: number) {
  let step = 0, previousStep = 0, start = -Infinity, duration = 1;
  for (const beat of scene.beats) {
    const caption = timeline.tracks.find(track => track.kind === 'caption' && track.beatId === beat.id);
    if (!caption || caption.startTick > tick) continue;
    const target = [...beat.targetIds].reverse().find(id => props.equations.some(equation => equation.id === id));
    const index = props.equations.findIndex(equation => equation.id === target);
    if (index < 0 || index === step) continue;
    previousStep = step; step = index; start = caption.startTick;
    duration = Math.max(1, Math.min(31_200, Math.ceil(caption.durationTicks * .3)));
  }
  const t = Math.max(0, Math.min(1, (tick - start) / duration));
  const progress = t * t * (3 - 2 * t);
  return {step, previousStep, progress};
}
