import { createDocument, validateDocument } from "./document.js";
import type {
  ConnectionRelation,
  ContainmentRelation,
  FormalDocument,
  JsonObject,
  JsonValue,
  LayoutNode,
} from "./types.js";

interface AuthoringBase {
  /** Optional human-readable stable key. Otherwise derived from the tree path. */
  id?: string;
  attributes?: JsonObject;
  layout?: {
    kind: LayoutNode["kind"];
    props?: JsonObject;
    includeSelf?: boolean;
  };
}
export interface AuthoringToken extends AuthoringBase {
  kind: "token";
  value: JsonValue;
  contentType?: string;
  renderer?: string;
}
export interface AuthoringOperator extends AuthoringBase {
  kind: "operator";
  token: string;
  renderer?: string;
  operands: Array<{
    port?: string;
    direction?: "in" | "out" | "neutral";
    role?: string;
    node: AuthoringTree;
  }>;
}
export interface AuthoringContainer extends AuthoringBase {
  kind: "container";
  renderer: string;
  slots: Array<{ name: string; role?: string; node: AuthoringTree }>;
}
export interface AuthoringPlaceholder extends AuthoringBase {
  kind: "placeholder";
  label?: string;
  renderer?: string;
}
export interface AuthoringReference extends AuthoringBase {
  kind: "reference";
  targetId: string;
  renderer?: string;
}
export type AuthoringTree =
  | AuthoringToken
  | AuthoringOperator
  | AuthoringContainer
  | AuthoringPlaceholder
  | AuthoringReference;

function authoringChildren(tree: AuthoringTree): AuthoringTree[] {
  if (tree.kind === "operator") {
    return tree.operands.map((operand) => operand.node);
  }
  if (tree.kind === "container") {
    return tree.slots.map((slot) => slot.node);
  }
  return [];
}

function authoringNodeSignature(tree: AuthoringTree): string {
  const layout = tree.layout?.kind ?? "";
  if (tree.kind === "token") {
    return `token:${normalizeFormalGlyph(tree.value)}:${tree.renderer ?? ""}:${layout}`;
  }
  if (tree.kind === "operator") {
    return `operator:${normalizeFormalGlyph(tree.token)}:${tree.renderer ?? ""}:${layout}`;
  }
  if (tree.kind === "container") {
    return `container:${tree.renderer}:${layout}`;
  }
  if (tree.kind === "placeholder") {
    return `placeholder:${tree.label ?? ""}:${layout}`;
  }
  return `reference:${tree.targetId}:${layout}`;
}

function authoringTreeFingerprint(tree: AuthoringTree): string {
  const relationships =
    tree.kind === "operator"
      ? tree.operands.map((operand) => ({
          port: operand.port,
          direction: operand.direction,
          role: operand.role,
          child: authoringTreeFingerprint(operand.node),
        }))
      : tree.kind === "container"
        ? tree.slots.map((slot) => ({
            name: slot.name,
            role: slot.role,
            child: authoringTreeFingerprint(slot.node),
          }))
        : [];
  return JSON.stringify([authoringNodeSignature(tree), relationships]);
}

function visitAuthoringTree(
  tree: AuthoringTree,
  visit: (node: AuthoringTree) => void,
) {
  visit(tree);
  authoringChildren(tree).forEach((child) => visitAuthoringTree(child, visit));
}

/**
 * Carry semantic node identities across a model-authored subtree rewrite.
 *
 * Exact unchanged subtrees are matched first, then remaining compatible nodes
 * are paired in reading order. This gives every renderer one durable identity
 * model even when an author supplies fresh cosmetic ids for each revision.
 */
