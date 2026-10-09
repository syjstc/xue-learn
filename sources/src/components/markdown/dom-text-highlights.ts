"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type DependencyList,
  type RefObject,
} from "react";
import type { TextHighlightSpan } from "../../shared/domain/material-highlight.js";
import { HIGHLIGHT_EXCLUDE_SELECTOR } from "../../shared/dom/text-range-rect.js";
import {
  charHighlightLookup,
  highlightMarkClassName,
  type CharHighlightLookup,
} from "./apply-text-highlights.js";

export function spansStructureKey(spans: TextHighlightSpan[]): string {
  return spans
    .map(
      (span) =>
        `${span.aid}:${span.start}-${span.end}:${span.threadId ?? ""}`,
    )
    .join("|");
}

export function highlightMapStructureKey(
  map: Map<string, TextHighlightSpan[]> | undefined,
): string {
  if (!map?.size) return "";
  return Array.from(map.entries())
    .map(([key, spans]) => `${key}=${spansStructureKey(spans)}`)
    .join(";");
}

function spansActiveKey(spans: TextHighlightSpan[]): string {
  return spans.map((span) => `${span.aid}:${span.active ? 1 : 0}`).join("|");
}

export type DomTextHighlightOptions = {
  /** Keep highlight marks inside these descendant roots (e.g. nested code blocks). */
  preserveInside?: string;
};

function shouldSkipTextNode(node: Node): boolean {
  const parent = node.parentElement;
  if (!parent) return false;
  if (parent.tagName === "RT") return true;
  // KaTeX output is not React-text; wrapping it breaks markdown updates.
  if (parent.closest(".katex, .katex-html")) return true;
  if (parent.closest(HIGHLIGHT_EXCLUDE_SELECTOR)) return true;
  return false;
}

export function removeDomTextHighlights(
  root: HTMLElement,
  options?: DomTextHighlightOptions,
): void {
  const marks = Array.from(root.querySelectorAll("[data-highlight-aid]")).filter(
    (mark) => {
      if (!options?.preserveInside) return true;
      const excluded = mark.closest(options.preserveInside);
      return !excluded || excluded === root;
    },
  );
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) {
      // React may detach nodes while we unwrap; bail instead of throwing.
      if (!mark.parentNode) break;
      const child = mark.firstChild;
      try {
        parent.insertBefore(child, mark);
      } catch {
        break;
      }
    }
    if (mark.parentNode) {
      parent.removeChild(mark);
    }
  }
  root.normalize();
}

export function updateDomTextHighlightActiveState(
  root: HTMLElement,
  spans: TextHighlightSpan[],
): void {
  for (const span of spans) {
    const marks = root.querySelectorAll(
      `[data-highlight-aid="${CSS.escape(span.aid)}"]`,
    );
    for (const mark of marks) {
      if (mark instanceof HTMLElement) {
        mark.className = highlightMarkClassName(span.active);
      }
    }
  }
}

function createTextHighlightMark(
  span: TextHighlightSpan,
  text: string,
): HTMLSpanElement {
  const mark = document.createElement("span");
  mark.dataset.highlightAid = span.aid;
  if (span.threadId) {
    mark.dataset.highlightThreadId = span.threadId;
  }
  mark.dataset.highlightInteractive = "true";
  mark.className = highlightMarkClassName(span.active);
  mark.textContent = text;
  return mark;
}

function wrapTextNodeWithCharHighlights(
  node: Text,
  nodeStart: number,
  lookup: CharHighlightLookup,
): void {
  const text = node.textContent ?? "";
  let hasHighlight = false;
  for (let i = 0; i < text.length; i++) {
    if (lookup.has(nodeStart + i)) {
      hasHighlight = true;
      break;
    }
  }
  if (!hasHighlight) return;

  const fragment = document.createDocumentFragment();
  let cursor = 0;

  while (cursor < text.length) {
    const globalIndex = nodeStart + cursor;
    const span = lookup.get(globalIndex);
    if (!span) {
      let next = cursor + 1;
      while (next < text.length && !lookup.has(nodeStart + next)) {
        next++;
      }
      fragment.appendChild(document.createTextNode(text.slice(cursor, next)));
      cursor = next;
      continue;
    }

    let next = cursor + 1;
    while (
      next < text.length &&
      lookup.get(nodeStart + next)?.aid === span.aid
    ) {
      next++;
    }
    fragment.appendChild(
      createTextHighlightMark(span, text.slice(cursor, next)),
    );
    cursor = next;
  }

  node.parentNode?.replaceChild(fragment, node);
}

