import { axisHeight, emOf, ruleThickness } from "./tex.js";

export const DEFAULT_EM = 32;
export { axisHeight, ruleThickness };

export function scriptScale(em: number): number {
  return emOf("S", em);
}

export type GlyphFace = {
  text: string;
  italic: boolean;
  width: number;
  height: number;
  depth: number;
};

const ROMAN_NAMES = new Set([
  "sin",
  "cos",
  "tan",
  "cot",
  "sec",
  "csc",
  "log",
  "ln",
  "exp",
  "lim",
  "max",
  "min",
  "inf",
  "sup",
  "limsup",
  "liminf",
  "gcd",
  "lcm",
  "det",
  "dim",
  "ker",
  "arg",
  "or",
  "and",
]);

const OPERATOR_TEXT: Record<string, string> = {
  "−": "−",
  "-": "−",
  "×": "×",
  "·": "·",
  "⋅": "⋅",
  "÷": "÷",
  "≤": "≤",
  "≥": "≥",
  "≠": "≠",
  "∞": "∞",
  "∃": "∃",
  "∀": "∀",
  "∈": "∈",
  "∉": "∉",
  "→": "→",
  "←": "←",
  "±": "±",
  "∅": "∅",
  "∧": "∧",
  "∨": "∨",
  "¬": "¬",
  "⇒": "⇒",
  "⇔": "⇔",
  "↔": "↔",
  "⊢": "⊢",
  "⊨": "⊨",
  "⊥": "⊥",
  "⊤": "⊤",
  "⟹": "⟹",
  "⟺": "⟺",
  "≈": "≈",
  "≡": "≡",
  "⊂": "⊂",
  "⊃": "⊃",
  "∩": "∩",
  "∪": "∪",
  "∘": "∘",
  "∑": "∑",
  "∏": "∏",
  π: "π",
  θ: "θ",
  φ: "φ",
  ϕ: "ϕ",
  ξ: "ξ",
  Δ: "Δ",
  δ: "δ",
};

/** Advance widths in em for operators whose drawn glyph is much wider than a letter. */
const SYMBOL_WIDTH: Record<string, number> = {
  "⇔": 1.72,
  "⟺": 1.72,
  "⇒": 1.38,
  "⟹": 1.38,
  "↔": 1.22,
  "→": 1.28,
  "⟶": 1.28,
  "←": 1.28,
  "⟵": 1.28,
  "¬": 0.78,
  "∧": 0.78,
  "∨": 0.78,
  "⊢": 0.78,
  "⊨": 0.92,
  "∀": 0.64,
  "∃": 0.64,
  "∈": 0.78,
  "∉": 0.86,
  "≠": 0.78,
  "≤": 0.78,
  "≥": 0.78,
  "≡": 0.78,
  "≈": 0.78,
  "⊂": 0.78,
  "⊃": 0.78,
  "∩": 0.78,
  "∪": 0.78,
  "∞": 0.86,
  "±": 0.78,
  "∅": 0.72,
};

export type MathAtom = "ord" | "op" | "bin" | "rel" | "open" | "close" | "punct";

const REL_ATOMS = new Set([
  "=",
  "≠",
  "<",
  ">",
  "≤",
  "≥",
  "∈",
  "∉",
  "→",
  "←",
  "⇒",
  "⇔",
  "↔",
  "⟹",
  "⟺",
  "⟶",
  "⟵",
  "⊢",
  "⊨",
  "≡",
  "≈",
  "⊂",
  "⊃",
]);
const BIN_ATOMS = new Set(["+", "−", "-", "×", "·", "⋅", "÷", "∧", "∨", "∩", "∪", "±", "∘", "*"]);
const OP_ATOMS = new Set(["¬", "∀", "∃", "∑", "∏", "∫"]);
const OPEN_ATOMS = new Set(["(", "[", "{", "⟨", "|"]);
const CLOSE_ATOMS = new Set([")", "]", "}", "⟩", "|"]);

