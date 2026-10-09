import React, { useId, type ReactNode } from "react";
import { MathLatex } from "../../../markdown/math-latex.js";
import { InlineMathText, hasInlineMath } from "../../../markdown/inline-math-text.js";
import { FixedMathText } from "../../../markdown/fixed-math-text.js";
import { SvgMathText } from "../../../markdown/svg-math-text.js";
import { THEME as T, tint } from "../theme.js";
export { T, tint };
export type SceneProps = { frame: number; fps: number };
export const clamp = (x: number) => Math.max(0, Math.min(1, x));
export const ease = (x: number) => {
  const t = clamp(x);
  return t * t * (3 - 2 * t);
};
export const progress = (frame: number, fps: number, start = 0, duration = 2) =>
  ease((frame / fps - start) / duration);
export function Diagram({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      viewBox="0 0 1000 500"
      role="img"
      aria-label={label}
      className="rt-diagram"
    >
      <defs>
        <pattern
          id={`grid-${id}`}
          width="40"
          height="40"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="1" r="1" fill={T.border} />
        </pattern>
      </defs>
      <rect width="1000" height="500" fill={`url(#grid-${id})`} opacity=".5" />
      {children}
    </svg>
  );
}
export function Label({
  x,
  y,
  children,
  size = 22,
  color = T.ink,
  anchor = "middle",
  weight = 600,
}: {
  x: number;
  y: number;
  children: ReactNode;
  size?: number;
  color?: string;
  anchor?: "start" | "middle" | "end";
  weight?: number;
}) {
  return (
    <SvgMathText
      x={x}
      y={y}
      textAnchor={anchor}
      fontSize={size}
      fontWeight={weight}
      fill={color}
      style={{ fontFamily: "inherit" }}
    >
      {children}
    </SvgMathText>
  );
}
/** Fixed text clearance uses the browser's native wrapping. The authored copy,
 * box and type are constant across cues; animation only moves its parent. */
export function TextBox({
  x, y, width, height, text, size = 22, lineHeight = size * 1.25,
  color = T.ink, weight = 600, align = "center",
}: {
  x: number; y: number; width: number; height: number; text: string;
  size?: number; lineHeight?: number; color?: string; weight?: number;
  align?: "start" | "center" | "end";
}) {
  return <foreignObject x={x} y={y} width={width} height={height} data-template-text-box="true">
    <FixedMathText contentKey={JSON.stringify([text,width,height,size,lineHeight,weight])} enabled={hasInlineMath(text)}
      style={{fontFamily:"inherit",fontSize:size,fontWeight:weight,lineHeight:`${lineHeight}px`,color,textAlign:align,whiteSpace:"pre-wrap",overflowWrap:"anywhere",lineBreak:"auto"}}>
      <InlineMathText text={text}/>
    </FixedMathText>
  </foreignObject>;
}
export function Formula({
  x,
  y,
  width = 400,
  height = 90,
  latex,
  size = 30,
}: {
  x: number;
  y: number;
  width?: number;
  height?: number;
  latex: string;
  size?: number;
}) {
  return (
    <foreignObject x={x} y={y} width={width} height={height}>
      <div className="rt-formula" style={{ fontSize: size, width: "100%", height: "100%" }}>
        <FixedMathText contentKey={JSON.stringify([latex,width,height,size])} enabled nowrap style={{textAlign:"center"}}>
        <MathLatex latex={latex} display className="rt-math" />
        </FixedMathText>
      </div>
    </foreignObject>
  );
}
export function Arrow({
  x1,
  y1,
  x2,
  y2,
  color = T.accent,
  width = 4,
  opacity = 1,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: string;
  width?: number;
  opacity?: number;
}) {
  const angle = Math.atan2(y2 - y1, x2 - x1),
    size = 12;
  return (
    <g opacity={opacity}>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
      />
      <path
        d={`M${x2 - size * Math.cos(angle - 0.5)},${y2 - size * Math.sin(angle - 0.5)} L${x2},${y2} L${x2 - size * Math.cos(angle + 0.5)},${y2 - size * Math.sin(angle + 0.5)}`}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}
export function Card({
  x,
  y,
  width = 220,
  height = 110,
  label,
  sub,
  color = T.accent,
  opacity = 1,
  fitLabel = false,
  labelSize = 20,
}: {
  x: number;
  y: number;
  width?: number;
  height?: number;
  label: string;
  sub?: string;
  color?: string;
  opacity?: number;
  fitLabel?: boolean;
  labelSize?: number;
}) {
  return (
    <g opacity={opacity}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx="18"
        fill={T.surface}
        stroke={tint(color, 0.4)}
        strokeWidth="2"
      />
      <rect
        x={x + 20}
        y={y + 22}
        width="5"
        height={height - 44}
        rx="2"
        fill={color}
      />
      {fitLabel ? <TextBox x={x + 34} y={y + 8} width={width - 44} height={height - 16} text={label} size={labelSize} lineHeight={labelSize + 4}/> : <Label
        x={x + width / 2 + 5}
        y={y + height / 2 + (sub ? -6 : 8)}
        size={23}
      >
        {label}
      </Label>}
      {sub && (
        <Label
          x={x + width / 2 + 5}
          y={y + height / 2 + 28}
          size={16}
          color={T.muted}
          weight={400}
        >
          {sub}
        </Label>
      )}
    </g>
  );
}
