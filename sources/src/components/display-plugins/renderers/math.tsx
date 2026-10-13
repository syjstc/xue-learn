import React from 'react';
import type {DisplayRendererProps,DisplayRenderer} from '../../display-runtime/index.js';
import type {DisplayPluginModule} from '../../../../libs/display/src/types.js';
import {FilmStage} from '../film/stage.js';
import {sampleDerivationDisplay} from '../derivation-sampling.js';
import {FormulaBoard} from '../film/formula-board.js';
import {AnimatedChart} from '../film/animated-chart.js';
import {TeachingDerivationScene} from '../film/teaching-derivation-scene.js';
import {DerivationScene} from '../film/formal-derivation-scene.js';
import type {DerivationDocumentV1} from '../../../../libs/formal-derivation/src/index.js';
import type {TeachingDerivationDocumentV1} from '../../../../libs/teaching-derivation/src/index.js';
import type {MaterialTeachingCueInterval} from '../../../../libs/domain/src/index.js';
import {createAnimatedDisplay} from './animated.js';
import {TeachingDisplay} from './teaching.js';
export function DerivationDisplay({node,clock}:DisplayRendererProps){
 const payload=node.payload as {document:TeachingDerivationDocumentV1;derived?:unknown;focused?:boolean;fromStep?:number;toStep?:number;cueId?:string;progress?:number;layoutProgress?:number;visualProgress?:number;contextProgress?:number;visualTimeline?:{intervals:readonly MaterialTeachingCueInterval[];tick:number}};
 if(!payload.document?.steps?.length)throw new Error('This derivation has not been prepared');
 const sampled=sampleDerivationDisplay(payload.document,Math.round(clock.timeSeconds*48_000));
 const defined=Object.fromEntries(Object.entries(payload).filter(([,value])=>value!==undefined));
 const frame=payload.toStep===undefined?{...sampled,...defined}:payload;
 return <FilmStage kind={node.kind}><TeachingDerivationScene document={payload.document} derived={payload.derived} focused={payload.focused} scene={{derivation:{toStep:frame.toStep??1,fromStep:frame.fromStep??0},slots:{caption:payload.document.title}}} cueId={frame.cueId} progress={frame.progress??1} layoutProgress={frame.layoutProgress} visualProgress={frame.visualProgress} contextProgress={frame.contextProgress} visualTimeline={frame.visualTimeline}/></FilmStage>;
}
export function FormalDerivationDisplay({node}:DisplayRendererProps){
 const payload=node.payload as {document:DerivationDocumentV1;fromStep?:number;toStep?:number;progress?:number};
 return <FilmStage kind={node.kind}><DerivationScene document={payload.document} scene={{derivation:{toStep:payload.toStep??1,fromStep:payload.fromStep??0},slots:{}}} progress={payload.progress??1}/></FilmStage>;
}

const module:DisplayPluginModule<DisplayRenderer>={components:{
 'math:formula@1':createAnimatedDisplay('formula.v1',({component,...context})=><FormulaBoard props={component.props} {...context}/>),
 'math:chart@1':createAnimatedDisplay('animated-chart.v1',({component,motion})=><AnimatedChart props={component.props} motion={motion}/>),
 'math:teaching@1':TeachingDisplay,'math:derivation@1':DerivationDisplay,'math:formal-derivation@1':FormalDerivationDisplay,
},validators:{'math:chart@1':value=>{const p=value as {categories:unknown[];series:{values:number[]}[];chart:string};return p.series.every(s=>s.values.length===p.categories.length&&s.values.every(Number.isFinite))&&(p.chart!=='donut'||p.series[0].values.every(n=>n>=0)&&p.series[0].values.some(n=>n>0));}}};
export default module;