export function applyDomTextHighlights(
  root: HTMLElement,
  spans: TextHighlightSpan[],
  _onSpanClick?: (aid: string, threadId?: string) => void,
  options?: DomTextHighlightOptions,
): void {
  if (!root.isConnected) return;
  removeDomTextHighlights(root, options);

  const valid = spans.filter((span) => span.start < span.end && span.end > 0);
  if (!valid.length) return;

  const lookup = charHighlightLookup(valid);
  const textNodes: Array<{ node: Text; start: number }> = [];
  let charIndex = 0;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (shouldSkipTextNode(current)) continue;
    const text = current.textContent ?? "";
    if (!text.length) continue;
    textNodes.push({ node: current as Text, start: charIndex });
    charIndex += text.length;
  }

  for (let i = textNodes.length - 1; i >= 0; i--) {
    const entry = textNodes[i]!;
    wrapTextNodeWithCharHighlights(entry.node, entry.start, lookup);
  }
}

/**
 * Apply follow-up highlights by wrapping rendered text nodes.
 *
 * Imperative wraps must be removed before React reconciles the same tree
 * (content refresh and follow-up open can remount/update ReactMarkdown).
 * Clear any leftover marks by DOM query — do not trust appliedRef alone.
 */
export function useDomTextHighlights(
  rootRef: RefObject<HTMLElement | null>,
  spans: TextHighlightSpan[],
  onSpanClick: ((aid: string, threadId?: string) => void) | undefined,
  enabled: boolean,
  deps: DependencyList,
  options?: DomTextHighlightOptions,
): void {
  const structureKey = spansStructureKey(spans);
  const activeKey = spansActiveKey(spans);
  const contentKey = deps.map(String).join("\0");
  const appliedRef = useRef(false);
  const applyEpochRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Always strip marks before children reconcile. Ignore preserveInside here so
  // nested code-block marks cannot leave React with a mutated tree on merge.
  const root = rootRef.current;
  if (root?.querySelector("[data-highlight-aid]")) {
    removeDomTextHighlights(root);
    appliedRef.current = false;
    applyEpochRef.current += 1;
  }
  const applyEpoch = applyEpochRef.current;

  useEffect(() => {
    const el = rootRef.current;
    if (!onSpanClick || !el) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const mark = target.closest("[data-highlight-aid]");
      if (!(mark instanceof HTMLElement) || !el.contains(mark)) return;
      event.preventDefault();
      event.stopPropagation();
      const aid = mark.dataset.highlightAid;
      if (!aid) return;
      onSpanClick(aid, mark.dataset.highlightThreadId);
    };

    el.addEventListener("click", handleClick);
    return () => el.removeEventListener("click", handleClick);
  }, [onSpanClick, rootRef, enabled, contentKey]);

  useLayoutEffect(() => {
    const el = rootRef.current;
    const opts = optionsRef.current;

    if (!enabled || !el || !spans.length) {
      if (el?.isConnected) {
        removeDomTextHighlights(el);
      }
      appliedRef.current = false;
      return;
    }

    applyDomTextHighlights(el, spans, onSpanClick, opts);
    appliedRef.current = el.querySelector("[data-highlight-aid]") != null;
  }, [
    enabled,
    onSpanClick,
    rootRef,
    structureKey,
    activeKey,
    contentKey,
    applyEpoch,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ...deps,
  ]);

  useLayoutEffect(() => {
    return () => {
      if (rootRef.current?.isConnected) {
        removeDomTextHighlights(rootRef.current);
      }
      appliedRef.current = false;
    };
  }, [rootRef]);
}