export function reconcileAuthoringTreeIdentity(
  previous: AuthoringTree,
  next: AuthoringTree,
  options: { rootId?: string } = {},
): AuthoringTree {
  const reconciled = structuredClone(next);
  const previousNodes: AuthoringTree[] = [];
  const nextNodes: AuthoringTree[] = [];
  visitAuthoringTree(previous, (node) => previousNodes.push(node));
  visitAuthoringTree(reconciled, (node) => nextNodes.push(node));

  const matchedIds = new Map<AuthoringTree, string>();
  const usedPrevious = new Set<AuthoringTree>();
  if (previous.id) {
    matchedIds.set(reconciled, options.rootId ?? previous.id);
    usedPrevious.add(previous);
  } else if (options.rootId) {
    matchedIds.set(reconciled, options.rootId);
  }

  const matchWholeSubtree = (
    previousNode: AuthoringTree,
    nextNode: AuthoringTree,
  ) => {
    const previousBranch: AuthoringTree[] = [];
    const nextBranch: AuthoringTree[] = [];
    visitAuthoringTree(previousNode, (node) => previousBranch.push(node));
    visitAuthoringTree(nextNode, (node) => nextBranch.push(node));
    if (previousBranch.length !== nextBranch.length) return;
    for (let index = 0; index < previousBranch.length; index += 1) {
      const before = previousBranch[index];
      const after = nextBranch[index];
      if (!before.id || usedPrevious.has(before)) continue;
      matchedIds.set(after, before.id);
      usedPrevious.add(before);
    }
  };

  for (const nextNode of nextNodes.slice(1)) {
    if (matchedIds.has(nextNode)) continue;
    const fingerprint = authoringTreeFingerprint(nextNode);
    const exact = previousNodes.find(
      (candidate) =>
        !usedPrevious.has(candidate) &&
        Boolean(candidate.id) &&
        authoringTreeFingerprint(candidate) === fingerprint,
    );
    if (exact) matchWholeSubtree(exact, nextNode);
  }

  for (const nextNode of nextNodes.slice(1)) {
    if (matchedIds.has(nextNode)) continue;
    const signature = authoringNodeSignature(nextNode);
    const compatible = previousNodes.find(
      (candidate) =>
        !usedPrevious.has(candidate) &&
        Boolean(candidate.id) &&
        authoringNodeSignature(candidate) === signature,
    );
    if (!compatible?.id) continue;
    matchedIds.set(nextNode, compatible.id);
    usedPrevious.add(compatible);
  }

  const usedOutputIds = new Set<string>();
  for (const node of nextNodes) {
    const desiredId = matchedIds.get(node) ?? node.id;
    if (!desiredId || usedOutputIds.has(desiredId)) {
      node.id = undefined;
      continue;
    }
    node.id = desiredId;
    usedOutputIds.add(desiredId);
  }
  return reconciled;
}

export const FORMAL_AUTHORING_TREE_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Formal expression authoring tree",
  $ref: "#/$defs/node",
  $defs: {
    node: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "value"],
          properties: {
            id: { type: "string" },
            kind: { const: "token" },
            value: {},
            contentType: { type: "string" },
            renderer: { type: "string" },
            attributes: { type: "object" },
            layout: { $ref: "#/$defs/layout" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "token", "operands"],
          properties: {
            id: { type: "string" },
            kind: { const: "operator" },
            token: { type: "string" },
            renderer: { type: "string" },
            attributes: { type: "object" },
            layout: { $ref: "#/$defs/layout" },
            operands: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["node"],
                properties: {
                  port: { type: "string" },
                  direction: { enum: ["in", "out", "neutral"] },
                  role: { type: "string" },
                  node: { $ref: "#/$defs/node" },
                },
              },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "renderer", "slots"],
          properties: {
            id: { type: "string" },
            kind: { const: "container" },
            renderer: { type: "string" },
            attributes: { type: "object" },
            layout: { $ref: "#/$defs/layout" },
            slots: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "node"],
                properties: {
                  name: { type: "string" },
                  role: { type: "string" },
                  node: { $ref: "#/$defs/node" },
                },
              },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties: {
            id: { type: "string" },
            kind: { const: "placeholder" },
            label: { type: "string" },
            attributes: { type: "object" },
            layout: { $ref: "#/$defs/layout" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "targetId"],
          properties: {
            id: { type: "string" },
            kind: { const: "reference" },
            targetId: { type: "string" },
            attributes: { type: "object" },
            layout: { $ref: "#/$defs/layout" },
          },
        },
      ],
    },
    layout: {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: {
          enum: [
            "subject",
            "flow",
            "stack",
            "overlay",
            "grid",
            "attach",
            "surround",
            "free",
          ],
        },
        props: { type: "object" },
        includeSelf: { type: "boolean" },
      },
    },
  },
} as const;

const safeId = (value: string) =>
  value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "node";

const GLYPH_KEYS = [
  "latex",
  "text",
  "token",
  "value",
  "name",
  "symbol",
  "content",
  "label",
  "char",
] as const;

