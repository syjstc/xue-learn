import type {CompiledVideoTimelineV1} from './timeline.js';
import type {RemotionLessonSceneV1, RemotionEvaluationLabComponent} from "./types.js";
import {ease} from './lesson-motion.js';

export function sampleEvaluationLab(props: RemotionEvaluationLabComponent['props'], scene: RemotionLessonSceneV1, timeline: CompiledVideoTimelineV1, tick: number) {
  const cues = scene.beats.map(beat => ({...beat, track:timeline.tracks.find(item => item.kind==='caption' && item.beatId===beat.id)}));
  const active = cues.filter(cue => cue.track && cue.track.startTick <= tick).at(-1);
  const runs = props.runs.map(run => {
    const cue = cues.find(cue => cue.action==='play' && cue.targetIds.includes(run.id));
    const start = cue?.track?.startTick ?? Infinity;
    const duration = Math.max(800, Math.min(288_000, (cue?.track?.durationTicks ?? 0) * .7));
    const progress = Math.max(0, Math.min(1, (tick-start)/duration));
    const completed = Math.min(props.cases.length, Math.floor(progress * props.cases.length));
    const outcomes = run.outcomes.slice(0, completed);
    const passed = outcomes.filter(item => item.verdict==='pass').length;
    const critical = outcomes.filter(item => item.verdict==='critical').length;
    return {...run, progress, completed, passed, critical, percent:Math.round(passed/props.cases.length*100),
      packet: ease(progress * props.cases.length - completed), running:tick>=start && progress<1};
  });
  const focused = active?.targetIds.filter(target => props.cases.some(item => item.id===target)) ?? [];
  const focusSpan = Math.max(800, (active?.track?.durationTicks ?? 0) / Math.max(1, focused.length));
  const focusAge = Math.max(0, tick - (active?.track?.startTick ?? tick));
  const focusIndex = Math.min(focused.length - 1, Math.floor(focusAge / focusSpan));
  const running = runs.find(run => run.running);
  // Multiple requested cases get equal, deterministic holds in the same beat;
  // never silently discard all but the first piece of authored evidence.
  const caseIndex = focused.length ? props.cases.findIndex(item=>item.id===focused[focusIndex]) : running ? Math.min(props.cases.length-1,running.completed) : -1;
  const focusProgress = ease(Math.min(1, Math.max(0, focusAge-focusIndex*focusSpan)/72_000));
  return {runs,caseIndex,active,focusProgress,inspecting:focused.length>0,seconds:tick/48_000};
}
