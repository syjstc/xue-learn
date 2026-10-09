"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { anchorForBlock, anchorId } from "@xue-learn/core/source/src/shared/domain/material-anchor.ts";
import type { MaterialAnchor } from "@xue-learn/core/source/src/shared/domain/material-anchor.ts";
import {
  contentKeyForAnchor,
  type OpenFollowUpMeta,
  type TextHighlightSpan,
} from "@xue-learn/core/source/src/shared/domain/material-highlight.ts";
import type { LearningMaterialContent } from "@xue-learn/core/source/src/shared/llm/schemas.ts";
import { getFollowUpAnchorRect } from "@/shared/dom/follow-up-anchor-rect";
import {
  getHighlightTextRoot,
  rangeOffsetsInElement,
  rectForTextOffsets,
} from "@xue-learn/core/source/src/shared/dom/text-range-rect.ts";

export type MaterialFollowUpHandlers = {
  inlineChat?: {
    discussions?: Array<{
      id: string;
      anchor: MaterialAnchor;
      messages: import("@xue-learn/core/source/src/shared/domain/material-anchor.ts").FollowUpMessage[];
    }>;
    activeDiscussionId?: string;
    messagesFor: (
      anchor: MaterialAnchor,
      aliases?: MaterialAnchor[],
    ) => import("@xue-learn/core/source/src/shared/domain/material-anchor.ts").FollowUpMessage[];
    send: (
      anchor: MaterialAnchor,
      message: string,
      aliases?: MaterialAnchor[],
    ) => Promise<boolean>;
    stop: () => void;
    selection?: { anchor: MaterialAnchor; text: string; nonce: number };
    clearSelection: () => void;
    sending: boolean;
    error: string;
  };
  textHighlights: Map<string, TextHighlightSpan[]>;
  activeAnchorId: string | null;
  blockThreadIds: Map<number, string>;
  onOpenFollowUp: (anchor: MaterialAnchor, meta?: OpenFollowUpMeta) => void;
  onHighlightClick: (aid: string, threadId?: string) => void;
};

function firstVisibleRangeRect(range: Range): DOMRect | null {
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 || rect.height > 0,
  );
  return rects[0] ?? range.getBoundingClientRect();
}

function safeRangeOffsets(
  root: HTMLElement,
  range: Range,
): { start: number; end: number } | undefined {
  try {
    return rangeOffsetsInElement(getHighlightTextRoot(root), range);
  } catch {
    return undefined;
  }
}

function selectionAnchorFromRange(
  material: LearningMaterialContent,
  container: HTMLElement,
  range: Range,
  selectedText: string,
): MaterialAnchor | null {
  if (!container.contains(range.commonAncestorContainer)) {
    return null;
  }

  const anchorElement =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : (range.commonAncestorContainer as Element | null);

  const codeBlockEl = anchorElement?.closest(
    "[data-code-block][data-content-key]",
  ) as HTMLElement | null;

  const contentEl =
    codeBlockEl ??
    (anchorElement?.closest("[data-content-key]") as HTMLElement | null);

  const blockEl = anchorElement?.closest(
    "[data-block-index]",
  ) as HTMLElement | null;

  const highlightKey = contentEl?.dataset.contentKey;

  if (
    contentEl?.dataset.contentKey === "intro" ||
    contentEl?.dataset.contentKey?.startsWith("intro:code:")
  ) {
    return {
      scope: "introduction",
      subPath: "text.selection",
      selectedText,
      textRange: safeRangeOffsets(contentEl, range),
      highlightKey: highlightKey ?? "intro",
    };
  }

  if (contentEl?.dataset.contentKey?.startsWith("takeaway:")) {
    const idx = Number(contentEl.dataset.contentKey.split(":")[1]);
    return {
      scope: "key_takeaway",
      takeawayIndex: idx,
      subPath: "text.selection",
      selectedText,
      textRange: safeRangeOffsets(contentEl, range),
      highlightKey: contentEl.dataset.contentKey,
    };
  }

  if (!blockEl) return null;

  const blockIndex = Number(blockEl.dataset.blockIndex);
  const block = material.blocks[blockIndex];
  if (!block) return null;

  const blockText =
    contentEl ?? blockEl.querySelector("[data-selectable-text]");
  const textRange =
    blockText instanceof HTMLElement
      ? safeRangeOffsets(blockText, range)
      : undefined;

  return anchorForBlock(block, blockIndex, "text.selection", {
    selectedText,
    textRange,
    highlightKey: highlightKey ?? `block:${blockIndex}`,
  });
}

