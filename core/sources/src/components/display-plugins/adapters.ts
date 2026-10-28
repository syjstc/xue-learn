import type {DisplayDocument,DisplayNode} from '../../../libs/display/src/types.js';
import type {CourseDisplayBlock,MaterialTeachingCueInterval,MusicPlaybackState,GuidedImageDisplay} from '../../../libs/domain/src/index.js';
import {resolveCodeFigureSpans} from '../../../libs/domain/src/material-cue.js';
import {classroomCodeSource} from '../../../libs/domain/src/course-code.js';
import {compareSideObjectId} from '../../../libs/domain/src/compare-block.js';
import {validatePresentationSvg} from '../../../libs/common/src/presentation-svg.js';
import {derivationDisplayBinding} from './derivation-sampling.js';
import type {TeachingDerivationDocumentV1} from '../../../libs/teaching-derivation/src/index.js';
import {builtinDisplayPluginForKind} from './catalog.js';

export type MaterialDisplayOptions = Readonly<{id?:string;activeTargetIds?:readonly string[];previousActiveTargetIds?:readonly string[];revealedTargetIds?:readonly string[];previousRevealedTargetIds?:readonly string[];progress?:number;teachingTimeline?:{intervals:readonly MaterialTeachingCueInterval[];tick:number};music?:MusicPlaybackState}>;
const text=(value:unknown)=>typeof value==='string'?value:'';
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'?value as Record<string,unknown>:{};
const teachingKind=(templateId:unknown)=>typeof templateId==='string'&&templateId.startsWith('math-')?'math:teaching':typeof templateId==='string'&&templateId.startsWith('music-')?'music:teaching':typeof templateId==='string'&&templateId.startsWith('physics-')?'physics:teaching':'general:teaching';
export {teachingKind as builtinTeachingKind};

/** Historical accepted data is projected without rewriting saved learner content. Unknown content remains an explicit missing-plugin node. */
export function materialDisplayNode(input:unknown,options:MaterialDisplayOptions={}):DisplayNode {return materialDisplayNodeInternal(input,options,new Set(),0);}
function materialDisplayNodeInternal(input:unknown,options:MaterialDisplayOptions,ancestors:Set<unknown>,depth:number):DisplayNode {
 if(depth>64||ancestors.has(input))throw Error('The material display contains a cycle or exceeds 64 nesting levels');
 const block=object(input) as CourseDisplayBlock;
 const id=options.id??(text(block.id)||'material-display');
 const common={activeTargetIds:options.activeTargetIds,previousActiveTargetIds:options.previousActiveTargetIds,revealedTargetIds:options.revealedTargetIds,previousRevealedTargetIds:options.previousRevealedTargetIds,progress:options.progress,teachingTimeline:options.teachingTimeline,music:options.music};
 const node=(kind:string,payload:unknown,children?:DisplayNode[]):DisplayNode=>({id,kind,version:1,payload,...(children?{children}:{} )});
 if(block.type==='display'&&block.document&&typeof block.document==='object')return (block.document as DisplayDocument).root;
 if(block.type==='teaching')return node(teachingKind(block.templateId),{block,...common});
 if(block.type==='visual')return node('general:visual',{block,...common});
 if(block.type==='music')return node('music:score',{block,...common});
 if(block.type==='conversation'){const turns=(Array.isArray(block.turns)?block.turns:[]).map((turn,index)=>({id:text(object(turn).id)||`turn-${index}`,speaker:text(object(turn).speaker),text:text(object(turn).text)}));return {...node('general:conversation',{title:text(block.title),turns,...common}),targets:turns.map(turn=>turn.id)};}
 if(block.type==='stage') {
  const figures=Array.isArray(block.figures)?block.figures:[];
  ancestors.add(input);const children=figures.map((figure,index)=>materialDisplayNodeInternal(figure,{...options,id:`${id}-figure-${index}`},ancestors,depth+1));ancestors.delete(input);
  return node('general:composition',{layout:block.layout==='split-v'||block.layout==='stack'?'column':'row'},children);
 }
 if(block.type==='code'){
  const code=classroomCodeSource(block);
  const highlights=resolveCodeFigureSpans(block).map(region=>({id:region.id,label:region.id,startLine:region.startLine,endLine:region.endLine}));
  return node('computing:code',{language:text(block.language)||'text',code,highlights,...common});
 }
 if(['illustration','image','svg'].includes(block.type)){
  const guided=block.guidedImage as GuidedImageDisplay|undefined;
  const svg=[block.svg,block.markup,block.body].find(value=>typeof value==='string'&&value.includes('<svg'));
  const safeSvg=typeof svg==='string'&&!validatePresentationSvg(svg).length?svg:undefined;
  const src=guided?.image.src||text(block.imageUrl)||text(block.src)||(safeSvg?`data:image/svg+xml;charset=utf-8,${encodeURIComponent(safeSvg)}`:undefined);
  return node('media:image',{id,prompt:text(block.prompt),alt:text(block.alt)||text(block.caption),caption:text(block.caption),src,motion:'still',...(guided?{guidedImage:{...guided.image,segmentation:guided.segmentation}}:{}),...common});
 }
 if(block.type==='compare'){
  const sides=Array.isArray(block.sides)?block.sides:[block.left,block.right];
  const side=(value:unknown,sideIndex:number)=>{const s=object(value);const sideId=compareSideObjectId({id:text(s.id)},sideIndex);return {id:sideId,label:text(s.label),points:(Array.isArray(s.points)?s.points:[]).map((p,pointIndex)=>({id:text(object(p).id)||`${sideId}-point-${pointIndex}`,text:typeof p==='string'?p:text(object(p).text)}))};};
  const accepted=sides.map(side);
  return node('general:compare',{left:accepted[0],right:accepted[1],...(accepted.length>2?{sides:accepted}:{}),...common});
 }
 if(block.type==='callout')return node('general:callout',{block,...common});
 if(block.type==='accordion'||block.type==='paragraph')return node('general:text',{title:text(block.title),text:text(block.body)||text(block.text),...common});
 if(block.type==='teaching_derivation'||block.type==='derivation')return node(block.type==='teaching_derivation'?'math:derivation':'math:formal-derivation',{...object(block.payload),document:block.document,derived:block.derived});
 return node(`legacy:${text(block.type)||'unknown'}`,block);
}

