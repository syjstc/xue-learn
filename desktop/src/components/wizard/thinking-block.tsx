"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useT } from "@xue-learn/core/i18n";

/** A small live preview of reasoning actually returned by the provider. */
export function ThinkingBlock({
  content,
  collapsed,
  loading,
}: {
  content: string;
  collapsed: boolean;
  loading?: boolean;
}) {
  const t = useT();
  const contentId = useId();
  const [view, setView] = useState<"preview" | "full" | "closed">(
    collapsed ? "closed" : "preview",
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasContent = Boolean(content.trim());

  useEffect(() => {
    setView(collapsed ? "closed" : "preview");
  }, [collapsed]);

  useEffect(() => {
    if (!loading || view !== "preview") return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [content, loading, view]);

  if (!hasContent && !loading) return null;

  return (
    <div
      data-thinking-block
      aria-busy={Boolean(loading)}
      className="mb-1.5 min-w-0 rounded-lg border border-border/60 bg-muted/50 px-2.5 py-2 text-muted-foreground"
    >
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="inline-flex items-center gap-1.5" role="status">
          {loading ? (
            <span className="inline-flex gap-0.5" aria-hidden="true">
              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-current" />
            </span>
          ) : null}
          {loading ? t("wizard.thinking.loading") : t("wizard.thinking.done")}
        </span>
        {hasContent ? (
          <button
            type="button"
            aria-controls={contentId}
            aria-expanded={view !== "closed"}
            onClick={() =>
              setView(view === "full" ? (collapsed ? "closed" : "preview") : "full")
            }
            className="shrink-0 rounded px-1 text-[10px] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {view === "full" ? t("wizard.thinking.collapse") : t("wizard.collapsible.expand")}
          </button>
        ) : null}
      </div>
      {hasContent && view !== "closed" ? (
        <div
          id={contentId}
          ref={scrollRef}
          data-thinking-content
          className={`mt-1 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 [overflow-wrap:anywhere] ${view === "full" ? "max-h-48" : "max-h-[3.75rem]"}`}
        >
          {content.trim()}
        </div>
      ) : null}
    </div>
  );
}
