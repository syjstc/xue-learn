import React from 'react';
import type {DisplayRendererProps} from '../../display-runtime/index.js';
import {FilmStage} from '../film/stage.js';
import {filmContext} from '../film/presentation.js';
import {sampleLessonMotion,type LessonMotion} from '../film/lesson-motion.js';
import type {RemotionLessonComponent,RemotionLessonSceneV1} from '../film/types.js';
import type {CompiledVideoTimelineV1} from '../film/timeline.js';

type Context<T extends RemotionLessonComponent['type']>={component:Extract<RemotionLessonComponent,{type:T}>;motion:LessonMotion;scene:RemotionLessonSceneV1;timeline:CompiledVideoTimelineV1;tick:number};
/** Shared clock adapter; each domain imports only the boards it implements. */
export function createAnimatedDisplay<T extends RemotionLessonComponent['type']>(type:T,render:(context:Context<T>)=>React.ReactNode,options:{fluid?:boolean}={}){
 return function AnimatedDisplay({node,clock,timeline:displayTimeline,resources}:DisplayRendererProps){
  const authored=node.payload as Record<string,unknown>;
  const resource=typeof authored.resourceId==='string'?resources[authored.resourceId]:undefined;
  const uri=resource?.status==='ready'&&(resource.value as {uri?:unknown})?.uri;
  const payload=typeof uri==='string'?{...authored,src:uri}:authored;
  const {tick,scene,timeline}=filmContext(node.id,type,payload,clock,displayTimeline);
  const sampled=sampleLessonMotion(scene,timeline,tick);
  const targets=(payload.activeTargetIds as readonly string[]|undefined)?.map(id=>id.replace(/^code:/,''));
  const motion=targets?{...sampled,targets,progress:typeof payload.progress==='number'?payload.progress:sampled.progress,opacity:(id:string)=>!targets.length||targets.includes(id)?1:.43}:sampled;
  const component={type,props:payload} as Extract<RemotionLessonComponent,{type:T}>;
  return <FilmStage kind={node.kind} fluid={options.fluid}>{render({component,motion,scene,timeline,tick})}</FilmStage>;
 };
}
