import { walkFormulaNodes, type FormulaNode } from "../../formula-analysis/src/index.js";

export type StructuralAction = {
  pairs: { beforeNodeId: string; afterNodeId: string }[];
  cancelledNodeIds: string[];
};
function unwrap(node: FormulaNode): FormulaNode {
  return node.kind === 'group' && node.children.length === 1 ? unwrap(node.children[0]!.node) : node;
}
const multiply = (n: FormulaNode) => ['*', 'mul', 'implicit_mul'].includes(n.operator ?? '');
function factors(node: FormulaNode): FormulaNode[] {
  const n = unwrap(node);
  return multiply(n) ? n.children.flatMap(c => factors(c.node)) : [n];
}
function key(node: FormulaNode): string {
  const n = unwrap(node);
  if (multiply(n)) return product(factors(n));
  return `${n.kind}:${n.operator ?? ''}:${n.value ?? ''}(${n.children.map(c => `${c.role}:${key(c.node)}`).join(',')})`;
}
function product(items: readonly FormulaNode[]): string {
  const significant = items.filter(n => !(unwrap(n).kind === "number" && unwrap(n).value === "1"));
  return significant.length === 1 ? key(significant[0]!) : `product(${significant.map(key).join(',')})`;
}
function pairs(before: FormulaNode, after: FormulaNode, multiple: boolean): StructuralAction['pairs'] {
  const old = walkFormulaNodes(before).filter(n => n.kind !== 'group');
  const fresh = walkFormulaNodes(after).filter(n => n.kind !== 'group');
  const result: StructuralAction['pairs'] = [];
  for (const node of old) {
    const a = old.filter(n => key(n) === key(node));
    const b = fresh.filter(n => key(n) === key(node));
    if ((a.length === 1 && b.length === 1) || (multiple && a.length === 1 && b.length > 0) || (multiple && a.length > 0 && b.length === 1)) {
      for (const to of b) result.push({ beforeNodeId: node.nodeId, afterNodeId: to.nodeId });
    }
  }
  // Prefer maximal regions; overlapping child mappings would double-paint glyphs.
  return result.filter(pair => !result.some(other => other !== pair && other.beforeNodeId !== pair.beforeNodeId && other.afterNodeId !== pair.afterNodeId &&
    walkFormulaNodes(old.find(n => n.nodeId === other.beforeNodeId)!).some(n => n.nodeId === pair.beforeNodeId) &&
    walkFormulaNodes(fresh.find(n => n.nodeId === other.afterNodeId)!).some(n => n.nodeId === pair.afterNodeId)));
}

/** Local structural identities only. This is not a general algebra prover. */
export function recognizeStructuralAction(kind: 'cancel' | 'expand' | 'merge', before: FormulaNode, after: FormulaNode, hasConditions: boolean): StructuralAction | undefined {
  if (walkFormulaNodes(before).some(n => n.parseStatus !== 'recognized') || walkFormulaNodes(after).some(n => n.parseStatus !== 'recognized')) return;
  const a = unwrap(before), b = unwrap(after);
  if (kind === 'cancel') {
    if (a.kind !== 'fraction' || b.kind !== 'fraction' || !hasConditions) return;
    const top = factors(a.children.find(c => c.role === 'numerator')!.node);
    const bottom = factors(a.children.find(c => c.role === 'denominator')!.node);
    const freshTop = factors(b.children.find(c => c.role === 'numerator')!.node);
    const freshBottom = factors(b.children.find(c => c.role === 'denominator')!.node);
    const matches = top.flatMap((n, i) => bottom.flatMap((d, j) => key(n) === key(d) &&
      product(top.filter((_, k) => k !== i)) === product(freshTop) &&
      product(bottom.filter((_, k) => k !== j)) === product(freshBottom) ? [{ n, d }] : []));
    if (matches.length !== 1) return;
    return { pairs: pairs(a, b, false), cancelledNodeIds: [matches[0]!.n.nodeId, matches[0]!.d.nodeId] };
  }
  const source = kind === 'expand' ? a : b;
  const result = kind === 'expand' ? b : a;
  const fs = factors(source);
  const sums = fs.map((f, index) => ({ n: unwrap(f), index })).filter(({ n }) => n.kind === 'nary' && n.operator === '+');
  if (sums.length !== 1 || fs.length < 2 || result.kind !== 'nary' || result.operator !== '+') return;
  const sum = sums[0]!;
  if (sum.n.children.length !== result.children.length) return;
  const correct = sum.n.children.every((term, i) => product([...fs.slice(0, sum.index), term.node, ...fs.slice(sum.index + 1)]) === product(factors(result.children[i]!.node)));
  return correct ? { pairs: pairs(a, b, true), cancelledNodeIds: [] } : undefined;
}
