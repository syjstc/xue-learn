import type {
  ContainmentRelation,
  FormalDocument,
  FormalNode,
  LayoutNode,
} from "../../formal-expression-core/src/index.js";
import {
  isNonMathAuthoringGlyph,
  normalizeFormalGlyph,
} from "../../formal-expression-core/src/index.js";

const INFIX_GLYPHS = new Set([
  "+",
  "-",
  "−",
  "=",
  "≠",
  "<",
  ">",
  "≤",
  "≥",
  "×",
  "·",
  "⋅",
  "*",
  "∗",
  "/",
  "÷",
  "／",
  "―",
  "^",
  "∘",
  "∈",
  "∉",
  "→",
  "←",
  "⊂",
  "⊃",
  "∩",
  "∪",
  "∧",
  "∨",
  "⇒",
  "⇔",
  "↔",
  "⊢",
  "⊨",
  "⟹",
  "⟺",
]);

const FUNCTION_RENDERERS = new Set(["function", "apply", "call"]);

const POWER_RENDERERS = new Set([
  "superscript",
  "super",
  "power",
  "supscript",
  "exponent",
]);

const LARGE_OPERATORS: Record<string, string> = {
  lim: "lim",
  limit: "lim",
  max: "max",
  min: "min",
  inf: "inf",
  sup: "sup",
  limsup: "limsup",
  liminf: "liminf",
  sum: "∑",
  prod: "∏",
};

const STRUCTURAL_TOKENS = new Set([
  "flow",
  "stack",
  "overlay",
  "attach",
  "surround",
  "subject",
  "grid",
  "free",
  "apply",
  "call",
]);

/** Word-form juxtaposition that models emit instead of × / · / invisible times. */
const IMPLICIT_PRODUCT_TOKENS = new Set(["mul", "multiply"]);

export function glyphValue(node: FormalNode | undefined): string {
  if (!node) return "";
  return normalizeFormalGlyph(node.value);
}

/** Layout-kind / apply words that models sometimes emit as visible tokens. */
export function isStructuralLayoutToken(
  node: FormalNode | undefined,
): boolean {
  if (!node) return false;
  const glyph = glyphValue(node);
  return (
    STRUCTURAL_TOKENS.has(glyph.toLowerCase()) || isNonMathAuthoringGlyph(glyph)
  );
}

export function isIntegralNode(node: FormalNode): boolean {
  if (node.renderer === "integral") return true;
  const glyph = glyphValue(node);
  return glyph === "∫" || glyph === "∬" || glyph === "∭" || glyph === "∮";
}

export function isFractionNode(node: FormalNode): boolean {
  if (node.renderer === "fraction" || node.renderer === "fraction-bar")
    return true;
  const glyph = glyphValue(node);
  return glyph === "/" || glyph === "÷" || glyph === "／" || glyph === "―";
}

export function isProductOperator(node: FormalNode): boolean {
  if (node.renderer === "invisible") return false;
  const glyph = glyphValue(node);
  return (
    glyph === "×" ||
    glyph === "·" ||
    glyph === "⋅" ||
    glyph === "*" ||
    glyph === "∗"
  );
}

export function isImplicitProduct(node: FormalNode | undefined): boolean {
  if (!node) return false;
  if (node.renderer === "invisible") return true;
  return IMPLICIT_PRODUCT_TOKENS.has(glyphValue(node).toLowerCase());
}

/** Infix connectors that must repeat between every operand (`a + b + c`). */
export function isInfixChainOperator(node: FormalNode | undefined): boolean {
  if (!node) return false;
  if (
    isPowerOperator(node) ||
    isApplyOperator(node) ||
    isPrimeOperator(node) ||
    isFractionNode(node) ||
    isFunctionRenderer(node) ||
    isIntegralNode(node)
  ) {
    return false;
  }
  if (isImplicitProduct(node) || isProductOperator(node)) return true;
  return INFIX_GLYPHS.has(glyphValue(node));
}

export function isPrimeOperator(node: FormalNode): boolean {
  const glyph = glyphValue(node);
  return glyph === "'" || glyph === "′";
}

export function isPowerOperator(node: FormalNode): boolean {
  const glyph = glyphValue(node);
  const renderer = (node.renderer ?? "").toLowerCase();
  if (glyph === "^") return true;
  if (
    POWER_RENDERERS.has(renderer) ||
    POWER_RENDERERS.has(glyph.toLowerCase())
  ) {
    return true;
  }
  if (node.kind === "container") return false;
  if (renderer === "sup" && glyph.toLowerCase() !== "sup") return true;
  return (
    glyph.toLowerCase() === "sup" &&
    renderer !== "prefix" &&
    renderer !== "lim" &&
    renderer !== "sup"
  );
}

export function isApplyOperator(node: FormalNode | undefined): boolean {
  if (!node) return false;
  if (FUNCTION_RENDERERS.has(node.renderer ?? "")) return true;
  const glyph = glyphValue(node);
  return glyph === "apply" || glyph === "call";
}