export function mathAtom(text: string, role?: string): MathAtom {
  if (role === "paren-left" || role === "bracket-left" || role === "brace-left") {
    return "open";
  }
  if (role === "paren-right" || role === "bracket-right" || role === "brace-right") {
    return "close";
  }
  if (role === "arrow-right" || role === "arrow-left") return "rel";
  if (OPEN_ATOMS.has(text)) return "open";
  if (CLOSE_ATOMS.has(text)) return "close";
  if (REL_ATOMS.has(text)) return "rel";
  if (BIN_ATOMS.has(text)) return "bin";
  if (OP_ATOMS.has(text)) return "op";
  if (text === "," || text === ";" || text === ":") return "punct";
  return "ord";
}

/** TeX math list spacing in em (thin=3mu, med=4mu, thick=5mu). */
export function texSpace(left: MathAtom, right: MathAtom, em: number): number {
  const thin = (3 / 18) * em;
  const med = (4 / 18) * em;
  const thick = (5 / 18) * em;
  const key = `${left}:${right}`;
  const table: Record<string, number> = {
    "ord:op": thin,
    "ord:bin": med,
    "ord:rel": thick,
    "op:ord": thin,
    "op:op": thin,
    "op:rel": thick,
    "bin:ord": med,
    "bin:op": med,
    "bin:open": med,
    "rel:ord": thick,
    "rel:op": thick,
    "rel:open": thick,
    "close:op": thin,
    "close:bin": med,
    "close:rel": thick,
    "punct:ord": thin,
    "punct:op": thin,
    "punct:rel": thin,
    "punct:open": thin,
  };
  return table[key] ?? 0;
}

export function gapPx(gap: unknown, em: number): number {
  const raw = Number(gap);
  if (!Number.isFinite(raw)) return 0.28 * em;
  return raw * (em / DEFAULT_EM);
}

const ROMAN_SYMBOLS = new Set([
  "∇",
  "∂",
  "ℏ",
  "∞",
  "∑",
  "∏",
  "∫",
  "⊥",
  "⊤",
  "⊢",
  "⊨",
  "∀",
  "∃",
  "¬",
  "∧",
  "∨",
  "⇒",
  "⇔",
  "↔",
  "⟹",
  "⟺",
  "√",
  "⟨",
  "⟩",
  "†",
]);

export function glyphAxisLift(text: string, em: number): number {
  if (text === "·" || text === "⋅" || text === "×" || text === "∘") {
    return -axisHeight(em);
  }
  return 0;
}

function isCjkChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0x20000 && code <= 0x3ffff)
  );
}

function charAdvance(char: string, em: number, roman: boolean): number {
  if (isCjkChar(char)) return em;
  if (char === "Δ") return 0.76 * em;
  const mapped = OPERATOR_TEXT[char] ?? char;
  if (SYMBOL_WIDTH[mapped] != null) return SYMBOL_WIDTH[mapped] * em;
  if (roman) return romanCharWidth(char, em);
  if (/^[A-Za-z]$/.test(char)) return italicCharWidth(char, em);
  if (/^[0-9]$/.test(char)) return 0.5 * em;
  return romanCharWidth(char, em);
}

