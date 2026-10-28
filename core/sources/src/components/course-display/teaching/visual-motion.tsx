import React, {type ReactNode} from "react";
import {visualTeachingOperations, type VisualTeachingProps, type MaterialTeachingSample} from "../../../../libs/domain/src/index.js";
import {Diagram, TextBox, T, tint, ease, clamp} from "./templates/primitives.js";
import {hasInlineMath} from "../../markdown/inline-math-text.js";

export {T, tint, ease, clamp};
export const colors = [T.accent, T.compare, T.positive, T.caution, T.tertiary, T.accentText, T.compareText];
export const number = (value: number) => {
  const exact = String(value);
  if (exact.length <= 12) return exact;
  const rounded = Number(value.toPrecision(6));
  return `${rounded === value ? "" : "≈"}${rounded}`;
};
export const mix = (from: number, to: number, progress: number) => from + (to - from) * progress;
export type VisualMotion = {reveal: (id: string) => number; focus: (id: string) => number; seconds: number};
export type VisualArtProps = {props: VisualTeachingProps; motion: VisualMotion};

/** Production uses the accepted cue sample. The frame fallback is only for the
 * native three-phase adapter and gallery. No wall clock or CSS animation. */
export function visualMotion(props: VisualTeachingProps, frame: number, fps: number, sample?: MaterialTeachingSample, seconds?: number): VisualMotion {
  const operations = visualTeachingOperations(props), time = frame / fps;
  const index = (id: string) => operations.findIndex(item => item.id === id);
  return {
    reveal: id => ease(sample ? sample.items.find(item => item.id === id)?.reveal ?? 0 : clamp((time - index(id) * 12 / operations.length) / (9 / operations.length))),
    focus: id => sample ? sample.items.find(item => item.id === id)?.focus ?? 0 : Math.floor(time * operations.length / 12) === index(id) ? 1 : 0,
    seconds: seconds ?? time,
  };
}
export function Canvas({id, children}: {id: string; children: ReactNode}) {
  return <div data-visual-primitive={id} style={{width: "100%", height: "100%"}}><Diagram label={id}>{children}</Diagram></div>;
}
export function Copy({x, y, width = 180, height = 52, text, size = 22, color = T.ink, align = "center"}: {
  x: number; y: number; width?: number; height?: number; text: string; size?: number; color?: string; align?: "start" | "center" | "end";
}) {
  // Choose type from the uncued text and its permanent lane. Neither opacity,
  // focus, progress nor viewport participates, so cues cannot reflow this copy.
  const units = [...text].reduce((sum, char) => sum + (/\s/.test(char) ? .35 : /[\x20-\x7e]/.test(char) ? .65 : 1), 0);
  let fitted = size;
  while (!hasInlineMath(text) && fitted > 12 && Math.ceil(units / Math.max(1, Math.floor((width - 8) / fitted))) * fitted * 1.3 > height) fitted--;
  return <TextBox x={x} y={y} width={width} height={height} text={text} size={fitted} lineHeight={fitted * 1.3} color={color} align={align}/>;
}
export function Stroke({d, amount, color = T.accent, width = 4, dashed = false}: {d: string; amount: number; color?: string; width?: number; dashed?: boolean}) {
  return <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" pathLength={1}
    strokeDasharray={dashed ? ".012 .018" : 1} strokeDashoffset={dashed ? 0 : 1 - amount} opacity={dashed ? amount : 1}/>;
}
export function Dot({x, y, color = T.accent, focus = 0, radius = 9}: {x: number; y: number; color?: string; focus?: number; radius?: number}) {
  return <g><circle cx={x} cy={y} r={radius + 10 + focus * 5} fill={tint(color, .12 + focus * .08)}/><circle cx={x} cy={y} r={radius} fill={color}/><circle cx={x - radius * .28} cy={y - radius * .28} r={radius * .24} fill={T.surface}/></g>;
}
export function Caption({text, opacity = 1}: {text: string; opacity?: number}) {
  return <g opacity={opacity}><Copy x={90} y={446} width={820} height={44} text={text} size={19} color={T.muted}/></g>;
}
