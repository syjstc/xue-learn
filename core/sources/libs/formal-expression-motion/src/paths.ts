import type { StretchRole } from "./types.js";
import {
  cmBracketPath,
  cmBracketWidth,
  cmIntegralPath,
  cmIntegralWidth,
  cmParenPath,
  cmParenWidth,
} from "./cm-glyphs.js";
import {
  axisHeight,
  CM,
  delimiterBox,
  radicalClearance,
} from "./tex.js";

export function stretchPath(
  role: StretchRole,
  extent: number,
  em: number,
  extra = 0,
  box?: { height: number; depth: number },
): string {
  const span = Math.max(extent, 0.8 * em);
  const width = extra > 0 ? extra : delimiterWidth(role, span, em);
  const height = box?.height ?? span * 0.72;
  const depth = box?.depth ?? span * 0.28;
  switch (role) {
    case "frac-rule":
      return `M 0 0 L ${Math.max(width, span, em * 0.4)} 0`;
    case "vinculum":
      return `M 0 ${-height} L ${Math.max(width, span, em * 0.4)} ${-height}`;
    case "radical":
      return radicalHook(span, em, height, depth);
    case "paren-left":
      return cmParenPath("left", span, em);
    case "paren-right":
      return cmParenPath("right", span, em);
    case "bracket-left":
      return cmBracketPath("left", span, em);
    case "bracket-right":
      return cmBracketPath("right", span, em);
    case "brace-left":
      return bracePath("left", span, em, width);
    case "brace-right":
      return bracePath("right", span, em, width);
    case "integral":
      return cmIntegralPath(span, em);
    case "arrow-right":
      return arrowPath("right", em, width);
    case "arrow-left":
      return arrowPath("left", em, width);
    case "cdot":
      return axisDotPath(em, width, 0.048 * em, true);
    case "circ":
      return axisDotPath(em, width, 0.12 * em, false);
    case "times":
      return axisTimesPath(em, width);
    case "prime":
      return cmPrimePath(em, width);
    default:
      return "";
  }
}

export function stretchFilled(role: StretchRole): boolean {
  return (
    role === "paren-left" ||
    role === "paren-right" ||
    role === "bracket-left" ||
    role === "bracket-right" ||
    role === "integral" ||
    role === "arrow-left" ||
    role === "arrow-right" ||
    role === "cdot" ||
    role === "circ" ||
    role === "prime"
  );
}

/** Pixel floor so mobile/fit-em stems do not vanish. */
export function stretchStrokeWidth(role: StretchRole, em: number): number {
  if (role === "frac-rule" || role === "vinculum")
    return Math.max(1, 0.045 * em);
  if (role === "times") return Math.max(1.15, 0.05 * em);
  if (role === "radical") return Math.max(1.2, 0.05 * em);
  if (role.startsWith("brace")) return Math.max(1.9, 0.1 * em);
  return Math.max(1.25, 0.072 * em);
}

function stem(em: number): number {
  return Math.max(1.75, 0.1 * em);
}

/** TeX-like radical hook in baseline space: tick, drop, then rise to the rule. */
function radicalHook(
  span: number,
  em: number,
  height: number,
  depth: number,
): string {
  const hook = Math.max(0.6 * em, 0.22 * span);
  const tick = 0.14 * em;
  const top = -height;
  const bot = depth;
  return `M 0 ${top + 0.55 * (bot - top)} L ${tick} ${bot} L ${hook} ${top}`;
}

function delimEnds(extent: number, em: number): { top: number; bot: number; span: number } {
  const box = delimiterBox(extent, em);
  return { top: -box.height, bot: box.depth, span: box.height + box.depth };
}

function f(n: number): string {
  return n.toFixed(2);
}


function bracePath(
  side: "left" | "right",
  extent: number,
  em: number,
  width: number,
): string {
  const { top, bot, span } = delimEnds(extent, em);
  const mid = (top + bot) / 2;
  const inner = side === "left" ? width - 0.06 * em : 0.06 * em;
  const spine = side === "left" ? 0.36 * width : width - 0.36 * width;
  const tip = side === "left" ? 0.08 * em : width - 0.08 * em;
  const wing = Math.min(0.18 * span, 0.42 * em);
  return [
    `M ${f(inner)} ${f(top)}`,
    `C ${f(spine)} ${f(top)}, ${f(spine)} ${f(top + wing)}, ${f(spine)} ${f(mid - wing)}`,
    `C ${f(spine)} ${f(mid - 0.05 * em)}, ${f(tip)} ${f(mid)}, ${f(tip)} ${f(mid)}`,
    `C ${f(tip)} ${f(mid)}, ${f(spine)} ${f(mid + 0.05 * em)}, ${f(spine)} ${f(mid + wing)}`,
    `C ${f(spine)} ${f(bot - wing)}, ${f(spine)} ${f(bot)}, ${f(inner)} ${f(bot)}`,
  ].join(" ");
}

