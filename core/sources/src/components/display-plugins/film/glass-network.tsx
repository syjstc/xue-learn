import React, {useId} from 'react';
import {InlineMathText} from '../../markdown/inline-math-text.js';
import type {RemotionConceptNetworkComponent} from './types.js';
import {ease, type LessonMotion} from './lesson-motion.js';
import {GLASS_COLORS, GlassDecor, GlassEmblem, glassMotion} from './glass-scene.js';
import './glass-network.css';

export function GlassNetwork({props, motion}: {props: RemotionConceptNetworkComponent['props']; motion: LessonMotion}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const {nodes, edges} = props;
  const dense = nodes.length > 5, grid = nodes.length > 8;
  const width = dense ? 202 : 264, height = dense ? 132 : 174;
  const positions = nodes.map((_, index) => grid
    ? {x: 172 + index % 3 * 285, y: 110 + Math.floor(index / 3) * 500 / Math.max(1, Math.ceil(nodes.length / 3) - 1)}
    : nodes.length === 1 ? {x: 450, y: 342}
    : {x: 450 + Math.cos(-Math.PI / 2 + index / nodes.length * Math.PI * 2) * 300, y: 342 + Math.sin(-Math.PI / 2 + index / nodes.length * Math.PI * 2) * 224});
  const selectedEdge = edges.find(edge => motion.targets.includes(edge.id) || motion.active?.action === 'connect' && motion.targets.includes(edge.from) && motion.targets.includes(edge.to));
  const selectedIndex = Math.max(0, nodes.findIndex(node => node.id === (selectedEdge?.to ?? motion.targets.at(-1))));
  const selectedNode = nodes[selectedIndex];
  const focused = nodes.some(node => motion.targets.includes(node.id)) || !!selectedEdge;
  const readable = nodes.some(node => Array.from(node.label).length > 16 || Array.from(node.detail ?? '').length > 45);
  return <section className={`rm-new-network rm-glass-network${dense ? ' rm-glass-network-dense' : ''}${readable ? ' rm-glass-network-readable' : ''}`} data-animation-component="concept-network.v1">
    <svg viewBox="0 0 1476 730" preserveAspectRatio="none" className="rm-network-edges rm-glass-network-links" fill="none" aria-hidden="true">
      <defs>{GLASS_COLORS.map((color, index) => <marker key={color} id={`${id}-arrow-${index}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1 8 5 1 9" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></marker>)}</defs>
      {!grid && <g className="rm-glass-network-orbit"><ellipse cx="450" cy="342" rx="340" ry="268" stroke="#c9685c" strokeOpacity=".11" strokeDasharray="2 13"/><ellipse cx="450" cy="342" rx="247" ry="176" stroke="#5f9188" strokeOpacity=".09"/><circle className="rm-glass-line-light" cx={450 + Math.cos(motion.seconds * .22) * 340} cy={342 + Math.sin(motion.seconds * .22) * 268} r="4" fill="#c9685c" opacity=".4"/></g>}
      {edges.map((edge, index) => {
        const from = nodes.findIndex(node => node.id === edge.from), to = nodes.findIndex(node => node.id === edge.to);
        if (from < 0 || to < 0) return null;
        const a = positions[from], b = positions[to], dx = b.x - a.x, dy = b.y - a.y;
        const inset = Math.min(dx ? width / 2 / Math.abs(dx) : Infinity, dy ? height / 2 / Math.abs(dy) : Infinity);
        // A self relation has its own loop; it never divides by a zero-length edge.
        const self = from === to;
        const start = self ? {x: a.x - width / 2, y: a.y} : {x: a.x + dx * inset, y: a.y + dy * inset};
        const end = self ? {x: b.x + width / 2, y: b.y} : {x: b.x - dx * inset, y: b.y - dy * inset};
        const d = self ? `M${start.x} ${start.y}C${start.x - 70} ${a.y - 150} ${end.x + 70} ${a.y - 150} ${end.x} ${end.y}` : `M${start.x} ${start.y}L${end.x} ${end.y}`;
        const active = selectedEdge?.id === edge.id || motion.targets.includes(edge.from) || motion.targets.includes(edge.to);
        const color = GLASS_COLORS[to % 3];
        const reveal = ease((motion.seconds - .25 - index * .1) / 1.25);
        const visible = motion.opacity(edge.from) > 0 && motion.opacity(edge.to) > 0 || selectedEdge?.id === edge.id;
        const travel = (motion.seconds * .26 + index * .19) % 1;
        return <g key={edge.id} opacity={visible ? 1 : 0} data-network-edge={edge.id}>
          <path d={d} stroke={color} strokeWidth={active ? 3 : 2} strokeOpacity={active ? .55 : .24} pathLength="100" strokeDasharray={`${reveal * 100} 100`} markerEnd={reveal === 1 ? `url(#${id}-arrow-${to % 3})` : undefined}/>
          <path className="rm-glass-line-light" d={d} stroke={color} strokeWidth={active ? 5 : 3} strokeOpacity={active ? .8 : .35} pathLength="100" strokeLinecap="round" strokeDasharray="6 94" strokeDashoffset={-travel * 100} opacity={reveal}/>
          {!self && <circle className="rm-glass-line-light" cx={start.x + (end.x - start.x) * travel} cy={start.y + (end.y - start.y) * travel} r={active ? 5.5 : 3.5} fill={color} opacity={reveal * (active ? .85 : .35)}/>}
        </g>;
      })}
    </svg>
    {!grid && nodes.length > 2 && <div className="rm-glass-network-center rm-glass-tone" data-tone="0" aria-hidden="true"><GlassEmblem seconds={motion.seconds}/></div>}
    {nodes.map((node, index) => {
      const active = motion.targets.includes(node.id) || selectedEdge?.from === node.id || selectedEdge?.to === node.id;
      const style = glassMotion(motion, selectedEdge && active ? [node.id, selectedEdge.id] : [node.id], index, focused);
      return <div className="rm-glass-network-position" key={node.id} style={{left: `${positions[index].x / 1476 * 100}%`, top: `${positions[index].y / 730 * 100}%`, width, height}}>
        <article className="rm-network-node rm-glass-network-node rm-glass-tone rm-glass-surface" data-tone={index % 3} data-network-node={node.id} data-long={Array.from(node.label).length > 12 || undefined} data-selected={active || undefined} style={style}>
          <GlassDecor seconds={motion.seconds} index={index}/>
          <div className="rm-glass-network-node-top"><span className="rm-glass-badge">{String(index + 1).padStart(2, '0')}</span><i aria-hidden="true"/></div>
          <h3><InlineMathText text={node.label}/></h3>
        </article>
      </div>;
    })}
    {selectedNode && <article className="rm-network-detail rm-glass-network-detail rm-glass-tone rm-glass-surface" data-tone={selectedIndex % 3}>
      <GlassDecor seconds={motion.seconds} index={selectedIndex}/>
      <div className="rm-glass-network-detail-top"><span className="rm-glass-kicker">{selectedEdge ? '关联' : '概念'}</span><span className="rm-glass-badge">{String(selectedIndex + 1).padStart(2, '0')}</span></div>
      <GlassEmblem seconds={motion.seconds} index={selectedIndex}/>
      <span className="rm-glass-rule" aria-hidden="true"/>
      <h3><InlineMathText text={selectedNode.label}/></h3>
      {selectedNode.detail && <p><InlineMathText text={selectedNode.detail}/></p>}
      {selectedEdge?.label && <div className="rm-glass-network-caption"><span aria-hidden="true">↗</span><InlineMathText text={selectedEdge.label}/></div>}
      <div className="rm-glass-footline" aria-hidden="true"><span/>{nodes.map((_, index) => <i key={index} data-current={index === selectedIndex || undefined}/>)}</div>
    </article>}
  </section>;
}
