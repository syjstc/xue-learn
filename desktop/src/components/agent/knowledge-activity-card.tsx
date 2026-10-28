import { ExternalLink, Globe2, LoaderCircle, Search } from "lucide-react";
import {
  dedupeContentSources,
  type KnowledgeActivity,
} from "@xue-learn/core/domain";
import { useT } from "@xue-learn/core/i18n";

export function KnowledgeActivityCard({
  activity,
}: {
  activity: KnowledgeActivity;
}) {
  const t = useT();
  const busy = ["searching", "reading", "saving"].includes(activity.status);
  const sources = dedupeContentSources(activity.sources);
  const sourceCount = activity.sources
    ? sources.length
    : (activity.sourceCount ?? 0);
  const retrievedAt = activity.searchedAt ?? sources[0]?.retrievedAt;
  const title =
    activity.status === "searching"
      ? t("knowledgeActivity.searching")
      : activity.status === "reading"
        ? t("knowledgeActivity.reading")
        : activity.status === "saving"
          ? t("knowledgeActivity.saving")
          : activity.status === "error"
            ? t("knowledgeActivity.error")
            : activity.mode === "saved_knowledge"
              ? t("knowledgeActivity.savedSummary", {
                  count: sourceCount,
                })
              : t("knowledgeActivity.searchedSummary", {
                  count: sourceCount,
                  saved: activity.saved
                    ? t("knowledgeActivity.savedSuffix")
                    : "",
                });
  return (
    <aside
      className="rounded-xl border border-[color-mix(in_srgb,var(--info)_28%,var(--border))] bg-(--info-soft) p-3 text-sm"
      aria-live="polite"
      aria-label={t("knowledgeActivity.ariaLabel")}
    >
      <div className="flex items-start gap-2">
        {busy ? (
          <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-info" />
        ) : activity.status === "error" ? (
          <Search className="mt-0.5 size-4 shrink-0 text-warning" />
        ) : (
          <Globe2 className="mt-0.5 size-4 shrink-0 text-info" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 break-words text-xs text-muted-foreground">
            {activity.query}
          </p>
          {retrievedAt || activity.freshUntil ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {retrievedAt
                ? t("knowledgeActivity.retrievedAt", {
                    time: new Date(retrievedAt).toLocaleString(),
                  })
                : ""}
              {retrievedAt && activity.freshUntil ? " · " : ""}
              {activity.freshUntil
                ? t("knowledgeActivity.freshUntil", {
                    time: new Date(activity.freshUntil).toLocaleString(),
                  })
                : ""}
            </p>
          ) : null}
          {activity.error ? (
            <p className="mt-1 text-xs text-warning">
              {activity.error}
              {activity.stale ? t("knowledgeActivity.staleWarning") : ""}
            </p>
          ) : null}
          {sources.length ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium text-info">
                {t("knowledgeActivity.viewSources")}
              </summary>
              <ul className="mt-2 space-y-2">
                {sources.map((source, index) => (
                  <li
                    key={`${source.revisionId ?? source.sourceId ?? source.url ?? source.title}-${index}`}
                  >
                    {source.url && /^https?:\/\//i.test(source.url) ? (
                      <a
                        className="inline-flex items-center gap-1 text-xs font-medium text-(--ds-link) hover:underline"
                        href={source.url}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {source.title}
                        <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="text-xs font-medium">
                        {source.title}
                      </span>
                    )}
                    {source.publisher ? (
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        {source.publisher}
                      </span>
                    ) : null}
                    {source.excerpt ? (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                        {source.excerpt}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
