import type { SubjectRef } from "../../formal-expression-core/src/index.js";

export type StretchRole =
  | "paren-left"
  | "paren-right"
  | "bracket-left"
  | "bracket-right"
  | "brace-left"
  | "brace-right"
  | "integral"
  | "arrow-left"
  | "arrow-right"
  | "frac-rule"
  | "radical"
  | "vinculum"
  | "cdot"
  | "times"
  | "circ"
  | "prime";

export type MotionPrimitive = {
  id: string;
  subject?: SubjectRef;
  /** Left edge in scene coordinates. */
  x: number;
  /** Baseline y in scene coordinates (down is positive). */
  y: number;
  width: number;
  /** Distance above the baseline. */
  height: number;
  /** Distance below the baseline. */
  depth: number;
  opacity: number;
  em: number;
  italic: boolean;
  text: string;
  role?: StretchRole;
  /** Stretch parameter: delimiter/integral/radical total span, or rule width. */
  extent: number;
  /** Board row layout id when this glyph sits on a stacked derivation line. */
  rowKey?: string;
};

export type MotionHitRegion = {
  subject: SubjectRef;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MotionScene = {
  width: number;
  height: number;
  primitives: MotionPrimitive[];
  hits: MotionHitRegion[];
};

export type MotionAlign = "start" | "center" | "end";

export type MotionLayoutOptions = {
  em?: number;
  padding?: number;
};
