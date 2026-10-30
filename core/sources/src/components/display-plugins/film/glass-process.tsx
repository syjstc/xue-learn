import React, {useId} from 'react';
import {InlineMathText} from '../../markdown/inline-math-text.js';
import type {RemotionProcessComponent} from './types.js';
import type {LessonMotion} from './lesson-motion.js';
import {GLASS_COLORS, GlassDecor, GlassEmblem, GlassHeading, glassMotion} from './glass-scene.js';
import './glass-process.css';

export function GlassProcess({props, motion}: {props: RemotionProcessComponent['props']; motion: LessonMotion}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const {steps, direction} = props;
  const columns = Math.min(4, Math.max(1, steps.length));
  const rows = Math.max(1, Math.ceil(steps.length / columns));
  const dense = rows > 1;
  const width = 1440 / columns - 46, height = dense ? 420 / rows * .73 : 302;
  const positions = steps.map((_, index) => {
    const row = Math.floor(index / columns), column = index % columns;
    return {x: (row % 2 ? columns - column - .5 : column + .5) * 1440 / columns, y: (row + .5) * 420 / rows};
  });
  const selectedIndex = Math.max(0, steps.findIndex(step => motion.targets.includes(step.id)));
  const selected = steps[selectedIndex];
  const focused = steps.some(step => motion.targets.includes(step.id));
  return <section className={`rm-new-process rm-glass-process${dense ? ' rm-glass-process-dense' : ''}`} data-animation-component="process.v1">
    {props.title && <GlassHeading title={props.title}/>}
    <div className="rm-glass-process-track">
      <svg viewBox="0 0 1440 420" preserveAspectRatio="none" className="rm-glass-process-links" aria-hidden="true">
        <defs>{GLASS_COLORS.map((color, index) => <marker key={color} id={`${id}-arrow-${index}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1 8 5 1 9" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/></marker>)}</defs>
        {steps.slice(1).map((step, index) => {
          const a = positions[index], b = positions[index + 1];
          const sameRow = Math.abs(a.y - b.y) < 1;
          const sign = b.x >= a.x ? 1 : -1;
          const start = {x: a.x + (sameRow ? sign * (width / 2 + 4) : 0), y: a.y + (sameRow ? 0 : height / 2 + 5)};
          const end = {x: b.x - (sameRow ? sign * (width / 2 + 8) : 0), y: b.y - (sameRow ? 0 : height / 2 + 8)};
          const color = GLASS_COLORS[(index + 1) % 3];
          const travel = (motion.seconds * .4 + index * .2) % 1;
          const d = `M${start.x} ${start.y}L${end.x} ${end.y}`;
          const visible = motion.opacity(steps[index].id) > 0 && motion.opacity(step.id) > 0;
          return <g key={step.id} opacity={visible ? 1 : 0} data-process-link={`${steps[index].id}/${step.id}`}>
            <path d={d} stroke={color} strokeOpacity=".3" strokeWidth="2" markerEnd={`url(#${id}-arrow-${(index + 1) % 3})`}/>
            <path className="rm-glass-line-light" d={d} stroke={color} strokeWidth="4" strokeOpacity=".6" strokeLinecap="round" pathLength="100" strokeDasharray="12 88" strokeDashoffset={-travel * 100}/>
            <circle className="rm-glass-line-light" cx={start.x + (end.x - start.x) * travel} cy={start.y + (end.y - start.y) * travel} r="4.5" fill={color}/>
          </g>;
        })}
        {direction === 'cycle' && steps.length > 1 && (() => {
          const first = positions[0], last = positions.at(-1)!;
          const d = rows === 1
            ? `M${last.x} ${last.y + height / 2 + 5}V394Q${last.x} 408 ${last.x - 20} 408H${first.x + 20}Q${first.x} 408 ${first.x} 390V${first.y + height / 2 + 7}`
            : `M${last.x - width / 2 - 4} ${last.y}H12Q3 ${last.y} 3 ${last.y - 15}V${first.y + 15}Q3 ${first.y} 15 ${first.y}H${first.x - width / 2 - 8}`;
          return <g className="rm-glass-cycle-return"><path d={d} stroke="#5f9188" strokeWidth="2" strokeOpacity=".3" markerEnd={`url(#${id}-arrow-1)`} fill="none"/><path className="rm-glass-line-light" d={d} fill="none" stroke="#5f9188" strokeWidth="3" strokeOpacity=".6" pathLength="100" strokeDasharray="8 92" strokeDashoffset={-motion.seconds * 13}/></g>;
        })()}
      </svg>
      {steps.map((step, index) => <div key={step.id} className="rm-glass-process-position" style={{left: `${positions[index].x / 1440 * 100}%`, top: `${positions[index].y / 420 * 100}%`, width: `${width / 1440 * 100}%`, height: `${height / 420 * 100}%`}}>
        <article className="rm-process-step rm-glass-process-node rm-glass-tone rm-glass-surface" data-tone={index % 3} data-process-step={step.id} data-long={Array.from(step.label).length > 12 || undefined} data-selected={focused && index === selectedIndex || undefined} style={glassMotion(motion, [step.id], index, focused)}>
          <GlassDecor seconds={motion.seconds} index={index}/>
          <span className="rm-glass-badge">{String(index + 1).padStart(2, '0')}</span>
          <GlassEmblem seconds={motion.seconds} index={index}/>
          <h3><InlineMathText text={step.label}/></h3>
          <span className="rm-glass-process-node-line" aria-hidden="true"/>
        </article>
      </div>)}
    </div>
    {selected && <article className="rm-process-detail rm-glass-process-detail rm-glass-tone rm-glass-surface" data-tone={selectedIndex % 3}>
      <GlassDecor seconds={motion.seconds} index={selectedIndex}/>
      <span className="rm-glass-process-detail-number" aria-hidden="true">{String(selectedIndex + 1).padStart(2, '0')}</span>
      <div className="rm-glass-process-detail-copy"><h3><InlineMathText text={selected.label}/></h3>{selected.detail && <p><InlineMathText text={selected.detail}/></p>}</div>
      <div className="rm-glass-process-dots" aria-hidden="true">{steps.map((step, index) => <i key={step.id} data-selected={index === selectedIndex || undefined}/>)}</div>
    </article>}
  </section>;
}
