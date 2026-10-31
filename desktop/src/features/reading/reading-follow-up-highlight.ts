import type {MaterialAnchor} from "@xue-learn/core/shared/domain/material-anchor";

const HIGHLIGHT_NAME = "reading-follow-up";

/** Restore Reading's DOM text offsets, including quotes spanning multiple blocks. */
function quoteRange(root: HTMLElement, anchor: MaterialAnchor): Range | null {
  const offsets = anchor.textRange;
  const block = Array.from(root.querySelectorAll<HTMLElement>("[data-reading-block]"))
    .find(element => element.dataset.readingBlock === anchor.reading?.blockId);
  if (!block || !offsets || offsets.start < 0 || offsets.end <= offsets.start) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  walker.currentNode = block;
  const range = document.createRange();
  let offset = 0, started = false, node: Node | null;
  while ((node = walker.nextNode())) {
    const end = offset + (node.textContent?.length ?? 0);
    if (!started && end > offsets.start) {
      range.setStart(node, offsets.start - offset);
      started = true;
    }
    if (started && end >= offsets.end) {
      range.setEnd(node, offsets.end - offset);
      // A changed document must never highlight unrelated text at old offsets.
      // Selection.toString() inserts paragraph breaks absent from Range.toString().
      return range.toString().replace(/\s/g, "") === anchor.selectedText?.replace(/\s/g, "") ? range : null;
    }
    offset = end;
  }
  return null;
}

/** Paint independently of the browser selection, without changing React's DOM. */
export function observeReadingFollowUpHighlights(root: HTMLElement, anchors: MaterialAnchor[]): () => void {
  if (typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined") return () => {};
  let painted: {highlight: Highlight; ranges: Range[]} | undefined;
  const clear = () => {
    if (!painted) return;
    for (const range of painted.ranges) painted.highlight.delete(range);
    if (!painted.highlight.size && CSS.highlights.get(HIGHLIGHT_NAME) === painted.highlight)
      CSS.highlights.delete(HIGHLIGHT_NAME);
    painted = undefined;
  };
  const paint = () => {
    clear();
    const ranges = anchors.flatMap(anchor => {
      const range = quoteRange(root, anchor);
      return range ? [range] : [];
    });
    if (!ranges.length) return;
    // Multiple mounted chapters share the registry but own only their ranges.
    const highlight = CSS.highlights.get(HIGHLIGHT_NAME) ?? new Highlight();
    for (const range of ranges) highlight.add(range);
    CSS.highlights.set(HIGHLIGHT_NAME, highlight);
    painted = {highlight, ranges};
  };
  paint();
  const observer = new MutationObserver(paint);
  observer.observe(root, {childList: true, subtree: true, characterData: true});
  return () => {observer.disconnect(); clear();};
}
