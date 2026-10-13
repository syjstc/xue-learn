import type {DisplayRendererProps} from '../../display-runtime/index.js';
/** Public timelines use namespaced paths; artwork consumes only this node's local targets. */
export function displayFocus(props:Pick<DisplayRendererProps,'node'|'clock'|'timeline'|'activeTargets'>,wholeTarget?:string){
 const prefix=props.node.id+'/';
 // Some artwork distinguishes an unrevealed board from a whole-board visit.
 // Keep that visit explicit, while specific child targets still take priority.
 const local=(targets:readonly string[])=>{
  const specific=targets.filter(target=>target.startsWith(prefix)).map(target=>target.slice(prefix.length));
  return specific.length||!wholeTarget||!targets.includes(props.node.id)?specific:[wholeTarget];
 };
 const scale=48_000/props.clock.ticksPerSecond;
 const intervals=props.timeline.filter(cue=>cue.targets.some(target=>target===props.node.id||target.startsWith(prefix))).map(cue=>({targetIds:local(cue.targets),startTick:Math.round(cue.startTick*scale),durationTicks:Math.max(1,Math.round(cue.durationTicks*scale))}));
 const tick=Math.round(props.clock.tick*scale),history=intervals.filter(cue=>cue.startTick<=tick),current=history.at(-1),previous=history.at(-2);
 const repeated=current&&previous&&JSON.stringify(current.targetIds)===JSON.stringify(previous.targetIds);
 const raw=current?Math.min(1,Math.max(0,(tick-current.startTick)/Math.min(33_600,current.durationTicks))):0;
 return {activeTargetIds:local(props.activeTargets),previousActiveTargetIds:previous?.targetIds??[],revealedTargetIds:[...new Set(history.flatMap(cue=>cue.targetIds))],previousRevealedTargetIds:[...new Set(history.slice(0,-1).flatMap(cue=>cue.targetIds))],progress:repeated?1:raw*raw*(3-2*raw),intervals,tick};
}
