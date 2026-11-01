"use client";
import { useT } from "@xue-learn/core/i18n";

import { useEffect } from "react";
import { useTypewriter } from "@/hooks/use-typewriter";
import type { ContentSource } from "@xue-learn/core/shared/types/content-sources";
import { CitationMarkdownContent } from "@/components/citations/citation-markdown-content";
import { stripTrailingPartialCitation } from "@/shared/citations/inline-citations";
import type { TextHighlightSpan } from "@xue-learn/core/shared/domain/material-highlight";
import type { ProseMarkdownVariant } from "@xue-learn/core/components/markdown/prose-markdown";
import { ProseMarkdown } from "@xue-learn/core/components/markdown/prose-markdown";
import { typingCaretHostClassName } from "@/components/ui/typing-caret";
import { cn } from "@xue-learn/core/utils";

export function TypewriterText({
  text,
  enabled = true,
  resetKey,
  className,
  spans = [],
  sources,
  onSpanClick,
  onComplete,
  charsPerTick,
  msPerTick,
  markdownVariant = "default",
  contentKeyPrefix,
  highlightSpansByKey,
  revealedLength,
  onSkip,
}: {
  text: string;
  enabled?: boolean;
  resetKey?: string | number;
  className?: string;
  spans?: TextHighlightSpan[];
  sources?: ContentSource[];
  onSpanClick?: (aid: string, threadId?: string) => void;
  onComplete?: () => void;
  charsPerTick?: number;
  msPerTick?: number;
  markdownVariant?: ProseMarkdownVariant;
  contentKeyPrefix?: string;
  highlightSpansByKey?: Map<string, TextHighlightSpan[]>;
  /** Provider-timed controlled reveal; omit to use the interval typewriter. */
  revealedLength?: number;
  onSkip?: () => void;
}) {
  const t = useT();
  const interval = useTypewriter(text, {
    enabled,
    resetKey: resetKey ?? text,
    charsPerTick,
    msPerTick,
  });
  const controlled = revealedLength !== undefined;
  const clampedLength = Math.max(0, Math.min(revealedLength ?? 0, text.length));
  const displayed = controlled
    ? text.slice(0, clampedLength)
    : interval.displayed;
  const done = controlled ? clampedLength >= text.length : interval.done;

  useEffect(() => {
    if (done) onComplete?.();
  }, [done, onComplete]);

  // Mid-typewriter text may end on a partial [^n marker; drop it until complete.
  const content = done ? text : stripTrailingPartialCitation(displayed);
  const showCaret = !done && !controlled;
  // Highlights map to full-text offsets — only apply after the animation finishes.
  const markdownProps = {
    contentKeyPrefix,
    highlightSpansByKey,
    ...(done && spans.length > 0 ? { spans, onSpanClick } : {}),
  };
  const rendered = sources?.length ? (
    <CitationMarkdownContent
      key={done ? text : undefined}
      content={content}
      sources={sources}
      variant={markdownVariant}
      className={showCaret ? typingCaretHostClassName : undefined}
      {...markdownProps}
    />
  ) : (
    <ProseMarkdown
      key={done ? text : undefined}
      content={content}
      variant={markdownVariant}
      className={showCaret ? typingCaretHostClassName : undefined}
      {...markdownProps}
    />
  );
  const fullTextUnderlay =
    controlled && !done ? (
      <div
        className="pointer-events-none opacity-25"
        aria-hidden
        data-audio-text-underlay
      >
        {sources?.length ? (
          <CitationMarkdownContent
            content={text}
            sources={sources}
            variant={markdownVariant}
            contentKeyPrefix={contentKeyPrefix}
            highlightSpansByKey={highlightSpansByKey}
          />
        ) : (
          <ProseMarkdown
            content={text}
            variant={markdownVariant}
            contentKeyPrefix={contentKeyPrefix}
            highlightSpansByKey={highlightSpansByKey}
          />
        )}
      </div>
    ) : null;

  return (
    <span
      className={cn(controlled && !done && "relative block", className)}
      onClick={(e) => {
        if (!enabled || done) return;
        e.stopPropagation();
        if (controlled) onSkip?.();
        else interval.skip();
      }}
      title={
        !done ? t("desktop.ui.typewriterText.skipTypingAnimation") : undefined
      }
    >
      {fullTextUnderlay}
      <div
        data-highlight-surface
        className={controlled && !done ? "absolute inset-0" : undefined}
      >
        {rendered}
      </div>
    </span>
  );
}
