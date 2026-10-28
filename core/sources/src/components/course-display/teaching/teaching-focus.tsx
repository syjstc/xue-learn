import React, {createContext, useContext, type ReactNode} from "react";
import type {MaterialTeachingSample} from "../../../../libs/domain/src/index.js";
import {THEME as T, tint} from "./theme.js";

const TeachingFocusContext = createContext<MaterialTeachingSample | undefined>(undefined);
export function TeachingFocusProvider({sample, children}: {sample?: MaterialTeachingSample; children: ReactNode}) {
  return <TeachingFocusContext.Provider value={sample}>{children}</TeachingFocusContext.Provider>;
}
/** These bounds belong to the artwork, never to authored content. A traced
 * outline settles into a steady pointer; it never moves or resizes the copy.
 * All motion comes from the accepted narration sample, including reverse seek. */
export function TeachingFocus({id, operations = [], x, y, width, height, radius = 12, color = T.accent, focus: suppliedFocus, progress: suppliedProgress, path}: {
  id: string; operations?: readonly string[]; x: number; y: number; width: number; height: number; radius?: number; color?: string;
  focus?: number; progress?: number; path?: string;
}) {
  const sample = useContext(TeachingFocusContext);
  const targets = sample?.focusTargets;
  const target = targets?.find(item => item.id === id);
  const specific = (targets?.length ?? 0) > 0;
  const operation = sample?.items.filter(item => operations.includes(item.id)).reduce((value, item) => Math.max(value, item.focus), 0) ?? 0;
  const focus = Math.max(0, Math.min(1, sample ? (specific ? target?.focus ?? 0 : operation) : suppliedFocus ?? 0));
  const amount = Math.max(0, Math.min(1, suppliedProgress ?? target?.progress ?? sample?.progress ?? focus));
  const arrival = amount * amount * (3 - 2 * amount);
  // Topmost cards reserve no outer margin. Keep their pointer inside the
  // existing bound instead of sending it beyond the stage crop. Negative
  // local coordinates (atoms, notes) still belong to a translated group.
  const pointerY = y >= 0 && y < 18 ? y + 9 : y - 8 - (1 - arrival) * 8;
  if (focus <= 0) return null;
  return <g data-teaching-focus={id} data-focus-progress={amount} data-focus-strength={focus} aria-hidden="true" pointerEvents="none" opacity={focus}>
    {path ? <path d={path} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - arrival}/> : <rect x={x} y={y} width={width} height={height} rx={radius} fill={tint(color, .035)} stroke={color} strokeWidth={2.4} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - arrival}/>}
    <path d={`M${x + Math.min(18, width / 4)} ${pointerY}l6 -7h-12Z`} fill={color} opacity={arrival}/>
  </g>;
}
