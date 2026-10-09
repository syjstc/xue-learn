/** Subtrees that manage their own highlights or non-content chrome. */
export const HIGHLIGHT_EXCLUDE_SELECTOR = "[data-highlight-exclude]";

/** Prefer the inner highlight surface when present (matches selection + follow-up rects). */
export function getHighlightTextRoot(contentEl: HTMLElement): HTMLElement {
  return (
    (contentEl.querySelector("[data-highlight-surface]") as HTMLElement | null) ??
    contentEl
  );
}

function shouldSkipTextNode(node: Node): boolean {
  const parent = node.parentElement;
  if (!parent) return false;
  if (parent.tagName === "RT") return true;
  if (parent.closest(HIGHLIGHT_EXCLUDE_SELECTOR)) return true;
  return false;
}

/** Count visible text in a range, skipping ruby rt and excluded subtrees. */
function countVisibleTextInRange(range: Range): number {
  const fragment = range.cloneContents();
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  let count = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (shouldSkipTextNode(node)) continue;
    count += node.textContent?.length ?? 0;
  }
  return count;
}

/** Character offset within root's visible text (skips ruby rt and excluded subtrees). */
export function textOffsetInRoot(
  root: HTMLElement,
  container: Node,
  offset: number,
): number {
  const probe = document.createRange();
  probe.selectNodeContents(root);
  probe.setEnd(container, offset);
  return countVisibleTextInRange(probe);
}

/** Character offsets for a DOM selection within a text container. */
export function rangeOffsetsInElement(
  root: HTMLElement,
  range: Range,
): { start: number; end: number } {
  return {
    start: textOffsetInRoot(root, range.startContainer, range.startOffset),
    end: textOffsetInRoot(root, range.endContainer, range.endOffset),
  };
}

function locateTextOffsets(
  root: HTMLElement,
  start: number,
  end: number,
): {
  startNode: Node;
  startOffset: number;
  endNode: Node;
  endOffset: number;
} | null {
  let charIndex = 0;
  let startNode: Node | null = null;
  let startOffset = 0;
  let endNode: Node | null = null;
  let endOffset = 0;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (shouldSkipTextNode(node)) continue;
    const len = node.textContent?.length ?? 0;
    if (!startNode && charIndex + len > start) {
      startNode = node;
      startOffset = start - charIndex;
    }
    if (!endNode && charIndex + len >= end) {
      endNode = node;
      endOffset = end - charIndex;
      break;
    }
    charIndex += len;
  }

  if (!startNode || !endNode) return null;

  return { startNode, startOffset, endNode, endOffset };
}

/** DOM Range for character offsets within a text container. */
export function domRangeForOffsets(
  root: HTMLElement,
  start: number,
  end: number,
): Range | null {
  const located = locateTextOffsets(root, start, end);
  if (!located) return null;

  const range = document.createRange();
  try {
    range.setStart(located.startNode, located.startOffset);
    range.setEnd(located.endNode, located.endOffset);
    return range.collapsed ? null : range;
  } catch {
    return null;
  }
}

/** Viewport rect for character offsets within a text container. */
export function rectForTextOffsets(
  root: HTMLElement,
  start: number,
  end: number,
): DOMRect | null {
  const range = domRangeForOffsets(root, start, end);
  if (!range) return null;

  try {
    const rect = range.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 ? rect : null;
  } catch {
    return null;
  }
}
