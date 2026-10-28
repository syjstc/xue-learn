import { useEffect, useRef, type RefObject } from "react";
import { scrollIntoViewBelowStickyHeader } from "@/shared/dom/scroll-below-sticky-header";

export type StructuredLearningTab =
  | "sq"
  | "material"
  | "map"
  | "questions"
  | "notes";

/** Scroll the active structured-learning tab panel below the sticky header after tab changes. */
export function useScrollStructuredTabPanel(
  tab: StructuredLearningTab,
  panelRefs: Record<StructuredLearningTab, RefObject<HTMLElement | null>>,
  enabled = true,
): void {
  const prevTabRef = useRef(tab);

  useEffect(() => {
    if (!enabled) return;
    if (prevTabRef.current === tab) return;
    prevTabRef.current = tab;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollIntoViewBelowStickyHeader(panelRefs[tab].current);
      });
    });
  }, [enabled, panelRefs, tab]);
}