/** Flatten model-authored nested token payloads into a single glyph string. */
export function coerceGlyphValue(
  value: unknown,
  seen = new Set<unknown>(),
): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => coerceGlyphValue(item, seen)).join("");
  }
  const record = value as Record<string, unknown>;
  for (const key of GLYPH_KEYS) {
    if (!(key in record)) continue;
    const found = coerceGlyphValue(record[key], seen);
    if (found) return found;
  }
  for (const nested of Object.values(record)) {
    const found = coerceGlyphValue(nested, seen);
    if (found) return found;
  }
  return "";
}

const GLYPH_COMMAND_ALIASES: Record<string, string> = {
  minus: "−",
  plus: "+",
  times: "×",
  cdot: "·",
  cdotp: "·",
  dot: "·",
  div: "÷",
  divide: "÷",
  exists: "∃",
  exist: "∃",
  forall: "∀",
  in: "∈",
  notin: "∉",
  infty: "∞",
  infinity: "∞",
  int: "∫",
  integral: "∫",
  iint: "∬",
  iiint: "∭",
  oint: "∮",
  emptyset: "∅",
  leq: "≤",
  le: "≤",
  geq: "≥",
  ge: "≥",
  neq: "≠",
  ne: "≠",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  pm: "±",
  circ: "∘",
  prime: "'",
  mid: "∣",
  subset: "⊂",
  supset: "⊃",
  cap: "∩",
  cup: "∪",
  land: "∧",
  lor: "∨",
  neg: "¬",
  approx: "≈",
  equiv: "≡",
};

const SPOKEN_FORMULA_GLYPH = /撇|分之|根号|乘以|除以|的平方/;

/**
 * Inspect/compile path ids and classroom 讲解 speech that models sometimes
 * put in token.value. Those must not typeset as mathematics.
 */
export function isNonMathAuthoringGlyph(value: unknown): boolean {
  const glyph = normalizeFormalGlyph(value).trim();
  if (!glyph) return false;
  if (/(?:^|-)operand-\d/i.test(glyph)) return true;
  if (/^(?:root|node)(?:-[a-z0-9_]+)+$/i.test(glyph)) return true;
  return SPOKEN_FORMULA_GLYPH.test(glyph);
}

/** Map TeX/word operator names (`minus`, `\\cdot`) onto a single glyph. */
export function normalizeFormalGlyph(value: unknown): string {
  let glyph = coerceGlyphValue(value).replace(/′/g, "'").trim();
  if (!glyph) return "";
  if (glyph.startsWith("\\")) glyph = glyph.slice(1).trim();
  if (glyph.length >= 2 && glyph.startsWith("$") && glyph.endsWith("$")) {
    glyph = glyph.slice(1, -1).trim();
    if (glyph.startsWith("\\")) glyph = glyph.slice(1).trim();
  }
  return GLYPH_COMMAND_ALIASES[glyph.toLowerCase()] ?? glyph;
}

const DIVISION_TOKENS = new Set(["/", "÷", "／"]);
const INTEGRAL_GLYPHS = new Set(["∫", "∬", "∭", "∮"]);
const RADICAL_RENDERERS = new Set(["radical", "sqrt", "root"]);
const LEIBNIZ_QUOTIENT = /^(?:d|∂)[A-Za-zφϕξθπΔδ]\/(?:d|∂)[A-Za-zφϕξθπΔδ]$/;

export function isIntegralGlyph(value: unknown): boolean {
  return INTEGRAL_GLYPHS.has(normalizeFormalGlyph(value));
}

function isBoardContainer(tree: AuthoringTree): boolean {
  return tree.kind === "container" && tree.renderer === "board";
}

function isFractionBarTree(tree: AuthoringTree): boolean {
  if (tree.renderer === "fraction-bar") return true;
  if (tree.kind !== "token") return false;
  const glyph = normalizeFormalGlyph(tree.value);
  return glyph === "―" || DIVISION_TOKENS.has(glyph);
}

function wantsFractionContainer(tree: AuthoringContainer): boolean {
  if (isBoardContainer(tree)) return false;
  if (tree.renderer === "fraction") return true;
  return tree.layout?.kind === "stack" && Boolean(tree.layout.props?.separator);
}

