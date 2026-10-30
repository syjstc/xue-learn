import React, {useRef, type CSSProperties, type ReactNode} from 'react';
import {InlineMathText} from '../../markdown/inline-math-text.js';
import {usePresentationFit} from '../../course-display/presentation-stage.js';
import {ease, type LessonMotion} from './lesson-motion.js';
import {GlassSculpture} from './glass-sculpture.js';
import './glass-scene.css';

export const GLASS_COLORS = ['#c9685c', '#5f9188', '#c19a55'] as const;

export function GlassFit({children}: {children: ReactNode}) {
  const viewport = useRef<HTMLDivElement>(null), canvas = useRef<HTMLDivElement>(null);
  usePresentationFit(viewport, canvas, true);
  return <div ref={viewport} className="rm-glass-fit"><div ref={canvas} className="rm-glass-fit-canvas">{children}</div></div>;
}

export function glassSeconds(clock: {timeSeconds: number; ticksPerSecond: number}, id: string, timeline: readonly {startTick: number; targets: readonly string[]}[], presentation?: {startTick?: number}) {
  const first = timeline.find(cue => cue.targets.some(target => target === id || target.startsWith(`${id}/`)));
  return Math.max(0, clock.timeSeconds - (first ? first.startTick / clock.ticksPerSecond : (presentation?.startTick ?? 0) / 48_000));
}

/** Only the supplied presentation clock drives light, focus and entrance. */
export function glassMotion(motion: LessonMotion, ids: readonly string[], index = 0, hasFocus = false): CSSProperties {
  const entrance = ease((motion.seconds - index * .13) / .95);
  const selected = ids.some(id => motion.targets.includes(id));
  const previous = ids.some(id => motion.previous?.targetIds.includes(id));
  const focus = selected ? motion.progress : previous ? 1 - motion.progress : 0;
  const visible = !ids.length || ids.some(id => motion.opacity(id) > 0);
  return {
    '--glass-focus': focus,
    '--glass-breathe': .5 + Math.sin(motion.seconds * 1.6 + index) * .5,
    opacity: visible ? entrance * (hasFocus ? .78 + .22 * focus : 1) : 0,
    transform: `translateY(${(1 - entrance) * 32 - focus * 5}px)`,
  } as CSSProperties;
}

export function GlassDecor({seconds, index = 0}: {seconds: number; index?: number}) {
  const phase = seconds * .32 + index * 1.5;
  return <div className="rm-glass-decor" aria-hidden="true">
    <span className="rm-glass-aura" style={{transform: `translate(${Math.sin(phase) * 24}px, ${Math.cos(phase) * 17}px)`}}/>
    <span className="rm-glass-sweep" style={{transform: `translateX(${-110 + ((seconds / 7 + index * .16) % 1) * 220}%) rotate(-23deg)`}}/>
    <svg className="rm-glass-specks" viewBox="0 0 240 180" fill="none">
      <path d="M194 24v14m-7-7h14M40 128v10m-5-5h10" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx={80 + Math.sin(phase) * 9} cy={40 + Math.cos(phase) * 7} r="3" fill="currentColor"/>
      <circle cx={200 + Math.cos(phase) * 8} cy={124 + Math.sin(phase) * 10} r="2.5" fill="currentColor"/>
    </svg>
  </div>;
}

export function GlassHeading({title, aside}: {title: string; aside?: ReactNode}) {
  return <header className="rm-glass-heading"><i aria-hidden="true"/><h2><InlineMathText text={title}/></h2><span aria-hidden="true"/>{aside}</header>;
}

export function GlassEmblem({seconds, index = 0, className = ''}: {seconds: number; index?: number; className?: string}) {
  return <div className={`rm-glass-emblem ${className}`} aria-hidden="true"><GlassSculpture seconds={seconds} index={index}/></div>;
}
