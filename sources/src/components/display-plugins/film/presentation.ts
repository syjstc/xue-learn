import type {DisplayClock,DisplayTimelineCue} from '../../../../libs/display/src/types.js';
import type {CompiledVideoTimelineV1} from './timeline.js';
import type {RemotionLessonSceneV1} from './types.js';

/** Serializable host narration data; renderer code never imports the host video engine. */
export type FilmPresentation = Readonly<{
  beats: RemotionLessonSceneV1['beats'];
  tracks: CompiledVideoTimelineV1['tracks'];
  startTick: number;
  endTick: number;
}>;
export function filmContext(id: string, type: string, payload: Record<string, unknown>, clock: DisplayClock, cues:readonly DisplayTimelineCue[] = []) {
  const local=cues.filter(cue=>cue.targets.some(target=>target===id||target.startsWith(`${id}/`)));
  const scale=48_000/clock.ticksPerSecond;
  const saved=payload.presentation as FilmPresentation | undefined;
  const stages=Array.isArray(payload.stages)?payload.stages as {id:string}[]:[];
  const runs=Array.isArray(payload.runs)?payload.runs as {id:string}[]:[];
  // Course cues execute the same stages as film beats. Hosts supply time;
  // previously accepted native actions retain their identities and ordering.
  const input = local.length?{
    beats:local.map(cue=>{
      const targetIds=cue.targets.filter(target=>target.startsWith(`${id}/`)).map(target=>target.slice(id.length+1));
      const original=saved?.beats.find(beat=>beat.id===cue.id);
      const action=original?.action??(targetIds.some(target=>stages.some(stage=>stage.id===target))?'transform'
        :type==='evaluation-lab.v1'&&targetIds.some(target=>runs.some(run=>run.id===target))?'play':targetIds.length?'focus':'overview');
      return {id:cue.id,text:original?.text??'',action,targetIds:original?.targetIds??targetIds};
    }),
    tracks:local.map(cue=>({kind:'caption',beatId:cue.id,startTick:Math.round(cue.startTick*scale),durationTicks:Math.max(1,Math.round(cue.durationTicks*scale))})),
    startTick:Math.round(local[0].startTick*scale),endTick:Math.round(Math.max(...local.map(cue=>cue.startTick+cue.durationTicks))*scale),
  }:saved;
  const tick = Math.round(clock.tick * 48_000 / clock.ticksPerSecond);
  const scene: RemotionLessonSceneV1 = {id,title:'',component:{type,props:payload},beats:input?.beats ?? []};
  const timeline: CompiledVideoTimelineV1 = {durationTicks:input?.endTick ?? 480_000,
    scenes:[{id,startTick:input?.startTick ?? 0,endTick:input?.endTick ?? 480_000}],tracks:input?.tracks ?? []};
  return {scene,timeline,tick};
}