function completeIntegralContainer(
  tree: AuthoringContainer,
): AuthoringContainer {
  if (
    tree.renderer !== "integral" &&
    tree.renderer !== "int" &&
    !isIntegralGlyph(tree.renderer)
  ) {
    return tree;
  }
  const lowerSlot = tree.slots.find(
    (s) =>
      s.name === "lower" ||
      s.name === "from" ||
      s.role === "lower" ||
      s.role === "subscript",
  );
  const upperSlot = tree.slots.find(
    (s) =>
      s.name === "upper" ||
      s.name === "to" ||
      s.role === "upper" ||
      s.role === "superscript",
  );
  const bodySlot = tree.slots.find(
    (s) =>
      s.name === "body" ||
      s.name === "integrand" ||
      s.role === "body",
  );
  const tailSlot = tree.slots.find(
    (s) =>
      s.name === "tail" ||
      s.name === "differential" ||
      s.role === "tail",
  );

  if (lowerSlot || upperSlot || bodySlot || tailSlot) {
    const slots: Array<{ name: string; role?: string; node: AuthoringTree }> = [];
    if (lowerSlot)
      slots.push({
        ...lowerSlot,
        name: "lower",
        role: lowerSlot.role || "lower",
      });
    if (upperSlot)
      slots.push({
        ...upperSlot,
        name: "upper",
        role: upperSlot.role || "upper",
      });
    if (bodySlot)
      slots.push({ ...bodySlot, name: "body", role: bodySlot.role || "body" });
    if (tailSlot)
      slots.push({ ...tailSlot, name: "tail", role: tailSlot.role || "tail" });
    for (const slot of tree.slots) {
      if (!slots.some((s) => s.node === slot.node)) {
        slots.push(slot);
      }
    }
    return {
      ...tree,
      renderer: "integral",
      layout: {
        kind: "flow",
        props: {
          ...(tree.layout?.props ?? {}),
        },
        includeSelf: true,
      },
      slots,
    };
  }

  if (tree.slots.length >= 3) {
    return {
      ...tree,
      renderer: "integral",
      layout: {
        kind: "flow",
        props: { ...(tree.layout?.props ?? {}) },
        includeSelf: true,
      },
      slots: [
        { name: "lower", role: "lower", node: tree.slots[0]!.node },
        { name: "upper", role: "upper", node: tree.slots[1]!.node },
        { name: "body", role: "body", node: tree.slots[2]!.node },
        ...tree.slots.slice(3).map((slot, i) => ({
          name: i === 0 ? "tail" : slot.name || `slot-${i + 3}`,
          role: slot.role,
          node: slot.node,
        })),
      ],
    };
  }

  return {
    ...tree,
    renderer: "integral",
    layout: {
      kind: "flow",
      props: tree.layout?.props,
      includeSelf: true,
    },
  };
}

function stampIntegralRenderer(tree: AuthoringTree): AuthoringTree {
  if (tree.kind === "token" && isIntegralGlyph(tree.value)) {
    return {
      ...tree,
      value: normalizeFormalGlyph(tree.value),
      renderer: "integral",
    };
  }
  if (tree.kind === "operator" && isIntegralGlyph(tree.token)) {
    return {
      ...tree,
      token: normalizeFormalGlyph(tree.token),
      renderer: "integral",
      layout: {
        kind: "flow",
        props: tree.layout?.props,
        includeSelf: true,
      },
    };
  }
  if (
    tree.kind === "container" &&
    (tree.renderer === "int" || isIntegralGlyph(tree.renderer))
  ) {
    return completeIntegralContainer({ ...tree, renderer: "integral" });
  }
  return tree;
}

function completeFractionContainer(
  tree: AuthoringContainer,
): AuthoringContainer {
  const slots = tree.slots;
  if (slots.length === 3 && isFractionBarTree(slots[1]!.node)) {
    const bar = slots[1]!.node;
    return {
      ...tree,
      renderer: "fraction",
      layout: {
        kind: "stack",
        props: { ...(tree.layout?.props ?? {}), separator: true },
        includeSelf: tree.layout?.includeSelf,
      },
      slots: [
        { ...slots[0]!, name: slots[0]!.name || "numerator" },
        {
          ...slots[1]!,
          name: slots[1]!.name || "separator",
          node:
            bar.kind === "token"
              ? { ...bar, value: "―", renderer: "fraction-bar" }
              : { ...bar, renderer: "fraction-bar" },
        },
        { ...slots[2]!, name: slots[2]!.name || "denominator" },
      ],
    };
  }
  if (slots.length !== 2 || slots.some((slot) => isFractionBarTree(slot.node))) {
    return tree;
  }
  if (!wantsFractionContainer(tree)) return tree;
  return {
    ...tree,
    renderer: "fraction",
    layout: {
      kind: "stack",
      props: { ...(tree.layout?.props ?? {}), separator: true },
      includeSelf: tree.layout?.includeSelf,
    },
    slots: [
      { name: "numerator", node: slots[0]!.node },
      {
        name: "separator",
        node: {
          kind: "token",
          value: "―",
          renderer: "fraction-bar",
        },
      },
      { name: "denominator", node: slots[1]!.node },
    ],
  };
}

