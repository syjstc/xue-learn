import React from 'react';
import {InlineMathText} from '../../markdown/inline-math-text.js';
import {StoryText} from './text.js';
import {ease, type LessonMotion} from './lesson-motion.js';
import type {RemotionTitleComponent, RemotionCompareComponent} from './types.js';
import {GlassDecor, GlassEmblem, glassMotion} from './glass-scene.js';
import './glass-title-compare.css';

export function GlassTitle({props, motion}: {props: RemotionTitleComponent['props']; motion: LessonMotion}) {
  const entrance = ease(motion.seconds / 1.1);
  const focused = props.keywords.some(item => motion.targets.includes(item.id));
  return <section className="rm-new-title rm-glass-title rm-glass-tone rm-glass-surface" data-animation-component="title.v1" data-tone="0">
    <GlassDecor seconds={motion.seconds}/>
    <div className="rm-glass-title-orbits" aria-hidden="true">
      <svg viewBox="0 0 600 650" fill="none">
        <g className="rm-glass-ambient-motion" style={{transform: `rotate(${motion.seconds * 3}deg)`, transformOrigin: '300px 320px'}}>
          <ellipse cx="300" cy="320" rx="260" ry="238" stroke="#c9685c" strokeOpacity=".14" strokeDasharray="2 14"/>
          <ellipse cx="300" cy="320" rx="207" ry="191" stroke="#c9685c" strokeOpacity=".13"/>
          <circle cx="560" cy="320" r="6" fill="#c9685c" opacity=".55"/>
          <circle cx="93" cy="320" r="4" fill="#5f9188" opacity=".6"/>
        </g>
        <path d="M128 548h345M128 548v-12m345 12v-12" stroke="#c9685c" strokeOpacity=".18"/>
        <circle cx={128 + ((motion.seconds * 25) % 345)} cy="548" r="4" fill="#c9685c" opacity=".5"/>
      </svg>
      <GlassEmblem seconds={motion.seconds} index={0} className="rm-glass-title-emblem"/>
      <div className="rm-glass-title-satellite rm-glass-tone" data-tone="1" style={{transform: `translateY(${Math.sin(motion.seconds * .6) * 9}px) rotate(-12deg)`}}><GlassEmblem seconds={motion.seconds} index={1}/></div>
      <div className="rm-glass-title-satellite rm-glass-title-satellite-gold rm-glass-tone" data-tone="2" style={{transform: `translateY(${Math.cos(motion.seconds * .6) * 8}px) rotate(10deg)`}}><GlassEmblem seconds={motion.seconds} index={2}/></div>
    </div>
    <div className="rm-glass-title-copy" style={{opacity: entrance, transform: `translateY(${(1 - entrance) * 34}px)`}}>
      {props.eyebrow && <div className="rm-glass-title-eyebrow"><span aria-hidden="true"/><InlineMathText text={props.eyebrow}/></div>}
      <h1><InlineMathText text={props.headline}/></h1>
      {props.subtitle && <p className="rm-glass-title-subtitle"><InlineMathText text={props.subtitle}/></p>}
      <div className="rm-new-keywords rm-glass-keywords">{props.keywords.map((item, index) => <div key={item.id} className="rm-glass-keyword rm-glass-tone" data-tone={index % 3} data-keyword-id={item.id} style={glassMotion(motion, [item.id], index + 1, focused)}><small aria-hidden="true">{String(index + 1).padStart(2, '0')}</small><span><InlineMathText text={item.label}/></span><i aria-hidden="true"/></div>)}</div>
    </div>
  </section>;
}

export function GlassCompare({props, motion}: {props: RemotionCompareComponent['props']; motion: LessonMotion}) {
  const sides = props.sides ?? [props.left, props.right];
  const focused = sides.some(side => [side.id, ...side.points.map(point => point.id)].some(id => motion.targets.includes(id)));
  return <section className={`rm-new-compare rm-glass-compare${sides.length > 2 ? ' rm-glass-compare-dense' : ''}`} data-animation-component="compare.v1" style={{gridTemplateColumns: `repeat(${Math.min(3, sides.length)}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.ceil(sides.length / 3)}, minmax(0, 1fr))`}}>
    {sides.map((side, index) => <article className="rm-glass-compare-side rm-glass-tone rm-glass-surface" key={side.id} data-tone={index % 3} data-comparison-side={side.id} style={glassMotion(motion, [side.id, ...side.points.map(point => point.id)], index, focused)}>
      <GlassDecor seconds={motion.seconds} index={index}/>
      <div className="rm-glass-compare-top"><span className="rm-glass-badge">{String.fromCharCode(65 + index)}</span><GlassEmblem seconds={motion.seconds} index={index}/></div>
      <h3 className="rm-glass-compare-title"><InlineMathText text={side.label}/></h3>
      <div className="rm-glass-compare-points">{side.points.map((point, pointIndex) => {
        const selected = motion.targets.includes(side.id) || motion.targets.includes(point.id);
        const revealed = motion.opacity(point.id) > 0 || motion.targets.includes(side.id);
        return <div className="rm-glass-compare-point" key={point.id} data-comparison-point={point.id} style={{opacity: revealed ? 1 : 0, '--point-focus': selected ? motion.progress : 0} as React.CSSProperties}><span aria-hidden="true">{String(pointIndex + 1).padStart(2, '0')}</span><p><StoryText text={point.text}/></p></div>;
      })}</div>
      <span className="rm-glass-compare-watermark" aria-hidden="true">{String.fromCharCode(65 + index)}</span>
      <div className="rm-glass-footline" aria-hidden="true"><span/>{sides.map((_, position) => <i key={position} data-current={position === index || undefined}/>)}</div>
    </article>)}
  </section>;
}