/** Leibniz differential `d` / `∂`, typeset as juxtaposition (`dy`), not `d(y)`. */
export function isDifferentialSymbol(node: FormalNode | undefined): boolean {
  if (!node) return false;
  const glyph = glyphValue(node);
  return glyph === "d" || glyph === "∂";
}

export function isCallName(node: FormalNode): boolean {
  if (node.renderer === "invisible") return false;
  if (isImplicitProduct(node)) return false;
  if (limitCommand(node)) return false;
  if (FUNCTION_RENDERERS.has(node.renderer ?? "")) return true;
  if (node.kind !== "connector") return false;
  const glyph = glyphValue(node);
  if (!glyph || INFIX_GLYPHS.has(glyph) || isPrimeOperator(node)) return false;
  return /^(?:[A-Za-zφϕξθπΔδ]+(?:'+)?)$/.test(glyph);
}

export function isToArrow(node: FormalNode): boolean {
  const glyph = glyphValue(node);
  return glyph === "→" || glyph === "⟶";
}

export function arrowRole(
  node: FormalNode,
): import("./types.js").StretchRole | undefined {
  const glyph = glyphValue(node);
  if (glyph === "→" || glyph === "⟶") return "arrow-right";
  if (glyph === "←" || glyph === "⟵") return "arrow-left";
  return undefined;
}

export function axisBinopRole(
  node: FormalNode,
): import("./types.js").StretchRole | undefined {
  const glyph = glyphValue(node);
  if (glyph === "·" || glyph === "⋅") return "cdot";
  if (glyph === "×") return "times";
  if (glyph === "∘") return "circ";
  return undefined;
}

export function limitCommand(node: FormalNode): string | undefined {
  if (isPowerOperator(node)) return undefined;
  const renderer = (node.renderer ?? "").toLowerCase();
  if (LARGE_OPERATORS[renderer]) return LARGE_OPERATORS[renderer];
  const glyph = glyphValue(node).toLowerCase();
  return LARGE_OPERATORS[glyph];
}

export function isFunctionRenderer(node: FormalNode): boolean {
  return FUNCTION_RENDERERS.has(node.renderer ?? "");
}

export function subjectRef(
  layoutId: string,
  doc: FormalDocument,
): { id: string; node: FormalNode } | undefined {
  const layout = doc.layouts[layoutId];
  if (layout?.subject?.type !== "node") return undefined;
  const node = doc.nodes[layout.subject.id];
  return node ? { id: layout.subject.id, node } : undefined;
}

export function firstSubject(
  layoutId: string,
  doc: FormalDocument,
): string | undefined {
  const layout = doc.layouts[layoutId];
  if (!layout) return undefined;
  if (layout.subject?.type === "node") return layout.subject.id;
  for (const child of layout.children) {
    const found = firstSubject(child, doc);
    if (found) return found;
  }
  return undefined;
}

export function containmentParentId(
  child: string,
  doc: FormalDocument,
): string | undefined {
  const relation = Object.values(doc.relations).find(
    (candidate): candidate is ContainmentRelation =>
      candidate.kind === "containment" && candidate.child === child,
  );
  return relation?.parent;
}

export function wrapperNodeId(layoutId: string): string | undefined {
  if (!layoutId.startsWith("layout-") || layoutId.endsWith("-subject"))
    return undefined;
  return layoutId.slice("layout-".length);
}

export function isFractionStack(
  layout: LayoutNode,
  doc: FormalDocument,
): boolean {
  if (layout.children.length < 3) return false;
  const bar = subjectRef(layout.children[1], doc);
  return Boolean(bar && (layout.props?.separator || isFractionNode(bar.node)));
}

export function isIncompleteFractionStack(
  layoutId: string,
  layout: LayoutNode,
  doc: FormalDocument,
): boolean {
  if (layout.children.length !== 2) return false;
  if (isFractionStack(layout, doc)) return false;
  const ownerId = wrapperNodeId(layoutId);
  const owner = ownerId ? doc.nodes[ownerId] : undefined;
  if (owner?.renderer === "board") return false;
  return owner?.renderer === "fraction" || Boolean(layout.props?.separator);
}

export function isLeftDelimiter(value: string): boolean {
  return ["(", "[", "{", "|", "⟨", "⌈", "⌊", "<"].includes(value);
}

export function isRightDelimiter(value: string): boolean {
  return [")", "]", "}", "|", "⟩", "⌉", "⌋", ">"].includes(value);
}

export function delimiterRole(
  value: string,
  side: "left" | "right",
): import("./types.js").StretchRole {
  if (value === "[" || value === "]")
    return side === "left" ? "bracket-left" : "bracket-right";
  if (value === "{" || value === "}")
    return side === "left" ? "brace-left" : "brace-right";
  return side === "left" ? "paren-left" : "paren-right";
}
