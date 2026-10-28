import type {TeachingDerivationDocumentV1} from '../../../libs/teaching-derivation/src/index.js';

export const DISPLAY_TICKS_PER_SECOND=48_000;
const smooth=(value:number)=>{const p=Math.max(0,Math.min(1,value));return p*p*(3-2*p);};
/** Preview timing only. An authored narration host overrides these durations with its accepted audio cues. */
export function derivationDisplayTimeline(document:TeachingDerivationDocumentV1){
 let tick=0;
 return document.steps.flatMap((step,index)=>{
  const cues=step.cues?.length?step.cues:[{id:`step-${index+1}`,text:step.narration||step.justification,targetIds:[],startTransform:true}];
  const stepStart=tick;
  return cues.map(cue=>{
   const text=cue.text??'';
   const cjk=(text.match(/[\u3000-\u9fff]/gu)??[]).length;
   const words=text.replace(/[\u3000-\u9fff]/gu,' ').trim().split(/\s+/u).filter(Boolean).length;
   const durationTicks=Math.round(Math.max(1.4,Math.min(24,cjk/4.8+words/2.4+.5))*DISPLAY_TICKS_PER_SECOND);
   const entry={step:index+1,stepStart,cueId:cue.id,startTick:tick,durationTicks,startTransform:cue.startTransform===true,targetIds:cue.targetIds,visualTargetIds:cue.visualTargetIds??[]};
   tick+=durationTicks;
   return entry;
  });
 });
}
export function derivationDisplayDurationTicks(document:TeachingDerivationDocumentV1){const last=derivationDisplayTimeline(document).at(-1);return last?last.startTick+last.durationTicks:0;}
/** Reconstruct from absolute time; repeated or backwards seeks produce identical formula and companion state. */
export function sampleDerivationDisplay(document:TeachingDerivationDocumentV1,tick:number){
 const cues=derivationDisplayTimeline(document);
 const current=cues.filter(cue=>cue.startTick<=tick).at(-1)??cues[0];
 if(!current)return {fromStep:0,toStep:1,cueId:undefined,progress:0,layoutProgress:0,visualProgress:0,contextProgress:0,visualTimeline:{intervals:[],tick}};
 const stepCues=cues.filter(cue=>cue.step===current.step);
 const trigger=stepCues.find(cue=>cue.startTransform)??stepCues[0];
 const elapsed=tick-trigger.startTick;
 const morphTicks=Math.min(30_720,Math.round(trigger.durationTicks*.65));
 const layoutTicks=Math.min(17_280,Math.max(1,trigger.durationTicks-morphTicks));
 const firstVisual=stepCues.find(cue=>JSON.stringify(cue.visualTargetIds)===JSON.stringify(current.visualTargetIds));
 return {fromStep:Math.max(0,current.step-1),toStep:current.step,cueId:current.cueId,
  progress:smooth(elapsed/Math.max(1,morphTicks)),layoutProgress:smooth((elapsed-morphTicks)/layoutTicks),
  visualProgress:smooth((tick-(firstVisual?.startTick??current.startTick))/Math.min(33_600,current.durationTicks)),
  contextProgress:smooth((tick-current.startTick)/Math.min(24_000,current.durationTicks)),
  visualTimeline:{intervals:stepCues.map(cue=>({startTick:cue.startTick,durationTicks:cue.durationTicks,targetIds:cue.visualTargetIds})),tick}};
}

/** Namespaced semantic targets and preview narration cues for prepared embedded derivations. */
export function derivationDisplayBinding(document:TeachingDerivationDocumentV1,nodeId:string){
 const cues=derivationDisplayTimeline(document);
 const local=(cue:typeof cues[number])=>[`step-${cue.step}`,...cue.targetIds.map(target=>`step-${cue.step}/${target}`),...cue.visualTargetIds.map(target=>`step-${cue.step}/visual/${target}`)];
 return {targets:[...new Set(cues.flatMap(local))],timeline:cues.map(cue=>({id:`${nodeId}:step-${cue.step}:cue-${cue.cueId}`,startTick:cue.startTick,durationTicks:cue.durationTicks,targets:local(cue).map(target=>`${nodeId}/${target}`)})),durationTicks:derivationDisplayDurationTicks(document),ticksPerSecond:DISPLAY_TICKS_PER_SECOND};
}
