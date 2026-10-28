import type {CompiledVideoTimelineV1} from './timeline.js';
import type {RemotionLessonSceneV1, RemotionOcclusionLabComponent} from "./types.js";
import {ease} from './lesson-motion.js';

type State = {cutaway: number; moved: number};
const mix = (a: State, b: State, t: number): State => ({cutaway: a.cutaway + (b.cutaway - a.cutaway) * t, moved: a.moved + (b.moved - a.moved) * t});

/** Replay transition boundaries, not incremental React state. This also handles
 * unusually short speech clips and reverse seeks through interrupted motion. */
export function sampleOcclusionLab(props: RemotionOcclusionLabComponent['props'], scene: RemotionLessonSceneV1, timeline: CompiledVideoTimelineV1, tick: number) {
  let from: State = {cutaway: 0, moved: 0}, to = from;
  let start = 0, duration = 1, stageIndex = -1;
  const sample = (at: number) => mix(from, to, ease((at - start) / duration));
  for (const beat of scene.beats) {
    const track = timeline.tracks.find(item => item.kind === 'caption' && item.beatId === beat.id);
    if (!track || track.startTick > tick) continue;
    const index = props.stages.findIndex(stage => stage.id === beat.targetIds[0]);
    const stage = props.stages[index];
    if (!stage || index === stageIndex) continue;
    from = sample(track.startTick);
    to = {cutaway: stage.view === 'cutaway' ? 1 : 0, moved: stage.moved ? 1 : 0};
    start = track.startTick;
    // Finish the visual operation early enough for the viewer to inspect it.
    duration = Math.max(800, Math.min(76_800, Math.floor(track.durationTicks * .36)));
    stageIndex = index;
  }
  const state = sample(tick);
  const progress = ease((tick - start) / duration);
  const hidden = (cell: number) => cell >= props.wall.from - .5 && cell <= props.wall.to + .5;
  return {...state, stageIndex, progress, moving: Math.abs(to.moved - from.moved) > 0 && progress < 1,
    seconds: Math.max(0, tick - (timeline.scenes.find(item => item.id === scene.id)?.startTick ?? 0)) / 48_000,
    cases: props.cases.map(item => {
      const cell = item.initialCell + props.moveBy * state.moved;
      return {...item, cell, visible: !hidden(cell), finalVisible: !hidden(item.initialCell + props.moveBy)};
    }),
  };
}
