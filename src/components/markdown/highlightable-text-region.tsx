"use client";

import type { TextHighlightSpan } from "@xue-learn/core/shared/domain/material-highlight";
import type { ContentSource } from "@xue-learn/core/shared/types/content-sources";
import { RichText } from "@/components/markdown/rich-text";
import type { ProseMarkdownVariant } from "@xue-learn/core/components/markdown/prose-markdown";

/**
 * Selectable course text with follow-up highlights.
 * Prose highlights stay React-owned so opening the selection toolbar cannot
 * invalidate React's DOM sibling references. Nested code blocks keep their own
 * keyed highlight regions through highlightSpansByKey.
 */
export function HighlightableTextRegion({
  contentKey,
  text,
  spans = [],
  highlightSpansByKey,
  sources,
  className,
  onSpanClick,
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
  spans?: TextHighlightSpan[];
  /** Full highlight map so nested code blocks can resolve block:N:code:M spans. */
  highlightSpansByKey?: Map<string, TextHighlightSpan[]>;
  sources?: ContentSource[];
  className?: string;
  onSpanClick?: (aid: string, threadId?: string) => void;
  animateText?: boolean;
  typewriterResetKey?: string | number;
  typewriterCharsPerTick?: number;
  typewriterMsPerTick?: number;
  onTextAnimationComplete?: () => void;
  markdownVariant?: ProseMarkdownVariant;
  revealedLength?: number;
  onTypewriterSkip?: () => void;
}) {
  return (
    <span
      data-content-key={contentKey}
      data-selectable-text
      className={className}
    >
      <div data-highlight-surface>
        <RichText
          key={`${contentKey}:${text}`}
          text={text}
          spans={spans}
          sources={sources}
          onSpanClick={onSpanClick}
          animateText={animateText}
          typewriterResetKey={typewriterResetKey}
          typewriterCharsPerTick={typewriterCharsPerTick}
          typewriterMsPerTick={typewriterMsPerTick}
          onTextAnimationComplete={onTextAnimationComplete}
          markdownVariant={markdownVariant}
          revealedLength={revealedLength}
          onTypewriterSkip={onTypewriterSkip}
          contentKeyPrefix={contentKey}
          highlightSpansByKey={highlightSpansByKey}
        />
      </div>
    </span>
  );
}
