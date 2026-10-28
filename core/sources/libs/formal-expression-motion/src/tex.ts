/**
 * TeX math layout constants (Computer Modern / KaTeX Main-Regular).
 *
 * Source of truth:
 * - Knuth, *The TeXbook*, Appendix G (box/glue math lists, 8 styles, scripts, fractions)
 * - KaTeX `fontMetrics` for CM σ / ξ values already used by the KaTeX renderer
 *
 * OpenType MATH is the same model encoded in a font table (axisHeight,
 * fraction shifts, delimiter variants + extenders). We implement Appendix G
 * placement with CM numbers first; stretchy marks are parameterized SVG
 * paths so tween can lerp `extent` without swapping Size glyphs.
 *
 * Styles: D display, T text, S script, SS scriptscript. Cramped variants
 * (under radicals, denominators) use the same size with tighter superscripts.
 */
export type MathStyle = "D" | "T" | "S" | "SS";

/** σ / ξ parameters in em, text-size column of CM. */
export const CM = {
  xHeight: 0.431,
  axisHeight: 0.25,
  defaultRuleThickness: 0.04,
  num1: 0.677,
  num2: 0.394,
  num3: 0.444,
  denom1: 0.686,
  denom2: 0.345,
  sup1: 0.413,
  sup2: 0.363,
  sup3: 0.289,
  sub1: 0.15,
  sub2: 0.247,
  supDrop: 0.386,
  subDrop: 0.05,
  delim1: 2.39,
  delim2: 1.01,
  bigOpSpacing1: 0.111,
  bigOpSpacing2: 0.167,
  bigOpSpacing3: 0.2,
  bigOpSpacing4: 0.6,
  bigOpSpacing5: 0.1,
} as const;

export function styleScale(style: MathStyle): number {
  if (style === "S") return 0.7;
  if (style === "SS") return 0.5;
  return 1;
}

export function scriptStyle(style: MathStyle): MathStyle {
  if (style === "D" || style === "T") return "S";
  return "SS";
}

export function emOf(style: MathStyle, textEm: number): number {
  return textEm * styleScale(style);
}

export function axisHeight(em: number): number {
  return CM.axisHeight * em;
}

export function ruleThickness(em: number): number {
  return Math.max(1, CM.defaultRuleThickness * em);
}

/** TeX \genfrac with a rule: numerator / denominator shifts and min clearance. */
export function fractionPlacement(
  numer: { height: number; depth: number },
  denom: { height: number; depth: number },
  em: number,
  style: MathStyle = "D",
): { numerDy: number; denomDy: number; ruleDy: number; rule: number } {
  const display = style === "D";
  const rule = ruleThickness(em);
  const axis = axisHeight(em);
  const clearance = (display ? 3 : 1) * rule + 0.18 * em;
  let numerShift = (display ? CM.num1 : CM.num2) * em;
  let denomShift = (display ? CM.denom1 : CM.denom2) * em;
  const numerClearance = numerShift - axis - (rule / 2 + numer.depth);
  if (numerClearance < clearance) numerShift += clearance - numerClearance;
  const denomClearance = denomShift - (denom.height + rule / 2) + axis;
  if (denomClearance < clearance) denomShift += clearance - denomClearance;
  return {
    numerDy: -numerShift,
    denomDy: denomShift,
    ruleDy: -axis,
    rule,
  };
}

/** Appendix G superscript / subscript baselines relative to the nucleus baseline. */
export function scriptPlacement(
  base: { height: number; depth: number },
  scripts: { super?: { height: number; depth: number }; sub?: { height: number; depth: number } },
  em: number,
  style: MathStyle = "D",
  cramped = false,
): { superDy: number; subDy: number } {
  const scriptEm = emOf(scriptStyle(style), em) / em;
  let superDy = 0;
  let subDy = 0;
  if (scripts.super) {
    const drop = CM.supDrop * em * scriptEm;
    const minShift = (cramped ? CM.sup3 : style === "D" ? CM.sup1 : CM.sup2) * em;
    const fromDrop = base.height - drop;
    superDy = -Math.max(minShift, fromDrop);
  }
  if (scripts.sub) {
    const drop = CM.subDrop * em * scriptEm;
    const minShift = (scripts.super ? CM.sub2 : CM.sub1) * em;
    subDy = Math.max(minShift, base.depth + drop);
  }
  if (scripts.super && scripts.sub) {
    const gap = -superDy - scripts.super.depth - (subDy - scripts.sub.height);
    const minGap = 4 * ruleThickness(em);
    if (gap < minGap) {
      const extra = (minGap - gap) / 2;
      superDy -= extra;
      subDy += extra;
    }
  }
  return { superDy, subDy };
}

/** TeX radical: rule thickness θ, clearance θ+|φ|/4 (φ = xHeight in display). */
export function radicalClearance(em: number, style: MathStyle = "D"): number {
  const theta = ruleThickness(em);
  const phi = style === "D" ? CM.xHeight * em : theta;
  return theta + Math.abs(phi) / 4 + 0.1 * em;
}

/**
 * `\left`/`\right` pick the smallest delimiter whose total span covers the
 * inner formula; TeX then falls back to extensible recipes. We keep a
 * continuous `extent` for animation, clamped to at least `\big`.
 */
export function delimiterExtent(
  inner: { height: number; depth: number },
  em: number,
  style: MathStyle = "D",
): number {
  const axis = axisHeight(em);
  const above = Math.max(inner.height - axis, 0);
  const below = Math.max(inner.depth + axis, 0);
  const needed = 2 * Math.max(above, below);
  const minSize = (style === "D" ? CM.delim1 : CM.delim2) * em * 0.45;
  return Math.max(needed, inner.height + inner.depth, minSize, 0.9 * em);
}

/** Height/depth of a delimiter whose total span is `extent`, centered on the axis. */
export function delimiterBox(
  extent: number,
  em: number,
): { height: number; depth: number } {
  const axis = axisHeight(em);
  const half = Math.max(extent, 0.9 * em) / 2;
  return { height: half + axis, depth: Math.max(0, half - axis) };
}

export const DELIM_GLYPH: Record<string, string> = {
  "paren-left": "(",
  "paren-right": ")",
  "bracket-left": "[",
  "bracket-right": "]",
  "brace-left": "{",
  "brace-right": "}",
  integral: "∫",
};

/** Display-style CM integral (KaTeX Size2-Regular U+222B) box. */
export const INTEGRAL_HEIGHT_SHARE = 1.36 / (1.36 + 0.862);

export function integralMetrics(em: number): {
  extent: number;
  width: number;
  height: number;
  depth: number;
  italicCorr: number;
} {
  const height = 1.36 * em;
  const depth = 0.862 * em;
  const italicCorr = 0.444 * em;
  return {
    extent: height + depth,
    width: 0.889 * em,
    height,
    depth,
    italicCorr,
  };
}

export function integralBox(extent: number, em: number): {
  height: number;
  depth: number;
} {
  const native = integralMetrics(em);
  const span = Math.max(extent, native.extent);
  return {
    height: INTEGRAL_HEIGHT_SHARE * span,
    depth: span - INTEGRAL_HEIGHT_SHARE * span,
  };
}