function convertDivisionOperator(tree: AuthoringTree): AuthoringTree {
  if (tree.kind !== "operator") return tree;
  if (!DIVISION_TOKENS.has(normalizeFormalGlyph(tree.token))) return tree;
  if (tree.operands.length !== 2 || !tree.operands[0] || !tree.operands[1]) {
    return tree;
  }
  return completeFractionContainer({
    kind: "container",
    id: tree.id,
    renderer: "fraction",
    attributes: tree.attributes,
    layout: { kind: "stack", props: { separator: true } },
    slots: [
      { name: "numerator", node: tree.operands[0].node },
      { name: "denominator", node: tree.operands[1].node },
    ],
  });
}

function unwrapTransparentGroup(tree: AuthoringTree): AuthoringTree {
  if (tree.kind !== "container" || tree.slots.length !== 1 || !tree.slots[0]) {
    return tree;
  }
  if (tree.renderer !== "group") return tree;
  const left = String(tree.layout?.props?.left ?? "(");
  const right = String(tree.layout?.props?.right ?? ")");
  if (left !== "" || right !== "") return tree;
  return unwrapTransparentGroup(tree.slots[0].node);
}

/** `token: "dy/dx"` as apply(dy, dx) is a Leibniz quotient, not a function name. */
function convertLeibnizQuotient(tree: AuthoringTree): AuthoringTree {
  if (tree.kind !== "operator") return tree;
  if (!LEIBNIZ_QUOTIENT.test(normalizeFormalGlyph(tree.token))) return tree;
  if (tree.operands.length !== 2 || !tree.operands[0] || !tree.operands[1]) {
    return tree;
  }
  return completeFractionContainer({
    kind: "container",
    id: tree.id,
    renderer: "fraction",
    attributes: tree.attributes,
    layout: { kind: "stack", props: { separator: true } },
    slots: [
      { name: "numerator", node: unwrapTransparentGroup(tree.operands[0].node) },
      {
        name: "denominator",
        node: unwrapTransparentGroup(tree.operands[1].node),
      },
    ],
  });
}

function wantsRadicalContainer(tree: AuthoringContainer): boolean {
  if (isBoardContainer(tree)) return false;
  if (RADICAL_RENDERERS.has(tree.renderer)) return true;
  const symbol = String(tree.layout?.props?.symbol ?? "");
  const left = String(tree.layout?.props?.left ?? "");
  return symbol === "√" || left === "√" || left === "sqrt";
}

function completeRadicalContainer(tree: AuthoringContainer): AuthoringContainer {
  if (!wantsRadicalContainer(tree)) return tree;
  const radicand = tree.slots[0]?.node;
  if (!radicand) return tree;
  const already =
    tree.renderer === "radical" &&
    tree.layout?.kind === "surround" &&
    tree.layout.props?.symbol === "√" &&
    tree.slots[0]?.name === "radicand";
  if (already) return tree;
  return {
    ...tree,
    renderer: "radical",
    layout: {
      kind: "surround",
      props: { symbol: "√" },
    },
    slots: [{ name: "radicand", node: radicand }],
  };
}

/**
 * Recover presentation slips that do not change grouping: a two-slot fraction
 * missing its bar, infix "/" / "÷", a Leibniz `dy/dx` apply-token, a sqrt
 * surround that used left "√" instead of a radical, and ∫ / int without
 * renderer "integral". Integral operators are prefix (`∫ f`, never `f ∫`).
 * Idempotent. Does not wrap products or invent parentheses.
 */
