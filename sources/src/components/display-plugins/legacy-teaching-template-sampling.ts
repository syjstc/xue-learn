import type {CompiledVideoTimelineV1} from './film/timeline.js';
import type {RemotionLessonSceneV1} from './film/types.js';
import type {TeachingContentProps} from '../../../libs/domain/src/material-teaching-content.js';
type RemotionTeachingTemplateProps=TeachingContentProps & {stages:readonly {id:string;phase:string}[]};

import {isVisualTeaching, sampleMaterialTeachingTimeline, visualTeachingOperations} from '../../../libs/domain/src/index.js';

export type TeachingTemplateLayerMotion = {focusId?: string; layers: {id: string; reveal: number; focus: number}[]};

/** Per-sentence evidence uses the same accepted caption clock as narration.
 * Entering another layer changes focus without restarting the structural phase. */
function sampleLayers(props: RemotionTeachingTemplateProps, scene: RemotionLessonSceneV1, timeline: CompiledVideoTimelineV1, tick: number): TeachingTemplateLayerMotion | undefined {
  const ids = teachingTemplateContentIds(props);
  if (!ids.length || !scene.beats.some(beat => ids.includes(beat.targetIds[1]))) return undefined;
  const first = new Map<string, {start: number; duration: number}>();
  let focusId: string | undefined;
  let previousId: string | undefined;
  let focusStart = 0, focusDuration = 1;
  for (const beat of scene.beats) {
    const track = timeline.tracks.find(item => item.kind === 'caption' && item.beatId === beat.id);
    if (!track || track.startTick > tick) continue;
    const id = ids.includes(beat.targetIds[1]) ? beat.targetIds[1] : undefined;
    if (id && !first.has(id)) first.set(id, {start: track.startTick, duration: Math.max(1, Math.min(26_400, Math.ceil(track.durationTicks * .72)))});
    if (id !== focusId) {
      previousId = focusId;
      focusId = id;
      focusStart = track.startTick;
      focusDuration = Math.max(1, Math.min(33_600, Math.ceil(track.durationTicks * .32)));
    }
  }
  const fraction = (start: number, duration: number) => Math.max(0, Math.min(1, (tick - start) / duration));
  const focus = fraction(focusStart, focusDuration);
  return {focusId, layers: ids.map(id => ({id, reveal: first.has(id) ? fraction(first.get(id)!.start, first.get(id)!.duration) : 0, focus: id === focusId ? focus : id === previousId ? 1 - focus : 0}))};
}

/** Rebuild from canonical caption intervals on every seek. A repeated stage
 * keeps its first operation and never starts the animation again. */
export function sampleLegacyTeachingTemplate(props: RemotionTeachingTemplateProps, scene: RemotionLessonSceneV1, timeline: CompiledVideoTimelineV1, tick: number) {
  let stageIndex = -1;
  let startTick = 0;
  let durationTicks = 1;
  const entered = new Set<string>();
  for (const beat of scene.beats) {
    const track = timeline.tracks.find(item => item.kind === 'caption' && item.beatId === beat.id);
    if (!track || track.startTick > tick) continue;
    const index = props.stages.findIndex(stage => beat.targetIds.includes(stage.id));
    if (index < 0 || entered.has(props.stages[index].id)) continue;
    entered.add(props.stages[index].id);
    stageIndex = index;
    startTick = track.startTick;
    // Reserve the end of the spoken interval for inspecting the completed state.
    durationTicks = Math.max(1, Math.ceil(track.durationTicks * .72));
  }
  const progress = stageIndex < 0 ? 0 : Math.max(0, Math.min(1, (tick - startTick) / durationTicks));
  const grammarSeconds = stageIndex < 0 ? 0 : sampleTeachingTemplateStage(props, stageIndex, progress).presentationSeconds;
  const contentMotion = sampleLayers(props, scene, timeline, tick);
  const summaryMotion = props.templateId === 'general-summary'
    ? contentMotion?.layers ?? sampleLegacySummaryFocus(props.content, scene, timeline, tick, stageIndex)
    : undefined;
  const visualSample = props.templateId === 'general-question' && contentMotion ? {
    stepIndex: stageIndex, stepId: props.stages[stageIndex]?.id, progress, grammarSeconds, frame: grammarSeconds * 60, fps: 60 as const,
    sourceItemIds: [], items: [], focusTargets: contentMotion.layers.filter(layer => layer.id === contentMotion.focusId || layer.focus > 0)
      .map(layer => ({id: layer.id, focus: layer.focus, progress: layer.focus})),
  } : isVisualTeaching(props) && scene.beats.some(beat => beat.targetIds.length === 2)
    ? sampleMaterialTeachingTimeline({...props, type:'teaching', version:1, id:scene.id, title:scene.title}, scene.beats.flatMap(beat => {
      const track = timeline.tracks.find(item => item.kind === 'caption' && item.beatId === beat.id);
      return track ? [{targetIds:beat.targetIds.slice(1), startTick:track.startTick, durationTicks:track.durationTicks}] : [];
    }), tick) : undefined;
  return {stageIndex, stageId: props.stages[stageIndex]?.id, phase: props.stages[stageIndex]?.phase, progress, grammarSeconds, frame: grammarSeconds * 60, fps: 60, startTick, durationTicks, layerMotion: contentMotion, summaryMotion, visualSample};
}


