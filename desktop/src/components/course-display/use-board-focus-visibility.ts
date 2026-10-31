import { useLayoutEffect, type RefObject } from "react";

/** Minimal movement for a fitting target; oversized targets start at the top. */
export function boardFocusScrollDelta(
  start: number,
  end: number,
  size: number,
): number {
  const margin = Math.min(12, size / 10);
  if (end - start > size - margin * 2) return start - margin;
  if (start < margin) return start - margin;
  if (end > size - margin) return end - size + margin;
  return 0;
}

/** Scroll only the display's own viewports, never the page or narration pane. */
export function useBoardFocusVisibility(
  rootRef: RefObject<HTMLDivElement | null>,
  focusKey: string,
) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !focusKey) return;
    let frame = 0;
    let interrupted = false;
    const board = root.closest<HTMLElement>(".course-conversation-board");
    const conversation = board?.closest<HTMLElement>(".course-conversation");
    const scrollBoundary = () => board && /(auto|scroll)/.test(getComputedStyle(board).overflowY)
      ? board
      : conversation && /(auto|scroll)/.test(getComputedStyle(conversation).overflowY)
        ? conversation
        : board;
    const reveal = () => {
      if (interrupted) return;
      const slots = root.querySelectorAll<HTMLElement>(
        '[data-stage-index][data-focused="true"]',
      );
      const slot = slots[slots.length - 1];
      const scope = slot ?? root;
      const target =
        scope.querySelector<HTMLElement>('.course-callout-detail[data-active="true"]:not([aria-hidden="true"])') ??
        scope.querySelector<HTMLElement>(
          '.lp-compare-side[data-lp-lit="true"], .code-block-part.is-cued, .lp-code-line.is-cued, .lp-text-board-part.is-cued',
        ) ??
        scope.querySelector<HTMLElement>(
          '[data-lp-lit="true"] .lp-composed-figure-copy',
        ) ??
        scope.querySelector<HTMLElement>(".lp-composed-figure-copy") ??
        slot ??
        root.querySelector<HTMLElement>('[data-lp-lit="true"]');
      if (!target) return;
      const boundary = scrollBoundary();
      for (
        let parent = target.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        if (
          /(auto|scroll)/.test(style.overflowY) &&
          parent.scrollHeight > parent.clientHeight + 1
        ) {
          const box = parent.getBoundingClientRect();
          const rect = target.getBoundingClientRect();
          const panel = slot?.getBoundingClientRect();
          // A newly addressed panel starts at the top when it fits. Focusing
          // a row in a large panel moves only enough to keep that row visible.
          const delta = parent === boundary && panel && panel.height <= parent.clientHeight - 24
            ? panel.top - box.top - parent.clientTop - 12
            : boardFocusScrollDelta(
                rect.top - box.top - parent.clientTop,
                rect.bottom - box.top - parent.clientTop,
                parent.clientHeight,
              );
          if (Math.abs(delta) > 1) parent.scrollTop += delta;
        }
        if (parent === boundary || (!boundary && parent === root)) break;
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reveal);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    root
      .querySelectorAll("[data-stage-index], .lp-composed-figure-copy, .course-callout-detail")
      .forEach((element) => observer.observe(element));
    if (board) observer.observe(board);
    if (conversation) observer.observe(conversation);
    // A new cue follows again; browsing this cue by hand takes precedence.
    const interactionRoot = conversation ?? board ?? root;
    const interrupt = (event: Event) => {
      if (board && event.target instanceof Node && !board.contains(event.target) &&
        (event.type === "pointerdown" || scrollBoundary() === board)) return;
      interrupted = true;
    };
    interactionRoot.addEventListener("wheel", interrupt, {passive: true});
    interactionRoot.addEventListener("touchstart", interrupt, {passive: true});
    interactionRoot.addEventListener("pointerdown", interrupt);
    // Portable display plugins and their focused rows can arrive after mount.
    const mutations = new MutationObserver(schedule);
    mutations.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-focused", "data-active", "data-lp-lit"],
    });
    root.addEventListener("load", schedule, true);
    root.addEventListener("transitionend", schedule);
    window.addEventListener("resize", schedule);
    schedule();
    // The outer conversation pane may still be entering when the cue arrives.
    const settled = window.setTimeout(schedule, 700);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(frame);
      window.clearTimeout(settled);
      interactionRoot.removeEventListener("wheel", interrupt);
      interactionRoot.removeEventListener("touchstart", interrupt);
      interactionRoot.removeEventListener("pointerdown", interrupt);
      root.removeEventListener("load", schedule, true);
      root.removeEventListener("transitionend", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [rootRef, focusKey]);
}
