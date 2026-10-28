import {TeachingFocus} from "./teaching-focus.js";
import React from "react";
import {Label, Arrow} from "./templates/primitives.js";
import {Canvas, Copy, Stroke, Dot, colors, number, mix, T, tint, type VisualArtProps} from "./visual-motion.js";

export function VisualDiagrams({props, motion: m}: VisualArtProps) {
  const r = m.reveal;
  switch (props.templateId) {
    case "visual-timeline": {
      const c = props.content, lo = c.events[0]!.at, hi = c.events[c.events.length - 1]!.at;
      const x = (at: number) => 90 + (at - lo) / (hi - lo) * 820;
      return <Canvas id={props.templateId}>
        <path d="M90 248H910" stroke={T.border} strokeWidth={3}/>
        {c.events.map((item, i) => {
          const columns = Math.ceil(c.events.length / 2);
          const id = `event-${i + 1}`, a = r(id), px = x(item.at), col = 30 + Math.floor(i / 2) * 940 / columns, w = 920 / columns;
          const above = i % 2 === 0, by = above ? 35 : 320, end = above ? 217 : 318;
          return <g key={id} data-visual-item={id}>
            <Stroke d={`M${i ? x(c.events[i - 1]!.at) : 90} 248H${px}`} amount={a} color={colors[i]}/>
            <g opacity={a}>
              <Stroke d={`M${px} 248V${above ? 206 : 288}L${col + w / 2} ${end}`} amount={a} color={colors[i]} width={2}/>
              <Dot x={px} y={248} color={colors[i]} focus={m.focus(id)}/>
              <TeachingFocus id={id} operations={[id]} x={col - 3} y={by - 3} width={w + 6} height={175} color={colors[i]}/>
              <Copy x={col} y={by} width={w} height={35} text={`${number(item.at)}${c.unit}`} color={colors[i]} size={21}/>
              <Copy x={col} y={by + 37} width={w} height={56} text={item.label} size={21}/>
              <Copy x={col + 3} y={by + 96} width={w - 6} height={75} text={item.detail} size={17} color={T.muted}/>
            </g>
          </g>;
        })}
      </Canvas>;
    }
    case "visual-cycle": {
      const c = props.content, n = c.nodes.length, angle = (i: number) => -Math.PI / 2 + i * Math.PI * 2 / n;
      const point = (i: number, radius = 157) => ({x: 327 + Math.cos(angle(i)) * radius, y: 252 + Math.sin(angle(i)) * radius});
      return <Canvas id={props.templateId}>
        <circle cx={327} cy={252} r={157} fill="none" stroke={T.border} strokeWidth={2} strokeDasharray="4 10"/>
        <circle cx={327} cy={252} r={86} fill={T.surface} stroke={T.border}/>
        <Copy x={257} y={210} width={140} height={84} text={c.center} size={25}/>
        {c.nodes.map((node, i) => {
          const id = `path-${i + 1}`, a = r(id), p = point(i), q = point((i + 1) % n), theta = angle(i) + a * Math.PI * 2 / n;
          const label = point(i, 211), row = 50 + i * 64;
          return <g key={id} data-visual-item={id}>
            <Stroke d={`M${p.x} ${p.y}A157 157 0 0 1 ${q.x} ${q.y}`} amount={a} color={colors[i]} width={8}/>
            <circle cx={p.x} cy={p.y} r={21} fill={T.surface} stroke={colors[i]} strokeWidth={3}/>
            <Label x={p.x} y={p.y + 7} size={18}>{i + 1}</Label>
            <Copy x={label.x - 77} y={label.y - 28} width={154} height={56} text={node.label} size={19}/>
            <g opacity={a}><Dot x={327 + Math.cos(theta) * 157} y={252 + Math.sin(theta) * 157} color={colors[i]} radius={6}/></g>
            <g opacity={a}>
              <TeachingFocus id={id} operations={[id]} x={632} y={row - 3} width={316} height={60} color={colors[i]}/>
              <rect x={635} y={row} width={310} height={54} rx={12} fill={tint(colors[i]!, .07 + m.focus(id) * .09)}/>
              <Label x={657} y={row + 34} size={18} color={colors[i]}>{i + 1}</Label>
              <Copy x={685} y={row + 3} width={246} height={48} text={node.process} size={21} align="start"/>
            </g>
          </g>;
        })}
      </Canvas>;
    }
    case "visual-decision": {
      const c = props.content, n = c.branches.length;
      return <Canvas id={props.templateId}>
        <g opacity={r("question")}><TeachingFocus id="question" operations={["question"]} x={369} y={69} width={262} height={100}/><path d="M500 38L676 119L500 200L324 119Z" fill={tint(T.accent, .09)} stroke={T.accent} strokeWidth={3}/>
          <Copy x={376} y={74} width={248} height={90} text={c.question} size={23}/></g>
        {c.branches.map((branch, i) => {
          const id = `branch-${i + 1}`, a = r(id), w = 850 / n, x = 75 + w * (i + .5), color = colors[i]!;
          return <g key={id} data-visual-item={id}>
            <Stroke d={`M500 200C500 248 ${x} 220 ${x} 279`} amount={a} color={color} width={4}/>
            <g opacity={a}>
              <Dot x={x} y={279} color={color} radius={7} focus={m.focus(id)}/>
              <TeachingFocus id={id} operations={[id]} x={x - w / 2 + 5} y={290} width={w - 10} height={166} color={color}/>
              <Copy x={x - w / 2 + 10} y={292} width={w - 20} height={56} text={branch.condition} size={20} color={color}/>
              <rect x={x - w / 2 + 10} y={358} width={w - 20} height={92} rx={20} fill={T.surface} stroke={color} strokeWidth={2}/>
              <Copy x={x - w / 2 + 22} y={367} width={w - 44} height={74} text={branch.outcome} size={22}/>
            </g>
          </g>;
        })}
      </Canvas>;
    }
    case "visual-network": {
      const c = props.content, n = c.nodes.length, point = (i: number) => ({x: 330 + Math.cos(-Math.PI / 2 + i * Math.PI * 2 / n) * 174, y: 245 + Math.sin(-Math.PI / 2 + i * Math.PI * 2 / n) * 174});
      const byId = (id: string) => point(c.nodes.findIndex(node => node.id === id));
      return <Canvas id={props.templateId}>
        {c.links.map((link, i) => {
          const id = `link-${i + 1}`, a = r(id), p = byId(link.from), q = byId(link.to), color = colors[i % colors.length]!;
          // The perpendicular offset separates reciprocal directed edges.
          const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy), cx = (p.x + q.x) / 2 - dy / len * 44, cy = (p.y + q.y) / 2 + dx / len * 44;
          const at = (t: number) => ({x: (1-t)**2*p.x+2*(1-t)*t*cx+t*t*q.x, y: (1-t)**2*p.y+2*(1-t)*t*cy+t*t*q.y});
          const head = at(.82), tail = at(.76), particle = at(.15 + a * .7);
          return <g key={id} data-visual-item={id}>
            <Stroke d={`M${p.x} ${p.y}Q${cx} ${cy} ${q.x} ${q.y}`} amount={a} color={color} width={3 + m.focus(id) * 2}/>
            <Arrow x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} color={color} width={3} opacity={a}/>
            <g opacity={a}><Dot x={particle.x} y={particle.y} color={color} radius={5}/></g>
            <g opacity={a}>
              <TeachingFocus id={id} operations={[id]} x={621} y={29+i*53} width={338} height={52} color={color}/>
              <rect x={624} y={32+i*53} width={332} height={46} rx={10} fill={tint(color, .08 + .08*m.focus(id))}/>
              <Copy x={639} y={34+i*53} width={300} height={42} text={link.label} size={20} align="start"/>
            </g>
          </g>;
        })}
        {c.nodes.map((node, i) => {const p = point(i); return <g key={node.id} opacity={r("nodes")}>
          <TeachingFocus id={`node-${i + 1}`} operations={["nodes"]} x={p.x - 53} y={p.y - 53} width={106} height={106} radius={53} color={colors[i]}/>
          <circle cx={p.x} cy={p.y} r={48} fill={T.surface} stroke={colors[i]} strokeWidth={3}/>
          <Copy x={p.x-44} y={p.y-35} width={88} height={70} text={node.label} size={18}/>
        </g>;})}
      </Canvas>;
    }
    case "visual-hierarchy": {
      const c = props.content, n = c.groups.length, width = 864 / n;
      return <Canvas id={props.templateId}>
        <g opacity={r("root")}><TeachingFocus id="root" operations={["root"]} x={347} y={23} width={306} height={78}/><rect x={350} y={26} width={300} height={72} rx={36} fill={T.accent}/><Copy x={367} y={35} width={266} height={54} text={c.root} size={26} color={T.surface}/></g>
        {c.groups.map((group, i) => {
          const id = `group-${i + 1}`, a = r(id), x = 68 + width * (i + .5), color = colors[i]!;
          return <g key={id} data-visual-item={id}>
            <Stroke d={`M500 98V123H${x}V164`} amount={a} color={color} width={3}/>
            <g opacity={a}>
              <TeachingFocus id={id} operations={[id]} x={x-width/2+8} y={165} width={width-16} height={64} color={color}/>
              <rect x={x-width/2+12} y={168} width={width-24} height={58} rx={14} fill={tint(color,.15)} stroke={color} strokeWidth={2}/>
              <Copy x={x-width/2+22} y={173} width={width-44} height={48} text={group.label} size={21}/>
              {group.members.map((label, j) => <g key={j}>
                <TeachingFocus id={`member-${i + 1}-${j + 1}`} x={x-width/2+48} y={240+j*64} width={width-63} height={57} color={color}/>
                <path d={`M${x-width/2+28} 226V${268+j*64}H${x-width/2+44}`} fill="none" stroke={color} strokeWidth={2}/>
                <circle cx={x-width/2+44} cy={268+j*64} r={4} fill={color}/>
                <Copy x={x-width/2+54} y={240+j*64} width={width-74} height={56} text={label} size={19} align="start"/>
              </g>)}
            </g>
          </g>;
        })}
      </Canvas>;
    }
    case "visual-interval": {
      const c = props.content, x = (v: number) => 95 + (v-c.min)/(c.max-c.min)*810, a = r("interval");
      return <Canvas id={props.templateId}>
        <Copy x={240} y={12} width={520} height={60} text={c.label} size={27}/>
        <g opacity={r("range")}><TeachingFocus id="range" operations={["range"]} x={90} y={249} width={820} height={62}/><path d="M95 261H905" stroke={T.muted} strokeWidth={3}/>
          {Array.from({length: 6}, (_, i) => <g key={i}><path d={`M${95+i*162} 253v16`} stroke={T.muted} strokeWidth={2}/><Label x={95+i*162} y={298} size={18}>{number(mix(c.min,c.max,i/5))}</Label></g>)}
        </g>
        <rect x={x(c.low)} y={236} width={(x(c.high)-x(c.low))*a} height={49} rx={12} fill={tint(T.positive,.25)}/>
        <g opacity={a}><TeachingFocus id="interval" operations={["interval"]} x={296} y={91} width={408} height={56} color={T.positive}/><Copy x={300} y={95} width={400} height={48} text={`[${number(c.low)}, ${number(c.high)}] ${c.unit}`} color={T.positive} size={27}/></g>
        {c.points.map((point,i) => {
          const id=`point-${i+1}`, p=r(id), col=40+i*920/c.points.length, w=900/c.points.length, px=mix(95,x(point.value),p), inRange=point.value>=c.low&&point.value<=c.high, color=inRange?T.positive:T.caution;
          return <g key={id} opacity={p} data-visual-item={id}>
            <path d={`M${px} 246l-10 -20h20Z`} fill={color}/>
            <path d={`M${px} 280V319L${col+w/2} 350`} fill="none" stroke={color} strokeWidth={2}/>
            <TeachingFocus id={id} operations={[id]} x={col - 3} y={346} width={w + 6} height={98} color={color}/>
            <Copy x={col} y={349} width={w} height={52} text={point.label} size={21}/>
            <Copy x={col} y={401} width={w} height={40} text={`${number(point.value)}${c.unit}`} color={color} size={23}/>
          </g>;
        })}
      </Canvas>;
    }
    default: return null;
  }
}
