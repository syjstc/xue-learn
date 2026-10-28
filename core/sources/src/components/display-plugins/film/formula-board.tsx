import {InlineMathText} from "../../markdown/inline-math-text.js";
import React, {useLayoutEffect, useRef, useState} from 'react';
import {MathLatex} from '../../markdown/math-latex.js';
import type {RemotionFormulaComponent, RemotionLessonSceneV1} from "./types.js";
import type {LessonMotion} from './lesson-motion.js';
import {StoryText} from './text.js';
import {wrapStoryMath} from './text.js';
import type {CompiledVideoTimelineV1} from './timeline.js';
import {sampleFormulaBoard} from './formula-board-sampling.js';

function FormulaFit({latex}: {latex: string}) {
  const host = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    let disposed = false;
    const measure = () => {
      if (disposed || !host.current || !content.current) return;
      setScale(Math.min(1, (host.current.clientWidth - 48) / Math.max(1, content.current.scrollWidth), (host.current.clientHeight - 36) / Math.max(1, content.current.scrollHeight)));
    };
    measure(); void document.fonts.ready.then(measure);
    const observer = new ResizeObserver(measure); if (host.current) observer.observe(host.current);
    return () => {disposed = true; observer.disconnect();};
  }, [latex]);
  return <div className="rm-formula-fit" ref={host} data-remotion-resource-status={scale * 49 < 22 ? 'error' : 'ready'}><div className="rm-formula-expression" ref={content} style={{transform: `translate(-50%, -50%) scale(${scale})`, visibility: scale * 49 < 22 ? 'hidden' : 'visible'}}><MathLatex latex={wrapStoryMath(latex, 32)} display/></div>{scale * 49 < 22 && <p className="rm-formula-unreadable">公式过长，请拆成更短的推导步骤。</p>}</div>;
}

export function FormulaBoard({props, motion, scene, timeline, tick}: {props: RemotionFormulaComponent['props']; motion: LessonMotion; scene: RemotionLessonSceneV1; timeline: CompiledVideoTimelineV1; tick: number}) {
  const {step, previousStep, progress} = sampleFormulaBoard(props, scene, timeline, tick);
  return <div className="rm-new-formula rm-formula-stepper">
    <div className="rm-formula-main rm-panel">
      <div className="rm-formula-step-label">{String(step + 1).padStart(2, '0')} / {String(props.equations.length).padStart(2, '0')}<span><InlineMathText text={props.equations[step].label}/></span></div>
      <div className="rm-formula-canvas" data-formula-step={props.equations[step].id}>{props.equations.map((equation, i) => <div key={equation.id} className="rm-equation-slide" aria-hidden={i !== step} style={{opacity: i === step ? progress : i === previousStep ? 1 - progress : 0, transform: `translateY(${i === step ? (1 - progress) * 16 : i === previousStep ? -progress * 10 : 16}px)`}}><FormulaFit latex={equation.latex}/></div>)}</div>
      <div className="rm-formula-steps">{props.equations.map((equation, i) => <span key={equation.id} className={i === step ? 'rm-formula-selected' : ''}>{String(i + 1).padStart(2, '0')}<small><InlineMathText text={equation.label}/></small></span>)}</div>
    </div>
    <div className="rm-formula-notes">{props.notes.map(note => <p key={note.id} style={{opacity: motion.opacity(note.id)}}><StoryText text={note.text}/></p>)}</div>
  </div>;
}
