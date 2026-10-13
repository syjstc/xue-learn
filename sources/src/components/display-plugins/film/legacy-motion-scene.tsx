import React,{useLayoutEffect,useRef,useState} from 'react';
import type {DisplayRendererProps} from '../../display-runtime/index.js';
import {FilmStage} from './stage.js';
import {THEME as T} from './theme.js';
import {parseLegacyMotionScenePayload,type LegacyMotionScenePayload,type LegacyMotionPrimitive} from './legacy-motion-scene-schema.js';
import {legacyMotionViewBox} from './legacy-motion-scene-layout.js';

/** The latest explicit stage wins; historical whole-node narration advances
 * stages once per applicable cue and holds the final stage. No state is retained. */
export function legacyMotionStage(payload:LegacyMotionScenePayload,{node,clock,timeline,activeTargets}:Pick<DisplayRendererProps,'node'|'clock'|'timeline'|'activeTargets'>){
  const prefix=`${node.id}/`,stages=new Set(payload.stages.map(stage=>stage.id));
  const local=(target:string)=>target.startsWith(prefix)?target.slice(prefix.length):undefined;
  const stageTarget=(targets:readonly string[])=>targets.map(local).find(target=>target!==undefined&&stages.has(target));
  const cues=timeline.map((cue,index)=>({cue,index})).filter(({cue})=>cue.startTick<=clock.tick&&cue.targets.some(target=>target===node.id||target.startsWith(prefix)))
    .sort((a,b)=>a.cue.startTick-b.cue.startTick||a.index-b.index).map(({cue})=>cue);
  const hostTargets=(node.payload as {activeTargetIds?:unknown}).activeTargetIds;
  const active=stageTarget(activeTargets)??(Array.isArray(hostTargets)?hostTargets.filter((target):target is string=>typeof target==='string').map(target=>stages.has(target)?target:local(target)).find(target=>target!==undefined&&stages.has(target)):undefined);
  const explicit=active??cues.slice().reverse().map(cue=>stageTarget(cue.targets)).find(Boolean);
  if(explicit)return payload.stages.find(stage=>stage.id===explicit)!;
  const spoken=cues.filter(cue=>cue.targets.includes(node.id)).length;
  return payload.stages[Math.min(payload.stages.length-1,Math.max(0,spoken-1))]!;
}

export function legacyMotionArcPath(object:Extract<LegacyMotionPrimitive,{type:'arc'}>):string {
  const [cx,cy]=object.center,r=object.radius,span=object.endAngle-object.startAngle;
  const at=(degrees:number)=>{const radians=degrees*Math.PI/180;return [cx+r*Math.cos(radians),cy+r*Math.sin(radians)] as const;};
  const start=at(object.startAngle),end=at(object.endAngle),sweep=span>0?1:0;
  if(Math.abs(span)===360){const middle=at(object.startAngle+span/2);return `M${start[0]} ${start[1]} A${r} ${r} 0 0 ${sweep} ${middle[0]} ${middle[1]} A${r} ${r} 0 0 ${sweep} ${end[0]} ${end[1]}`;}
  return `M${start[0]} ${start[1]} A${r} ${r} 0 ${Math.abs(span)>180?1:0} ${sweep} ${end[0]} ${end[1]}`;
}

const palette=[T.accentText,T.compareText,T.positive,T.cautionText];
function primitiveColor(object:LegacyMotionPrimitive,index:number){return object.color??(object.type==='line'?T.muted:object.type==='point'?T.ink:palette[index%palette.length]);}

/** Direct SVG primitives preserve all supplied coordinates. Complete object and
 * stage labels occupy a separate column so they cannot cover the geometry. */
