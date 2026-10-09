import type {
  AuthoringContainer,
  AuthoringOperator,
  AuthoringToken,
  AuthoringTree,
} from "../../formal-expression-core/src/index.js";

export function tok(
  value: string,
  id?: string,
  extras?: Partial<AuthoringToken>,
): AuthoringToken {
  return {
    kind: "token",
    value,
    id,
    renderer: extras?.renderer ?? "math",
    ...extras,
  };
}

export function op(
  token: string,
  operands: AuthoringTree[],
  id?: string,
  extras?: Partial<AuthoringOperator>,
): AuthoringOperator {
  return {
    kind: "operator",
    token,
    id,
    renderer: extras?.renderer,
    operands: operands.map((node, index) => ({
      port: `operand-${index + 1}`,
      node,
    })),
    ...extras,
  };
}

export function eq(
  left: AuthoringTree,
  right: AuthoringTree,
  id?: string,
): AuthoringOperator {
  return op("=", [left, right], id);
}

export function minus(
  left: AuthoringTree,
  right: AuthoringTree,
  id?: string,
): AuthoringOperator {
  return op("−", [left, right], id);
}

export function plus(
  left: AuthoringTree,
  right: AuthoringTree,
  id?: string,
): AuthoringOperator {
  return op("+", [left, right], id);
}

export function times(
  left: AuthoringTree,
  right: AuthoringTree,
  id?: string,
): AuthoringOperator {
  return op("×", [left, right], id);
}

export function frac(
  numerator: AuthoringTree,
  denominator: AuthoringTree,
  id = "frac",
): AuthoringContainer {
  return {
    kind: "container",
    id,
    renderer: "fraction",
    layout: { kind: "stack", props: { separator: true } },
    slots: [
      { name: "numerator", node: numerator },
      {
        name: "separator",
        node: tok("―", `${id}-bar`, { renderer: "fraction-bar" }),
      },
      { name: "denominator", node: denominator },
    ],
  };
}

/**
 * Semantically empty root that stacks sibling statements on one formula tree.
 * Parallel working lines stay in the same document, with animation scoped to
 * each row so identities never travel between independent statements.
 */
export function board(
  lines: AuthoringTree[],
  id = "board",
): AuthoringContainer {
  return {
    kind: "container",
    id,
    renderer: "board",
    layout: { kind: "stack" },
    slots: lines.map((node, index) => ({
      name: `line-${index + 1}`,
      node,
    })),
  };
}

export function group(inner: AuthoringTree, id?: string): AuthoringContainer {
  return {
    kind: "container",
    id,
    renderer: "group",
    layout: { kind: "surround", props: { left: "(", right: ")" } },
    slots: [{ name: "content", node: inner }],
  };
}

export function radical(inner: AuthoringTree, id = "sqrt"): AuthoringContainer {
  return {
    kind: "container",
    id,
    renderer: "radical",
    layout: { kind: "surround", props: { symbol: "√" } },
    slots: [{ name: "radicand", node: inner }],
  };
}

/** Invisible infix so `f` and `(x)` typeset as juxtaposition / application. */
export function call(
  callee: AuthoringTree,
  argument: AuthoringTree,
  id?: string,
): AuthoringOperator {
  return op(
    "apply",
    [callee, group(argument, id ? `${id}-arg` : undefined)],
    id,
    {
      renderer: "invisible",
    },
  );
}

export function fn(
  name: string,
  argument: AuthoringTree,
  id?: string,
): AuthoringOperator {
  return call(tok(name, id ? `${id}-fn` : undefined), argument, id);
}

export function replaceAuthoringNode(
  tree: AuthoringTree,
  targetId: string,
  replacement: AuthoringTree,
): AuthoringTree {
  if (tree.id === targetId) {
    return {
      ...structuredClone(replacement),
      id: replacement.id ?? targetId,
    } as AuthoringTree;
  }
  if (tree.kind === "operator") {
    return {
      ...tree,
      operands: tree.operands.map((operand) => ({
        ...operand,
        node: replaceAuthoringNode(operand.node, targetId, replacement),
      })),
    };
  }
  if (tree.kind === "container") {
    return {
      ...tree,
      slots: tree.slots.map((slot) => ({
        ...slot,
        node: replaceAuthoringNode(slot.node, targetId, replacement),
      })),
    };
  }
  return structuredClone(tree);
}

export function authoringContainsId(
  tree: AuthoringTree,
  targetId: string,
): boolean {
  if (tree.id === targetId) return true;
  if (tree.kind === "operator")
    return tree.operands.some((operand) =>
      authoringContainsId(operand.node, targetId),
    );
  if (tree.kind === "container")
    return tree.slots.some((slot) => authoringContainsId(slot.node, targetId));
  return false;
}

export function collectAuthoringIds(tree: AuthoringTree): string[] {
  const ids: string[] = [];
  const visit = (node: AuthoringTree) => {
    if (node.id) ids.push(node.id);
    if (node.kind === "operator")
      node.operands.forEach((item) => visit(item.node));
    if (node.kind === "container")
      node.slots.forEach((item) => visit(item.node));
  };
  visit(tree);
  return ids;
}

export function authoringNodeCount(tree: AuthoringTree): number {
  let count = 1;
  if (tree.kind === "operator")
    for (const operand of tree.operands)
      count += authoringNodeCount(operand.node);
  if (tree.kind === "container")
    for (const slot of tree.slots) count += authoringNodeCount(slot.node);
  return count;
}

export function findAuthoringNode(
  tree: AuthoringTree,
  targetId: string,
): AuthoringTree | undefined {
  if (tree.id === targetId) return tree;
  if (tree.kind === "operator") {
    for (const operand of tree.operands) {
      const found = findAuthoringNode(operand.node, targetId);
      if (found) return found;
    }
  }
  if (tree.kind === "container") {
    for (const slot of tree.slots) {
      const found = findAuthoringNode(slot.node, targetId);
      if (found) return found;
    }
  }
  return undefined;
}
