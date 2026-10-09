"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

/** Compact model reasoning indicator. Provider reasoning text is never shown. */
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
  const [expanded, setExpanded] = useState(!collapsed);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (collapsed) setExpanded(false);
  }, [collapsed]);

  useEffect(() => {
    if (!loading) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [content, loading]);

  if (!content.trim() && !loading) return null;

  if (collapsed && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
        className="mb-1.5 flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted/70"
      >
        <span className="inline-flex gap-0.5" aria-hidden="true">
          <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
          <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
          <span className="h-1 w-1 animate-bounce rounded-full bg-current" />
        </span>
        <span>{t("wizard.thinking.done")}</span>
      </button>
    );
  }

  return (
    <div className="mb-1.5 rounded-md border border-border bg-muted/90 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-muted-foreground">
          {loading ? t("wizard.thinking.loading") : t("wizard.thinking.done")}
        </span>
        {!loading ? (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-expanded={true}
            className="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
          >
            {t("wizard.thinking.collapse")}
          </button>
        ) : null}
      </div>
      <div
        ref={scrollRef}
        className="mt-1 flex items-center gap-1.5 text-muted-foreground"
      >
        <span className="inline-flex gap-1" aria-hidden="true">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
        </span>
      </div>
    </div>
  );
}
