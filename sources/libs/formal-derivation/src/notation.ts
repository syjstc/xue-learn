import {
  incompleteFractionContainers,
  isNonMathAuthoringGlyph,
  normalizeAuthoringPresentation,
  normalizeFormalGlyph,
  type AuthoringTree,
} from "../../formal-expression-core/src/index.js";
import { DerivationError } from "./errors.js";
import type { ValidationFindingV1 } from "./types.js";

const PRODUCT_TOKENS = new Set(["×", "·", "⋅", "*", "∗"]);
const ADDITIVE_TOKENS = new Set(["+", "-", "−"]);
const QUANTIFIER_TOKENS = new Set(["∃", "∀"]);
const MEMBERSHIP_TOKENS = new Set(["∈", "∉"]);
const OPAQUE_WORD_TOKENS = new Set(["sup", "inf"]);
const OPAQUE_LOGIC_TOKENS = new Set(["∧", "∨", "⇒", "⇔"]);

export interface UngroupedProductOperand {
  operatorId?: string;
  operandId?: string;
}

export interface MalformedQuantifier {
  operatorId?: string;
  reason: string;
}

export interface UngroupedFunctionArgument {
  operatorId?: string;
  operandId?: string;
}

export interface OpaqueTeachingNotation {
  nodeId?: string;
  token: string;
  advice: string;
}

function isGrouped(tree: AuthoringTree): boolean {
  if (tree.kind !== "container") return false;
  return tree.layout?.kind === "surround" || tree.renderer === "group";
}

function isAdditiveOperator(tree: AuthoringTree): boolean {
  return (
    tree.kind === "operator" &&
    tree.renderer !== "invisible" &&
    ADDITIVE_TOKENS.has(normalizeFormalGlyph(tree.token))
  );
}

function isProductOperator(tree: AuthoringTree): boolean {
  if (tree.kind !== "operator") return false;
  if (isFunctionApply(tree)) return false;
  if (tree.renderer === "invisible") return true;
  return PRODUCT_TOKENS.has(normalizeFormalGlyph(tree.token));
}

function isFunctionApply(tree: AuthoringTree): boolean {
  if (tree.kind !== "operator" && tree.kind !== "container") return false;
  const renderer = tree.renderer ?? "";
  if (renderer === "function" || renderer === "apply" || renderer === "call") {
    return true;
  }
  return tree.kind === "operator" && ["apply", "call"].includes(normalizeFormalGlyph(tree.token));
}

function functionArguments(tree: AuthoringTree): AuthoringTree[] {
  if (tree.kind === "operator") {
    return tree.operands.slice(1).map((operand) => operand.node);
  }
  if (tree.kind === "container") {
    return tree.slots.slice(1).map((slot) => slot.node);
  }
  return [];
}

function visitUngroupedFunctionArguments(
  tree: AuthoringTree,
  found: UngroupedFunctionArgument[],
): void {
  if (isFunctionApply(tree)) {
    for (const argument of functionArguments(tree)) {
      if (!isGrouped(argument)) {
        found.push({
          operatorId: tree.id,
          operandId: argument.id,
        });
      }
    }
  }
  if (tree.kind === "operator") {
    for (const operand of tree.operands) {
      visitUngroupedFunctionArguments(operand.node, found);
    }
    return;
  }
  if (tree.kind === "container") {
    for (const slot of tree.slots) {
      visitUngroupedFunctionArguments(slot.node, found);
    }
  }
}

function visit(
  tree: AuthoringTree,
  found: UngroupedProductOperand[],
): void {
  if (tree.kind === "operator") {
    if (isProductOperator(tree)) {
      for (const operand of tree.operands) {
        if (isAdditiveOperator(operand.node) && !isGrouped(operand.node)) {
          found.push({
            operatorId: tree.id,
            operandId: operand.node.id,
          });
        }
      }
    }
    for (const operand of tree.operands) visit(operand.node, found);
    return;
  }
  if (tree.kind === "container") {
    for (const slot of tree.slots) visit(slot.node, found);
  }
}

