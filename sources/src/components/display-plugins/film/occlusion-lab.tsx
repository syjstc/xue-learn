import {SvgMathText} from "../../markdown/svg-math-text.js";
import React from 'react';
import type {CompiledVideoTimelineV1} from './timeline.js';
import type {RemotionLessonSceneV1, RemotionOcclusionLabComponent} from "./types.js";
import {sampleOcclusionLab} from './occlusion-motion.js';
import {THEME as T, tint} from './theme.js';

// Preserve the existing classroom palette and teacher's reserved area. The
// visual upgrade comes from geometry and sampled motion, not new design tokens.
const C = {...T, accent: T.accentText, warm: T.cautionText};

/** Original vector scene: a continuous two-case experiment. Optical masks clip
 * the actor AND its glow/trail/shadow, so observation frames reveal no hidden
 * state. The scanning cutaway is explicitly labeled as a teaching view. */
export function OcclusionLab({props, scene, timeline, tick}: {props: RemotionOcclusionLabComponent['props']; scene: RemotionLessonSceneV1; timeline: CompiledVideoTimelineV1; tick: number}) {
  const s = sampleOcclusionLab(props, scene, timeline, tick);
  const prefix = `lab-${scene.id}`;
  const stage = props.stages[Math.max(0, s.stageIndex)];
  const cellWidth = 660 / props.cells;
  const x = (cell: number) => 40 + (cell - .5) * cellWidth;
  const wallX = x(props.wall.from) - cellWidth / 2;
  const wallWidth = (props.wall.to - props.wall.from + 1) * cellWidth;
  const cut = s.cutaway;
  const motion = Math.sin(Math.PI * s.moved);
  return <svg className="rm-occlusion-lab" viewBox="0 0 1784 778" role="img" aria-label={`${scene.title}：两个隐藏状态接受同一动作`} data-animation-component="occlusion-lab.v1" data-lab-stage={stage.id} data-lab-moved={s.moved} data-lab-cutaway={cut}>
    <defs>
      <radialGradient id={`${prefix}-aura`}><stop stopColor={C.accent} stopOpacity=".22"/><stop offset="1" stopColor={C.accent} stopOpacity="0"/></radialGradient>
      <radialGradient id={`${prefix}-orb`} cx="30%" cy="24%" r="80%"><stop stopColor={C.ink}/><stop offset=".28" stopColor={C.accent}/><stop offset="1" stopColor={C.stage}/></radialGradient>
      <linearGradient id={`${prefix}-floor`} x2="0" y2="1"><stop stopColor={C.surface}/><stop offset="1" stopColor={C.stage}/></linearGradient>
      <linearGradient id={`${prefix}-wall`} x2="0" y2="1"><stop stopColor={C.border}/><stop offset="1" stopColor={C.inset}/></linearGradient>
      <linearGradient id={`${prefix}-trail`}><stop stopColor={C.accent} stopOpacity="0"/><stop offset="1" stopColor={C.accent}/></linearGradient>
      <filter id={`${prefix}-glow`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="8"/></filter>
      <mask id={`${prefix}-occlusion`} maskUnits="userSpaceOnUse" x="0" y="0" width="780" height="550">
        <rect width="780" height="550" fill="white"/>
        <rect x={wallX} y="140" width={wallWidth} height="310" fill="black"/>
        <rect x={wallX} y="140" width={wallWidth * cut} height="310" fill="white"/>
      </mask>
    </defs>
    <ellipse cx="892" cy="398" rx="860" ry="420" fill={`url(#${prefix}-aura)`}/>
    <g opacity=".16" stroke={C.border} fill="none">
      {[0,1,2,3,4].map(i => <ellipse key={i} cx="892" cy="460" rx={400 + i * 145} ry={90 + i * 54}/>)}
    </g>
    <SvgMathText x="892" y="39" fill={C.accent} textAnchor="middle" fontSize="24" letterSpacing="7">OBSERVATION / STATE / PREDICTION</SvgMathText>
    <SvgMathText x="892" y="104" fill={C.ink} textAnchor="middle" fontSize="48" fontWeight="700">{stage.label}</SvgMathText>
    <g opacity={cut}>
      <rect x="743" y="128" width="298" height="37" rx="18.5" fill={tint(C.warm, .12)} stroke={tint(C.warm, .5)}/>
      <SvgMathText x="892" y="153" fill={C.warm} textAnchor="middle" fontSize="24">教学透视 · 非实际观测</SvgMathText>
    </g>
    {s.cases.map((item, index) => {
      const actorX = x(item.cell), initialX = x(item.initialCell);
      const cameraScale = 1 + .055 * cut + .012 * Math.sin(Math.PI * s.moved);
      const color = index === 0 ? C.accent : C.compare;
      return <g key={item.id} transform={`translate(${index === 0 ? 72 : 968} 174)`} data-lab-case={item.id} data-lab-cell={item.cell} data-lab-visible={item.visible}>
        <SvgMathText x="34" y="43" fontSize="26" fill={color} letterSpacing="2">{index === 0 ? 'A' : 'B'} / {item.label}</SvgMathText>
        <g transform={`translate(370 280) scale(${cameraScale}) skewY(${-3.2 * (1-cut)}) translate(-370 -280)`}>
          <path d="M18 340L78 270H694L754 340V381H18Z" fill={`url(#${prefix}-floor)`} stroke={C.border}/>
          <path d="M18 340H754V381H18Z" fill={C.inset} stroke={C.border}/>
          <path d="M18 340H754" stroke={color} strokeWidth="2" opacity=".7"/>
          {Array.from({length: props.cells}, (_, i) => <g key={i}>
            <path d={`M${x(i+1)} 330L${x(i+1) * .86 + 51} 277`} stroke={C.border} opacity=".5"/>
            <SvgMathText x={x(i+1)} y="369" textAnchor="middle" fontSize="24" fill={C.muted}>{String(i + 1).padStart(2, '0')}</SvgMathText>
          </g>)}
          {(cut > 0 || item.visible) && <g mask={`url(#${prefix}-occlusion)`}>
            <ellipse cx={actorX} cy="329" rx="43" ry="10" fill={C.accent} opacity=".3" filter={`url(#${prefix}-glow)`}/>
            <g opacity={motion}>
              <path d={`M${initialX} 276H${actorX}`} stroke={C.accent} strokeWidth="18" opacity=".5" filter={`url(#${prefix}-glow)`}/>
              <path d={`M${initialX} 276H${actorX}`} stroke={`url(#${prefix}-trail)`} strokeWidth="4"/>
              {Array.from({length: 16}, (_, j) => {
                const fraction = ((j * .173 + s.seconds * .9) % 1);
                return <circle key={j} cx={initialX + (actorX - initialX) * fraction} cy={276 + Math.sin(j * 2.4 + s.seconds * 4) * 22} r={1.5 + j % 3} fill={C.accent} opacity={fraction * .8}/>;
              })}
            </g>
            <circle cx={actorX} cy="276" r="43" fill={C.accent} opacity=".48" filter={`url(#${prefix}-glow)`}/>
            <circle cx={actorX} cy="276" r="31" fill={`url(#${prefix}-orb)`} stroke={tint(C.ink, .7)}/>
            <ellipse cx={actorX} cy="276" rx="48" ry="15" fill="none" stroke={C.accent} strokeWidth="1.5" transform={`rotate(${-24 + Math.sin(s.seconds * 1.4) * 9} ${actorX} 276)`}/>
            <ellipse cx={actorX} cy="276" rx="48" ry="15" fill="none" stroke={C.accent} opacity=".5" transform={`rotate(${62 + Math.sin(s.seconds) * 9} ${actorX} 276)`}/>
          </g>}
          <g>
            {/* Wipe a real occluding surface into its transparent wireframe. */}
            <path d={`M${wallX} 182l15 -14h${wallWidth}l-15 14Z`} fill={C.border} opacity={1 - .8 * cut}/>
            <rect x={wallX} y="182" width={wallWidth} height="155" fill="none" stroke={C.accent} strokeOpacity={.25 + .4 * cut}/>
            <rect x={wallX + wallWidth * cut} y="182" width={wallWidth * (1-cut)} height="155" fill={`url(#${prefix}-wall)`}/>
            {Array.from({length: props.wall.to - props.wall.from + 2}, (_, j) => <path key={j} d={`M${wallX + j * cellWidth} 182V337`} stroke={C.accent} strokeDasharray={cut > .99 ? '3 8' : undefined} opacity={.12 + cut * .25}/>)}
            <path d={`M${wallX} 182H${wallX + wallWidth}M${wallX} 337H${wallX + wallWidth}`} stroke={C.accent} opacity=".6"/>
            <g opacity={Math.sin(Math.PI * cut)}>
              <path d={`M${wallX + wallWidth * cut} 152V357`} stroke={C.accent} strokeWidth="15" filter={`url(#${prefix}-glow)`}/>
              <path d={`M${wallX + wallWidth * cut} 152V357`} stroke={C.ink} strokeWidth="3"/>
            </g>
          </g>
          {cut > 0 && <SvgMathText x={actorX} y="418" fontSize="26" textAnchor="middle" fill={C.accent} opacity={cut}>{Number(item.cell.toFixed(1))} 格</SvgMathText>}
          <g opacity={1-cut}>
            <circle cx="277" cy="425" r="5" fill={item.visible ? C.accent : C.muted}/>
            <SvgMathText x="294" y="433" fontSize="26" fill={item.visible ? C.accent : C.muted}>{item.visible ? '观测到目标' : '未观测到目标'}</SvgMathText>
          </g>
        </g>
      </g>;
    })}
    <path d="M892 229V584" stroke={C.border} strokeDasharray="2 10"/>
    <g opacity={s.moved > 0 ? 1 : cut}>
      <path d="M696 674H802M982 674H1088" stroke={C.accent} strokeWidth="2"/>
      <SvgMathText x="892" y="682" fill={C.ink} fontSize="28" textAnchor="middle">{props.moveBy > 0 ? '→' : '←'} {Math.abs(props.moveBy)} 格</SvgMathText>
      <SvgMathText x="892" y="720" fill={C.muted} fontSize="24" textAnchor="middle">两种状态 · 同一个动作</SvgMathText>
    </g>
  </svg>;
}
