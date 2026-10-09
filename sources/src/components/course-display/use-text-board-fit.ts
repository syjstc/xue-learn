import { useLayoutEffect, type RefObject } from "react";

/** Fit the rendered Markdown, including part padding and math, in design pixels.
 * Source-line counts cannot predict wrapped Markdown height. Keep the fit stable
 * across narration cues so highlighting never moves the learner's reference.
 */
export function useTextBoardFit(
  boardRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  source: string,
) {
  useLayoutEffect(() => {
    const board = boardRef.current;
    const pane = board?.closest<HTMLElement>(
      ".lp-composed-figure, .lp-stage-display-frame, .lp-stage-content",
    );
    const viewport = board?.querySelector<HTMLElement>(".lp-code-viewport");
    const content = board?.querySelector<HTMLElement>(".lp-code-source");
    if (!enabled || !board || !pane || !viewport || !content) return;
    let disposed = false;
    const measure = () => {
      if (disposed || pane.clientHeight < 32 || board.clientWidth < 32) return;
      const height = Math.max(
        1,
        pane.clientHeight - (board.offsetHeight - board.clientHeight),
      );
      board.style.setProperty("--lp-code-viewport-height", `${height}px`);
      const fits = (scale: number) => {
        content.style.fontSize = `${scale}em`;
        return (
          content.scrollHeight <= height - 2 &&
          content.scrollWidth <= viewport.clientWidth
        );
      };
      if (!fits(1)) {
        let low = 0;
        let high = 1;
        // Bounded synchronous layout before paint also serves exact export seeks.
        for (let index = 0; index < 12; index += 1) {
          const middle = (low + high) / 2;
          if (fits(middle)) low = middle;
          else high = middle;
        }
        fits(low);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    observer.observe(content);
    void document.fonts?.ready.then(measure);
    return () => {
      disposed = true;
      observer.disconnect();
      content.style.removeProperty("font-size");
      board.style.removeProperty("--lp-code-viewport-height");
    };
  }, [boardRef, enabled, source]);
}
