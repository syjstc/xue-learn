import type { FormulaChild, FormulaNode, FormulaNodeKind } from "./types.js";

export function nodeFingerprint(input: {
  kind: FormulaNodeKind;
  operator?: string;
  value?: string;
  parseStatus: FormulaNode["parseStatus"];
  children: readonly FormulaChild[];
  opaqueKey?: string;
}): string {
  if (input.parseStatus === "opaque") {
    return `opaque:${input.opaqueKey ?? input.value ?? input.kind}`;
  }
  const kids = input.children
    .map((child) => `${child.role}:${child.node.fingerprint}`)
    .join(",");
  return `${input.kind}|${input.operator ?? ""}|${input.value ?? ""}|${input.parseStatus}[${kids}]`;
}

export function walkFormulaNodes(root: FormulaNode): FormulaNode[] {
  const out: FormulaNode[] = [];
  const visit = (node: FormulaNode) => {
    out.push(node);
    for (const child of node.children) visit(child.node);
  };
  visit(root);
  return out;
}

export function formulaNodeMap(root: FormulaNode): Map<string, FormulaNode> {
  return new Map(walkFormulaNodes(root).map((node) => [node.nodeId, node]));
}

export function parentMap(root: FormulaNode): Map<string, FormulaNode | null> {
  const parents = new Map<string, FormulaNode | null>();
  parents.set(root.nodeId, null);
  const visit = (node: FormulaNode) => {
    for (const child of node.children) {
      parents.set(child.node.nodeId, node);
      visit(child.node);
    }
  };
  visit(root);
  return parents;
}

export function childIndex(
  parent: FormulaNode,
  childId: string,
): { role: string; index: number } | null {
  const index = parent.children.findIndex((child) => child.node.nodeId === childId);
  if (index < 0) return null;
  return { role: parent.children[index]!.role, index };
}

export function mergeRanges(
  ranges: readonly { start: number; end: number }[],
): { start: number; end: number }[] {
  const sorted = [...ranges].filter((range) => range.end > range.start).sort(
    (a, b) => a.start - b.start,
  );
  const merged: { start: number; end: number }[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end) {
      merged.push({ ...range });
    } else {
      last.end = Math.max(last.end, range.end);
    }
  }
  return merged;
}

export function rangesOf(node: FormulaNode): { start: number; end: number }[] {
  return mergeRanges([
    ...node.sourceRanges,
    ...node.children.flatMap((child) => rangesOf(child.node)),
  ]);
}

export function sliceSource(
  source: string,
  ranges: readonly { start: number; end: number }[],
): string {
  return mergeRanges(ranges)
    .map((range) => source.slice(range.start, range.end))
    .join("");
}
