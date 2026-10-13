import {SvgMathText} from "../../markdown/svg-math-text.js";
import {InlineMathText} from "../../markdown/inline-math-text.js";
import React from 'react';
import type {CompiledVideoTimelineV1} from './timeline.js';
import type {RemotionLessonSceneV1, RemotionEvaluationLabComponent} from "./types.js";
import {sampleEvaluationLab} from './evaluation-motion.js';
import {THEME as T, tint} from './theme.js';

const verdictColor = (verdict: string) => verdict==='pass' ? T.positive : verdict==='critical' ? T.accentText : T.cautionText;
const verdictLabel = (verdict: string) => verdict==='pass' ? '通过' : verdict==='critical' ? '关键失败' : '未通过';

/** Shared test IDs travel through two actual declared result streams. Scores
 * are derived from revealed outcomes; no numeric decoration or hidden answer. */
export function EvaluationLab({props,scene,timeline,tick}: {props:RemotionEvaluationLabComponent['props'];scene:RemotionLessonSceneV1;timeline:CompiledVideoTimelineV1;tick:number}) {
  const s=sampleEvaluationLab(props,scene,timeline,tick);
  const id=`eval-${scene.id}`;
  return <svg className="rm-evaluation-lab" viewBox="0 0 1516 778" role="img" aria-label={props.caption} data-animation-component="evaluation-lab.v1">
    <defs>
      <linearGradient id={`${id}-beam`}><stop stopColor={T.accent} stopOpacity="0"/><stop offset=".7" stopColor={T.accent} stopOpacity=".9"/><stop offset="1" stopColor={T.accentText}/></linearGradient>
      <radialGradient id={`${id}-core`}><stop stopColor={T.surfaceStrong}/><stop offset="1" stopColor={T.accentSoft}/></radialGradient>
      <filter id={`${id}-glow`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="7"/></filter>
    </defs>
    <SvgMathText x="40" y="55" fontSize="26" fill={T.muted}>{props.caption}</SvgMathText>
    <SvgMathText x="40" y="134" fontSize="32" fontWeight="700" fill={T.ink}>同一套测试</SvgMathText>
    <SvgMathText x="40" y="175" fontSize="22" fill={T.muted}>{props.cases.length} 个固定样例 · 同一判定规则</SvgMathText>
    <path d="M366 225H430V510H366M430 270H495M430 510H495" stroke={T.border} strokeWidth="3" fill="none"/>
    {props.cases.map((item,index)=> {
      const x=40+index%2*155,y=210+Math.floor(index/2)*65,selected=s.caseIndex===index;
      return <g key={item.id} transform={`translate(${x} ${y})`}>
        <rect width="140" height="52" rx="12" fill={selected?T.accentSoft:T.surface} stroke={selected?T.accent:T.border} strokeWidth={selected?2:1}/>
        <foreignObject x="10" y="5" width="120" height="43"><div style={{fontSize:20,lineHeight:1.08,height:'100%',display:'flex',alignItems:'center',justifyContent:'center',textAlign:'center',color:selected?T.accentText:T.ink}}><InlineMathText text={item.label}/></div></foreignObject>
      </g>;
    })}
    {s.runs.map((run,index)=> {
      const y=270+index*240, color=index===0?T.compareText:T.accentText;
      const tracing=s.inspecting && s.caseIndex<run.completed && s.focusProgress<1;
      const packet=run.running?run.packet:s.focusProgress, packetX=490+packet*605;
      return <g key={run.id} data-evaluation-run={run.id} data-evaluation-completed={run.completed} data-evaluation-passed={run.passed} data-evaluation-critical={run.critical}>
        <SvgMathText x="504" y={y-99} fill={color} fontSize="30" fontWeight="700">{run.label}</SvgMathText>
        <path d={`M494 ${y}H1110`} stroke={T.border} strokeWidth="3"/>
        <path d={`M494 ${y}H1110`} stroke={color} strokeWidth="3" strokeDasharray="6 12" strokeDashoffset={-run.progress*500} opacity={run.progress>0?.45:0}/>
        <g transform={`translate(800 ${y})`}>
          <circle r="64" fill={`url(#${id}-core)`} stroke={color} strokeWidth="2"/>
          <circle r="81" fill="none" stroke={color} strokeWidth="2" strokeDasharray="70 30 4 30" strokeDashoffset={-run.progress*500} opacity=".6"/>
          <circle r="96" fill="none" stroke={color} strokeDasharray="2 11" strokeDashoffset={run.progress*260} opacity=".3"/>
          <path d="M-24 -22H24M-24 0H24M-24 22H10" stroke={color} strokeWidth="5" strokeLinecap="round"/>
        </g>
        {(run.running || tracing) && <g>
          <path d={`M${Math.max(494,packetX-85)} ${y}H${packetX}`} stroke={color} strokeWidth="17" opacity=".25" filter={`url(#${id}-glow)`}/>
          <rect x={packetX-19} y={y-19} width="38" height="38" rx="9" fill={color} transform={`rotate(${packet*180} ${packetX} ${y})`}/>
          <circle cx={packetX} cy={y} r="27" fill="none" stroke={color} opacity=".35"/>
        </g>}
        <SvgMathText x="1180" y={y-4} fontSize="67" fontWeight="760" fill={color}>{run.progress>0?`${run.percent}%`:'—'}</SvgMathText>
        <SvgMathText x="1185" y={y+37} fontSize="23" fill={T.muted}>{run.progress>0?`${run.passed} / ${props.cases.length} 通过`:'等待评测'}</SvgMathText>
        <g transform={`translate(502 ${y+66})`}>
          {run.outcomes.map((outcome,i)=> {
            const revealed=i<run.completed;
            return <g key={outcome.caseId} transform={`translate(${i*49} 0)`}>
              <rect width="37" height="31" rx="8" fill={revealed?tint(verdictColor(outcome.verdict),i===s.caseIndex?.25:.15):T.inset} stroke={revealed?verdictColor(outcome.verdict):T.border} strokeWidth={i===s.caseIndex?3:1}/>
              <SvgMathText x="18.5" y="23" fontSize="22" textAnchor="middle" fill={revealed?verdictColor(outcome.verdict):T.muted}>{revealed?(outcome.verdict==='pass'?'✓':outcome.verdict==='critical'?'!':'×'):'·'}</SvgMathText>
            </g>;
          })}
        </g>
        {run.critical>0 && <g transform={`translate(1172 ${y+62})`}>
          <rect width="257" height="43" rx="12" fill={T.accentSoft} stroke={T.accent}/>
          <SvgMathText x="128" y="29" fontSize="23" textAnchor="middle" fill={T.accentText}>! 关键失败 {run.critical} 项</SvgMathText>
        </g>}
      </g>;
    })}
    <path d="M40 645H1450" stroke={T.border}/>
    {s.caseIndex>=0 ? <g>
      <SvgMathText x="40" y="692" fontSize="24" fill={T.ink} fontWeight="700">{props.cases[s.caseIndex].label}</SvgMathText>
      {s.runs.map((run,i)=> {
        const outcome=run.outcomes[s.caseIndex], revealed=s.caseIndex<run.completed;
        return <g key={run.id} transform={`translate(${350+i*560} 668)`}>
          <SvgMathText y="25" fill={revealed?verdictColor(outcome.verdict):T.muted} fontSize="24">{run.label} · {revealed?verdictLabel(outcome.verdict):'待判定'}</SvgMathText>
          <foreignObject y="41" width="510" height="65"><div style={{fontSize:23,lineHeight:1.35,color:T.ink}}><InlineMathText text={revealed?outcome.note:'等待样例经过评测通道'}/></div></foreignObject>
        </g>;
      })}
    </g> : <SvgMathText x="40" y="698" fontSize="26" fill={T.muted}>逐题检查，再汇总；关键失败独立保留。</SvgMathText>}
  </svg>;
}
