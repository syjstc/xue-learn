import {TeachingFocus} from "./teaching-focus.js";
import React from "react";
import {Label} from "./templates/primitives.js";
import {Canvas, Copy, Dot, Caption, colors, number, mix, T, tint, type VisualArtProps} from "./visual-motion.js";

export function VisualQuantities({props, motion: m}: VisualArtProps) {
  const r = m.reveal;
  switch (props.templateId) {
    case "visual-funnel": {
      const c = props.content, initial = c.stages[0]!.value, height = 345/c.stages.length;
      return <Canvas id={props.templateId}>
        {c.stages.map((item, i) => {
          const id=`stage-${i+1}`, a=r(id), y=52+i*height, w=440*item.value/initial, prior=i?440*c.stages[i-1]!.value/initial:w, color=colors[i]!;
          return <g key={id} data-visual-item={id}>
            {i>0&&<path d={`M${360-prior/2} ${y-8}L${360-w/2} ${y+12}H${360+w/2}L${360+prior/2} ${y-8}`} fill={tint(color,.14)} opacity={a}/>}
            <path d={`M${360-w/2} ${y+12}H${360+w/2}V${y+height-10}H${360-w/2}Z`} fill={tint(color,.28+.35*m.focus(id))} stroke={color} strokeWidth={2} opacity={a}/>
            <g opacity={a}>
              <Label x={360} y={y+height/2+9} size={26}>{number(item.value)}</Label>
              <TeachingFocus id={id} operations={[id]} x={636} y={y - 4} width={300} height={76} color={color}/>
              <Copy x={642} y={y} width={288} height={46} text={item.label} size={24} align="start"/>
              <Copy x={642} y={y+40} width={288} height={30} text={`${number(item.value/initial*100)}% · ${c.unit}`} size={19} color={T.muted} align="start"/>
              {Array.from({length: 5},(_,j)=><circle key={j} cx={360+(j-2)*Math.min(w/8,28)} cy={y+12+(height-27)*a} r={3} fill={color} opacity={item.value>0&&a<1?.8:0}/>)}
            </g>
          </g>;
        })}
        <Caption text={`同一群体 · 共同起点 ${number(initial)}${c.unit}`}/>
      </Canvas>;
    }
    case "visual-balance": {
      const c=props.content, totals=[c.left,c.right].map(side=>side.items.reduce((sum,item)=>sum+item.value,0)), a=r("left"), b=r("right"), current=[totals[0]!*a,totals[1]!*b];
      const tilt=(current[1]!-current[0]!)/Math.max(1,...totals)*55;
      return <Canvas id={props.templateId}>
        <path d="M500 214L432 430H568Z" fill={T.elevated} stroke={T.border} strokeWidth={3}/>
        <rect x={403} y={429} width={194} height={12} rx={6} fill={T.muted}/>
        <line x1={229} y1={173-tilt} x2={771} y2={173+tilt} stroke={T.accent} strokeWidth={13} strokeLinecap="round"/>
        <Dot x={500} y={173} radius={16}/>
        {[c.left,c.right].map((side,i)=>{
          const x=i?771:229, y=173+(i?tilt:-tilt), reveal=i?b:a, color=colors[i]!;
          return <g key={i} data-visual-item={i?"right":"left"}>
            <TeachingFocus id={i ? "right" : "left"} operations={[i ? "right" : "left"]} x={x - 155} y={8} width={310} height={106} color={color}/>
            <Copy x={x-150} y={12} width={300} height={50} text={side.label} size={25}/>
            <g opacity={reveal}>
              <Copy x={x-140} y={64} width={280} height={46} text={`${number(totals[i]!)}${c.unit}`} size={30} color={color}/>
              <path d={`M${x} ${y}L${x-100} ${y+126}H${x+100}Z`} fill="none" stroke={color} strokeWidth={3}/>
              <path d={`M${x-110} ${y+126}Q${x} ${y+186} ${x+110} ${y+126}Z`} fill={tint(color,.25)} stroke={color} strokeWidth={3}/>
              {side.items.map((item,j)=><g key={j} transform={`translate(0,${-(1-reveal)*65})`}>
                <TeachingFocus id={`${i ? "right" : "left"}-item-${j + 1}`} x={x-85+j*55} y={y+87} width={55} height={43} color={color}/>
                <rect x={x-82+j*55} y={y+91} width={49} height={35} rx={7} fill={color}/>
                <Label x={x-58+j*55} y={y+115} size={Math.min(14, 62/number(item.value).length)} color={T.surface}>{number(item.value)}</Label>
              </g>)}
              <Copy x={x-174} y={394} width={348} height={44} text={side.items.map(item=>`${item.label}：${number(item.value)}`).join("\n")} size={18} color={T.muted}/>
            </g>
          </g>;
        })}
        <TeachingFocus id="difference" operations={["difference"]} x={220} y={443} width={560} height={49}/>
        <Caption text={`${number(totals[0]!)} − ${number(totals[1]!)} = ${number(totals[0]!-totals[1]!)}${c.unit}`} opacity={r("difference")}/>
      </Canvas>;
    }
    case "visual-matrix": {
      const c=props.content, w=710/c.columns.length, h=315/c.rows.length;
      return <Canvas id={props.templateId}>
        {c.columns.map((label,i)=><Copy key={i} x={223+i*w} y={20} width={w-6} height={57} text={label} size={23}/>)}
        {c.rows.map((row,i)=>{
          const id=`row-${i+1}`, a=r(id);
          return <g key={id} data-visual-item={id}>
            <TeachingFocus id={id} operations={[id]} x={20} y={85+i*h} width={922} height={h-1}/>
            <Copy x={22} y={88+i*h} width={185} height={h-5} text={row.label} size={22}/>
            {row.values.map((value,j)=><g key={j}>
              <TeachingFocus id={`cell-${i + 1}-${j + 1}`} x={222+j*w} y={85+i*h} width={w-2} height={h-2}/>
              <rect x={225+j*w} y={88+i*h} width={w-8} height={h-8} rx={12} fill={T.surface} stroke={T.border}/>
              <rect x={225+j*w} y={88+i*h} width={w-8} height={h-8} rx={12} fill={tint(T.accent,.1+.7*value/c.max)} opacity={a}/>
              <g opacity={a}><Label x={225+(j+.5)*w-4} y={88+(i+.5)*h+5} size={27}>{number(value)}</Label></g>
            </g>)}
            <rect x={219+a*710} y={88+i*h} width={4} height={h-8} rx={2} fill={T.accent} opacity={a>0&&a<1?1:0}/>
          </g>;
        })}
        <Caption text={`共同刻度 0 — ${number(c.max)}${c.unit}`}/>
      </Canvas>;
    }
    case "visual-proportion": {
      const c=props.content, total=c.parts.reduce((sum,x)=>sum+x.value,0), radius=147, length=2*Math.PI*radius;
      let offset=0, shown=0;
      return <Canvas id={props.templateId}>
        <circle cx={316} cy={244} r={radius} stroke={T.border} strokeWidth={56} fill="none"/>
        {c.parts.map((part,i)=>{
          const id=`part-${i+1}`, a=r(id), share=part.value/total, start=offset, color=colors[i]!;
          offset+=share; shown+=part.value*a;
          return <g key={id} data-visual-item={id}>
            <circle cx={316} cy={244} r={radius} fill="none" stroke={color} strokeWidth={56} strokeDasharray={`${length*share*a} ${length}`} strokeDashoffset={-length*start} transform="rotate(-90 316 244)"/>
            <g opacity={a}>
              <TeachingFocus id={id} operations={[id]} x={588} y={30+i*76} width={340} height={76} color={color}/>
              <rect x={592} y={44+i*76} width={12} height={48} rx={6} fill={color}/>
              <Copy x={619} y={33+i*76} width={305} height={42} text={part.label} size={23} align="start"/>
              <Copy x={619} y={72+i*76} width={305} height={32} text={`${number(part.value)}${c.unit} · ${number(share*100)}%`} size={19} color={T.muted} align="start"/>
            </g>
          </g>;
        })}
        <Copy x={212} y={158} width={208} height={72} text={c.whole} size={23}/>
        <Copy x={212} y={237} width={208} height={58} text={number(total)} size={40}/>
        <Copy x={212} y={295} width={208} height={36} text={c.unit} size={19} color={T.muted}/>
        <Caption text={`已解释份额 ${number(shown/total*100)}% · 整体 = 各份额之和`}/>
      </Canvas>;
    }
    case "visual-counter": {
      const c=props.content, a=r("change"), current=mix(c.from,c.to,a), radius=179, arc=Math.PI*radius;
      const angle=Math.PI*(1-a), px=500+Math.cos(angle)*radius, py=281-Math.sin(angle)*radius;
      return <Canvas id={props.templateId}>
        <TeachingFocus id="baseline" operations={["baseline"]} x={218} y={175} width={564} height={108}/>
        <TeachingFocus id="change" operations={["change"]} x={px - 17} y={py - 17} width={34} height={34} radius={17}/>
        <TeachingFocus id="result" operations={["result"]} x={218} y={348} width={564} height={70}/>
        <Copy x={230} y={10} width={540} height={61} text={c.label} size={30}/>
        <g opacity={r("baseline")}>
          <path d="M321 281A179 179 0 0 1 679 281" fill="none" stroke={T.border} strokeWidth={20} strokeLinecap="round"/>
          <path d="M321 281A179 179 0 0 1 679 281" fill="none" stroke={T.accent} strokeWidth={20} strokeLinecap="round" strokeDasharray={`${arc*a} ${arc}`}/>
          <Dot x={px} y={py} radius={10}/>
          <foreignObject x={220} y={175} width={560} height={105}>
            <div data-visual-counter-value={current} style={{fontSize:72,fontWeight:750,textAlign:"center",color:T.ink,fontVariantNumeric:"tabular-nums",lineHeight:"105px",fontFamily:"inherit"}}>{number(current)}</div>
          </foreignObject>
          <Copy x={410} y={282} width={180} height={42} text={c.unit} size={22} color={T.muted}/>
          <Label x={255} y={315} size={22}>{number(c.from)}</Label><Label x={745} y={315} size={22}>{number(c.to)}</Label>
        </g>
        <g opacity={r("result")}><Copy x={220} y={350} width={560} height={65} text={`Δ ${c.to>=c.from?"+":""}${number(c.to-c.from)}${c.unit}`} size={33} color={T.accent}/></g>
        <Caption text={c.context}/>
      </Canvas>;
    }
    case "visual-ranking": {
      const c=props.content, a=r("change"), max=Math.max(1,...c.items.flatMap(x=>[x.before,x.after])), h=335/c.items.length;
      const rank=(key:"before"|"after")=>c.items.map((item,i)=>({i,value:item[key]})).sort((a,b)=>b.value-a.value||a.i-b.i).map(x=>x.i);
      const before=rank("before"), after=rank("after");
      return <Canvas id={props.templateId}>
        <Copy x={60} y={15} width={400} height={48} text={c.before} size={23}/>
        <Copy x={540} y={15} width={400} height={48} text={c.after} size={23} color={T.accent}/>
        <path d="M480 39H519l-9 -7m9 7l-9 7" fill="none" stroke={T.accent} strokeWidth={3}/>
        <path d="M260 83V424" stroke={T.border} strokeWidth={2}/>
        {c.items.map((item,i)=>{
          const y=85+mix(before.indexOf(i),after.indexOf(i),a)*h, value=mix(item.before,item.after,a), color=colors[i]!;
          return <g key={i} opacity={r("before")} data-ranking-object={item.label} data-ranking-value={value} transform={`translate(0 ${y})`}>
            <TeachingFocus id={`item-${i + 1}`} operations={["before", "change", "after"]} x={33} y={-3} width={Math.min(916, 280 + 560*value/max)} height={h-4} color={color}/>
            <Copy x={38} y={0} width={198} height={h-10} text={item.label} size={22} align="end"/>
            <rect x={260} y={8} width={560*value/max} height={h-25} rx={9} fill={color}/>
            <Label x={282+560*value/max} y={h/2+2} size={24} anchor="start">{number(value)}</Label>
          </g>;
        })}
        <Caption text={`共同量纲：${c.unit} · 同一对象保持颜色与身份`}/>
      </Canvas>;
    }
    default: return null;
  }
}
