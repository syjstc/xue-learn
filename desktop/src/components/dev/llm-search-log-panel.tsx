"use client";

import type { ContentSource } from "@xue-learn/core/shared/types/content-sources";

type SearchLogPayload = {
  answer?: string | null;
  sources?: ContentSource[];
  results?: Array<{ title: string; url: string; contentPreview?: string }>;
  promptContext?: string;
  hitCount?: number;
  collectionCount?: number;
  extract?: {
    urlCount: number;
    successCount: number;
    failedCount: number;
    contextChars: number;
    urls: string[];
    failed: Array<{ url: string; error: string }>;
  };
};

function isSearchLogPayload(res: Record<string, unknown>): res is SearchLogPayload {
  return (
    Array.isArray(res.sources) ||
    Array.isArray(res.results) ||
    typeof res.promptContext === "string"
  );
}

export function extractSearchLogPayload(
  response: unknown
): SearchLogPayload | null {
  if (!response || typeof response !== "object") return null;
  const res = response as Record<string, unknown>;
  if (!isSearchLogPayload(res)) return null;
  return res;
}

export function LlmSearchLogPanel({ payload }: { payload: SearchLogPayload }) {
  const sources = payload.sources ?? [];
  const results = payload.results ?? [];
  const isRag = payload.hitCount !== undefined && !payload.answer;

  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-muted-foreground">
        {isRag
          ? "pgvector returns document chunks. The prompt below is what the LLM reads as “Reference context”."
          : "Tavily returns snippets, optional summary, and (when configured) full-page excerpts from the top URLs via Tavily Extract."}
      </p>

      {isRag && payload.collectionCount === 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-amber-900">
          pgvector scope is empty (collectionCount: 0). Upload records exist in
          the database but no chunks were indexed — re-upload the document.
        </p>
      ) : null}

      {payload.answer ? (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            Tavily answer (prepended as Summary)
          </p>
          <p className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-foreground">
            {payload.answer}
          </p>
        </div>
      ) : null}

      {sources.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            Sources ({sources.length}) — also shown in the learner UI
          </p>
          <ul className="space-y-2">
            {sources.map((s, i) => (
              <li
                key={`${s.url ?? s.title}-${i}`}
                className="rounded-lg border border-border bg-card px-3 py-2"
              >
                {s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-indigo-700 hover:underline"
                  >
                    {s.title}
                  </a>
                ) : (
                  <span className="font-medium text-foreground">{s.title}</span>
                )}
                {s.excerpt ? (
                  <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                    {s.excerpt}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {payload.extract && payload.extract.urlCount > 0 ? (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            Tavily extract ({payload.extract.successCount}/
            {payload.extract.urlCount} ok)
          </p>
          <ul className="list-inside list-disc text-xs text-foreground">
            {payload.extract.urls.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-700 hover:underline"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
          {payload.extract.failed.length > 0 ? (
            <p className="mt-1 text-xs text-amber-800">
              Failed:{" "}
              {payload.extract.failed.map((f) => `${f.url} (${f.error})`).join("; ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {results.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            Tavily hits — full snippet preview ({results.length})
          </p>
          <ul className="space-y-2">
            {results.map((r, i) => (
              <li
                key={`${r.url}-${i}`}
                className="rounded-lg border border-border bg-muted px-3 py-2 text-xs"
              >
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-indigo-700 hover:underline"
                >
                  {r.title || r.url}
                </a>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {r.url}
                </p>
                {r.contentPreview ? (
                  <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap wrap-break-word text-foreground">
                    {r.contentPreview}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {payload.promptContext ? (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            Prompt context (sent to LLM)
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap wrap-break-word rounded-lg bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-100">
            {payload.promptContext}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
