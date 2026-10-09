"use client";

import {
  Fragment,
  cloneElement,
  isValidElement,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import type { TextHighlightSpan } from "../../shared/domain/material-highlight.js";

export type TextIndexState = { index: number };

const SKIP_HIGHLIGHT_TAGS = new Set([
  "code",
  "pre",
  "kbd",
  "samp",
  "script",
  "style",
]);

/** Ruby annotations are visual-only; Range offsets exclude <rt> text. */
const SKIP_INDEX_TAGS = new Set(["rt"]);

export function highlightMarkClassName(active: boolean): string {
  return `text-highlight-span${
    active ? " text-highlight-span-active" : ""
  }`;
}

export type CharHighlightLookup = Map<number, TextHighlightSpan>;

/** Expand start/end spans into a per-character index map for underline rendering. */
export function charHighlightLookup(
  spans: TextHighlightSpan[],
): CharHighlightLookup {
  const map = new Map<number, TextHighlightSpan>();
  for (const span of spans) {
    if (span.start >= span.end) continue;
    for (let i = span.start; i < span.end; i++) {
      map.set(i, span);
    }
  }
  return map;
}

function highlightMarkProps(
  span: TextHighlightSpan,
  onSpanClick?: (aid: string, threadId?: string) => void,
) {
  const interactive = Boolean(onSpanClick);
  return {
    "data-highlight-aid": span.aid,
    "data-highlight-thread-id": span.threadId,
    "data-highlight-interactive": interactive ? "true" : undefined,
    className: highlightMarkClassName(span.active),
    ...(onSpanClick
      ? {
          onClick: (event: MouseEvent<HTMLElement>) => {
            event.preventDefault();
            event.stopPropagation();
            onSpanClick(span.aid, span.threadId);
          },
        }
      : {}),
  };
}

function wrapStringWithHighlights(
  text: string,
  lookup: CharHighlightLookup,
  state: TextIndexState,
  onSpanClick?: (aid: string, threadId?: string) => void,
): ReactNode {
  if (!text) return text;

  const chunkStart = state.index;
  const chunkEnd = chunkStart + text.length;
  state.index = chunkEnd;

  let hasHighlight = false;
  for (let i = chunkStart; i < chunkEnd; i++) {
    if (lookup.has(i)) {
      hasHighlight = true;
      break;
    }
  }
  if (!hasHighlight) return text;

  const parts: ReactNode[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const globalIndex = chunkStart + cursor;
    const span = lookup.get(globalIndex);
    if (!span) {
      let next = cursor + 1;
      while (next < text.length && !lookup.has(chunkStart + next)) {
        next++;
      }
      parts.push(text.slice(cursor, next));
      cursor = next;
      continue;
    }

    // Wrap contiguous characters from the same span in one mark so
    // background highlights render as a continuous marker, not per-glyph chips.
    let next = cursor + 1;
    while (
      next < text.length &&
      lookup.get(chunkStart + next)?.aid === span.aid
    ) {
      next++;
    }
    parts.push(
      <span
        key={`${span.aid}-${globalIndex}`}
        {...highlightMarkProps(span, onSpanClick)}
      >
        {text.slice(cursor, next)}
      </span>,
    );
    cursor = next;
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

function walkTextIndex(node: ReactNode, state: TextIndexState): void {
  if (node == null || typeof node === "boolean") return;

  if (typeof node === "string") {
    state.index += node.length;
    return;
  }

  if (typeof node === "number") {
    state.index += String(node).length;
    return;
  }

  if (Array.isArray(node)) {
    for (const child of node) walkTextIndex(child, state);
    return;
  }

  if (isValidElement(node)) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    const tag = typeof element.type === "string" ? element.type : "";
    if (SKIP_INDEX_TAGS.has(tag)) return;
    if (element.props.children != null) {
      walkTextIndex(element.props.children, state);
    }
  }
}

/** Walk rendered markdown nodes and wrap each highlighted character. */
export function applyTextHighlights(
  node: ReactNode,
  spans: TextHighlightSpan[],
  onSpanClick: ((aid: string, threadId?: string) => void) | undefined,
  state: TextIndexState,
  lookup?: CharHighlightLookup,
): ReactNode {
  if (!spans.length) return node;
  const charLookup = lookup ?? charHighlightLookup(spans);
  if (node == null || typeof node === "boolean") return node;

  if (typeof node === "string") {
    return wrapStringWithHighlights(node, charLookup, state, onSpanClick);
  }

  if (typeof node === "number") {
    return wrapStringWithHighlights(String(node), charLookup, state, onSpanClick);
  }

  if (Array.isArray(node)) {
    return node.map((child, index) => (
      <Fragment key={`hl-${state.index}-${index}`}>
        {applyTextHighlights(child, spans, onSpanClick, state, charLookup)}
      </Fragment>
    ));
  }

  if (isValidElement(node)) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    const tag = typeof element.type === "string" ? element.type : "";

    if (SKIP_INDEX_TAGS.has(tag)) {
      return node;
    }

    if (SKIP_HIGHLIGHT_TAGS.has(tag)) {
      if (element.props.children != null) {
        walkTextIndex(element.props.children, state);
      }
      return node;
    }

    if (element.props.children == null) return node;

    return cloneElement(element, {
      children: applyTextHighlights(
        element.props.children,
        spans,
        onSpanClick,
        state,
        charLookup,
      ),
    });
  }

  return node;
}
