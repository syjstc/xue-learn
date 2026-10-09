"use client";

import { useMemo } from "react";
import type { ContentSource } from "@xue-learn/core/shared/types/content-sources";
import {
  clampCitationMarkers,
  parseCitationSegments,
} from "@/shared/citations/inline-citations";
import { FEATURE_REFERENCE_SOURCES } from "@xue-learn/core/features";
import type { TextHighlightSpan } from "@xue-learn/core/shared/domain/material-highlight";
import {
  ProseMarkdown,
  proseMarkdownClassName,
  type ProseMarkdownVariant,
} from "@xue-learn/core/components/markdown/prose-markdown";
import { cn } from "@xue-learn/core/utils";
import { CitationBadge } from "./citation-badge.tsx";

/**
 * Renders markdown while turning [^n] into inline citation badges (not GFM footnotes).
 */
export function CitationMarkdownContent({
  content,
  sources,
  className,
  variant = "default",
  onInternalLinkClick,
  spans = [],
  onSpanClick,
  contentKeyPrefix,
  highlightSpansByKey,
}: {
  content: string;
  sources?: ContentSource[];
  className?: string;
  variant?: ProseMarkdownVariant;
  onInternalLinkClick?: () => void;
  spans?: TextHighlightSpan[];
  onSpanClick?: (aid: string, threadId?: string) => void;
  contentKeyPrefix?: string;
  highlightSpansByKey?: Map<string, TextHighlightSpan[]>;
}) {
  const nodes = useMemo(() => {
    if (!content) return null;
    const highlightState = { index: 0 };
    const highlightProps =
      spans.length > 0 ? { spans, onSpanClick, highlightState } : {};
    const codeBlockProps = { contentKeyPrefix, highlightSpansByKey };

    if (!FEATURE_REFERENCE_SOURCES || !sources?.length) {
      return (
        <ProseMarkdown
          content={
            FEATURE_REFERENCE_SOURCES ? content : clampCitationMarkers(content, 0)
          }
          className={className}
          variant={variant}
          onInternalLinkClick={onInternalLinkClick}
          {...highlightProps}
          {...codeBlockProps}
        />
      );
    }

    const segments = parseCitationSegments(content);
    if (segments.length <= 1 && segments[0]?.type === "text") {
      return (
        <ProseMarkdown
          content={content}
          className={className}
          variant={variant}
          onInternalLinkClick={onInternalLinkClick}
          {...highlightProps}
          {...codeBlockProps}
        />
      );
    }

    return (
      <div className={cn(proseMarkdownClassName(variant), className)}>
        {segments.map((seg, i) => {
          if (seg.type === "text") {
            if (!seg.value) return null;
            return (
              <ProseMarkdown
                key={`md-${i}`}
                content={seg.value}
                variant={variant}
                onInternalLinkClick={onInternalLinkClick}
                {...highlightProps}
                {...codeBlockProps}
              />
            );
          }
          const source = sources[seg.index - 1];
          if (!source) return null;
          return (
            <CitationBadge
              key={`cite-${i}-${seg.index}`}
              index={seg.index}
              source={source}
              className="align-super"
            />
          );
        })}
      </div>
    );
  }, [
    content,
    sources,
    className,
    variant,
    onInternalLinkClick,
    spans,
    onSpanClick,
    contentKeyPrefix,
    highlightSpansByKey,
  ]);

  return nodes;
}
