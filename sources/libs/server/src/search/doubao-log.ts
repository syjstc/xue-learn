import type { ContentSource } from "../rag/content-sources.js";

export type DoubaoSearchLogResponse = {
  resultCount: number;
  sources: ContentSource[];
  results: Array<{
    title: string;
    url: string;
    contentLength: number;
    contentPreview: string;
  }>;
  promptContext: string;
  contextChars: number;
};

export function buildDoubaoSearchLogResponse(params: {
  results: { title: string; url: string; content: string }[];
  sources: ContentSource[];
  promptContext: string;
}): DoubaoSearchLogResponse {
  return {
    resultCount: params.results.length,
    sources: params.sources,
    results: params.results.map((r) => ({
      title: r.title,
      url: r.url,
      contentLength: r.content.length,
      contentPreview: r.content.slice(0, 600),
    })),
    promptContext: params.promptContext,
    contextChars: params.promptContext.length,
  };
}
