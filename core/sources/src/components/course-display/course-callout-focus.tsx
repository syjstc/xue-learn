import { useLayoutEffect, useRef, useState } from "react";

type Row = { top: number; height: number };

/** Measure the uncued, reserved rows once per layout. Only the independent light
 * plate moves; glyph positions and wrapping never depend on a narration cue. */
export function CourseCalloutFocus({ layoutKey, items }: {
  layoutKey: string;
  items: readonly { emphasis: number }[];
}) {
  const plateRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  useLayoutEffect(() => {
    const container = plateRef.current?.parentElement;
    if (!container) return;
    let disposed = false;
    const elements = [...container.querySelectorAll<HTMLElement>(":scope > .course-callout-detail")];
    const measure = () => {
      if (disposed) return;
      const next = elements.map(row => ({ top: row.offsetTop, height: row.offsetHeight }));
      setRows(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    elements.forEach(row => observer.observe(row));
    void document.fonts?.ready.then(measure);
    return () => { disposed = true; observer.disconnect(); };
  }, [layoutKey]);

  // The frame already contains the eased, tick-derived crossfade. Weighted row
  // geometry makes one plate travel continuously, including reverse seeks and
  // unequal multiline rows. A repeated cue has the same weights and holds.
  const weight = items.reduce((sum, item, index) => sum + (rows[index] ? item.emphasis : 0), 0);
  const weighted = (field: keyof Row) => weight > 0
    ? items.reduce((sum, item, index) => sum + (rows[index]?.[field] ?? 0) * item.emphasis, 0) / weight : 0;
  return <div ref={plateRef} className="course-callout-focus" aria-hidden="true" style={{
    transform: `translateY(${weighted("top")}px)`, height: weighted("height"), opacity: Math.min(1, weight),
  }}><i/></div>;
}
