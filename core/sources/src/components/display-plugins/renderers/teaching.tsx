import React from 'react';
import type {DisplayRendererProps,DisplayRenderer} from '../../display-runtime/index.js';
import type {DisplayPluginModule} from '../../../../libs/display/src/types.js';
import {FilmStage} from '../film/stage.js';
import {sampleMaterialTeaching,sampleMaterialTeachingTimeline,type MaterialTeaching,type MaterialTeachingSample,type MaterialTeachingCueInterval,type MusicPlaybackState} from '../../../../libs/domain/src/index.js';
import {TeachingArt} from '../../course-display/teaching/teaching-art.js';
import {displayFocus} from './focus.js';
import {filmContext} from '../film/presentation.js';
import {sampleLegacyTeachingTemplate} from '../legacy-teaching-template-sampling.js';
export function TeachingDisplay(props:DisplayRendererProps) {
 const {node,clock}=props,focus=displayFocus(props);
 const payload=node.payload as {block:MaterialTeaching;artFrame?:number;artFps?:number;sample?:MaterialTeachingSample;music?:MusicPlaybackState;activeTargetIds?:readonly string[];previousActiveTargetIds?:readonly string[];revealedTargetIds?:readonly string[];progress?:number;teachingTimeline?:{intervals:readonly MaterialTeachingCueInterval[];tick:number};layerMotion?:React.ComponentProps<typeof TeachingArt>['layerMotion'];summaryMotion?:React.ComponentProps<typeof TeachingArt>['summaryMotion'];motionSeconds?:number};
 const block=payload.block;
 const legacy=Array.isArray((block as unknown as {stages?:unknown}).stages)&&!payload.sample&&payload.artFrame===undefined
  ? (()=>{const context=filmContext(node.id,'teaching-template.v1',{...block,presentation:(payload as unknown as {presentation?:unknown}).presentation},clock,props.timeline);
    return sampleLegacyTeachingTemplate(block as unknown as Parameters<typeof sampleLegacyTeachingTemplate>[0],context.scene,context.timeline,context.tick);})():undefined;
 const targets=payload.activeTargetIds??focus.activeTargetIds;
 const timeline=payload.teachingTimeline??(focus.intervals.length?{intervals:focus.intervals,tick:focus.tick}:undefined);
 const state=payload.sample??legacy?.visualSample??(payload.artFrame!==undefined?undefined:timeline?sampleMaterialTeachingTimeline(block,timeline.intervals,timeline.tick):sampleMaterialTeaching(block,{activeTargetIds:targets,previousActiveTargetIds:payload.previousActiveTargetIds??focus.previousActiveTargetIds,revealedTargetIds:payload.revealedTargetIds,progress:payload.progress??1,reading:true}));
 return <FilmStage kind={node.kind}><div className="display-film-teaching"><TeachingArt props={block} frame={payload.artFrame??legacy?.frame??state?.frame??0} fps={payload.artFps??state?.fps??60} sample={state} music={payload.music} motionSeconds={payload.motionSeconds??clock.timeSeconds} layerMotion={payload.layerMotion??legacy?.layerMotion??(block.templateId==='general-layers'&&state?{focusId:state.stepId,layers:state.items}:undefined)} summaryMotion={payload.summaryMotion??legacy?.summaryMotion}/></div></FilmStage>;
}
