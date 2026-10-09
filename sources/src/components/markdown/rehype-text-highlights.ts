import type { TextHighlightSpan } from "../../shared/domain/material-highlight.js";
import {
  charHighlightLookup,
  highlightMarkClassName,
} from "./apply-text-highlights.js";

type RehypeTextHighlightOptions = {
  spans: TextHighlightSpan[];
  startIndex?: number;
  onComplete?: (endIndex: number) => void;
};

type HastNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const COUNT_ONLY_TAGS = new Set([
  "code",
  "kbd",
  "samp",
  "script",
  "style",
]);

function hasClass(node: HastNode, name: string): boolean {
  const value = node.properties?.className;
  return Array.isArray(value)
    ? value.includes(name)
    : typeof value === "string" && value.split(/\s+/).includes(name);
}

function highlightElement(
  span: TextHighlightSpan,
  value: string,
): HastNode {
  return {
    type: "element",
    tagName: "span",
    properties: {
      className: [highlightMarkClassName(span.active)],
      "data-highlight-aid": span.aid,
      "data-highlight-thread-id": span.threadId,
      "data-highlight-interactive": "true",
    },
    children: [{ type: "text", value }],
  };
}

function splitTextNode(
  node: HastNode,
  nodeStart: number,
  lookup: ReturnType<typeof charHighlightLookup>,
): HastNode[] {
  const value = node.value ?? "";
  const parts: HastNode[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    const span = lookup.get(nodeStart + cursor);
    let next = cursor + 1;

    if (!span) {
      while (next < value.length && !lookup.has(nodeStart + next)) next++;
      parts.push({ type: "text", value: value.slice(cursor, next) });
    } else {
      while (
        next < value.length &&
        lookup.get(nodeStart + next)?.aid === span.aid
      ) {
        next++;
      }
      parts.push(highlightElement(span, value.slice(cursor, next)));
    }

    cursor = next;
  }

  return parts;
}

/**
 * Wrap rendered markdown text by walking the HAST tree in document order.
 * Unlike a shared counter inside React component renderers, this order is
 * deterministic even when markdown text crosses strong/em/link boundaries.
 */
export function rehypeTextHighlights(options: RehypeTextHighlightOptions) {
  return (tree: HastNode) => {
    const lookup = charHighlightLookup(options.spans);
    let charIndex = options.startIndex ?? 0;

    const walk = (parent: HastNode, countOnly = false) => {
      const children = parent.children;
      if (!children) return;

      for (let index = 0; index < children.length; index++) {
        const child = children[index]!;

        if (child.type === "text") {
          const nodeStart = charIndex;
          const value = child.value ?? "";
          charIndex += value.length;
          if (countOnly || !value.length) continue;

          const replacement = splitTextNode(child, nodeStart, lookup);
          if (replacement.length === 1 && replacement[0]?.type === "text") {
            continue;
          }
          children.splice(index, 1, ...replacement);
          index += replacement.length - 1;
          continue;
        }

        if (child.type !== "element") continue;

        // These subtrees either have their own offset space or are visual-only.
        if (child.tagName === "pre" || child.tagName === "rt") continue;

        // KaTeX owns a complex duplicated visual/accessibility tree. Keep it
        // intact; course code blocks are handled by CodeBlockShell separately.
        if (hasClass(child, "katex")) continue;

        walk(
          child,
          countOnly ||
            (child.tagName ? COUNT_ONLY_TAGS.has(child.tagName) : false),
        );
      }
    };

    walk(tree);
    options.onComplete?.(charIndex);
  };
}
