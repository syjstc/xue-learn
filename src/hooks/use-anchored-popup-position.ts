"use client";

import { useEffect, useState } from "react";
import {
  rectToAnchorPosition,
  type PopupAnchorPosition,
} from "@xue-learn/core/shared/domain/material-highlight";

/** Recompute viewport anchor position on scroll/resize so fixed popups track content. */
export function useAnchoredPopupPosition(
  getRect: () => DOMRect | null,
  enabled: boolean
): PopupAnchorPosition | null {
  const [pos, setPos] = useState<PopupAnchorPosition | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPos(null);
      return;
    }

    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = getRect();
        setPos(rect ? rectToAnchorPosition(rect) : null);
      });
    };

    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [getRect, enabled]);

  return pos;
}
