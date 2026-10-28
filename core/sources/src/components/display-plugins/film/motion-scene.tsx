import {InlineMathText} from "../../markdown/inline-math-text.js";
import React,{useLayoutEffect,useRef,useState} from 'react';
import {MathLatex} from '../../markdown/math-latex.js';
import type {CompiledVideoTimelineV1} from './timeline.js';
import type {RemotionLessonSceneV1} from "./types.js";
import type {MotionObject,RemotionMotionSceneComponent} from "./motion-scene-schema.js";
import {motionWorld,sampleMotionScene} from './motion-scene-sampling.js';
import {THEME as T,tint} from './theme.js';

const colors={primary:T.accentText,secondary:T.compareText,positive:T.positive,caution:T.cautionText,ink:T.ink,muted:T.muted};
const isLabel=(o:MotionObject)=>o.kind==='text'||o.kind==='number'||o.kind==='formula';
function shape(o:Extract<MotionObject,{kind:'shape'}>) {
  if(o.shape==='ellipse')return <ellipse rx={o.width/2} ry={o.height/2}/>;
  if(o.shape==='polygon')return <polygon points={o.points!.map(p=>`${p.x},${p.y}`).join(' ')}/>;
  return <rect x={-o.width/2} y={-o.height/2} width={o.width} height={o.height} rx={Math.min(T.radius/3,o.width/8,o.height/8)}/>;
}

/** Fixed authored text boxes. Camera/group transforms never change layout.
 * Overflow blocks export instead of silently shrinking or cutting evidence. */
function MotionText({object:o}:{object:Extract<MotionObject,{kind:'text'|'formula'|'number'}>}) {
  const host=useRef<HTMLDivElement>(null),[overflow,setOverflow]=useState(false);
  const label=o.kind==='formula'?o.latex:o.kind==='text'?o.text:`${o.prefix??''}${o.value.toFixed(o.decimals??0)}${o.suffix??''}`;
  useLayoutEffect(()=>{
    let disposed=false;
    const measure=()=>{if(!disposed&&host.current) {const e=host.current;setOverflow(e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1);}};
    measure();void document.fonts.ready.then(measure);
    return ()=>{disposed=true;};
  },[label,o.width,o.height]);
  const fontSize=o.size==='heading'?28:o.size==='body'?20:16;
  return <foreignObject x={-o.width/2} y={-o.height/2} width={o.width} height={o.height}>
    <div ref={host} className="rm-motion-text" data-remotion-resource-status={overflow?'error':'ready'} style={{width:'100%',height:'100%',fontSize,lineHeight:1.2,fontWeight:o.size==='heading'?750:600,color:colors[o.tone??'ink'],textAlign:o.align??'center',display:'flex',alignItems:'center',justifyContent:o.align==='left'?'flex-start':o.align==='right'?'flex-end':'center',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>
      <span style={{textWrap:'balance',background:T.stage,boxShadow:`0 0 0 2px ${T.stage}`,borderRadius:T.radius/6}}>{o.kind==='formula'?<MathLatex latex={o.latex} display/>:<InlineMathText text={label}/>}</span>
    </div>
  </foreignObject>;
}

export function MotionScene({props,scene,timeline,tick}:{props:RemotionMotionSceneComponent['props'];scene:RemotionLessonSceneV1;timeline:CompiledVideoTimelineV1;tick:number}) {
  const sampled=sampleMotionScene(props,scene,timeline,tick),{world,anchor}=motionWorld(sampled.objects);
  const prefix=`motion-${scene.id}`,camera=sampled.camera;
  return <svg className="rm-motion-scene" viewBox="0 0 1000 500" role="img" aria-label={props.description} data-animation-component="motion-scene.v1" data-motion-stage={sampled.stageId}>
    <defs>
      {Object.entries(colors).map(([key,color])=><marker key={key} id={`${prefix}-arrow-${key}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1L9 5L1 9" fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/></marker>)}
      {sampled.objects.filter((o):o is Extract<MotionObject,{kind:'shape'}>=>o.kind==='shape').map(o=><clipPath id={`${prefix}-clip-${o.id}`} key={o.id} clipPathUnits="userSpaceOnUse">{React.cloneElement(shape(o),{transform:`matrix(${world(o.id).matrix.join(' ')})`})}</clipPath>)}
    </defs>
    <g transform={`translate(500 250) scale(${camera.zoom}) translate(${-camera.x} ${-camera.y})`}>
      {sampled.objects.slice().sort((a,b)=>Number(isLabel(a))-Number(isLabel(b))).map(o=>{
        if(o.kind==='group'||o.kind==='shape'&&o.maskOnly)return null;
        const geometry=world(o.id),color=colors[o.tone??'primary'],selected=sampled.focus.includes(o.id)||Boolean(o.parentId&&sampled.focus.includes(o.parentId));
        let content:React.ReactNode;
        if(o.kind==='shape') content=<g fill={o.fill==='none'?'none':o.fill==='solid'?color:tint(color,.16)} stroke={color} strokeWidth={(o.strokeWidth??1.5)+(selected?1.5:0)}>{shape(o)}</g>;
        else if(o.kind==='path'||o.kind==='link') {
          let d:string;
          if(o.kind==='path')d=o.points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ')+(o.closed?' Z':'');
          else {
            const a=anchor(o.from,o.fromPort),b=anchor(o.to,o.toPort),length=Math.max(1,Math.hypot(b.x-a.x,b.y-a.y));
            const c={x:(a.x+b.x)/2-(b.y-a.y)/length*(o.bend??0),y:(a.y+b.y)/2+(b.x-a.x)/length*(o.bend??0)};
            d=`M${a.x} ${a.y}Q${c.x} ${c.y} ${b.x} ${b.y}`;
          }
          const draw=o.draw??1;
          content=<path d={d} fill={o.kind==='path'&&o.closed&&o.fill!=='none'?(o.fill==='solid'?color:tint(color,.16)):'none'} stroke={color} strokeWidth={(o.strokeWidth??2)+(selected?1.5:0)} strokeLinecap="round" strokeLinejoin="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1-draw} opacity={draw>0?1:0} markerEnd={o.arrow&&draw>.995?`url(#${prefix}-arrow-${o.tone??'primary'})`:undefined}/>;
        } else content=<g opacity={o.contentOpacity??1}><MotionText object={o}/></g>;
        let element=<g transform={`matrix(${geometry.matrix.join(' ')})`} opacity={geometry.opacity} data-motion-object={o.id} data-motion-kind={o.kind} data-motion-x={o.x} data-motion-y={o.y}>{content}</g>;
        for(const clip of geometry.clips)element=<g clipPath={`url(#${prefix}-clip-${clip})`}>{element}</g>;
        return <React.Fragment key={o.id}>{element}</React.Fragment>;
      })}
    </g>
  </svg>;
}
