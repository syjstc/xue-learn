import { childIndex, formulaNodeMap, parentMap, walkFormulaNodes } from "./tree.js";
import type {
  FormulaAnalysis,
  FormulaCorrespondence,
  FormulaNode,
  FormulaTransition,
  FormulaTransitionRegion,
  TransitionOp,
} from "./types.js";
import { TRANSITION_COMPILER_VERSION } from "./versions.js";

export function compileFormulaTransition(
  before: FormulaAnalysis,
  after: FormulaAnalysis,
  correspondence: FormulaCorrespondence,
): FormulaTransition {
  if (before.source === after.source) {
    return {
      compilerVersion: TRANSITION_COMPILER_VERSION,
      regions: [
        {
          op: "hold",
          beforeNodeId: before.root.nodeId,
          afterNodeId: after.root.nodeId,
          correspondenceId: correspondence.pairs[0]?.correspondenceId,
        },
      ],
      animationStatus: "node",
    };
  }

  const byBefore = new Map(
    correspondence.pairs.map((pair) => [pair.beforeNodeId, pair]),
  );
  const byAfter = new Map(
    correspondence.pairs.map((pair) => [pair.afterNodeId, pair]),
  );
  const beforeParents = parentMap(before.root);
  const afterParents = parentMap(after.root);
  const beforeNodes = formulaNodeMap(before.root);
  const afterNodes = formulaNodeMap(after.root);
  const raw: FormulaTransitionRegion[] = [];

  for (const pair of correspondence.pairs) {
    const left = beforeNodes.get(pair.beforeNodeId);
    const right = afterNodes.get(pair.afterNodeId);
    if (!left || !right) continue;
    if (!left.sourceRanges.length || !right.sourceRanges.length) continue;
    const leftParent = beforeParents.get(left.nodeId);
    const rightParent = afterParents.get(right.nodeId);
    const leftIndex = leftParent ? childIndex(leftParent, left.nodeId) : { role: "root", index: 0 };
    const rightIndex = rightParent
      ? childIndex(rightParent, right.nodeId)
      : { role: "root", index: 0 };
    const op: TransitionOp =
      leftIndex?.role === rightIndex?.role && leftIndex?.index === rightIndex?.index
        ? "hold"
        : "move";
    raw.push({
      op,
      beforeNodeId: left.nodeId,
      afterNodeId: right.nodeId,
      correspondenceId: pair.correspondenceId,
    });
  }

  for (const id of correspondence.unmatchedBefore) {
    const node = beforeNodes.get(id);
    if (!node?.sourceRanges.length) continue;
    const parent = beforeParents.get(id);
    const parentPair = parent ? byBefore.get(parent.nodeId) : undefined;
    const afterParent = parentPair
      ? afterNodes.get(parentPair.afterNodeId)
      : undefined;
    const slot = parent ? childIndex(parent, id) : null;
    const counterpart = afterParent?.children.find(
      (child, index) =>
        child.role === slot?.role &&
        index === slot?.index &&
        !byAfter.has(child.node.nodeId),
    );
    if (counterpart) {
      raw.push({
        op: "crossfade",
        beforeNodeId: id,
        afterNodeId: counterpart.node.nodeId,
      });
    } else {
      raw.push({ op: "exit", beforeNodeId: id });
    }
  }

  for (const id of correspondence.unmatchedAfter) {
    if (raw.some((region) => region.afterNodeId === id)) continue;
    const node = afterNodes.get(id);
    if (!node?.sourceRanges.length) continue;
    raw.push({ op: "enter", afterNodeId: id });
  }

  const regions = selectNonNested(raw, before.root, after.root, beforeParents, afterParents);
  return {
    compilerVersion: TRANSITION_COMPILER_VERSION,
    regions,
    animationStatus: animationStatus(regions, before.root, after.root),
  };
}

function selectNonNested(
  raw: readonly FormulaTransitionRegion[],
  beforeRoot: FormulaNode,
  afterRoot: FormulaNode,
  beforeParents: Map<string, FormulaNode | null>,
  afterParents: Map<string, FormulaNode | null>,
): FormulaTransitionRegion[] {
  const beforeDepth = depthMap(beforeRoot);
  const afterDepth = depthMap(afterRoot);
  const ranked = [...raw].sort((a, b) => {
    const da = a.beforeNodeId
      ? beforeDepth.get(a.beforeNodeId) ?? 0
      : afterDepth.get(a.afterNodeId ?? "") ?? 0;
    const db = b.beforeNodeId
      ? beforeDepth.get(b.beforeNodeId) ?? 0
      : afterDepth.get(b.afterNodeId ?? "") ?? 0;
    return db - da;
  });
  const chosen: FormulaTransitionRegion[] = [];
  const coveredBefore = new Set<string>();
  const coveredAfter = new Set<string>();
  for (const region of ranked) {
    if (region.op === "hold" && region.beforeNodeId === beforeRoot.nodeId) {
      continue;
    }
    if (
      (region.beforeNodeId && ancestorCovered(region.beforeNodeId, beforeParents, coveredBefore)) ||
      (region.afterNodeId && ancestorCovered(region.afterNodeId, afterParents, coveredAfter))
    ) {
      continue;
    }
    chosen.push(region);
    if (region.beforeNodeId) markDescendants(region.beforeNodeId, beforeRoot, coveredBefore);
    if (region.afterNodeId) markDescendants(region.afterNodeId, afterRoot, coveredAfter);
  }
  if (chosen.length === 0) {
    return [
      {
        op: "crossfade",
        beforeNodeId: beforeRoot.nodeId,
        afterNodeId: afterRoot.nodeId,
      },
    ];
  }
  return chosen;
}

function depthMap(root: FormulaNode): Map<string, number> {
  const depths = new Map<string, number>();
  const visit = (node: FormulaNode, depth: number) => {
    depths.set(node.nodeId, depth);
    for (const child of node.children) visit(child.node, depth + 1);
  };
  visit(root, 0);
  return depths;
}

function ancestorCovered(
  nodeId: string,
  parents: Map<string, FormulaNode | null>,
  covered: Set<string>,
): boolean {
  let current = parents.get(nodeId) ?? null;
  while (current) {
    if (covered.has(current.nodeId)) return true;
    current = parents.get(current.nodeId) ?? null;
  }
  return false;
}

function markDescendants(
  nodeId: string,
  root: FormulaNode,
  covered: Set<string>,
) {
  const target = walkFormulaNodes(root).find((node) => node.nodeId === nodeId);
  if (!target) return;
  for (const node of walkFormulaNodes(target)) covered.add(node.nodeId);
}

function animationStatus(
  regions: readonly FormulaTransitionRegion[],
  beforeRoot: FormulaNode,
  afterRoot: FormulaNode,
): FormulaTransition["animationStatus"] {
  if (
    regions.length === 1 &&
    regions[0]?.beforeNodeId === beforeRoot.nodeId &&
    regions[0]?.afterNodeId === afterRoot.nodeId &&
    regions[0]?.op !== "hold"
  ) {
    return regions[0]?.op === "crossfade" ? "formula" : "formula";
  }
  const hasStable = regions.some(
    (region) =>
      (region.op === "hold" || region.op === "move") &&
      region.beforeNodeId !== beforeRoot.nodeId,
  );
  if (hasStable) return "node";
  if (regions.some((region) => region.op === "crossfade")) return "region";
  return "formula";
}
