"use client";

import { useMemo } from "react";
import { cn } from "../../shared/utils.js";
import { highlightCode, resolveHighlightLanguage } from "./highlight.js";

export function HighlightedCode({
  code,
  language,
  className,
  as = "code",
}: {
  code: string;
  language?: string;
  className?: string;
  /** Use an inline token container when a caller owns the enclosing <code>. */
  as?: "code" | "span";
}) {
  const html = useMemo(
    // Inline fragments share one source: their final newline separates the
    // next fragment and must not be treated as a fenced-block terminator.
    () => highlightCode(code, language, as === "span"),
    [code, language, as],
  );
  const resolvedLanguage = resolveHighlightLanguage(language);
  const Component = as;

  return (
    <Component
      className={cn(
        "hljs font-mono",
        as === "code" && "block",
        resolvedLanguage && `language-${resolvedLanguage}`,
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
