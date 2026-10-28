import React from 'react';
import {InlineMathText} from '../../markdown/inline-math-text.js';
import type {RemotionConceptNetworkComponent, RemotionProcessComponent, RemotionTitleComponent, RemotionCardsComponent, RemotionCompareComponent} from './types.js';
import {StoryText} from './text.js';
import {ease,type LessonMotion} from './lesson-motion.js';
import {THEME as T} from './theme.js';
function Network({props, motion}: {props: RemotionConceptNetworkComponent['props']; motion: LessonMotion}) {
  const {nodes, edges} = props;
  const position = (i: number) => ({x: 500 + Math.cos(-Math.PI / 2 + i / nodes.length * Math.PI * 2) * 315, y: 344 + Math.sin(-Math.PI / 2 + i / nodes.length * Math.PI * 2) * 235});
  const selectedEdge = edges.find(e => motion.targets.includes(e.id) || motion.active?.action === 'connect' && motion.targets.includes(e.from) && motion.targets.includes(e.to));
  const node = nodes.find(n => n.id === (selectedEdge?.to ?? motion.targets.at(-1))) ?? nodes[0];
  return <div className="rm-new-network" data-animation-component="concept-network.v1">
    <svg viewBox="0 0 1516 750" className="rm-network-edges"><defs><marker id="rm-network-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill={T.accent}/></marker></defs>
      <circle cx="500" cy="344" r="287" fill="none" stroke={T.border} strokeDasharray="2 13"/>
      {edges.map(edge => {const a = position(nodes.findIndex(n => n.id === edge.from)), b = position(nodes.findIndex(n => n.id === edge.to)); const selected = selectedEdge?.id === edge.id; const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy); const inset = 85 / length; const start = {x: a.x + dx * inset, y: a.y + dy * inset}, end = {x: b.x - dx * inset, y: b.y - dy * inset}; return <g key={edge.id}>
        <path d={`M${start.x} ${start.y}L${end.x} ${end.y}`} stroke={selected ? T.accent : T.border} strokeWidth={selected ? 5 : 2} markerEnd="url(#rm-network-arrow)"/>
        {selected && <circle r="7" cx={start.x + (end.x - start.x) * motion.progress} cy={start.y + (end.y - start.y) * motion.progress} fill={T.accent}/>}
      </g>;})}
    </svg>
    {nodes.map((item, i) => {const p = position(i); return <div className="rm-network-node rm-panel" key={item.id} style={{left: p.x - 127, top: p.y - 90, opacity: motion.opacity(item.id), transform: `scale(${.92 + motion.entrance * .08})`, borderColor: motion.targets.includes(item.id) ? T.accent : T.border}}><small>{String(i + 1).padStart(2, '0')}</small><h3><InlineMathText text={item.label}/></h3></div>;})}
    <div className="rm-network-detail rm-panel"><div className="rm-kicker">{selectedEdge ? '关联' : '概念'}</div><h3><InlineMathText text={node.label}/></h3><p><InlineMathText text={node.detail}/></p>{selectedEdge?.label && <div className="rm-edge-caption"><InlineMathText text={selectedEdge.label}/></div>}</div>
  </div>;
}