export function useMaterialTextSelection(
  material: LearningMaterialContent,
  followUp?: MaterialFollowUpHandlers,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectionToolbar, setSelectionToolbar] = useState<{
    anchor: MaterialAnchor;
  } | null>(null);
  const pointerSelectingRef = useRef(false);
  const processRafRef = useRef(0);

  const clearSelection = useCallback(() => {
    setSelectionToolbar(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const processSelection = useCallback(() => {
    const container = containerRef.current;
    if (!followUp || !container) {
      setSelectionToolbar(null);
      return;
    }

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelectionToolbar(null);
      return;
    }

    const text = sel.toString().trim();
    if (text.length < 2) {
      setSelectionToolbar(null);
      return;
    }

    if (
      !container.contains(sel.anchorNode) ||
      !container.contains(sel.focusNode)
    ) {
      setSelectionToolbar(null);
      return;
    }

    const range = sel.getRangeAt(0);
    const anchor = selectionAnchorFromRange(material, container, range, text);
    if (!anchor) {
      setSelectionToolbar(null);
      return;
    }

    setSelectionToolbar({ anchor });
  }, [followUp, material]);

  const scheduleProcessSelection = useCallback(() => {
    cancelAnimationFrame(processRafRef.current);
    processRafRef.current = requestAnimationFrame(() => {
      processRafRef.current = requestAnimationFrame(() => {
        if (pointerSelectingRef.current) return;
        processSelection();
      });
    });
  }, [processSelection]);

  useEffect(() => {
    if (!followUp) return;

    const onPointerDown = () => {
      pointerSelectingRef.current = true;
    };
    const onPointerUp = () => {
      pointerSelectingRef.current = false;
      scheduleProcessSelection();
    };

    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("mouseup", onPointerUp, true);
    document.addEventListener("selectionchange", scheduleProcessSelection);

    return () => {
      cancelAnimationFrame(processRafRef.current);
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("mouseup", onPointerUp, true);
      document.removeEventListener("selectionchange", scheduleProcessSelection);
    };
  }, [followUp, scheduleProcessSelection]);

  const handleMouseUp = scheduleProcessSelection;

  const getSelectionToolbarRect = useCallback(() => {
    if (!selectionToolbar) return null;
    const { anchor } = selectionToolbar;

    const sel = window.getSelection();
    if (
      sel &&
      !sel.isCollapsed &&
      sel.rangeCount > 0 &&
      containerRef.current?.contains(sel.anchorNode)
    ) {
      return firstVisibleRangeRect(sel.getRangeAt(0));
    }

    if (anchor.textRange) {
      const key = contentKeyForAnchor(material, anchor) ?? anchor.highlightKey;
      if (key) {
        const root = containerRef.current?.querySelector(
          `[data-content-key="${key}"]`,
        ) as HTMLElement | null;
        if (root) {
          return rectForTextOffsets(
            getHighlightTextRoot(root),
            anchor.textRange.start,
            anchor.textRange.end,
          );
        }
      }
    }

    return getFollowUpAnchorRect(anchor, anchorId(anchor), material);
  }, [selectionToolbar, material]);

  return {
    containerRef,
    selectionToolbar,
    clearSelection,
    handleMouseUp,
    getSelectionToolbarRect,
  };
}
