import React, {lazy,useMemo} from 'react';
import {isVisualTeaching} from "../../../../libs/domain/src/index.js";
import {VisualPrimitives} from "./visual-primitives.js";
import type {MusicPlaybackState} from "../../../../libs/domain/src/index.js";
import {teachingTemplateMusicBlock, teachingTemplateMusicPerformance, type TeachingContentProps} from "../../../../libs/domain/src/index.js";
import type {MaterialTeachingItemMotion, MaterialTeachingSample} from "../../../../libs/domain/src/index.js";
import {QuestionScene, LayersScene, FlowScene, CompareScene, SummaryScene} from "./templates/general-scenes.js";
import {GeometryAreaScene, FunctionChangeScene, AccumulationScene, ConditionalSetScene, ForceMotionScene, WaveSuperpositionScene, CircuitQuantityScene} from "./templates/math-physics.js";
import {DisciplineScene} from "./templates/discipline-scenes.js";
const MusicScene=lazy(async()=>({default:(await import('./templates/music-scenes.js')).MusicScene}));
import {teachingTemplateReaction} from "./teaching-template-reaction.js";
import {TeachingSortingArt} from "./teaching-sorting.js";
import 'katex/dist/katex.min.css';
import './templates/templates.css';
import {TeachingFocusProvider} from "./teaching-focus.js";

/** Production consumes the selected component's actual typed data. Gallery
 * presets, frame shells and example IDs never participate in this dispatch. */
type TeachingArtProps = {
  props: TeachingContentProps & {id?: string}; frame: number; fps: number; music?: MusicPlaybackState; layerMotion?: {focusId?: string; layers: readonly MaterialTeachingItemMotion[]}; sample?: MaterialTeachingSample;
  motionSeconds?: number;
  summaryMotion?: readonly MaterialTeachingItemMotion[];
};
export function TeachingArt(props: TeachingArtProps) {
  return <TeachingFocusProvider sample={props.sample}><TeachingArtwork {...props}/></TeachingFocusProvider>;
}
function TeachingArtwork({props, frame, fps, music, layerMotion, sample, motionSeconds, summaryMotion}: TeachingArtProps) {
  const timing = {frame, fps};
  const block = useMemo(() => teachingTemplateMusicBlock(props), [props]);
  const performance = useMemo(() => teachingTemplateMusicPerformance(props), [props]);
  const reaction = useMemo(() => props.templateId === 'chemistry-reaction' ? teachingTemplateReaction(props.content) : undefined, [props]);
  if (isVisualTeaching(props)) return <VisualPrimitives props={props} {...timing} sample={sample} motionSeconds={motionSeconds}/>;
  switch (props.templateId) {
    case 'general-question': return <QuestionScene {...timing} content={props.content} motionSeconds={motionSeconds}/>;
    case 'general-layers': return <LayersScene {...timing} content={props.content} layerMotion={layerMotion} structureProgress={sample?.items[0]?.reveal}/>;
    case 'general-flow': return <FlowScene {...timing} content={props.content} itemMotion={sample?.items} motionSeconds={motionSeconds}/>;
    case 'general-compare': return <CompareScene {...timing} content={props.content} itemMotion={sample?.items}/>;
    case 'general-summary': return <SummaryScene {...timing} content={props.content} itemMotion={summaryMotion ?? sample?.items} motionSeconds={motionSeconds}/>;
    case 'math-pythagoras': return <GeometryAreaScene {...timing} data={props.content}/>;
    case 'math-tangent': return <FunctionChangeScene {...timing} data={props.content}/>;
    case 'math-integral': return <AccumulationScene {...timing} data={props.content}/>;
    case 'math-probability': return <ConditionalSetScene {...timing} data={props.content}/>;
    case 'physics-forces': return <ForceMotionScene {...timing} data={props.content}/>;
    case 'physics-waves': return <WaveSuperpositionScene {...timing} data={props.content}/>;
    case 'physics-circuit': return <CircuitQuantityScene {...timing} data={props.content}/>;
    case 'chemistry-reaction': return <DisciplineScene {...timing} id={props.templateId} config={reaction!}/>;
    case 'chemistry-titration': case 'biology-mitosis': case 'biology-enzyme': case 'geography-water':
    case 'history-timeline': case 'language-syntax': case 'language-perspective': case 'cs-sorting':
    case 'cs-recursion': case 'economics-equilibrium': return props.templateId === 'cs-sorting' && sample ? <TeachingSortingArt values={props.content.values} sample={sample}/> : <DisciplineScene {...timing} id={props.templateId} config={props.content} teachingSample={sample}/>;
    case 'music-score': case 'music-harmony':
      if (!block) throw new Error('The authored music template has no playable score');
      return <MusicScene {...timing} content={block} performance={performance ?? null} timelineMusic={music && (music.figureId === block.id || music.figureId === props.id) ? {...music, figureId: block.id} : undefined} timelineDriven activeTargetIds={sample?.items.some(item => item.focus > 0) ? sample.sourceItemIds : []}
        narration={sample ? {progress: sample.progress, previousTargetIds: sample.progress >= 1 ? sample.sourceItemIds : []} : undefined}/>;
  }
}
