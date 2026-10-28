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
    const reveal = () => {
      const slot = root.querySelector<HTMLElement>(
        '[data-stage-index][data-focused="true"]',
      );
      const target =
        root.querySelector<HTMLElement>('.course-callout-detail[data-active="true"]:not([aria-hidden="true"])') ??
        slot?.querySelector<HTMLElement>(
          '.lp-compare-side[data-lp-lit="true"], .code-block-part.is-cued',
        ) ??
        slot?.querySelector<HTMLElement>(
          '[data-lp-lit="true"] .lp-composed-figure-copy',
        ) ??
        slot?.querySelector<HTMLElement>(".lp-composed-figure-copy") ??
        slot ??
        root.querySelector<HTMLElement>('[data-lp-lit="true"]');
      if (!target) return;
      const boundary = root.closest(".course-conversation-board");
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
          const delta = boardFocusScrollDelta(
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
    const boundary = root.closest(".course-conversation-board");
    if (boundary) observer.observe(boundary);
    root.addEventListener("load", schedule, true);
    root.addEventListener("transitionend", schedule);
    window.addEventListener("resize", schedule);
    schedule();
    // The outer conversation pane may still be entering when the cue arrives.
    const settled = window.setTimeout(schedule, 700);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.clearTimeout(settled);
      root.removeEventListener("load", schedule, true);
      root.removeEventListener("transitionend", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [rootRef, focusKey]);
}
