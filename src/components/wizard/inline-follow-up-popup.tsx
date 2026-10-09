"use client";

import type { CSSProperties } from "react";
import { X } from "lucide-react";
import {
  rectToAnchorPosition,
  type PopupAnchorPosition,
} from "@xue-learn/core/source/src/shared/domain/material-highlight.ts";
import { useAnchoredPopupPosition } from "@/hooks/use-anchored-popup-position";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

const TOOLBAR_WIDTH = 108;
const TOOLBAR_HEIGHT = 36;

function toolbarStyleFromAnchor(anchorPos: PopupAnchorPosition): CSSProperties {
  const vw =
    typeof window !== "undefined"
      ? window.innerWidth
      : anchorPos.left + TOOLBAR_WIDTH;
  return {
    top: Math.max(8, anchorPos.top - TOOLBAR_HEIGHT - 6),
    left: Math.min(vw - TOOLBAR_WIDTH, anchorPos.left),
  };
}

/** Floating action shown immediately after the learner selects course text. */
export function SelectionFollowUpToolbar({
  getAnchorRect,
  onAsk,
  onDismiss,
}: {
  getAnchorRect: () => DOMRect | null;
  onAsk: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const immediateRect = getAnchorRect();
  const immediatePos = immediateRect
    ? rectToAnchorPosition(immediateRect)
    : null;
  const anchorPos = useAnchoredPopupPosition(getAnchorRect, true);
  const pos = anchorPos ?? immediatePos;
  if (!pos) return null;

  return (
    <div
      data-follow-up-toolbar
      className="fixed z-popover flex items-center gap-0.5 rounded-xl border border-[var(--border-200)] bg-[var(--bg-50)] p-0.5 shadow-lg"
      style={toolbarStyleFromAnchor(pos)}
      role="toolbar"
      aria-label={t("wizard.selection.toolbarLabel")}
    >
      <button
        type="button"
        className="h-8 rounded-lg bg-[var(--brand-600)] px-3 text-xs font-medium text-white outline-none hover:bg-[var(--brand-700)] focus-visible:ring-2 focus-visible:ring-ring"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onAsk}
      >
        {t("wizard.selection.ask")}
      </button>
      <button
        type="button"
        className="flex size-8 items-center justify-center rounded-lg text-[var(--text-400)] outline-none hover:bg-[var(--bg-300)] focus-visible:ring-2 focus-visible:ring-ring"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onDismiss}
        aria-label={t("wizard.selection.dismiss")}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
