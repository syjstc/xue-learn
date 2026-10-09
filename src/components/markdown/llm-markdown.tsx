"use client";

import {
  ProseMarkdown,
  type ProseMarkdownVariant,
} from "@xue-learn/core/source/src/components/markdown/prose-markdown.tsx";

/** GFM markdown for LLM-generated user-facing strings (summaries, outlines, plan text). */
export function LlmMarkdown({
  content,
  className,
  variant = "compact",
}: {
  content: string;
  className?: string;
  variant?: ProseMarkdownVariant;
}) {
  return (
    <ProseMarkdown content={content} variant={variant} className={className} />
  );
}

/** Inline markdown for list items, TOC labels, and mixed title + body rows. */
export function LlmMarkdownInline({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <ProseMarkdown content={content} variant="inline" className={className} />
  );
}
