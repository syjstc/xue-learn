"use client";

import { BookOpen, ExternalLink, FileText, Globe } from "lucide-react";
import type { ContentSource } from "@xue-learn/core/shared/types/content-sources";
import { citationSourceElementId } from "@/shared/citations/inline-citations";
import { FEATURE_REFERENCE_SOURCES } from "@xue-learn/core/features";
import { useT } from "@xue-learn/core/i18n";

export function ContentSourcesPanel({
  sources,
  compact = false,
  showCitationHint = false,
  className = "",
}: {
  sources: ContentSource[];
  compact?: boolean;
  /** Mention inline [n] badges when material uses citation markers. */
  showCitationHint?: boolean;
  className?: string;
}) {
  const t = useT();
  if (!FEATURE_REFERENCE_SOURCES || sources.length === 0) return null;

  return (
    <aside
      className={`rounded-lg border border-sky-200/80 bg-sky-50/60 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100 ${compact ? "p-2.5" : "p-3"} ${className}`}
      aria-label={t("wizard.sources.ariaLabel")}
    >
      <div className="flex items-start gap-2">
        <BookOpen
          className={`mt-0.5 shrink-0 text-sky-700 ${compact ? "h-3.5 w-3.5" : "h-4 w-4"}`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p
            className={`font-medium text-sky-900 dark:text-sky-100 ${compact ? "text-[11px]" : "text-xs"}`}
          >
            {t("wizard.sources.title")}
          </p>
          <p
            className={`mt-0.5 text-sky-800/90 dark:text-sky-200/90 ${compact ? "text-[10px]" : "text-[11px]"}`}
          >
            {showCitationHint
              ? t("wizard.sources.citationHint")
              : t("wizard.sources.description")}
          </p>
          <ul className={`mt-2 space-y-2 ${compact ? "text-[11px]" : "text-xs"}`}>
            {sources.map((s, i) => {
              const n = i + 1;
              return (
                <li
                  key={`${s.kind}-${i}`}
                  id={citationSourceElementId(n)}
                  className="scroll-mt-4 rounded-md text-foreground transition-colors"
                >
                  {s.kind === "web" && s.url ? (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-indigo-700 hover:underline"
                    >
                      <span className="mr-0.5 font-mono text-[10px] text-sky-800">
                        [{n}]
                      </span>
                      <Globe className="h-3 w-3 shrink-0" aria-hidden />
                      {s.title}
                      <ExternalLink
                        className="h-3 w-3 shrink-0 opacity-70"
                        aria-hidden
                      />
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-medium text-foreground">
                      <span className="mr-0.5 font-mono text-[10px] text-sky-800">
                        [{n}]
                      </span>
                      {s.kind === "web" ? (
                        <Globe className="h-3 w-3 shrink-0 text-sky-700" aria-hidden />
                      ) : (
                        <FileText
                          className="h-3 w-3 shrink-0 text-sky-700"
                          aria-hidden
                        />
                      )}
                      {s.title}
                    </span>
                  )}
                  {s.excerpt && (
                    <p className="mt-0.5 line-clamp-2 text-muted-foreground">{s.excerpt}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </aside>
  );
}