function isMembershipBinding(tree: AuthoringTree): boolean {
  return (
    tree.kind === "operator" &&
    MEMBERSHIP_TOKENS.has(normalizeFormalGlyph(tree.token)) &&
    tree.operands.length === 2
  );
}

function isProposition(tree: AuthoringTree): boolean {
  if (tree.kind === "operator") {
    const token = normalizeFormalGlyph(tree.token);
    return token !== "," && token !== ";" && !MEMBERSHIP_TOKENS.has(token);
  }
  return tree.kind === "container" && tree.slots.length > 0;
}

function visitMalformedQuantifiers(
  tree: AuthoringTree,
  found: MalformedQuantifier[],
): void {
  if (tree.kind === "operator") {
    const token = normalizeFormalGlyph(tree.token);
    if (QUANTIFIER_TOKENS.has(token)) {
      if (tree.renderer !== "prefix") {
        found.push({
          operatorId: tree.id,
          reason: `quantifier ${token} must use renderer "prefix"`,
        });
      } else if (
        tree.operands.length !== 2 ||
        !tree.operands[0] ||
        !isMembershipBinding(tree.operands[0].node) ||
        !tree.operands[1] ||
        !isProposition(tree.operands[1].node)
      ) {
        found.push({
          operatorId: tree.id,
          reason:
            `quantifier ${token} requires exactly two structured operands: ` +
            `a membership binding such as ξ∈(a,b), then the proposition being asserted`,
        });
      }
    }
    for (const operand of tree.operands) {
      visitMalformedQuantifiers(operand.node, found);
    }
    return;
  }
  if (tree.kind === "container") {
    for (const slot of tree.slots) visitMalformedQuantifiers(slot.node, found);
  }
}

function visitOpaqueTeachingNotation(
  tree: AuthoringTree,
  found: OpaqueTeachingNotation[],
): void {
  if (tree.kind === "reference") {
    found.push({
      nodeId: tree.id,
      token: tree.targetId,
      advice:
        'Do not author kind "reference" or paint inspect path ids. Copy the real subtree and reuse inspected node ids.',
    });
    return;
  }
  if (tree.kind === "token") {
    if (typeof tree.value !== "string") return;
    const token = normalizeFormalGlyph(tree.value).trim();
    if (
      OPAQUE_WORD_TOKENS.has(token.toLowerCase()) ||
      OPAQUE_LOGIC_TOKENS.has(token)
    ) {
      found.push({
        nodeId: tree.id,
        token,
        advice:
          "Use explicit maximum/minimum statements instead of sup/inf, and use separate readable statements instead of logical connective glyphs such as ∧, ∨, ⇒, or ⇔.",
      });
    } else if (isNonMathAuthoringGlyph(token)) {
      found.push({
        nodeId: tree.id,
        token,
        advice:
          "token.value must be a math glyph. Do not put inspect/compile path ids or 讲解 speech on the board.",
      });
    }
    return;
  }
  if (tree.kind === "operator") {
    const token = normalizeFormalGlyph(tree.token).trim();
    if (
      OPAQUE_WORD_TOKENS.has(token.toLowerCase()) ||
      OPAQUE_LOGIC_TOKENS.has(token)
    ) {
      found.push({
        nodeId: tree.id,
        token,
        advice:
          "Use explicit maximum/minimum statements instead of sup/inf, and use separate readable statements instead of logical connective glyphs such as ∧, ∨, ⇒, or ⇔.",
      });
    } else if (isNonMathAuthoringGlyph(token)) {
      found.push({
        nodeId: tree.id,
        token,
        advice:
          "operator.token must be a math glyph. Do not put inspect/compile path ids or 讲解 speech on the board.",
      });
    }
    for (const operand of tree.operands) {
      visitOpaqueTeachingNotation(operand.node, found);
    }
    return;
  }
  if (tree.kind === "container") {
    for (const slot of tree.slots) {
      visitOpaqueTeachingNotation(slot.node, found);
    }
  }
}

