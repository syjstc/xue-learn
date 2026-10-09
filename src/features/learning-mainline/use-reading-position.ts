import { useEffect } from "react";
import type { LearningMaterialContent } from "@xue-learn/core/schemas";
import {
  captureReadingPosition,
  pendingLearningReturn,
  rememberLearningPosition,
} from "@/features/learning-trajectory/navigation";
import { mainlineEnabled } from "./enabled.ts";
/** Store a content identity and viewport offset, never a mastery or completion signal. */
export function useMainlineReadingPosition(
  unitId: string,
  sectionId: string,
  material: LearningMaterialContent,
) {
  useEffect(() => {
    if (!mainlineEnabled("persistence")) return;
    const capture = () => {
      if (pendingLearningReturn(unitId)) return;
      const roots = [
        ...document.querySelectorAll<HTMLElement>("[data-learning-section]"),
      ];
      const root = roots.find((el) => {
        const box = el.getBoundingClientRect();
        return (
          box.height > 0 && box.bottom > 100 && box.top < window.innerHeight
        );
      });
      if (!root || root.dataset.learningSection !== sectionId) return;
      const blocks = [
        ...root.querySelectorAll<HTMLElement>("[data-block-index]"),
      ];
      const block = blocks.find(
        (el) =>
          el.getBoundingClientRect().bottom >
          Math.max(100, root.getBoundingClientRect().top),
      );
      if (!block) return;
      const index = Number(block.dataset.blockIndex);
      if (!Number.isInteger(index) || !material.blocks[index]) return;
      rememberLearningPosition(
        captureReadingPosition(unitId, sectionId, material, {
          scope: "block",
          blockIndex: index,
        }),
      );
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scroll = () => {
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          capture();
        }, 300);
    };
    document.addEventListener("scroll", scroll, true);
    const mounted = setTimeout(capture, 700);
    const root = document.querySelector(
      `[data-learning-section="${CSS.escape(sectionId)}"]`,
    );
    const observer = new MutationObserver(scroll);
    if (root) observer.observe(root, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("scroll", scroll, true);
      clearTimeout(mounted);
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [unitId, sectionId, material]);
}
