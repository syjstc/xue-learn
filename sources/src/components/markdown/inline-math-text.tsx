import React from "react";
import { MathLatex } from "./math-latex.js";

// Delimited math and explicit emphasis only: no authored HTML, links or images.
// Code spans take precedence, and TeX control-word whitespace is never removed.
const tokens =
  /(`+)[\s\S]*?\1|(?<!\\)\$\$[\s\S]+?(?<!\\)\$\$|(?<![\\$])\$(?!\$)(?:\\\$|[^$\n])+?(?<!\\)\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\*\*[^*]+\*\*/gu;

export function hasInlineMath(text: string): boolean {
  return [...text.matchAll(tokens)].some(
    ([part]) =>
      !part.startsWith("`") &&
      (part.startsWith("$") ||
        part.startsWith("\\") ||
        (part.startsWith("**") && hasInlineMath(part.slice(2, -2)))),
  );
}

export function InlineMathText({
  text = "",
  display = false,
  fitToContainer = false,
  wrapDisplayMath,
}: {
  text?: string;
  display?: boolean;
  fitToContainer?: boolean;
  wrapDisplayMath?: (latex: string) => string;
}) {
  const parts: React.ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(tokens)) {
    const part = match[0],
      start = match.index!;
    if (start > offset) parts.push(text.slice(offset, start));
    if (part.startsWith("`")) {
      const count = match[1].length;
      parts.push(<code key={start}>{part.slice(count, -count)}</code>);
    } else if (part.startsWith("**")) {
      parts.push(
        <strong key={start}>
          <InlineMathText
            text={part.slice(2, -2)}
            display={display}
            fitToContainer={fitToContainer}
            wrapDisplayMath={wrapDisplayMath}
          />
        </strong>,
      );
    } else {
      const block = part.startsWith("$$") || part.startsWith("\\[");
      const edge = part.startsWith("\\") || block ? 2 : 1;
      const latex = part.slice(edge, -edge);
      parts.push(
        <MathLatex
          key={start}
          latex={block && wrapDisplayMath ? wrapDisplayMath(latex) : latex}
          display={display || block}
          className={block ? "rm-math-block" : "rm-math-inline"}
          fitToContainer={fitToContainer}
        />,
      );
    }
    offset = start + part.length;
  }
  if (offset < text.length) parts.push(text.slice(offset));
  return <>{parts}</>;
}