export function malformedQuantifiers(
  tree: AuthoringTree,
): MalformedQuantifier[] {
  const found: MalformedQuantifier[] = [];
  visitMalformedQuantifiers(tree, found);
  return found;
}

export function opaqueTeachingNotation(
  tree: AuthoringTree,
): OpaqueTeachingNotation[] {
  const found: OpaqueTeachingNotation[] = [];
  visitOpaqueTeachingNotation(tree, found);
  return found;
}

export function ungroupedProductOperands(
  tree: AuthoringTree,
): UngroupedProductOperand[] {
  const found: UngroupedProductOperand[] = [];
  visit(tree, found);
  return found;
}

export function ungroupedFunctionArguments(
  tree: AuthoringTree,
): UngroupedFunctionArgument[] {
  const found: UngroupedFunctionArgument[] = [];
  visitUngroupedFunctionArguments(tree, found);
  return found;
}

export function notationFindingsForTree(
  tree: AuthoringTree,
  formulaId: string,
): ValidationFindingV1[] {
  const productFindings = ungroupedProductOperands(tree).map((item) => ({
    level: "mathematical" as const,
    severity: "error" as const,
    code: "ungrouped_product_operand",
    formulaId,
    message:
      `Formula ${formulaId} multiplies a sum or difference without parentheses` +
      (item.operandId ? ` (operand ${item.operandId})` : "") +
      ". Wrap that operand in a group container with left '(' and right ')' so the product is m(x-a), not m·x-a.",
  }));
  const functionFindings = ungroupedFunctionArguments(tree).map((item) => ({
    level: "mathematical" as const,
    severity: "error" as const,
    code: "ungrouped_function_argument",
    formulaId,
    message:
      `Formula ${formulaId} applies a function without parentheses around its argument` +
      (item.operandId ? ` (operand ${item.operandId})` : "") +
      ". Write f(u) as apply with a group surround around the argument so the preview is f(g(x)), not f g x.",
  }));
  const quantifierFindings = malformedQuantifiers(tree).map((item) => ({
    level: "mathematical" as const,
    severity: "error" as const,
    code: "malformed_quantifier",
    formulaId,
    message:
      `Formula ${formulaId} has a malformed quantifier` +
      (item.operatorId ? ` (${item.operatorId})` : "") +
      `: ${item.reason}. Do not pass punctuation and relation symbols as a flat operand list.`,
  }));
  const opaqueFindings = opaqueTeachingNotation(tree).map((item) => ({
    level: "mathematical" as const,
    severity: "error" as const,
    code: "opaque_teaching_notation",
    formulaId,
    message:
      `Formula ${formulaId} uses learner-opaque shorthand ${JSON.stringify(item.token)}` +
      (item.nodeId ? ` (${item.nodeId})` : "") +
      `. ${item.advice}`,
  }));
  const fractionFindings = incompleteFractionContainers(tree).map((item) => ({
    level: "formal" as const,
    severity: "error" as const,
    code: "incomplete_fraction",
    formulaId,
    message:
      `Formula ${formulaId} is a stacked fraction without a bar` +
      (item.nodeId ? ` (${item.nodeId})` : "") +
      '. Use renderer "fraction", layout stack with separator true, and three slots: numerator, separator token "―" with renderer "fraction-bar", denominator.',
  }));
  return [
    ...productFindings,
    ...functionFindings,
    ...quantifierFindings,
    ...opaqueFindings,
    ...fractionFindings,
  ];
}

export function assertValidNotation(tree: AuthoringTree, formulaId: string): void {
  const findings = notationFindingsForTree(tree, formulaId);
  const first = findings[0];
  if (!first) return;
  throw new DerivationError({
    code: first.code,
    message: first.message,
    formulaId,
  });
}

/** @deprecated Use assertValidNotation. */
export const assertGroupedProducts = assertValidNotation;

function wrapInGroup(inner: AuthoringTree): AuthoringTree {
  if (isGrouped(inner)) return inner;
  return {
    kind: "container",
    renderer: "group",
    layout: { kind: "surround", props: { left: "(", right: ")" } },
    slots: [{ name: "content", node: inner }],
  };
}

