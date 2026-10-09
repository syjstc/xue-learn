"use client";

import type { ContentSource } from "@xue-learn/core/source/src/shared/types/content-sources.ts";
import { scrollToCitationSource } from "@/shared/citations/inline-citations";

export function CitationBadge({
  index,
  source,
  className = "",
}: {
  index: number;
  source?: ContentSource;
  className?: string;
}) {
  const label = String(index);
  const title = source
    ? source.kind === "web" && source.url
      ? `${source.title} — ${source.url}`
      : source.title
    : `来源 ${index}`;

  return (
    <sup className={`mx-0.5 inline ${className}`}>
      <button
        type="button"
        className="rounded px-0.5 text-[0.65em] font-semibold leading-none text-sky-700 underline decoration-sky-500/60 underline-offset-2 hover:bg-sky-500/15 hover:text-sky-800 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500 dark:text-sky-300 dark:hover:text-sky-200"
        title={title}
        aria-label={`查看参考来源 ${index}：${source?.title ?? ""}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          scrollToCitationSource(index);
        }}
      >
        [{label}]
      </button>
    </sup>
  );
}