export function LegacyMotionScene(props:DisplayRendererProps){
  const payload=parseLegacyMotionScenePayload(props.node.payload);
  if(!payload)throw new Error('Invalid historical primitive motion scene');
  const stage=legacyMotionStage(payload,props),visible=new Set(stage.visibleIds);
  const labelHost=useRef<HTMLDivElement>(null),[overflow,setOverflow]=useState<string>();
  useLayoutEffect(()=>{
    let disposed=false;
    const measure=()=>{const element=labelHost.current;if(disposed||!element)return;
      const overflowing=[element,...element.querySelectorAll<HTMLElement>('[data-motion-legend]')].find(item=>item.scrollWidth>item.clientWidth+1||item.scrollHeight>item.clientHeight+1);
      setOverflow(overflowing?`Motion scene labels overflow (stage=${stage.id}, content=${overflowing.scrollWidth}x${overflowing.scrollHeight}, bounds=${overflowing.clientWidth}x${overflowing.clientHeight})`:undefined);};
    measure();void document.fonts.ready.then(measure);
    const observer=new ResizeObserver(measure);if(labelHost.current)observer.observe(labelHost.current);
    return ()=>{disposed=true;observer.disconnect();};
  },[payload.description,stage.id,payload.objects.map(object=>object.label??'').join('\n')]);
  const prefix=Array.from(props.node.id,character=>character.codePointAt(0)!.toString(16)).join('-');
  const marker=(id:string)=>`legacy-${prefix}-${id}-arrow`;
  return <FilmStage kind={props.node.kind}><div ref={labelHost} data-animation-component="legacy-motion-scene.v1" data-motion-stage={stage.id} data-remotion-resource-status={overflow?'error':'ready'} data-remotion-resource-message={overflow} data-display-node={props.node.id} data-display-kind={props.node.kind} style={{position:'absolute',inset:'36px',display:'grid',gridTemplateColumns:'minmax(0,1fr) 560px',gridTemplateRows:'auto minmax(0,1fr) auto',columnGap:40,rowGap:24,color:T.ink,overflowWrap:'anywhere'}}>
    <div data-motion-stage-label={stage.id} style={{gridColumn:'1/-1',paddingInlineEnd:40,fontSize:40,lineHeight:1.3,fontWeight:700,color:T.accentText}}>{stage.label}</div>
    <svg viewBox={legacyMotionViewBox(payload)} width="100%" height="100%" style={{minHeight:0}} role="img" aria-label={payload.description}>
      <defs>{payload.objects.map((object,index)=>object.type==='arrow'?<marker key={object.id} id={marker(object.id)} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill={primitiveColor(object,index)}/></marker>:null)}</defs>
      {payload.objects.map((object,index)=>{
        const color=primitiveColor(object,index),shown=visible.has(object.id);
        const line=object.type==='line'||object.type==='arrow';
        return <g key={object.id} data-motion-object={object.id} data-motion-kind={object.type} data-motion-visible={shown} data-motion-group={object.group} opacity={shown?1:0}>
          {object.label&&<title>{object.label}</title>}
          {object.type==='rect'?<rect x={object.x} y={object.y} width={object.width} height={object.height} fill={color} fillOpacity=".12" stroke={color} strokeWidth="2.5"/>:
            line?<line x1={object.from[0]} y1={object.from[1]} x2={object.to[0]} y2={object.to[1]} stroke={color} strokeWidth="2.5" strokeDasharray={object.dashed?'7 5':undefined} markerEnd={object.type==='arrow'?`url(#${marker(object.id)})`:undefined}/>:
            object.type==='point'?<circle cx={object.position[0]} cy={object.position[1]} r="4" fill={color}/>:
            object.type==='arc'?<path d={legacyMotionArcPath(object)} fill="none" stroke={color} strokeWidth="2" strokeDasharray={object.dashed?'7 5':undefined}/>:null}
        </g>;
      })}
    </svg>
    {/* Reserve a text em for Chromium's hanging CJK closing punctuation. The
        heading and complete explanation span the board instead of crowding the legend. */}
    <div data-motion-legend="true" style={{minWidth:0,minHeight:0,paddingInlineEnd:28,alignSelf:'stretch',display:'flex',flexDirection:'column',justifyContent:'center',gap:14,fontSize:28,lineHeight:1.4}}>{payload.objects.filter(object=>object.label&&visible.has(object.id)).map(object=><div key={object.id} data-motion-label={object.id} style={{display:'flex',alignItems:'baseline',gap:14}}><span aria-hidden="true" style={{width:24,height:5,background:primitiveColor(object,payload.objects.indexOf(object)),flexShrink:0}}/><span>{object.label}</span></div>)}</div>
    <div data-motion-description="true" style={{gridColumn:'1/-1',paddingInlineEnd:22,fontSize:22,lineHeight:1.5,color:T.muted}}>{payload.description}</div>
  </div></FilmStage>;
}