function arrowPath(side: "left" | "right", em: number, width: number): string {
  const axis = -0.25 * em;
  const t = stem(em) * 0.7;
  const head = 0.34 * em;
  const headH = 0.2 * em;
  const pad = 0.06 * em;
  if (side === "right") {
    const tip = width - pad;
    const stemEnd = tip - head * 0.72;
    return [
      `M ${f(pad)} ${f(axis - t)}`,
      `L ${f(stemEnd)} ${f(axis - t)}`,
      `L ${f(stemEnd)} ${f(axis - headH)}`,
      `L ${f(tip)} ${f(axis)}`,
      `L ${f(stemEnd)} ${f(axis + headH)}`,
      `L ${f(stemEnd)} ${f(axis + t)}`,
      `L ${f(pad)} ${f(axis + t)}`,
      "Z",
    ].join(" ");
  }
  const tip = pad;
  const stemEnd = tip + head * 0.72;
  return [
    `M ${f(width - pad)} ${f(axis - t)}`,
    `L ${f(stemEnd)} ${f(axis - t)}`,
    `L ${f(stemEnd)} ${f(axis - headH)}`,
    `L ${f(tip)} ${f(axis)}`,
    `L ${f(stemEnd)} ${f(axis + headH)}`,
    `L ${f(stemEnd)} ${f(axis + t)}`,
    `L ${f(width - pad)} ${f(axis + t)}`,
    "Z",
  ].join(" ");
}

/** Center a binop on the math axis, independent of the font glyph box. */
function axisDotPath(
  em: number,
  width: number,
  radius: number,
  filled: boolean,
): string {
  const cx = width / 2;
  const cy = -axisHeight(em);
  const ring = (rad: number, sweep: 0 | 1) =>
    `M ${f(cx - rad)} ${f(cy)} a ${f(rad)} ${f(rad)} 0 1 ${sweep} ${f(2 * rad)} 0 a ${f(rad)} ${f(rad)} 0 1 ${sweep} ${f(-2 * rad)} 0`;
  if (filled) return `${ring(radius, 0)} Z`;
  const inner = Math.max(radius - Math.max(1.2, 0.045 * em), radius * 0.45);
  return `${ring(radius, 0)} ${ring(inner, 1)}`;
}

/** Math-mode prime: a slanted tick, not a text/CJK quotation comma. */
function cmPrimePath(em: number, width: number): string {
  const top = -0.55 * em;
  const bot = -0.06 * em;
  const slant = 0.12 * em;
  const topW = Math.max(0.07 * em, 1.15);
  const botW = Math.max(0.032 * em, 0.7);
  const x0 = Math.max(0, (width - slant - topW) / 2);
  return [
    `M ${f(x0 + slant)} ${f(top)}`,
    `L ${f(x0 + slant + topW)} ${f(top)}`,
    `L ${f(x0 + botW)} ${f(bot)}`,
    `L ${f(x0)} ${f(bot)}`,
    "Z",
  ].join(" ");
}

function axisTimesPath(em: number, width: number): string {
  const cx = width / 2;
  const cy = -axisHeight(em);
  const arm = 0.2 * em;
  return [
    `M ${f(cx - arm)} ${f(cy - arm)}`,
    `L ${f(cx + arm)} ${f(cy + arm)}`,
    `M ${f(cx - arm)} ${f(cy + arm)}`,
    `L ${f(cx + arm)} ${f(cy - arm)}`,
  ].join(" ");
}

export function delimiterWidth(role: StretchRole, extent: number, em: number): number {
  if (role === "frac-rule" || role === "vinculum") return extent;
  if (role === "cdot") return 0.36 * em;
  if (role === "circ") return 0.5 * em;
  if (role === "prime") return 0.22 * em;
  if (role === "times") return 0.62 * em;
  if (role === "arrow-left" || role === "arrow-right") return 1.28 * em;
  if (role === "integral") return cmIntegralWidth(em);
  if (role === "radical") return Math.max(0.62 * em, 0.22 * extent);
  if (role === "brace-left" || role === "brace-right")
    return 0.44 * em + 0.03 * Math.min(Math.max(0, extent - em), 4 * em);
  if (role === "bracket-left" || role === "bracket-right")
    return cmBracketWidth(extent, em);
  if (role === "paren-left" || role === "paren-right")
    return cmParenWidth(extent, em);
  return 0.4 * em + 0.02 * Math.min(Math.max(0, extent - em), 4 * em);
}

export function radicalHookWidth(extent: number, em: number): number {
  return Math.max(0.62 * em, 0.22 * extent);
}

export { radicalClearance, CM };
