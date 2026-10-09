import type { ContentSource } from "../rag/content-sources.js";

/** Serializable Tavily payload for dev logs (truncated by logger max chars). */
export type TavilyLogResponse = {
  answer: string | null;
  resultCount: number;
  responseTimeMs?: number;
  /** Links + excerpts shown in the learner UI. */
  sources: ContentSource[];
  /** Per-hit detail from Tavily API. */
  results: Array<{
    title: string;
    url: string;
    contentLength: number;
    contentPreview: string;
  }>;
  /** Exact text injected into the next LLM prompt as reference context. */
  promptContext: string;
  contextChars: number;
  extract?: {
    urlCount: number;
    successCount: number;
    failedCount: number;
    contextChars: number;
    urls: string[];
    failed: Array<{ url: string; error: string }>;
  };
};

export function buildTavilyLogResponse(params: {
  answer?: string | null;
  results: { title: string; url: string; content: string }[];
  sources: ContentSource[];
  promptContext: string;
  responseTimeMs?: number;
  extract?: TavilyLogResponse["extract"];
}): TavilyLogResponse {
  return {
    answer: params.answer?.trim() || null,
    resultCount: params.results.length,
    responseTimeMs: params.responseTimeMs,
    sources: params.sources,
    results: params.results.map((r) => ({
      title: r.title,
      url: r.url,
      contentLength: r.content.length,
      contentPreview: r.content.slice(0, 600),
    })),
    promptContext: params.promptContext,
    contextChars: params.promptContext.length,
    extract: params.extract,
  };
}
