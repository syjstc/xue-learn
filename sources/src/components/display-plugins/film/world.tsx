import {SvgMathText} from "../../markdown/svg-math-text.js";
import React from 'react';
import {project,projectedPoints,cellX,type Camera,type V3} from './world-geometry.js';

import {THEME as T,tint,readableAccent,orbShade} from './theme.js';
type Face={points:V3[];fill:string;stroke:string;opacity?:number};

const prism=(x:number,y:number,z:number,w:number,h:number,d:number,colors:string[],alpha=1):Face[]=>[
  {points:[{x,y,z},{x:x+w,y,z},{x:x+w,y:y+h,z},{x,y:y+h,z}],fill:colors[0],stroke:colors[3],opacity:alpha},
  {points:[{x:x+w,y,z},{x:x+w,y,z:z+d},{x:x+w,y:y+h,z:z+d},{x:x+w,y:y+h,z}],fill:colors[1],stroke:colors[3],opacity:alpha},
  {points:[{x,y:y+h,z},{x:x+w,y:y+h,z},{x:x+w,y:y+h,z:z+d},{x,y:y+h,z:z+d}],fill:colors[2],stroke:colors[3],opacity:alpha},
];

export const World:React.FC<{id:string;t:number;position:number;accent?:string;camera?:Partial<Camera>;reveal?:number;build?:number;trail?:number;scan?:number;label?:string}>=
({id,t,position,accent=T.accent,camera={},reveal=0,build=1,trail=0,scan=-1,label})=>{
  const c:Camera={cx:690,cy:420,yaw:-.21,pitch:.45,scale:1.14,...camera};
  const faces:Face[]=[];
  for(let i=0;i<6;i++){
    const enter=Math.max(0,Math.min(1,build*1.6-i*.11));
    const y=-23-(1-enter)*170;
    faces.push(...prism(cellX(i+1)-73,y,-87,146,23,174,[T.elevated,T.inset,T.surface,tint(accent,.35)],enter));
  }
  // The wall is in front of the corridor. It can rise for a labeled teaching cutaway.
  for(let i=0;i<3;i++)faces.push(...prism(cellX(i+2)-77,reveal*100,25,154,176,20,
    [T.wallFront,T.wallSide,T.wallTop,tint(accent,.55)],1-reveal*.64));
  faces.sort((a,b)=>a.points.reduce((s,p)=>s+project(p,c).depth,0)/a.points.length-b.points.reduce((s,p)=>s+project(p,c).depth,0)/b.points.length);
  const ball=project({x:cellX(position),y:47,z:-25},c);
  const floor=project({x:cellX(position),y:0,z:-25},c);
  const hidden=position>1.5&&position<4.5;
  const centerOpacity=hidden?Math.max(.04,reveal):1;
  const ballRadius=31*c.scale;
  return <svg viewBox="0 0 1380 670" style={{width:'100%',height:'100%',overflow:'visible'}}>
    <defs>
      <radialGradient id={`${id}-orb`} cx="30%" cy="24%"><stop stopColor={T.inverse}/><stop offset=".18" stopColor={accent}/><stop offset="1" stopColor={orbShade(accent)}/></radialGradient>
      <radialGradient id={`${id}-halo`}><stop stopColor={accent} stopOpacity=".24"/><stop offset="1" stopColor={accent} stopOpacity="0"/></radialGradient>
      <filter id={`${id}-glow`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="5"/></filter>
    </defs>
    <ellipse cx={c.cx} cy={c.cy+30} rx="530" ry="180" fill={`url(#${id}-halo)`}/>
    {Array.from({length:17},(_,i)=>{
      const x=(i-8)*110;return <polyline key={`g${i}`} points={projectedPoints([{x,y:-31,z:-550},{x,y:-31,z:390}],c)} stroke={T.border} strokeOpacity=".28" strokeWidth="1"/>;
    })}
    {Array.from({length:11},(_,i)=>{
      const z=(i-5)*100;return <polyline key={`h${i}`} points={projectedPoints([{x:-920,y:-31,z},{x:920,y:-31,z}],c)} stroke={T.border} strokeOpacity=".23" strokeWidth="1"/>;
    })}
    {faces.map((face,i)=><polygon key={i} points={projectedPoints(face.points,c)} fill={face.fill} fillOpacity={face.opacity} stroke={face.stroke} strokeOpacity={face.opacity} strokeWidth="1.4" strokeLinejoin="round"/>)}
    {Array.from({length:6},(_,i)=>{const p=project({x:cellX(i+1),y:-16,z:128},c);return <SvgMathText key={i} x={p.x} y={p.y+38} textAnchor="middle" fill={i+1===Math.round(position)&&reveal>.5?readableAccent(accent):T.muted} fontFamily="monospace" fontSize="27">0{i+1}</SvgMathText>;})}
    {trail>0&&Array.from({length:16},(_,i)=>{
      const back=i/15*trail;const p=project({x:cellX(position-back),y:40+Math.sin(back*3)*2,z:-25},c);
      return <circle key={i} cx={p.x} cy={p.y} r={Math.max(1,11-i*.5)*c.scale} fill={accent} opacity={(1-i/16)*.34}/>;
    })}
    <g opacity={centerOpacity}>
      <ellipse cx={floor.x} cy={floor.y+2} rx={45*c.scale} ry={12*c.scale} fill={accent} opacity=".2"/>
      <circle cx={ball.x} cy={ball.y} r={ballRadius*2.8} fill={`url(#${id}-halo)`}/>
      <circle cx={ball.x} cy={ball.y} r={ballRadius} fill={`url(#${id}-orb)`}/>
      <ellipse cx={ball.x} cy={ball.y+1} rx={ballRadius*1.45} ry={ballRadius*.31} fill="none" stroke={accent} strokeWidth="2" transform={`rotate(${-18+Math.sin(t*.028)*13} ${ball.x} ${ball.y})`}/>
      <circle cx={ball.x-ballRadius*.26} cy={ball.y-ballRadius*.32} r={ballRadius*.13} fill={T.inverse} opacity=".8"/>
      {hidden&&reveal>.2&&<circle cx={ball.x} cy={ball.y} r={ballRadius+9} fill="none" stroke={accent} strokeWidth="1.5" strokeDasharray="5 7"/>}
    </g>
    {scan>=0&&scan<=1&&<g>
      <polygon points={projectedPoints([{x:-470+scan*940,y:0,z:-95},{x:-470+scan*940,y:270,z:-95},{x:-470+scan*940,y:270,z:80},{x:-470+scan*940,y:0,z:80}],c)} fill={accent} fillOpacity=".1" stroke={accent} strokeWidth="2"/>
      <polyline points={projectedPoints([{x:-470+scan*940,y:0,z:-95},{x:-470+scan*940,y:270,z:-95}],c)} stroke={accent} strokeWidth="8" opacity=".4" filter={`url(#${id}-glow)`}/>
    </g>}
    {label&&<SvgMathText x="690" y="643" textAnchor="middle" fill={readableAccent(accent)} fontSize="25" letterSpacing="2">{label}</SvgMathText>}
  </svg>;
};

/** Canonical model-input renderer: same pixels for any fully occluded position.
 * No hidden-state shadow, trail, highlight or camera parallax is included here. */
export const Observation:React.FC<{id:string;position?:number;scan?:number}>=({id,position=3,scan=-1})=>{
  const visible=position<1.5||position>4.5;
  return <svg data-observation={id} viewBox="0 0 600 250" style={{display:'block',width:'100%',height:'100%'}}>
    <defs><linearGradient id={`${id}-wall`} x2="0" y2="1"><stop stopColor={T.wallFront}/><stop offset="1" stopColor={T.wallSide}/></linearGradient></defs>
    <rect width="600" height="250" rx={T.radius} fill={T.surface}/>
    {Array.from({length:6},(_,i)=><rect key={i} x={37+i*88} y="193" width="86" height="9" fill={T.elevated}/>)}
    <rect x="125" y="57" width="264" height="138" rx="4" fill={`url(#${id}-wall)`} stroke={T.wallLine}/>
    <path d="M125 102 H389 M125 148 H389 M169 58 V102 M257 58 V102 M345 58 V102 M213 102 V148 M301 102 V148 M169 148 V193 M257 148 V193 M345 148 V193" fill="none" stroke={T.border}/>
    {visible&&<g><circle cx={81+(position-1)*88} cy="165" r="24" fill={T.accent}/><circle cx={74+(position-1)*88} cy="157" r="6" fill={T.inverse} opacity=".7"/></g>}
    {scan>=0&&scan<=1&&<rect x="32" y={28+scan*190} width="536" height="2" fill={T.accent} opacity=".7"/>}
  </svg>;
};
