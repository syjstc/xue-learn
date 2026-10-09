"use client";

import type { TextHighlightSpan } from "@xue-learn/core/source/src/shared/domain/material-highlight.ts";
import type { ContentSource } from "@xue-learn/core/source/src/shared/types/content-sources.ts";
import { HighlightableTextRegion } from "@/components/markdown/highlightable-text-region";
import type { MaterialFollowUpHandlers } from "@/hooks/use-material-text-selection";

function spansForKey(
  map: Map<string, TextHighlightSpan[]>,
  key: string,
): TextHighlightSpan[] {
  return map.get(key) ?? [];
}

export function Selectable({
  contentKey,
  text,
  highlights,
  sources,
  className,
  followUp,
  animateText = false,
  typewriterResetKey,
  typewriterCharsPerTick,
  typewriterMsPerTick,
  onTextAnimationComplete,
  markdownVariant = "default",
  revealedLength,
  onTypewriterSkip,
}: {
  contentKey: string;
  text: string;
  highlights: Map<string, TextHighlightSpan[]>;
  sources?: ContentSource[];
  className?: string;
  followUp?: MaterialFollowUpHandlers;
  animateText?: boolean;
  typewriterResetKey?: string | number;
  typewriterCharsPerTick?: number;
  typewriterMsPerTick?: number;
  onTextAnimationComplete?: () => void;
  markdownVariant?: "default" | "compact" | "muted" | "inline";
  revealedLength?: number;
  onTypewriterSkip?: () => void;
}) {
  const spans = spansForKey(highlights, contentKey);
  return (
    <HighlightableTextRegion
      contentKey={contentKey}
      text={text}
      spans={spans}
      highlightSpansByKey={highlights}
      sources={sources}
      className={className}
      onSpanClick={followUp?.onHighlightClick}
      animateText={animateText}
      typewriterResetKey={typewriterResetKey}
      typewriterCharsPerTick={typewriterCharsPerTick}
      typewriterMsPerTick={typewriterMsPerTick}
      onTextAnimationComplete={onTextAnimationComplete}
      markdownVariant={markdownVariant}
      revealedLength={revealedLength}
      onTypewriterSkip={onTypewriterSkip}
    />
  );
}
