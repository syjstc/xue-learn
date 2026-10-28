import { isWebSearchAvailable } from "./runtime-config.js";
import { searchLearningPathWithAnySearchSources } from "./anysearch.js";
import { searchLearningPathWithDoubaoSources } from "./doubao.js";
import {
  searchLearningPathWithSources as searchLearningPathWithTavilySources,
  type LearningPathSearchPurpose,
} from "./tavily.js";
import type { ContentSource } from "../rag/content-sources.js";
import { ensureSearchRuntimeConfig } from "./runtime-config.js";

export type SearchPayload = {
  context: string;
  sources: ContentSource[];
  sourceContents: Record<string, string>;
  provider?: string;
};

export type { LearningPathSearchPurpose };

export async function searchLearningPathWithSources(
  query: string,
  options?: {
    purpose?: LearningPathSearchPurpose;
    maxResults?: number;
    extractTopUrls?: number;
    meta?: Record<string, unknown>;
  },
): Promise<SearchPayload> {
  const userId =
    typeof options?.meta?.userId === "string"
      ? options.meta.userId
      : undefined;
  if (!(await isWebSearchAvailable(userId)))
    return { context: "", sources: [], sourceContents: {} };

  const config = await ensureSearchRuntimeConfig(userId);
  let result: Omit<SearchPayload, "provider">;
  if (config.provider === "doubao") {
    result = await searchLearningPathWithDoubaoSources(query, options);
  } else if (config.provider === "anysearch") {
    result = await searchLearningPathWithAnySearchSources(query, options);
  } else {
    result = await searchLearningPathWithTavilySources(query, options);
  }
  return { ...result, provider: config.provider };
}

export async function searchLearningPath(
  query: string,
  meta?: Record<string, unknown>,
): Promise<string> {
  const { context } = await searchLearningPathWithSources(query, { meta });
  return context;
}
