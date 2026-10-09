import { useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Globe2, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet } from "@/shared/api";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { useConfirm } from "@/hooks/use-confirm";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";

type WebKnowledgeSourceSummary = {
  id: string;
  title: string;
  url: string;
  publisher?: string | null;
  provider: string;
  status: string;
  retrievedAt?: string | null;
  freshUntil?: string | null;
  stale: boolean;
  targetIds: string[];
  targetTitles: string[];
};

type SourceGroup = {
  key: string;
  label: string;
  sources: WebKnowledgeSourceSummary[];
};

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function groupLabel(source: WebKnowledgeSourceSummary): string {
  const publisher = source.publisher?.trim();
  if (publisher) return publisher;
  return hostnameFromUrl(source.url) || source.provider;
}

function groupSources(sources: WebKnowledgeSourceSummary[]): SourceGroup[] {
  const byKey = new Map<string, SourceGroup>();
  for (const source of sources) {
    const label = groupLabel(source);
    const key = label.toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      existing.sources.push(source);
    } else {
      byKey.set(key, { key, label, sources: [source] });
    }
  }
  return [...byKey.values()].sort((a, b) => {
    if (b.sources.length !== a.sources.length) {
      return b.sources.length - a.sources.length;
    }
    return a.label.localeCompare(b.label);
  });
}

export function GoalWebKnowledgePanel({ goalId }: { goalId: string }) {
  const queryClient = useQueryClient();
  const t = useT();
  const { confirm } = useConfirm();
  const key = ["goals", goalId, "web-knowledge"] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      apiGet<{ sources: WebKnowledgeSourceSummary[] }>(
        `/api/goals/${goalId}/web-knowledge`,
      ),
  });
  const remove = useMutation({
    mutationFn: (sourceId: string) =>
      apiDelete(`/api/goals/${goalId}/web-knowledge/${sourceId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const sources = query.data?.sources ?? [];
  const groups = useMemo(() => groupSources(sources), [sources]);
  const [open, setOpen] = useState(false);
  const staleCount = sources.filter((source) => source.stale).length;

  return (
    <section className="border-t border-[var(--border-200)] px-5 py-3">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Globe2 className="size-4 shrink-0 text-sky-700" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <p className="text-sm font-semibold text-foreground">
              {t("webKnowledge.title")}
            </p>
            {sources.length > 0 ? (
              <span className="rounded-md bg-[var(--bg-100)] px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                {t("webKnowledge.count", { count: sources.length })}
              </span>
            ) : null}
            {staleCount > 0 ? (
              <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                {t("webKnowledge.staleCount", { count: staleCount })}
              </span>
            ) : null}
          </div>
          {!open ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {query.isLoading
                ? t("webKnowledge.loading")
                : sources.length === 0
                  ? t("webKnowledge.empty")
                  : t("webKnowledge.collapsedHint")}
            </p>
          ) : null}
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="mt-2">
          <p className="mb-2 text-xs text-muted-foreground">
            {t("webKnowledge.description")}
          </p>
          {query.isLoading ? (
            <p className="text-xs text-muted-foreground">
              {t("webKnowledge.loading")}
            </p>
          ) : sources.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("webKnowledge.empty")}
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--border-200)]">
              {groups.map((group) => (
                <div
                  key={group.key}
                  className="border-b border-[var(--border-200)] last:border-b-0"
                >
                  <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 bg-[var(--bg-50)] px-2.5 py-1.5">
                    <p className="truncate text-[11px] font-medium text-muted-foreground">
                      {group.label}
                    </p>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {t("webKnowledge.groupCount", {
                        count: group.sources.length,
                      })}
                    </span>
                  </div>
                  <ul>
                    {group.sources.map((source) => (
                      <li
                        key={source.id}
                        className="group/row flex items-start gap-1 border-t border-[var(--border-200)]/60 px-2 py-1.5 first:border-t-0 hover:bg-muted/40"
                      >
                        <div className="min-w-0 flex-1">
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex max-w-full items-center gap-1 text-[13px] font-medium leading-5 text-indigo-700 hover:underline dark:text-indigo-300"
                          >
                            <span className="truncate">{source.title}</span>
                            <ExternalLink className="size-3 shrink-0 opacity-60" />
                          </a>
                          {source.stale || source.targetTitles.length ? (
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                              {source.stale ? (
                                <span className="text-amber-700 dark:text-amber-300">
                                  {t("webKnowledge.staleShort")}
                                </span>
                              ) : null}
                              {source.targetTitles.length ? (
                                <span className="line-clamp-1">
                                  {source.targetTitles.join(" · ")}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
                          aria-label={t("webKnowledge.deleteAria", {
                            title: source.title,
                          })}
                          disabled={remove.isPending}
                          onClick={async () => {
                            const ok = await confirm({
                              title: t("webKnowledge.deleteTitle"),
                              description: t("webKnowledge.deleteDescription", {
                                title: source.title,
                              }),
                              variant: "destructive",
                              confirmLabel: t("webKnowledge.deleteConfirm"),
                            });
                            if (ok) remove.mutate(source.id);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