export function glyphFace(raw: string, em: number, roman = false): GlyphFace {
  const text = OPERATOR_TEXT[raw] ?? raw;
  if (!text) {
    return { text: "", italic: false, width: 0, height: 0.68 * em, depth: 0 };
  }
  const symbolWidth = SYMBOL_WIDTH[text];
  if (symbolWidth != null) {
    return {
      text,
      italic: false,
      width: symbolWidth * em,
      height: text === "¬" ? 0.58 * em : 0.42 * em,
      depth: 0.18 * em,
    };
  }
  const chars = [...text];
  if (chars.some(isCjkChar)) {
    const width = chars.reduce((sum, char) => sum + charAdvance(char, em, true), 0);
    return {
      text,
      italic: false,
      width,
      height: 0.86 * em,
      depth: 0.14 * em,
    };
  }
  const lower = text.toLowerCase();
  if (ROMAN_NAMES.has(lower) || (text.length > 1 && /^[A-Za-z]+$/.test(text))) {
    roman = true;
  }
  if (ROMAN_SYMBOLS.has(text)) roman = true;
  if (roman) {
    const width = chars.reduce((sum, char) => sum + romanCharWidth(char, em), 0);
    return {
      text,
      italic: false,
      width: Math.max(0.42 * em, width),
      height: /[A-Z]/.test(text) ? 0.7 * em : 0.66 * em,
      depth: /[gjpqy]/.test(text) ? 0.2 * em : 0.06 * em,
    };
  }
  if (/^[0-9.,]+$/.test(text)) {
    return {
      text,
      italic: false,
      width: text.length * 0.5 * em,
      height: 0.66 * em,
      depth: 0.02 * em,
    };
  }
  if (text === "→" || text === "⟶" || text === "←" || text === "⟵") {
    return {
      text,
      italic: false,
      width: 1.28 * em,
      height: 0.28 * em,
      depth: 0.22 * em,
    };
  }
  if (
    text === "+" ||
    text === "−" ||
    text === "=" ||
    text === "±"
  ) {
    return {
      text,
      italic: false,
      width: 0.78 * em,
      height: 0.55 * em,
      depth: 0.18 * em,
    };
  }
  if (text === "·" || text === "⋅" || text === "×" || text === "∘") {
    return {
      text,
      italic: false,
      width: text === "×" ? 0.72 * em : 0.42 * em,
      height: 0.22 * em,
      depth: 0.08 * em,
    };
  }
  if (text === "'" || text === "′") {
    return {
      text: "'",
      italic: false,
      width: 0.22 * em,
      height: 0.56 * em,
      depth: 0.02 * em,
    };
  }
  if (text === "/" || text === "／") {
    return {
      text: "/",
      italic: false,
      width: 0.44 * em,
      height: 0.62 * em,
      depth: 0.18 * em,
    };
  }
  const italic =
    /^[A-Za-z]$/.test(text) ||
    ["π", "θ", "φ", "ϕ", "ξ", "δ", "ρ", "ε", "σ", "γ", "ψ", "Ψ", "ħ", "μ"].includes(
      text,
    );
  const width = italic
    ? italicCharWidth(text, em)
    : chars.reduce((sum, char) => sum + charAdvance(char, em, false), 0);
  return {
    text,
    italic,
    width: Math.max(0.42 * em, width),
    height: 0.68 * em,
    depth: /[gjpqy]/.test(text) ? 0.22 * em : 0.05 * em,
  };
}

function romanCharWidth(char: string, em: number): number {
  if (/[MW]/.test(char)) return 0.92 * em;
  if (/[A-Z]/.test(char)) return 0.72 * em;
  if (/[mw]/.test(char)) return 0.78 * em;
  if (/[a-z]/.test(char)) return 0.5 * em;
  if (/[0-9]/.test(char)) return 0.5 * em;
  return 0.55 * em;
}

const ITALIC_WIDTH: Record<string, number> = {
  a: 0.611,
  b: 0.647,
  c: 0.554,
  d: 0.694,
  e: 0.518,
  f: 0.502,
  g: 0.531,
  h: 0.715,
  i: 0.369,
  j: 0.374,
  k: 0.647,
  l: 0.351,
  m: 0.889,
  n: 0.647,
  o: 0.58,
  p: 0.647,
  q: 0.607,
  r: 0.499,
  s: 0.497,
  t: 0.383,
  u: 0.647,
  v: 0.554,
  w: 0.776,
  x: 0.554,
  y: 0.554,
  z: 0.518,
};

function italicCharWidth(char: string, em: number): number {
  if (/[MW]/.test(char)) return 0.88 * em;
  if (/[A-Z]/.test(char)) return 0.76 * em;
  return (ITALIC_WIDTH[char] ?? 0.58) * em;
}
