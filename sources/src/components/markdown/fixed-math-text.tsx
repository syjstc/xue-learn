import React, { useLayoutEffect, useRef, useState } from "react";

/** Fit the complete typeset surface, in layout pixels. Focus/camera transforms
 * never participate in measuring or change the text's wrapping inputs. */
export function FixedMathText({
  children,
  contentKey,
  enabled,
  style,
  nowrap = false,
}: {
  children: React.ReactNode;
  contentKey: string;
  enabled: boolean;
  style: React.CSSProperties;
  nowrap?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    body = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    if (!enabled) {
      if (body.current) body.current.style.width = "100%";
      setScale(1);
      return;
    }
    let disposed = false;
    const fit = () => {
      if (disposed || !host.current || !body.current) return;
      const h = host.current,
        b = body.current;
      b.style.width = nowrap ? "max-content" : "100%";
      // A KaTeX atom can be wider than its inline/block wrapper. Give that
      // complete atom an uncropped layout surface before scaling the surface.
      const width = Math.max(
        b.scrollWidth,
        ...Array.from(
          b.querySelectorAll<HTMLElement>(".katex-html > .base"),
          (n) => n.offsetWidth,
        ),
      );
      if (width > h.clientWidth) b.style.width = `${width}px`;
      setScale(
        Math.min(
          1,
          Math.max(1, h.clientWidth - 2) / Math.max(1, b.scrollWidth),
          Math.max(1, h.clientHeight - 2) / Math.max(1, b.scrollHeight),
        ),
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host.current!);
    void document.fonts?.ready.then(fit);
    document.fonts?.addEventListener("loadingdone", fit);
    return () => {
      disposed = true;
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", fit);
    };
  }, [contentKey, enabled, nowrap]);
  return (
    <div
      ref={host}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        minWidth: 0,
        justifyContent:
          style.textAlign === "start"
            ? "flex-start"
            : style.textAlign === "end"
              ? "flex-end"
              : "center",
      }}
    >
      <div
        ref={body}
        data-template-text-body="true"
        data-math-scale={enabled ? scale : undefined}
        style={{
          ...style,
          width: "100%",
          minWidth: 0,
          flexShrink: 0,
          transform: enabled && scale < 1 ? `scale(${scale})` : undefined,
          transformOrigin: `${style.textAlign === "start" ? "left" : style.textAlign === "end" ? "right" : "center"} center`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
