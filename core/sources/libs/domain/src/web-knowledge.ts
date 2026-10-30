export type WebKnowledgeFreshnessClass = "live" | "rapid" | "normal" | "stable";

export type ContentSourceKind = "upload" | "web";

export type ContentSource = {
  kind: ContentSourceKind;
  title: string;
  url?: string;
  filename?: string;
  excerpt?: string;
  sourceId?: string;
  revisionId?: string;
  publisher?: string;
  publishedAt?: string;
  retrievedAt?: string;
  freshUntil?: string;
  freshnessClass?: WebKnowledgeFreshnessClass;
  saved?: boolean;
  stale?: boolean;
};

export type KnowledgeActivityMode = "web_search" | "saved_knowledge";
export type KnowledgeActivityStatus =
  | "searching"
  | "reading"
  | "saving"
  | "complete"
  | "skipped"
  | "error";

export type KnowledgeActivity = {
  id: string;
  mode: KnowledgeActivityMode;
  status: KnowledgeActivityStatus;
  query: string;
  reason: string;
  goalId?: string;
  sourceCount?: number;
  sources?: ContentSource[];
  searchedAt?: string;
  freshUntil?: string;
  saved?: boolean;
  stale?: boolean;
  error?: string;
  skipReason?: "unavailable" | "timeout";
};

export function dedupeContentSources(
  sources: ContentSource[] | undefined,
): ContentSource[] {
  if (!sources?.length) return [];
  const seen = new Set<string>();
  return sources.filter((source) => {
    const identity = source.revisionId
      ? `revision:${source.revisionId}`
      : source.sourceId
        ? `source:${source.sourceId}`
        : source.url
          ? `url:${source.url}`
          : undefined;
    if (!identity) return true;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