/**
 * Rewrite a tree so commit-time notation and presentation hold: stacked
 * fractions, integral renderers, grouped function arguments, and grouped
 * multiplied sums. Used for inspect seams and structural equality.
 */
export function canonicalizeNotationTree(tree: AuthoringTree): AuthoringTree {
  return canonicalizeGrouping(normalizeAuthoringPresentation(tree));
}

function canonicalizeGrouping(tree: AuthoringTree): AuthoringTree {
  if (tree.kind === "token" || tree.kind === "placeholder" || tree.kind === "reference") {
    return { ...tree };
  }
  if (tree.kind === "operator") {
    const operands = tree.operands.map((operand) => ({
      ...operand,
      node: canonicalizeGrouping(operand.node),
    }));
    const rewritten = (() => {
      if (isFunctionApply(tree)) {
        return operands.map((operand, index) =>
          index === 0 ? operand : { ...operand, node: wrapInGroup(operand.node) },
        );
      }
      if (isProductOperator(tree)) {
        return operands.map((operand) =>
          isAdditiveOperator(operand.node) && !isGrouped(operand.node)
            ? { ...operand, node: wrapInGroup(operand.node) }
            : operand,
        );
      }
      return operands;
    })();
    return { ...tree, operands: rewritten };
  }
  return {
    ...tree,
    slots: tree.slots.map((slot) => ({
      ...slot,
      node: canonicalizeGrouping(slot.node),
    })),
  };
}

function meaningfulRenderer(renderer: string | undefined): string | null {
  if (!renderer) return null;
  if (
    renderer === "invisible" ||
    renderer === "prefix" ||
    renderer === "function" ||
    renderer === "apply" ||
    renderer === "call" ||
    renderer === "fraction" ||
    renderer === "fraction-bar" ||
    renderer === "integral" ||
    renderer === "group" ||
    renderer === "board"
  ) {
    return renderer;
  }
  // math/text/infix/and similar are compile defaults, not teaching structure.
  return null;
}

function meaningfulLayout(
  layout: AuthoringTree["layout"] | undefined,
): { kind: string; props: unknown } | null {
  if (!layout) return null;
  if (layout.kind === "surround" || layout.kind === "stack") {
    return { kind: layout.kind, props: layout.props ?? null };
  }
  return null;
}

function structuralNode(tree: AuthoringTree): unknown {
  if (tree.kind === "token") {
    return {
      kind: "token",
      value:
        typeof tree.value === "string"
          ? normalizeFormalGlyph(tree.value)
          : tree.value,
      renderer: meaningfulRenderer(tree.renderer),
      attributes: tree.attributes ?? null,
    };
  }
  if (tree.kind === "placeholder") {
    return {
      kind: "placeholder",
      label: tree.label ?? null,
      attributes: tree.attributes ?? null,
    };
  }
  if (tree.kind === "reference") {
    return {
      kind: "reference",
      targetId: tree.targetId,
      attributes: tree.attributes ?? null,
    };
  }
  if (tree.kind === "operator") {
    return {
      kind: "operator",
      token: normalizeFormalGlyph(tree.token),
      renderer: meaningfulRenderer(tree.renderer),
      attributes: tree.attributes ?? null,
      layout: meaningfulLayout(tree.layout),
      operands: tree.operands.map((operand) => ({
        node: structuralNode(operand.node),
      })),
    };
  }
  return {
    kind: "container",
    renderer: meaningfulRenderer(tree.renderer) ?? tree.renderer,
    attributes: tree.attributes ?? null,
    layout: meaningfulLayout(tree.layout),
    slots: tree.slots.map((slot) => ({
      name: slot.name,
      node: structuralNode(slot.node),
    })),
  };
}

/**
 * Structural fingerprint for expansion seams: ignore ephemeral node ids and
 * treat notation-legal grouping wrappers as equal to legacy ungrouped forms.
 */
export function structuralAuthoringTree(tree: AuthoringTree): unknown {
  return structuralNode(canonicalizeNotationTree(tree));
}
