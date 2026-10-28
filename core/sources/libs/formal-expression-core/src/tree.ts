import type {
  FormalDocument,
  FormalRelation,
  FormalTreeNode,
  NodeId,
} from "./types.js";

export type TreeTraversal = "expression" | "ownership";

function outgoing(
  document: FormalDocument,
  parentId: NodeId,
  traversal: TreeTraversal,
) {
  return Object.entries(document.relations)
    .filter(([, relation]) => {
      if (relation.kind === "containment") return relation.parent === parentId;
      return traversal === "expression" && relation.connector === parentId;
    })
    .sort(([leftId, left], [rightId, right]) => {
      if (left.kind !== right.kind) return left.kind === "containment" ? -1 : 1;
      return left.index - right.index || leftId.localeCompare(rightId);
    })
    .map(([id, relation]) => ({ id, relation }));
}

function childId(relation: FormalRelation) {
  return relation.kind === "containment"
    ? relation.child
    : relation.participant;
}

/**
 * Projects normalized tables into recursive trees without changing snapshot
 * storage. Connector participants become ordered expression children, so tree
 * depth is also explicit grouping/precedence. Containment remains ownership.
 */
export function projectFormalTrees(
  document: FormalDocument,
  traversal: TreeTraversal = "expression",
): FormalTreeNode[] {
  const incomingCounts = new Map<NodeId, number>();
  for (const relation of Object.values(document.relations)) {
    const id = childId(relation);
    incomingCounts.set(id, (incomingCounts.get(id) ?? 0) + 1);
  }
  const visit = (
    id: NodeId,
    depth: number,
    path: ReadonlySet<NodeId>,
    via?: FormalTreeNode["via"],
  ): FormalTreeNode => {
    const node = document.nodes[id];
    if (!node) throw new Error(`Cannot project missing node ${id}`);
    if (path.has(id))
      return { id, node, depth, via, children: [], cycle: true };
    const nextPath = new Set(path);
    nextPath.add(id);
    const children = outgoing(document, id, traversal).map(({ id: relationId, relation }) =>
      visit(childId(relation), depth + 1, nextPath, {
        relationId,
        kind: relation.kind,
        slotOrPort:
          relation.kind === "containment" ? relation.slot : relation.port,
        index: relation.index,
      }),
    );
    return {
      id,
      node,
      depth,
      via,
      children,
      shared: (incomingCounts.get(id) ?? 0) > 1 || undefined,
    };
  };
  return document.roots.map((id) => visit(id, 0, new Set()));
}

/** Returns stable IDs in a recursively controllable selection. */
export function collectFormalSubtree(
  document: FormalDocument,
  rootId: NodeId,
  traversal: TreeTraversal = "expression",
): NodeId[] {
  const result: NodeId[] = [];
  const seen = new Set<NodeId>();
  const visit = (id: NodeId) => {
    if (seen.has(id)) return;
    seen.add(id);
    result.push(id);
    outgoing(document, id, traversal).forEach(({ relation }) =>
      visit(childId(relation)),
    );
  };
  visit(rootId);
  return result;
}