export function displayDocumentForNode(root:DisplayNode,id=`display-${root.id}`):DisplayDocument {
 const locks=new Map<string,{id:string;version:string}>();
 const ancestors=new Set<DisplayNode>();let count=0;
 const walk=(node:DisplayNode,depth:number)=>{if(depth>64||++count>10_000||ancestors.has(node))throw Error('The display tree contains a cycle or exceeds the supported size');ancestors.add(node);const plugin=builtinDisplayPluginForKind(node.kind);if(plugin)locks.set(plugin.id,{id:plugin.id,version:plugin.version});for(const child of [...(node.children??[]),...Object.values(node.slots??{}).flat()])walk(child,depth+1);ancestors.delete(node);};
 walk(root,0);
 return {version:1,id,root,plugins:[...locks.values()],ticksPerSecond:48_000};
}
export function materialDisplayDocument(block:unknown,options:MaterialDisplayOptions={}):DisplayDocument {
 const saved=object(block);if(saved.type==='display'&&saved.document&&typeof saved.document==='object')return saved.document as DisplayDocument;
 return displayDocumentForNode(materialDisplayNode(block,options));
}
export function derivationDisplayDocument(input:{document:unknown;derived?:unknown;id?:string;focused?:boolean;fromStep?:number;toStep?:number;cueId?:string;progress?:number;layoutProgress?:number;visualProgress?:number;contextProgress?:number;visualTimeline?:unknown}):DisplayDocument {
 const {id='derivation-display',...payload}=input;
 const document=input.document as TeachingDerivationDocumentV1;
 const binding=document?.steps?.length?derivationDisplayBinding(document,id):undefined;
 const display=displayDocumentForNode({id,kind:'math:derivation',version:1,payload,...(binding?{targets:binding.targets}:{})});
 return binding?{...display,timeline:binding.timeline,durationTicks:binding.durationTicks,ticksPerSecond:binding.ticksPerSecond}:display;
}
export const legacyMaterialToDisplayDocument=materialDisplayDocument;
export const legacyDerivationToDisplayDocument=derivationDisplayDocument;

/** A learner advances a cue while every preceding animation stage stays
 * completed. The authored tree and the course's saved timeline remain intact. */
export function projectDisplayFocusTimeline(document:DisplayDocument,activeTargets:readonly string[],cueId?:string,startSeconds=2,transitionSeconds=.7):DisplayDocument {
 const authored=document.timeline??[];
 const nodes:string[]=[];
 const visit=(node:DisplayNode)=>{nodes.push(node.id);node.children?.forEach(visit);Object.values(node.slots??{}).forEach(children=>children.forEach(visit));};
 visit(document.root);
 const specific=activeTargets.filter(target=>!nodes.includes(target));
 const targets=specific.length?specific:activeTargets;
 const index=cueId?authored.findIndex(cue=>cue.id===cueId):targets.length?authored.findIndex(cue=>cue.targets.some(target=>targets.includes(target))):-1;
 const ticks=document.ticksPerSecond??48_000;
 const prefix=index>0?authored.slice(0,index):[];
 const timeline=prefix.map((cue,at)=>({...cue,startTick:Math.round(startSeconds*ticks*at/prefix.length),durationTicks:Math.max(1,Math.round(startSeconds*ticks/prefix.length))}));
 timeline.push({id:index>=0?authored[index]!.id:'chat-focus',startTick:Math.round(startSeconds*ticks),durationTicks:Math.max(1,Math.round(transitionSeconds*ticks)),targets:index>=0?authored[index]!.targets:activeTargets.length?[...activeTargets]:nodes});
 return {...document,timeline,durationTicks:Math.round((startSeconds+transitionSeconds)*ticks)};
}