function Process({props, motion}: {props: RemotionProcessComponent['props']; motion: LessonMotion}) {
  const {steps, direction} = props;
  const columns = Math.min(4, steps.length), rows = Math.ceil(steps.length / columns);
  const selected = steps.find(step => step.id === motion.targets.at(-1)) ?? steps[0];
  return <div className={`rm-new-process${props.title?' rm-new-process-titled':''}`} data-animation-component="process.v1">
    {props.title&&<h2 className="rm-semantic-title"><InlineMathText text={props.title}/></h2>}
    <div className="rm-process-steps" style={{gridTemplateColumns: `repeat(${columns}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)`}}>{steps.map((step, i) => <div className="rm-process-step rm-panel" key={step.id} style={{opacity: motion.opacity(step.id), transform: `translateY(${(1 - ease((motion.seconds - i * .09) / .75)) * 24}px)`}}><small>{String(i + 1).padStart(2, '0')}</small><h3><InlineMathText text={step.label}/></h3>{i < steps.length - 1 && <span className="rm-process-arrow">→</span>}</div>)}</div>
    {direction === 'cycle' && <svg className="rm-process-loop" viewBox="0 0 1450 45"><path d="M1390 0Q1390 28 1300 28H120Q45 28 45 0" fill="none" stroke={T.compare} strokeWidth="3" strokeDasharray="8 8" strokeDashoffset={-motion.seconds * 14}/></svg>}
    <div className="rm-process-detail rm-panel"><span>{String(steps.indexOf(selected) + 1).padStart(2, '0')}</span><div><h3><InlineMathText text={selected.label}/></h3><p><InlineMathText text={selected.detail}/></p></div></div>
  </div>;
}

export function GeneralBoard({component,motion}:{component:RemotionConceptNetworkComponent|RemotionProcessComponent|RemotionTitleComponent|RemotionCardsComponent|RemotionCompareComponent;motion:LessonMotion}) {
  let body:React.ReactNode;
  if(component.type==='concept-network.v1') return <Network props={component.props} motion={motion}/>;
  if(component.type==='process.v1') return <Process props={component.props} motion={motion}/>;
  if (component.type === 'title.v1') body = <div className="rm-new-title"><div className="rm-title-halo" style={{transform: `rotate(${motion.seconds * 3}deg)`}}/><div className="rm-kicker"><InlineMathText text={component.props.eyebrow}/></div><h1><InlineMathText text={component.props.headline}/></h1><p><InlineMathText text={component.props.subtitle}/></p><div className="rm-new-keywords">{component.props.keywords.map(item => <span key={item.id} style={{opacity: motion.opacity(item.id)}}><InlineMathText text={item.label}/></span>)}</div></div>;
  else if (component.type === 'cards.v1') body = <div className={`rm-new-cards rm-new-cards-${component.props.layout} ${component.props.items.length > 3 ? 'rm-new-cards-dense' : ''}`} style={{gridTemplateColumns: `repeat(${component.props.layout === 'stack' ? 1 : Math.min(3, component.props.items.length)}, 1fr)`, gridTemplateRows: `repeat(${component.props.layout === 'stack' ? component.props.items.length : Math.ceil(component.props.items.length / 3)}, 1fr)`}}>{component.props.items.map((item, i) => <div className="rm-native-card rm-panel" key={item.id} style={{opacity: motion.opacity(item.id), transform: `translateY(${(1 - ease((motion.seconds - i * .11) / .9)) * 24}px)`}}><small>{String(i + 1).padStart(2, '0')}</small><h3><InlineMathText text={item.label}/></h3><p><InlineMathText text={item.detail}/></p></div>)}</div>;
  else if (component.type === 'compare.v1') body = <div className="rm-new-compare" style={{gridTemplateColumns:`repeat(${Math.min(3,component.props.sides?.length??2)},minmax(0,1fr))`}}>{(component.props.sides??[component.props.left, component.props.right]).map((side, i) => <div className="rm-panel" key={side.id} style={{borderTopColor: i ? T.compare : T.accent, opacity: !motion.targets.length || motion.targets.includes(side.id) || side.points.some(p => motion.targets.includes(p.id)) ? 1 : .5}}><small>{String.fromCharCode(65+i)}</small><h3><InlineMathText text={side.label}/></h3>{side.points.map(point => <p key={point.id} style={{opacity: motion.targets.includes(side.id) ? 1 : motion.opacity(point.id)}}><StoryText text={point.text}/></p>)}</div>)}</div>;

  return component.type==='cards.v1'&&component.props.title?<section className="rm-semantic-cards"><h2 className="rm-semantic-title"><InlineMathText text={component.props.title}/></h2><div>{body}</div></section>:body;
}
