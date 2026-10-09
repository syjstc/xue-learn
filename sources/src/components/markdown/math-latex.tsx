"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { renderKatexHtml } from "../../shared/markdown/katex-setup.js";

export function MathLatex({
  latex,
  display = false,
  className,
  fitToContainer = false,
}: {
  latex: string;
  display?: boolean;
  className?: string;
  /** Projection copy must fit without a scrollbar or clipped math atoms. */
  fitToContainer?: boolean;
}) {
  const inlineRef = useRef<HTMLSpanElement>(null);
  const blockRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => {
    try {
      return renderKatexHtml(latex, display);
    } catch {
      return latex;
    }
  }, [latex, display]);
  // Keep React from replacing measured KaTeX nodes on cue-only rerenders.
  const markup = useMemo(() => ({ __html: html }), [html]);

  useLayoutEffect(() => {
    const root = display ? blockRef.current : inlineRef.current;
    const math = root?.querySelector<HTMLElement>(".katex");
    const pane = root?.parentElement?.closest<HTMLElement>(
      "p, li, td, th, .lp-semantic-copy",
    );
    if (!fitToContainer || !root || !math || !pane) return;
    let disposed = false;
    let measured = "";
    const originalDisplay = math.style.display;
    const originalWhiteSpace = math.style.whiteSpace;
    // Inline KaTeX can break at operators, but each .base is indivisible.
    // Preserve those breaks; only fit the widest atom group. Display math
    // remains one expression. Use design pixels, never cue-scaled bounds.
    if (display) {
      math.style.display = "inline-block";
      math.style.whiteSpace = "nowrap";
    }
    const fit = (force = false) => {
      if (disposed) return;
      const style = getComputedStyle(pane);
      const width =
        pane.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      const key = `${width}:${style.fontSize}`;
      if (width <= 0 || (!force && key === measured)) return;
      measured = key;
      root.style.fontSize = "";
      const groups = math.querySelectorAll<HTMLElement>(".katex-html > .base");
      const natural =
        display || !groups.length
          ? math.offsetWidth
          : Math.max(...Array.from(groups, (group) => group.offsetWidth));
      const scale =
        natural > 0 ? Math.min(1, Math.max(1, width - 2) / natural) : 1;
      root.style.fontSize = scale < 1 ? `${scale}em` : "";
    };
    fit();
    const observer = new ResizeObserver(() => fit());
    observer.observe(pane);
    const fontLoaded = () => fit(true);
    void document.fonts?.ready.then(fontLoaded);
    document.fonts?.addEventListener("loadingdone", fontLoaded);
    return () => {
      disposed = true;
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", fontLoaded);
      root.style.fontSize = "";
      math.style.display = originalDisplay;
      math.style.whiteSpace = originalWhiteSpace;
    };
  }, [html, display, fitToContainer]);

  if (display) {
    return (
      <div
        ref={blockRef}
        data-math-fit={fitToContainer || undefined}
        className={
          className ?? "katex-display my-2 overflow-x-auto text-foreground"
        }
        dangerouslySetInnerHTML={markup}
      />
    );
  }

  return (
    <span
      ref={inlineRef}
      data-math-fit={fitToContainer || undefined}
      className={className ?? "katex-inline text-foreground"}
      dangerouslySetInnerHTML={markup}
    />
  );
}
