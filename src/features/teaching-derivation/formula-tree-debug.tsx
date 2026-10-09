"use client";

import { useState } from "react";
import {
  walkFormulaNodes,
  type FormulaAnalysis,
} from "@xue-learn/core/formula-analysis";

export function FormulaTreeDebug({
  analysis,
}: {
  analysis?: FormulaAnalysis;
}) {
  const [open, setOpen] = useState(false);
  if (!analysis) return null;
  const nodes = walkFormulaNodes(analysis.root);
  return (
    <details
      className="rounded-lg border border-dashed border-[color-mix(in_srgb,var(--border)_80%,transparent)] p-2 text-xs"
      open={open}
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-muted-foreground">
        Formula tree ({analysis.analysisStatus}, {nodes.length} nodes)
      </summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">
        {renderTree(analysis.root, analysis.source, 0)}
      </pre>
    </details>
  );
}

function renderTree(
  node: FormulaAnalysis["root"],
  source: string,
  depth: number,
): string {
  const pad = "  ".repeat(depth);
  const slice = node.sourceRanges
    .map((range) => source.slice(range.start, range.end))
    .join("·");
  const line = `${pad}${node.kind}${node.operator ? `(${node.operator})` : ""}${
    node.value ? ` ${node.value}` : ""
  } [${node.parseStatus}] ${slice}`;
  const kids = node.children
    .map((child) => `${pad}  :${child.role}\n${renderTree(child.node, source, depth + 2)}`)
    .join("\n");
  return kids ? `${line}\n${kids}` : line;
}