export function normalizeAuthoringPresentation(tree: AuthoringTree): AuthoringTree {
  const walk = (node: AuthoringTree): AuthoringTree => {
    if (node.kind === "operator") {
      const walked: AuthoringTree = {
        ...node,
        operands: node.operands.map((operand) => ({
          ...operand,
          node: walk(operand.node),
        })),
      };
      return stampIntegralRenderer(
        convertDivisionOperator(convertLeibnizQuotient(walked)),
      );
    }
    if (node.kind === "container") {
      const walked: AuthoringContainer = {
        ...node,
        slots: node.slots.map((slot) => ({
          ...slot,
          node: walk(slot.node),
        })),
      };
      return stampIntegralRenderer(
        completeIntegralContainer(
          completeRadicalContainer(completeFractionContainer(walked)),
        ),
      );
    }
    return stampIntegralRenderer(node);
  };
  return walk(tree);
}

export function incompleteFractionContainers(
  tree: AuthoringTree,
): Array<{ nodeId?: string }> {
  const found: Array<{ nodeId?: string }> = [];
  const visit = (node: AuthoringTree) => {
    if (node.kind === "operator") {
      for (const operand of node.operands) visit(operand.node);
      return;
    }
    if (node.kind === "container") {
      if (
        wantsFractionContainer(node) &&
        node.slots.length === 2 &&
        !node.slots.some((slot) => isFractionBarTree(slot.node))
      ) {
        found.push({ nodeId: node.id });
      }
      for (const slot of node.slots) visit(slot.node);
    }
  };
  visit(tree);
  return found;
}

/** Compile an AI-friendly recursive tree into normalized runtime tables. */
export function compileAuthoringTree(
  tree: AuthoringTree,
  documentId = "authored-expression",
): FormalDocument {
  tree = normalizeAuthoringPresentation(tree);
  const document = createDocument(documentId);
  let relationIndex = 0;
  const compile = (
    spec: AuthoringTree,
    path: string,
  ): { nodeId: string; layoutId: string } => {
    const nodeId = safeId(spec.id ?? path);
    if (document.nodes[nodeId])
      throw new Error(`Duplicate authored node id ${nodeId}`);
    const renderer =
      spec.kind === "container"
        ? spec.renderer
        : spec.kind === "operator"
          ? (spec.renderer ?? "operator")
          : spec.kind === "token"
            ? (spec.renderer ?? "text")
            : spec.kind;
    document.nodes[nodeId] =
      spec.kind === "operator"
        ? {
            kind: "connector",
            value: normalizeFormalGlyph(spec.token),
            renderer,
            attributes: spec.attributes,
          }
        : spec.kind === "container"
          ? {
              kind: "container",
              renderer,
              attributes: spec.attributes,
            }
          : spec.kind === "reference"
            ? {
                kind: "reference",
                attributes: {
                  ...(spec.attributes ?? {}),
                  targetId: spec.targetId,
                },
              }
            : {
                kind: spec.kind === "placeholder" ? "placeholder" : "value",
                contentType:
                  spec.kind === "placeholder"
                    ? "placeholder"
                    : spec.contentType,
                value:
                  spec.kind === "placeholder"
                    ? coerceGlyphValue(spec.label ?? "?") || "?"
                    : normalizeFormalGlyph(spec.value),
                renderer,
                attributes: spec.attributes,
              };
    const subjectId = `layout-${nodeId}-subject`;
    document.layouts[subjectId] = {
      kind: "subject",
      subject: { type: "node", id: nodeId },
      children: [],
    };
    const childLayouts: string[] = [];
    if (spec.kind === "operator")
      spec.operands.forEach((operand, index) => {
        const child = compile(operand.node, `${path}-operand-${index + 1}`);
        const relationId = `relation-${++relationIndex}`;
        document.relations[relationId] = {
          kind: "connection",
          connector: nodeId,
          participant: child.nodeId,
          port: operand.port ?? `operand-${index + 1}`,
          index,
          direction: operand.direction,
          role: operand.role,
        };
        childLayouts.push(child.layoutId);
      });
    if (spec.kind === "container")
      spec.slots.forEach((slot, index) => {
        const child = compile(
          slot.node,
          `${path}-${safeId(slot.name)}-${index + 1}`,
        );
        const relationId = `relation-${++relationIndex}`;
        document.relations[relationId] = {
          kind: "containment",
          parent: nodeId,
          child: child.nodeId,
          slot: slot.name,
          index,
          role: slot.role,
        };
        childLayouts.push(child.layoutId);
      });
    if (!childLayouts.length) return { nodeId, layoutId: subjectId };
    const layoutId = `layout-${nodeId}`;
    const requestedKind = spec.layout?.kind ?? "flow";
    const kind =
      requestedKind === "subject" ||
      ![
        "flow",
        "stack",
        "overlay",
        "grid",
        "attach",
        "surround",
        "free",
      ].includes(requestedKind)
        ? "flow"
        : requestedKind;
    const prefixOperator =
      spec.kind === "operator" &&
      (spec.renderer === "prefix" ||
        spec.renderer === "integral" ||
        isIntegralGlyph(spec.token));
    const children =
      spec.kind === "operator"
        ? prefixOperator
          ? [subjectId, ...childLayouts]
          : [childLayouts[0], subjectId, ...childLayouts.slice(1)]
        : spec.layout?.includeSelf
          ? [subjectId, ...childLayouts]
          : childLayouts;
    document.layouts[layoutId] = {
      kind,
      children,
      props: spec.layout?.props,
    };
    return { nodeId, layoutId };
  };
  const root = compile(tree, "root");
  document.roots = [root.nodeId];
  document.layoutRoots = [root.layoutId];
  const errors = validateDocument(document);
  if (errors.length) throw new Error(errors.join("; "));
  return document;
}

