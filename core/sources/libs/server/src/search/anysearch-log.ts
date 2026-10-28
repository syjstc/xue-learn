import type { ContentSource } from "../rag/content-sources.js";

/** Serializable AnySearch payload for dev logs (truncated by logger max chars). */
export type AnySearchLogResponse = {
  resultCount: number;
  responseTimeMs?: number;
  sources: ContentSource[];
  results: Array<{
    title: string;
    url: string;
    contentLength: number;
    contentPreview: string;
  }>;
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

export function buildAnySearchLogResponse(params: {
  results: { title: string; url: string; content: string }[];
  sources: ContentSource[];
  promptContext: string;
  responseTimeMs?: number;
  extract?: AnySearchLogResponse["extract"];
}): AnySearchLogResponse {
  return {
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
