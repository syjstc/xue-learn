import type { Document } from "@langchain/core/documents";
import { parseJson } from "../utils.js";
import type {
  ContentSource,
  ContentSourceKind,
} from "../../../domain/src/index.js";

export type { ContentSource, ContentSourceKind } from "../../../domain/src/index.js";

const EXCERPT_MAX = 220;

function trimExcerpt(text: string): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length <= EXCERPT_MAX ? s : `${s.slice(0, EXCERPT_MAX)}…`;
}

export function sourcesFromRagDocs(docs: Document[]): ContentSource[] {
  return docs.map((d) => {
    const filename =
      typeof d.metadata?.filename === "string" ? d.metadata.filename : undefined;
    const title = filename ?? "上传资料";
    return {
      kind: "upload",
      title,
      filename,
      excerpt: trimExcerpt(d.pageContent),
    };
  });
}

export function sourcesFromWebResults(
  results: { title: string; url: string; content: string }[]
): ContentSource[] {
  return results.map((r) => ({
    kind: "web",
    title: r.title.trim() || r.url,
    url: r.url,
    excerpt: trimExcerpt(r.content),
  }));
}

export function formatRetrievedDocs(docs: Document[]): string {
  return docs
    .map((d, i) => {
      const filename =
        typeof d.metadata?.filename === "string" ? d.metadata.filename : null;
      const label = filename ? `[${i + 1}] (${filename})` : `[${i + 1}]`;
      return `${label} ${d.pageContent}`;
    })
    .join("\n\n---\n\n");
}

export function formatWebResultsForPrompt(
  results: { title: string; url: string; content: string }[]
): string {
  return results
    .map((r, i) => `[${i + 1}] ${r.title.trim() || r.url}\n${r.url}\n${r.content}`)
    .join("\n\n---\n\n");
}

export function trimWebContextText(text: string, maxChars: number): string {
  const s = text.trim();
  if (!s || s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}…`;
}

/** Full-page extracts from Tavily (trimmed per URL, then joined). */
export function formatExtractedPagesForPrompt(
  pages: { url: string; title: string | null; rawContent: string }[],
  maxTotalChars: number,
  sourceIndexByUrl?: Map<string, number>
): string {
  if (pages.length === 0) return "";
  const perPage = Math.max(1500, Math.floor(maxTotalChars / pages.length));
  return pages
    .map((p) => {
      const title = p.title?.trim() || p.url;
      const body = trimWebContextText(p.rawContent, perPage);
      if (!body) return "";
      const n = sourceIndexByUrl?.get(p.url);
      const label = n != null ? `[${n}] ` : "";
      return `${label}${title}\n${p.url}\n\n${body}`;
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

export function enrichWebSourcesWithExtract(
  sources: ContentSource[],
  pages: { url: string; rawContent: string }[]
): ContentSource[] {
  const byUrl = new Map(pages.map((p) => [p.url, p.rawContent]));
  return sources.map((s) => {
    if (s.kind !== "web" || !s.url) return s;
    const raw = byUrl.get(s.url);
    if (!raw?.trim()) return s;
    return { ...s, excerpt: trimExcerpt(raw) };
  });
}

export function serializeContentSources(sources: ContentSource[]): string {
  return JSON.stringify(sources);
}

export function parseContentSources(raw: string | null | undefined): ContentSource[] {
  const parsed = parseJson<unknown>(raw ?? "[]", []);
  if (!Array.isArray(parsed)) return [];
  const out: ContentSource[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const kind = row.kind === "web" ? "web" : row.kind === "upload" ? "upload" : null;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    if (!kind || !title) continue;
    out.push({
      kind,
      title,
      url: typeof row.url === "string" ? row.url : undefined,
      filename: typeof row.filename === "string" ? row.filename : undefined,
      excerpt: typeof row.excerpt === "string" ? row.excerpt : undefined,
      sourceId: typeof row.sourceId === "string" ? row.sourceId : undefined,
      revisionId:
        typeof row.revisionId === "string" ? row.revisionId : undefined,
      publisher: typeof row.publisher === "string" ? row.publisher : undefined,
      publishedAt:
        typeof row.publishedAt === "string" ? row.publishedAt : undefined,
      retrievedAt:
        typeof row.retrievedAt === "string" ? row.retrievedAt : undefined,
      freshUntil:
        typeof row.freshUntil === "string" ? row.freshUntil : undefined,
      freshnessClass:
        row.freshnessClass === "live" ||
        row.freshnessClass === "rapid" ||
        row.freshnessClass === "normal" ||
        row.freshnessClass === "stable"
          ? row.freshnessClass
          : undefined,
      saved: typeof row.saved === "boolean" ? row.saved : undefined,
      stale: typeof row.stale === "boolean" ? row.stale : undefined,
    });
  }
  return out;
}

export function dedupeContentSources(sources: ContentSource[]): ContentSource[] {
  const seen = new Set<string>();
  const out: ContentSource[] = [];
  for (const s of sources) {
    const key =
      s.kind === "web"
        ? `web:${s.url ?? s.title}`
        : `upload:${s.filename ?? s.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Reuse stored generation sources in prompts (no new RAG/search). */
export function formatContentSourcesExcerptsForPrompt(
  sources: ContentSource[]
): string {
  return sources
    .map((s, i) => {
      const excerpt = s.excerpt?.trim();
      if (!excerpt) return "";
      const header =
        s.kind === "web" && s.url
          ? `[${i + 1}] ${s.title}\n${s.url}`
          : `[${i + 1}] ${s.title}${s.filename ? ` (${s.filename})` : ""}`;
      return `${header}\n${excerpt}`;
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}