/** Pure staged-authoring helper: replace one placeholder, then compile again. */
export function fillAuthoringPlaceholder(
  tree: AuthoringTree,
  placeholderId: string,
  replacement: AuthoringTree,
): AuthoringTree {
  if (tree.id === placeholderId && tree.kind === "placeholder")
    return structuredClone(replacement);
  if (tree.kind === "operator")
    return {
      ...tree,
      operands: tree.operands.map((operand) => ({
        ...operand,
        node: fillAuthoringPlaceholder(
          operand.node,
          placeholderId,
          replacement,
        ),
      })),
    };
  if (tree.kind === "container")
    return {
      ...tree,
      slots: tree.slots.map((slot) => ({
        ...slot,
        node: fillAuthoringPlaceholder(slot.node, placeholderId, replacement),
      })),
    };
  return structuredClone(tree);
}

/** Convert a normalized document back to the compact recursive authoring form. */
export function decompileAuthoringTree(
  document: FormalDocument,
  rootId = document.roots[0],
): AuthoringTree {
  if (!rootId) throw new Error("Document has no root to decompile");
  const expanded = new Set<string>();
  const visit = (id: string): AuthoringTree => {
    const node = document.nodes[id];
    if (!node) throw new Error(`Cannot decompile missing node ${id}`);
    if (expanded.has(id))
      return { id: `reference-${id}`, kind: "reference", targetId: id };
    expanded.add(id);
    const compiledLayout = document.layouts[`layout-${id}`];
    const layout = compiledLayout
      ? { kind: compiledLayout.kind, props: compiledLayout.props }
      : undefined;
    if (node.kind === "connector") {
      const operands = Object.values(document.relations)
        .filter(
          (relation): relation is ConnectionRelation =>
            relation.kind === "connection" && relation.connector === id,
        )
        .sort((left, right) => left.index - right.index)
        .map((relation) => ({
          port: relation.port,
          direction: relation.direction,
          role: relation.role,
          node: visit(relation.participant),
        }));
      return {
        id,
        kind: "operator",
        token: String(node.value ?? ""),
        renderer: node.renderer,
        attributes: node.attributes,
        layout,
        operands,
      };
    }
    if (node.kind === "container") {
      const slots = Object.values(document.relations)
        .filter(
          (relation): relation is ContainmentRelation =>
            relation.kind === "containment" && relation.parent === id,
        )
        .sort((left, right) => left.index - right.index)
        .map((relation) => ({
          name: relation.slot,
          role: relation.role,
          node: visit(relation.child),
        }));
      return {
        id,
        kind: "container",
        renderer: node.renderer ?? "container",
        attributes: node.attributes,
        layout,
        slots,
      };
    }
    if (node.kind === "placeholder")
      return {
        id,
        kind: "placeholder",
        label: String(node.value ?? "?"),
        attributes: node.attributes,
        layout,
      };
    if (node.kind === "reference")
      return {
        id,
        kind: "reference",
        targetId: String(node.attributes?.targetId ?? ""),
        attributes: node.attributes,
        layout,
      };
    return {
      id,
      kind: "token",
      value: node.value ?? null,
      contentType: node.contentType,
      renderer: node.renderer,
      attributes: node.attributes,
      layout,
    };
  };
  return visit(rootId);
}
