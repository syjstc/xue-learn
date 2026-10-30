import React, {type CSSProperties} from 'react';
import {InlineMathText} from '../../markdown/inline-math-text.js';
import {ease, type LessonMotion} from './lesson-motion.js';
import type {RemotionCardsComponent} from './types.js';
import './concept-cards.css';
import {GlassSculpture} from './glass-sculpture.js';


export function ConceptCards({props, motion}: {props: RemotionCardsComponent['props']; motion: LessonMotion}) {
  const {items, layout, title} = props;
  const dense = items.length > 3;
  const focused = items.some(item => motion.targets.includes(item.id));
  return <section className={`rm-concept-board${title ? ' rm-concept-board-titled' : ''}`} data-animation-component="cards.v1">
    {title && <header className="rm-concept-heading"><span aria-hidden="true"/><h2 className="rm-semantic-title"><InlineMathText text={title}/></h2><i aria-hidden="true"/></header>}
    <div className={`rm-new-cards rm-new-cards-${layout} rm-concept-cards${dense ? ' rm-new-cards-dense' : ''}`} style={{gridTemplateColumns: `repeat(${layout === 'stack' ? 1 : Math.min(3, items.length)}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout === 'stack' ? items.length : Math.ceil(items.length / 3)}, minmax(0, 1fr))`}}>
      {items.map((item, index) => {
        const enter = ease((motion.seconds - index * .14) / 1.05);
        const selected = motion.targets.includes(item.id);
        const wasSelected = motion.previous?.targetIds.includes(item.id) ?? false;
        const focus = selected ? motion.progress : wasSelected ? 1 - motion.progress : 0;
        const visible = motion.opacity(item.id) > 0;
        // No wall-clock animations: pausing and reverse seeking reproduce every effect.
        const style = {
          '--card-focus': focus,
          '--card-sheen-x': `${-80 + ease((motion.seconds - index * .14) / 2.4) * 220}%`,
          opacity: visible ? enter * (focused ? .74 + focus * .26 : 1) : 0,
          transform: `translateY(${(1 - enter) * 40 - focus * 7}px) scale(${.965 + enter * .035})`,
        } as CSSProperties;
        return <article key={item.id} className="rm-native-card rm-concept-card" data-tone={index % 3} data-card-id={item.id} data-card-focus={selected || undefined} style={style}>
          <div className="rm-concept-card-surface">
            <div className="rm-card-aura" aria-hidden="true"/>
            <div className="rm-card-sheen" aria-hidden="true"/>
            <div className="rm-card-topline"><small>{String(index + 1).padStart(2, '0')}</small><span className="rm-card-spark" aria-hidden="true">✧</span></div>
            <div className="rm-card-art"><span className="rm-card-watermark" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><GlassSculpture index={index} seconds={motion.seconds}/></div>
            <div className="rm-card-copy"><span className="rm-card-rule" aria-hidden="true"/><h3><InlineMathText text={item.label}/></h3>{item.detail && <p><InlineMathText text={item.detail}/></p>}</div>
            <div className="rm-card-footer" aria-hidden="true"><span/>{items.map((_, position) => <i key={position} data-current={position === index || undefined}/>)}</div>
          </div>
        </article>;
      })}
    </div>
  </section>;
}
