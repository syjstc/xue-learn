import type { MaterialAnchor } from "@xue-learn/core/source/src/shared/domain/material-anchor.ts";
import { contentKeyForAnchor } from "@xue-learn/core/source/src/shared/domain/material-highlight.ts";
import { getHighlightTextRoot, rectForTextOffsets } from "@xue-learn/core/source/src/shared/dom/text-range-rect.ts";
import type { LearningMaterialContent } from "@xue-learn/core/source/src/shared/llm/schemas.ts";

function unionRectForHighlightAid(aid: string): DOMRect | null {
  const marks = document.querySelectorAll(
    `[data-highlight-aid="${CSS.escape(aid)}"]`,
  );
  if (!marks.length) return null;

  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const mark of marks) {
    const rect = mark.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    top = Math.min(top, rect.top);
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }

  if (!Number.isFinite(top)) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

/** Live viewport rect for a follow-up anchor (highlight, text range, or block). */
export function getFollowUpAnchorRect(
  anchor: MaterialAnchor,
  anchorIdStr: string,
  material?: LearningMaterialContent
): DOMRect | null {
  const highlightRect = unionRectForHighlightAid(anchorIdStr);
  if (highlightRect) {
    return highlightRect;
  }

  if (anchor.textRange) {
    const key =
      (material ? contentKeyForAnchor(material, anchor) : null) ??
      anchor.highlightKey;
    if (key) {
      const root = document.querySelector(
        `[data-content-key="${key}"]`
      ) as HTMLElement | null;
      if (root) {
        const rect = rectForTextOffsets(
          getHighlightTextRoot(root),
          anchor.textRange.start,
          anchor.textRange.end,
        );
        if (rect) return rect;
      }
    }
  }

  if (anchor.blockIndex != null) {
    const block = document.querySelector(
      `[data-block-index="${anchor.blockIndex}"]`
    );
    return block?.getBoundingClientRect() ?? null;
  }

  if (anchor.scope === "introduction") {
    const root = document.querySelector(
      '[data-content-key="intro"]'
    ) as HTMLElement | null;
    if (root && anchor.textRange) {
      return rectForTextOffsets(
        getHighlightTextRoot(root),
        anchor.textRange.start,
        anchor.textRange.end,
      );
    }
    return root?.getBoundingClientRect() ?? null;
  }

  if (anchor.scope === "key_takeaway" && anchor.takeawayIndex != null) {
    const root = document.querySelector(
      `[data-content-key="takeaway:${anchor.takeawayIndex}"]`,
    ) as HTMLElement | null;
    if (root && anchor.textRange) {
      return rectForTextOffsets(
        getHighlightTextRoot(root),
        anchor.textRange.start,
        anchor.textRange.end,
      );
    }
    return root?.getBoundingClientRect() ?? null;
  }

  return null;
}

export function scrollFollowUpAnchorIntoView(
  anchor: MaterialAnchor,
  anchorIdStr: string,
  material?: LearningMaterialContent,
) {
  const highlight = document.querySelector(
    `[data-highlight-aid="${CSS.escape(anchorIdStr)}"]`,
  );
  if (highlight) {
    highlight.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const key =
    (material ? contentKeyForAnchor(material, anchor) : null) ??
    anchor.highlightKey;
  if (key) {
    const root = document.querySelector(`[data-content-key="${key}"]`);
    if (root) {
      root.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
  }

  if (anchor.blockIndex != null) {
    const block = document.querySelector(
      `[data-block-index="${anchor.blockIndex}"]`
    );
    if (block) {
      block.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
  }

  if (anchor.scope === "introduction") {
    document
      .querySelector('[data-content-key="intro"]')
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  if (anchor.scope === "key_takeaway" && anchor.takeawayIndex != null) {
    document
      .querySelector(`[data-content-key="takeaway:${anchor.takeawayIndex}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}
