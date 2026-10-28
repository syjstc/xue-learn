import React, { useId } from "react";
import { THEME as T, tint } from "../theme.js";

/** Pure functions of a sampled progress or clock. No component here owns time,
 * so pause, export and reverse seeks reproduce the same pixels. */
const clamp = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
export const easeOutBack = (x: number, overshoot = 1.6) => {
  const t = clamp(x) - 1;
  return 1 + t * t * ((overshoot + 1) * t + overshoot);
};
export const easeOutExpo = (x: number) => {
  const t = clamp(x);
  return t >= 1 ? 1 : 1 - 2 ** (-10 * t);
};
export const easeInOut = (x: number) => {
  const t = clamp(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
/** Local progress of a sub-window inside one sampled transition. */
export const span = (x: number, start: number, end: number) => clamp((x - start) / Math.max(1e-6, end - start));
/** Pop-in scale: grows past full size, then settles. */
export const popScale = (x: number) => (clamp(x) <= 0 ? 0 : 0.55 + 0.45 * easeOutBack(x));

/** Group that scales around its own visual center. */
export function Pop({ x, y, amount, children, rise = 0 }: { x: number; y: number; amount: number; children: React.ReactNode; rise?: number }) {
  const scale = popScale(amount);
  if (scale >= 0.999 && !rise) return <g>{children}</g>;
  return <g transform={`translate(${x} ${y + (1 - clamp(amount)) * rise}) scale(${scale}) translate(${-x} ${-y})`}>{children}</g>;
}

/** Soft colored glow behind a focused object. */
export function GlowRect({ x, y, width, height, radius = 18, color = T.accent, amount }: {
  x: number; y: number; width: number; height: number; radius?: number; color?: string; amount: number;
}) {
  const id = useId().replace(/:/g, "");
  if (amount <= 0.001) return null;
  return <g aria-hidden="true" opacity={clamp(amount)}>
    <defs><filter id={`glow-${id}`} x="-40%" y="-60%" width="180%" height="220%"><feGaussianBlur stdDeviation="14"/></filter></defs>
    <rect x={x - 4} y={y + 8} width={width + 8} height={height} rx={radius + 4} fill={tint(color, 0.42)} filter={`url(#glow-${id})`}/>
  </g>;
}

/** Concentric rings expanding from a focused object on the real narration clock. */
export function Halo({ cx, cy, r, seconds, amount, color = T.accent, period = 2.4, rings = 2 }: {
  cx: number; cy: number; r: number; seconds?: number; amount: number; color?: string; period?: number; rings?: number;
}) {
  if (seconds === undefined || amount <= 0.001) return null;
  return <g aria-hidden="true" pointerEvents="none">
    {Array.from({ length: rings }, (_, i) => {
      const phase = (((seconds / period + i / rings) % 1) + 1) % 1;
      return <circle key={i} cx={cx} cy={cy} r={r + phase * r * 0.55} fill="none" stroke={color}
        strokeWidth={2.5 * (1 - phase) + 0.5} opacity={clamp(amount) * (1 - phase) * 0.55}/>;
    })}
  </g>;
}

/** A short radial burst that plays once while a focus transition arrives. */
export function Burst({ cx, cy, r, amount, color = T.accent, count = 10 }: {
  cx: number; cy: number; r: number; amount: number; color?: string; count?: number;
}) {
  const t = clamp(amount);
  if (t <= 0 || t >= 1) return null;
  const travel = easeOutExpo(t);
  return <g aria-hidden="true" pointerEvents="none" opacity={1 - t}>
    {Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + 0.3;
      const inner = r + travel * r * 0.35, outer = inner + 10 + 16 * (1 - t);
      return <line key={i} x1={cx + Math.cos(angle) * inner} y1={cy + Math.sin(angle) * inner}
        x2={cx + Math.cos(angle) * outer} y2={cy + Math.sin(angle) * outer}
        stroke={i % 2 ? T.caution : color} strokeWidth={3} strokeLinecap="round"/>;
    })}
  </g>;
}

/** Diagonal light sweep clipped to a rounded rectangle. */
export function Shine({ x, y, width, height, radius = 12, amount, opacity = 0.55 }: {
  x: number; y: number; width: number; height: number; radius?: number; amount: number; opacity?: number;
}) {
  const id = useId().replace(/:/g, "");
  const t = clamp(amount);
  if (t <= 0 || t >= 1) return null;
  const band = Math.max(60, width * 0.18);
  const left = x - band * 2 + (width + band * 3) * easeInOut(t);
  return <g aria-hidden="true" pointerEvents="none">
    <defs>
      <clipPath id={`shine-clip-${id}`}><rect x={x} y={y} width={width} height={height} rx={radius}/></clipPath>
      <linearGradient id={`shine-${id}`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#fff" stopOpacity="0"/>
        <stop offset=".5" stopColor="#fff" stopOpacity={opacity}/>
        <stop offset="1" stopColor="#fff" stopOpacity="0"/>
      </linearGradient>
    </defs>
    <g clipPath={`url(#shine-clip-${id})`}>
      <path d={`M${left} ${y + height} L${left + band * 0.6} ${y} H${left + band * 1.6} L${left + band} ${y + height}Z`} fill={`url(#shine-${id})`}/>
    </g>
  </g>;
}

/** Glowing particle with a fading tail travelling along a straight segment. */
export function Comet({ x1, y1, x2, y2, phase, color = T.accent, radius = 5, opacity = 1 }: {
  x1: number; y1: number; x2: number; y2: number; phase: number; color?: string; radius?: number; opacity?: number;
}) {
  if (opacity <= 0.001) return null;
  const t = ((phase % 1) + 1) % 1;
  const at = (p: number) => [x1 + (x2 - x1) * p, y1 + (y2 - y1) * p] as const;
  const fade = Math.min(1, t / 0.15, (1 - t) / 0.15);
  return <g aria-hidden="true" pointerEvents="none" opacity={clamp(opacity) * fade}>
    {[0.16, 0.11, 0.06].map((lag, i) => {
      const [x, y] = at(Math.max(0, t - lag));
      return <circle key={i} cx={x} cy={y} r={radius * (0.4 + i * 0.18)} fill={color} opacity={0.18 + i * 0.16}/>;
    })}
    <circle cx={at(t)[0]} cy={at(t)[1]} r={radius * 2.2} fill={tint(color, 0.22)}/>
    <circle cx={at(t)[0]} cy={at(t)[1]} r={radius} fill={color}/>
  </g>;
}

/** Clip-path wipe that reveals its children left to right without moving them. */
export function Wipe({ x, y, width, height, amount, children }: {
  x: number; y: number; width: number; height: number; amount: number; children: React.ReactNode;
}) {
  const id = useId().replace(/:/g, "");
  const t = clamp(amount);
  if (t >= 1) return <g>{children}</g>;
  return <g>
    <defs><clipPath id={`wipe-${id}`}><rect x={x} y={y} width={width * easeInOut(t)} height={height}/></clipPath></defs>
    <g clipPath={`url(#wipe-${id})`}>{children}</g>
  </g>;
}
