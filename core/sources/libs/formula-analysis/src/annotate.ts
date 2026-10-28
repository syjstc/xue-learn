import { mergeRanges } from "./tree.js";
import type { FormulaNode, SourceRange } from "./types.js";

const ID_SAFE = /[^A-Za-z0-9_-]/g;

export function wrapNodeId(nodeId: string): string {
  return `tf-${nodeId.replace(ID_SAFE, "_")}`;
}

/** Wrap selected non-overlapping source ranges with KaTeX \\htmlId. */
export function annotateLatex(
  source: string,
  nodes: readonly FormulaNode[],
  allowNested = false,
): { latex: string; wrappedNodeIds: string[]; fallback: boolean } {
  const candidates = nodes
    .map((node) => {
      const merged = mergeRanges(node.sourceRanges);
      const ranges =
        allowNested && merged.length
          ? [{ start: merged[0]!.start, end: merged[merged.length - 1]!.end }]
          : merged;
      return { node, ranges };
    })
    .filter((item) => item.ranges.length === 1)
    .sort((a, b) => b.ranges[0]!.start - a.ranges[0]!.start);

  if (allowNested) {
    const accepted: typeof candidates = [];
    for (const item of candidates) {
      const r = item.ranges[0]!;
      if (
        r.start < 0 ||
        r.end > source.length ||
        r.end <= r.start ||
        !isSafeWrap(source.slice(r.start, r.end), source.slice(r.end))
      )
        continue;
      if (
        accepted.some((a) => {
          const q = a.ranges[0]!;
          return (
            overlaps(q, r) &&
            !(q.start <= r.start && q.end >= r.end) &&
            !(r.start <= q.start && r.end >= q.end)
          );
        })
      )
        continue;
      accepted.push(item);
    }
    const events = new Map<
      number,
      { open: typeof accepted; close: typeof accepted }
    >();
    for (const item of accepted) {
      const r = item.ranges[0]!;
      for (const pos of [r.start, r.end])
        if (!events.has(pos)) events.set(pos, { open: [], close: [] });
      events.get(r.start)!.open.push(item);
      events.get(r.end)!.close.push(item);
    }
    let result = "";
    for (let i = 0; i <= source.length; i++) {
      const event = events.get(i);
      if (event) {
        result += "}".repeat(event.close.length);
        for (const item of event.open.sort(
          (a, b) => b.ranges[0]!.end - a.ranges[0]!.end,
        ))
          result += `\\htmlId{${wrapNodeId(item.node.nodeId)}}{`;
      }
      if (i < source.length) result += source[i];
    }
    return {
      latex: result,
      wrappedNodeIds: accepted.map((item) => item.node.nodeId),
      fallback: !accepted.length && nodes.length > 0,
    };
  }
  const used: SourceRange[] = [];
  const wrappedNodeIds: string[] = [];
  let latex = source;
  for (const item of candidates) {
    const range = item.ranges[0]!;
    if (
      range.start < 0 ||
      range.end > source.length ||
      range.end <= range.start
    ) {
      continue;
    }
    if (used.some((seen) => overlaps(seen, range) || contains(seen, range))) {
      continue;
    }
    const fragment = source.slice(range.start, range.end);
    if (!isSafeWrap(fragment, source.slice(range.end))) continue;
    const id = wrapNodeId(item.node.nodeId);
    const wrapped = `\\htmlId{${id}}{${fragment}}`;
    latex = latex.slice(0, range.start) + wrapped + latex.slice(range.end);
    used.push(range);
    wrappedNodeIds.push(item.node.nodeId);
  }
  return {
    latex,
    wrappedNodeIds,
    fallback: wrappedNodeIds.length === 0 && nodes.length > 0,
  };
}

function overlaps(a: SourceRange, b: SourceRange): boolean {
  return a.start < b.end && b.start < a.end;
}

function contains(outer: SourceRange, inner: SourceRange): boolean {
  return outer.start <= inner.start && outer.end >= inner.end;
}

function isSafeWrap(fragment: string, following: string): boolean {
  // A parser may expose an unsupported macro as a standalone token. Wrapping
  // its name alone steals the following argument (e.g. \underbrace{...}).
  // Keep that command attached to its group; an enclosing region can move.
  if (
    /\\[A-Za-z]+\*?$/.test(fragment.trimEnd()) &&
    following.trimStart().startsWith("{")
  )
    return false;
  let depth = 0;
  for (let i = 0; i < fragment.length; i += 1) {
    if (fragment[i] === "{") depth += 1;
    if (fragment[i] === "}") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}