const STANDARD_PHASE_SPANS:readonly (readonly [number,number])[]=[[0, 4], [4, 8], [8, 12]];
function teachingTemplateContentIds(props:RemotionTeachingTemplateProps):string[]{
 if(isVisualTeaching(props))return visualTeachingOperations(props).map(operation=>operation.id);
 if(props.templateId==='general-question')return ['object-1','object-2','observation-1','observation-2','question','learning-goal'];
 if(props.templateId==='general-summary')return [...props.content.concepts.map((_,i)=>`concept-${i+1}`),'transfer'];
 return props.templateId==='general-layers'?props.content.layers.map((_,i)=>`layer-${i+1}`):[];
}
function sampleLegacySummaryFocus(content:{concepts:readonly string[];transfer:string},scene:RemotionLessonSceneV1,timeline:CompiledVideoTimelineV1,tick:number,stageIndex:number){
 const active=scene.beats.find(beat=>timeline.tracks.some(track=>track.kind==='caption'&&track.beatId===beat.id&&tick>=track.startTick&&tick<track.startTick+track.durationTicks));
 const tokens=(text:string)=>new Set((text.match(/[\p{Script=Han}]+|[A-Za-z]+\d*/gu)??[]).flatMap(run=>/^[A-Za-z]/.test(run)?[run]:Array.from({length:Math.max(0,run.length-1)},(_,i)=>run.slice(i,i+2))));
 const entries=[...content.concepts.map((text,i)=>({id:`concept-${i+1}`,text})),...(stageIndex===2?[{id:'transfer',text:content.transfer}]:[])];
 const terms=entries.map(entry=>tokens(entry.text)),spoken=tokens(active?.text??'');
 const scores=entries.map((entry,i)=>({id:entry.id,score:[...terms[i]].reduce((score,term)=>score+(spoken.has(term)&&!terms.some((other,j)=>i!==j&&other.has(term))?Math.max(2,Math.min(4,term.length)):0),0)})).sort((a,b)=>b.score-a.score);
 const focused=scores[0]?.score>=4&&scores[0].score>(scores[1]?.score??0)?scores[0].id:undefined;
 return [...content.concepts.map((_,i)=>`concept-${i+1}`),'transfer'].map(id=>({id,reveal:id==='transfer'?Number(stageIndex===2):1,focus:Number(id===focused)}));
}

export function teachingTemplatePhaseSpans(props: RemotionTeachingTemplateProps): readonly (readonly [number,number])[] {
  switch (props.templateId) {
    case "general-layers": return [[0, 1], [1, 6], [8, 12]];
    case "general-flow": return [[0, 1.4], [1.4, 7], [8, 12]];
    case "general-compare": return [[0, .6], [.6, 6], [8, 12]];
    case "math-pythagoras": return [[0, 4], [4, 7.3], [8, 12]];
    case "math-tangent": return [[0, 3], [3, 8], [8, 12]];
    case "math-integral": return [[0, 1.5], [1.5, 9], [9, 12]];
    case "math-probability": return [[0, 3], [3, 6.5], [8, 12]];
    case "physics-forces": return [[0, 2.5], [2.5, 8], [8, 12]];
    case "physics-waves": return [[0, 3.5], [3.5, 8], [8, 12]];
    case "physics-circuit": return [[0, 1], [1, 4], [8, 12]];
    case "chemistry-reaction": return [[0, 3.4], [3.4, 7], [7, 12]];
    case "biology-enzyme": return [[0, .8], [.8, 7.5], [7.5, 12]];
    case "geography-water": return [[0, 0], [0, 9.6], [9.6, 12]];
    case "language-syntax": return [[0, 2], [2, 8], [8, 12]];
    case "language-perspective": return [[0, 1], [1, 8], [8, 12]];
    case "cs-sorting": return [[0, 1], [1, 10], [10, 12]];
    case "cs-recursion": {const base = 6 - 6 / props.content.start; return [[0, base], [base, 6], [6, 12]];}
    case "economics-equilibrium": return [[0, 3], [3, 8], [8, 12]];
    default: return STANDARD_PHASE_SPANS;
  }
}
export function sampleTeachingTemplateStage(props: RemotionTeachingTemplateProps, stageIndex: number, progress: number): {stageIndex: number; progress: number; presentationSeconds: number} {
  const index = Math.max(0, Math.min(2, Math.floor(Number.isFinite(stageIndex) ? stageIndex : 0)));
  const fraction = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const [from, to] = teachingTemplatePhaseSpans(props)[index];
  return {stageIndex: index, progress: fraction, presentationSeconds: from + Math.max(0, to - from - .0001) * fraction};
}
