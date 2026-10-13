import {motionWorld,project,reserveMotionText,type Point,type SampledObject} from "./motion-scene-layout.js";
export {motionWorld} from "./motion-scene-layout.js";
import type {CompiledVideoTimelineV1} from './timeline.js';
import type {RemotionLessonSceneV1} from "./types.js";
import type {MotionStage,RemotionMotionSceneComponent} from "./motion-scene-schema.js";

type Camera={x:number;y:number;zoom:number};
type State={objects:SampledObject[];camera:Camera};
export const clamp=(t:number)=>Math.max(0,Math.min(1,t));
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
function easing(t:number,kind:string|undefined) {
  const p=clamp(t);
  if(kind==='linear') return p;
  if(kind==='spring') return p===1?1:1-Math.exp(-7*p)*Math.cos(8*p);
  return p*p*(3-2*p);
}

/** A piecewise curve through authored local waypoints, sampled without history. */
export function motionPath(points:Point[],progress:number):Point {
  const t=clamp(progress)*(points.length-1),i=Math.min(points.length-2,Math.floor(t)),u=t-i;
  const a=points[Math.max(0,i-1)],b=points[i],c=points[i+1],d=points[Math.min(points.length-1,i+2)];
  const axis=(key:'x'|'y')=>.5*((2*b[key])+(-a[key]+c[key])*u+(2*a[key]-5*b[key]+4*c[key]-d[key])*u*u+(-a[key]+3*b[key]-3*c[key]+d[key])*u*u*u);
  return {x:axis('x'),y:axis('y')};
}

function transition(from:State,stage:MotionStage,progress:number):State {
  const tracks=new Map(stage.tracks.map(track=>[track.targetId,track]));
  return {
    camera:stage.camera ? {x:lerp(from.camera.x,stage.camera.x,easing(progress,'smooth')),y:lerp(from.camera.y,stage.camera.y,easing(progress,'smooth')),zoom:lerp(from.camera.zoom,stage.camera.zoom,easing(progress,'smooth'))}:from.camera,
    objects:from.objects.map(object=>{
      const track=tracks.get(object.id);
      if(!track)return object;
      const local=clamp((progress-(track.start??0))/((track.end??1)-(track.start??0)));
      const t=easing(local,track.easing),bounded=clamp(t);
      const next={...object,contentOpacity:1} as SampledObject;
      const source=object as unknown as Record<string,unknown>, target=next as unknown as Record<string,unknown>;
      for(const [key,value] of Object.entries(track.to)) {
        if(typeof value==='number') {
          const fallback=key==='scale'||key==='opacity'||key==='draw'?1:0;
          // Preserve evidence bounds; spring overshoot applies only to geometry.
          const weight=['opacity','draw','value'].includes(key)?bounded:t;
          target[key]=lerp(typeof source[key]==='number'?source[key] as number:fallback,value,weight);
        } else if(key==='points' && Array.isArray(value)) {
          const original=source.points as Point[];
          target.points=value.map((point,i)=>({x:lerp(original[i].x,point.x,t),y:lerp(original[i].y,point.y,t)}));
        } else {
          target[key]=local<.5?source[key]:value;
          if((key==='text'||key==='latex') && source[key]!==value) next.contentOpacity=Math.abs(2*local-1);
        }
      }
      if(track.via) Object.assign(next,motionPath([{x:object.x,y:object.y},...track.via,{x:track.to.x!,y:track.to.y!}],bounded));
      return next;
    }),
  };
}

export function sampleMotionScene(props:RemotionMotionSceneComponent['props'],scene:RemotionLessonSceneV1,timeline:CompiledVideoTimelineV1,tick:number) {
  let from:State={objects:reserveMotionText(props),camera:{x:500,y:250,zoom:1}};
  let stage:MotionStage|undefined,start=0,duration=1,lastStage=-1;
  const sample=(at:number)=>stage?transition(from,stage,clamp((at-start)/duration)):from;
  let active:RemotionLessonSceneV1['beats'][number]|undefined;
  for(const beat of scene.beats) {
    const cue=timeline.tracks.find(t=>t.kind==='caption'&&t.beatId===beat.id);
    if(!cue || cue.startTick>tick)continue;
    active=beat;
    if(beat.action!=='transform')continue;
    const index=props.stages.findIndex(s=>s.id===beat.targetIds[0]);
    if(index<0 || index===lastStage)continue;
    from=sample(cue.startTick);stage=props.stages[index];lastStage=index;start=cue.startTick;
    const span=stage.pace==='quick'?31_200:stage.pace==='narration'?cue.durationTicks*.78:67_200;
    duration=Math.max(800,Math.min(span,cue.durationTicks*.9));
  }
  const sampled=sample(tick);
  return {...sampled,camera:readableMotionCamera(sampled.objects,sampled.camera),stageId:stage?.id,progress:stage?clamp((tick-start)/duration):0,focus:active?.action==='focus'?active.targetIds:[]};
}

/** Fit the camera, never the authored text layout. Reserve hidden labels too so
 * a reveal does not change the framing. Follow world bounds, including groups
 * whose children use a translated local coordinate system. */
export function readableMotionCamera(objects:SampledObject[],camera:Camera):Camera {
  const {world}=motionWorld(objects),bounds:Point[]=[];
  for(const o of objects) {
    if(!['text','formula','number'].includes(o.kind)||!('width' in o))continue;
    const m=world(o.id).matrix;
    const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>project(m,{x:x*o.width/2,y:y*o.height/2}));
    bounds.push(...corners);
  }
  if(!bounds.length)return camera;
  const left=Math.min(...bounds.map(p=>p.x)),right=Math.max(...bounds.map(p=>p.x));
  const top=Math.min(...bounds.map(p=>p.y)),bottom=Math.max(...bounds.map(p=>p.y));
  const zoom=Math.min(camera.zoom,952/Math.max(1,right-left),452/Math.max(1,bottom-top));
  const limit=(n:number,low:number,high:number)=>Math.max(low,Math.min(high,n));
  return {zoom,x:limit(camera.x,right-476/zoom,left+476/zoom),y:limit(camera.y,bottom-226/zoom,top+226/zoom)};
}
