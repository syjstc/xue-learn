"use client";

import { CitationMarkdownContent } from "@/components/citations/citation-markdown-content";
import type { TextHighlightSpan } from "@xue-learn/core/shared/domain/material-highlight";
import type { ContentSource } from "@xue-learn/core/shared/types/content-sources";
import { clampCitationMarkers } from "@/shared/citations/inline-citations";
import { FEATURE_REFERENCE_SOURCES } from "@xue-learn/core/features";
import { TypewriterText } from "@/components/wizard/typewriter-text";
import { ProseMarkdown, type ProseMarkdownVariant } from "@xue-learn/core/components/markdown/prose-markdown";

/**
 * Lesson / note text with optional citations, follow-up highlights, or typewriter.
 * Follow-up highlights are applied on rendered markdown so formatting is preserved.
 */
export function RichText({
  text,
  sources,
  spans = [],
  onSpanClick,
  className,
  markdownVariant = "default",
  animateText = false,
  typewriterResetKey,
  typewriterCharsPerTick,
  typewriterMsPerTick,
  onTextAnimationComplete,
  contentKeyPrefix,
  highlightSpansByKey,
  revealedLength,
  onTypewriterSkip,
}: {
  text: string;
  sources?: ContentSource[];
  spans?: TextHighlightSpan[];
  onSpanClick?: (aid: string, threadId?: string) => void;
  className?: string;
  markdownVariant?: ProseMarkdownVariant;
  animateText?: boolean;
  typewriterResetKey?: string | number;
  typewriterCharsPerTick?: number;
  typewriterMsPerTick?: number;
  onTextAnimationComplete?: () => void;
  contentKeyPrefix?: string;
  highlightSpansByKey?: Map<string, TextHighlightSpan[]>;
  revealedLength?: number;
  onTypewriterSkip?: () => void;
}) {
  if (!text) return null;

  const hasHighlights = spans.length > 0;
  const hasSources = FEATURE_REFERENCE_SOURCES && Boolean(sources?.length);
  const displayText =
    !FEATURE_REFERENCE_SOURCES && !hasHighlights
      ? clampCitationMarkers(text, 0)
      : text;

  const markdownProps = {
    contentKeyPrefix,
    highlightSpansByKey,
  };

  if (animateText) {
    return (
      <TypewriterText
        text={text}
        className={className}
        spans={spans}
        sources={hasSources ? sources : undefined}
        onSpanClick={onSpanClick}
        resetKey={typewriterResetKey}
        charsPerTick={typewriterCharsPerTick}
        msPerTick={typewriterMsPerTick}
        onComplete={onTextAnimationComplete}
        markdownVariant={markdownVariant}
        contentKeyPrefix={contentKeyPrefix}
        highlightSpansByKey={highlightSpansByKey}
        revealedLength={revealedLength}
        onSkip={onTypewriterSkip}
      />
    );
  }

  if (hasHighlights) {
    if (hasSources) {
      return (
        <CitationMarkdownContent
          content={displayText}
          sources={hasSources ? sources : undefined}
          spans={spans}
          onSpanClick={onSpanClick}
          className={className}
          variant={markdownVariant}
          {...markdownProps}
        />
      );
    }

    return (
      <ProseMarkdown
        content={displayText}
        spans={spans}
        onSpanClick={onSpanClick}
        className={className}
        variant={markdownVariant}
        {...markdownProps}
      />
    );
  }

  if (hasSources) {
    return (
      <CitationMarkdownContent
        content={displayText}
        sources={hasSources ? sources : undefined}
        onSpanClick={onSpanClick}
        className={className}
        variant={markdownVariant}
        {...markdownProps}
      />
    );
  }

  return (
    <ProseMarkdown
      content={displayText}
      onSpanClick={onSpanClick}
      className={className}
      variant={markdownVariant}
      {...markdownProps}
    />
  );
}
