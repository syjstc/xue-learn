import {
  formulaNodeMap,
  parentMap,
  childIndex,
  walkFormulaNodes,
} from "./tree.js";
import type {
  FormulaAnalysis,
  FormulaCorrespondence,
  FormulaCorrespondencePair,
  FormulaNode,
} from "./types.js";
import { MATCHER_VERSION } from "./versions.js";

export function matchFormulaTrees(
  before: FormulaAnalysis,
  after: FormulaAnalysis,
): FormulaCorrespondence {
  if (
    before.source === after.source &&
    before.sourceHash === after.sourceHash
  ) {
    return lockstep(before.root, after.root, "identical_source");
  }
  const pairs: FormulaCorrespondencePair[] = [];
  const usedBefore = new Set<string>();
  const usedAfter = new Set<string>();
  let nextId = 1;
  const pair = (
    left: FormulaNode,
    right: FormulaNode,
    reason: FormulaCorrespondencePair["reason"],
  ) => {
    if (usedBefore.has(left.nodeId) || usedAfter.has(right.nodeId)) return;
    usedBefore.add(left.nodeId);
    usedAfter.add(right.nodeId);
    pairs.push({
      correspondenceId: `c${nextId}`,
      beforeNodeId: left.nodeId,
      afterNodeId: right.nodeId,
      reason,
    });
    nextId += 1;
  };

  if (
    before.root.kind === after.root.kind &&
    before.root.operator === after.root.operator
  ) {
    pair(before.root, after.root, "same_role");
    matchChildren(before.root, after.root, pair, usedBefore, usedAfter);
  }

  // Algebra moves terms across parents (e.g. across the equals sign). Preserve
  // an exact subtree only when its identity is unambiguous in both formulas.
  // Repeated occurrences deliberately remain unmatched without local evidence.
  const beforeNodes = walkFormulaNodes(before.root);
  const afterNodes = walkFormulaNodes(after.root);
  for (const left of beforeNodes) {
    if (usedBefore.has(left.nodeId) || left.parseStatus !== "recognized")
      continue;
    const leftOccurrences = beforeNodes.filter(
      (node) => node.fingerprint === left.fingerprint,
    );
    const rightOccurrences = afterNodes.filter(
      (node) => node.fingerprint === left.fingerprint,
    );
    if (leftOccurrences.length !== 1 || rightOccurrences.length !== 1) continue;
    const right = rightOccurrences[0]!;
    if (usedAfter.has(right.nodeId) || right.parseStatus !== "recognized")
      continue;
    pair(left, right, "unique_subtree");
    matchChildren(left, right, pair, usedBefore, usedAfter);
  }

  const unmatchedBefore = walkFormulaNodes(before.root)
    .map((node) => node.nodeId)
    .filter((id) => !usedBefore.has(id));
  const unmatchedAfter = walkFormulaNodes(after.root)
    .map((node) => node.nodeId)
    .filter((id) => !usedAfter.has(id));
  return {
    matcherVersion: MATCHER_VERSION,
    pairs,
    unmatchedBefore,
    unmatchedAfter,
  };
}

function lockstep(
  before: FormulaNode,
  after: FormulaNode,
  reason: FormulaCorrespondencePair["reason"],
): FormulaCorrespondence {
  const pairs: FormulaCorrespondencePair[] = [];
  let nextId = 1;
  const visit = (left: FormulaNode, right: FormulaNode) => {
    pairs.push({
      correspondenceId: `c${nextId}`,
      beforeNodeId: left.nodeId,
      afterNodeId: right.nodeId,
      reason,
    });
    nextId += 1;
    const count = Math.min(left.children.length, right.children.length);
    for (let i = 0; i < count; i += 1) {
      visit(left.children[i]!.node, right.children[i]!.node);
    }
  };
  visit(before, after);
  return {
    matcherVersion: MATCHER_VERSION,
    pairs,
    unmatchedBefore: [],
    unmatchedAfter: [],
  };
}

function matchChildren(
  beforeParent: FormulaNode,
  afterParent: FormulaNode,
  pair: (
    left: FormulaNode,
    right: FormulaNode,
    reason: FormulaCorrespondencePair["reason"],
  ) => void,
  usedBefore: Set<string>,
  usedAfter: Set<string>,
) {
  const beforeKids = beforeParent.children;
  const afterKids = afterParent.children;
  const pendingBefore: FormulaNode[] = [];
  const pendingAfter = new Set(afterKids.map((child) => child.node.nodeId));

  for (let i = 0; i < beforeKids.length; i += 1) {
    const left = beforeKids[i]!;
    const right = afterKids[i];
    if (
      right &&
      left.role === right.role &&
      left.node.fingerprint === right.node.fingerprint &&
      !usedAfter.has(right.node.nodeId)
    ) {
      pair(left.node, right.node, "same_role");
      pendingAfter.delete(right.node.nodeId);
      matchChildren(left.node, right.node, pair, usedBefore, usedAfter);
    } else {
      pendingBefore.push(left.node);
    }
  }

  for (const left of pendingBefore) {
    if (usedBefore.has(left.nodeId)) continue;
    const candidates = afterKids
      .map((child) => child.node)
      .filter(
        (node) =>
          !usedAfter.has(node.nodeId) &&
          pendingAfter.has(node.nodeId) &&
          node.fingerprint === left.fingerprint,
      );
    const beforeDupes = pendingBefore.filter(
      (node) =>
        !usedBefore.has(node.nodeId) && node.fingerprint === left.fingerprint,
    );
    if (candidates.length === 1 && beforeDupes.length === 1) {
      const right = candidates[0]!;
      pair(left, right, "unique_subtree");
      pendingAfter.delete(right.nodeId);
      matchChildren(left, right, pair, usedBefore, usedAfter);
    }
  }
}

export function correspondenceMap(
  correspondence: FormulaCorrespondence,
): Map<string, FormulaCorrespondencePair> {
  return new Map(correspondence.pairs.map((pair) => [pair.beforeNodeId, pair]));
}

void formulaNodeMap;
void parentMap;
void childIndex;
