import { getRuntimeEnvironment } from "../env.js";
import { tavily } from "@tavily/core";
import { isWebSearchAvailable } from "./runtime-config.js";
import { beginSearchRequestLog } from "../llm/request-log.js";
import {
  type ContentSource,
  enrichWebSourcesWithExtract,
  formatExtractedPagesForPrompt,
  formatWebResultsForPrompt,
  sourcesFromWebResults,
} from "../rag/content-sources.js";
import { normalizeIngestText } from "../rag/ingest-text.js";
import { buildTavilyLogResponse } from "./tavily-log.js";

let client: ReturnType<typeof tavily> | null = null;

/** Total chars budget for extracted page bodies in the LLM prompt. */
const EXTRACT_MAX_CHARS = 10_000;

const LEARNING_PATH_SEARCH_PRESETS = {
  answer: { maxResults: 5, extractTopUrls: 3 },
  summary: { maxResults: 5, extractTopUrls: 2 },
  map: { maxResults: 8, extractTopUrls: 4 },
  deep_plan: { maxResults: 10, extractTopUrls: 4 },
  module_research: { maxResults: 8, extractTopUrls: 4 },
} as const;

export type LearningPathSearchPurpose =
  keyof typeof LEARNING_PATH_SEARCH_PRESETS;

function getClient() {
  const apiKey = getRuntimeEnvironment().TAVILY_API_KEY?.trim();
  if (!apiKey) return null;
  if (!client) client = tavily({ apiKey });
  return client;
}

export type TavilySearchPayload = {
  context: string;
  sources: ContentSource[];
  sourceContents: Record<string, string>;
};

type SearchRunOptions = {
  signal?: AbortSignal;
  maxResults: number;
  searchDepth?: "basic" | "advanced";
  extractTopUrls?: number;
  meta?: Record<string, unknown>;
};

function uniqueUrls(results: { url: string }[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of results) {
    const url = r.url?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}

async function extractPagesForPrompt(
  urls: string[],
  query: string,
  sourceIndexByUrl?: Map<string, number>,
): Promise<{
  promptSection: string;
  pages: { url: string; title: string | null; rawContent: string }[];
  failed: { url: string; error: string }[];
}> {
  if (urls.length === 0) {
    return { promptSection: "", pages: [], failed: [] };
  }

  const tvly = getClient();
  if (!tvly) return { promptSection: "", pages: [], failed: [] };

  try {
    const response = await tvly.extract(urls, {
      timeout: 15,
      extractDepth: "advanced",
      format: "markdown",
      query,
    });
    const pages = (response.results ?? []).filter((r) => r.rawContent?.trim());
    const failed = response.failedResults ?? [];
    const body = formatExtractedPagesForPrompt(
      pages,
      EXTRACT_MAX_CHARS,
      sourceIndexByUrl,
    );
    const promptSection = body
      ? `Full page excerpts (use for facts; snippets above are secondary):\n\n${body}`
      : "";
    return { promptSection, pages, failed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[tavily] extract failed:", message);
    return {
      promptSection: "",
      pages: [],
      failed: urls.map((url) => ({ url, error: message })),
    };
  }
}

async function runSearchWithSources(
  operation: string,
  query: string,
  options: SearchRunOptions,
): Promise<TavilySearchPayload> {
  const userId =
    typeof options.meta?.userId === "string" ? options.meta.userId : undefined;
  if (!(await isWebSearchAvailable(userId)))
    return { context: "", sources: [], sourceContents: {} };

  const tvly = getClient();
  if (!tvly) return { context: "", sources: [], sourceContents: {} };

  const searchDepth = options.searchDepth ?? "advanced";
  const extractTopUrls = options.extractTopUrls ?? 0;
  const logHandle = await beginSearchRequestLog({
    operation,
    request: {
      query,
      searchDepth,
      maxResults: options.maxResults,
      extractTopUrls,
    },
    meta: {
      ...options.meta,
      searchDepth,
      extractTopUrls,
      provider: "tavily",
    },
  });
  const started = Date.now();

  try {
    options.signal?.throwIfAborted();
    const response = await tvly.search(query, {
      timeout: options.signal ? 7 : 20,
      searchDepth,
      maxResults: options.maxResults,
      topic: "general",
    });
    const results = response.results ?? [];
    const sourceContents: Record<string, string> = Object.fromEntries(
      results
        .filter((result) => result.url?.trim())
        .map((result) => [result.url, result.content ?? ""]),
    );
    let sources = sourcesFromWebResults(results);
    const sourceIndexByUrl = new Map(
      sources
        .filter((s): s is typeof s & { url: string } => Boolean(s.url))
        .map((s, i) => [s.url, i + 1]),
    );
    const parts: string[] = [];
    if (response.answer?.trim()) {
      parts.push(`Summary: ${response.answer.trim()}`);
    }
    const snippetBody = formatWebResultsForPrompt(results);
    if (snippetBody) parts.push(snippetBody);

    let extractLog: ReturnType<typeof buildTavilyLogResponse>["extract"];
    options.signal?.throwIfAborted();
    if (extractTopUrls > 0 && results.length > 0) {
      const urls = uniqueUrls(results, extractTopUrls);
      const { promptSection, pages, failed } = await extractPagesForPrompt(
        urls,
        query,
        sourceIndexByUrl,
      );
      if (promptSection) parts.push(promptSection);
      sources = enrichWebSourcesWithExtract(sources, pages);
      for (const page of pages) {
        sourceContents[page.url] = normalizeIngestText(page.rawContent);
      }
      extractLog = {
        urlCount: urls.length,
        successCount: pages.length,
        failedCount: failed.length,
        contextChars: promptSection.length,
        urls,
        failed,
      };
    }

    const text = parts.join("\n\n");

    await logHandle?.finish({
      status: "success",
      durationMs: Date.now() - started,
      response: buildTavilyLogResponse({
        answer: response.answer,
        results,
        sources,
        promptContext: text,
        responseTimeMs: response.responseTime,
        extract: extractLog,
      }),
    });

    return { context: text, sources, sourceContents };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logHandle?.finish({
      status: "error",
      durationMs: Date.now() - started,
      error: message,
    });
    console.warn("[tavily] search failed:", message);
    return { context: "", sources: [], sourceContents: {} };
  }
}

/** Web search for plan summary / cognitive map when no uploaded materials. */
export async function searchLearningPathWithSources(
  query: string,
  options?: {
    signal?: AbortSignal;
    purpose?: LearningPathSearchPurpose;
    maxResults?: number;
    extractTopUrls?: number;
    meta?: Record<string, unknown>;
  },
): Promise<TavilySearchPayload> {
  const purpose = options?.purpose ?? "map";
  const preset = LEARNING_PATH_SEARCH_PRESETS[purpose];
  return runSearchWithSources(
    "tavily.search_learning_path",
    purpose === "answer" ? query : `${query} learning path syllabus curriculum`,
    {
      maxResults: options?.maxResults ?? preset.maxResults,
      searchDepth: "advanced",
      extractTopUrls: options?.extractTopUrls ?? preset.extractTopUrls,
      meta: options?.meta,
      signal: options?.signal,
    },
  );
}

export async function searchLearningPath(
  query: string,
  meta?: Record<string, unknown>,
): Promise<string> {
  const { context } = await searchLearningPathWithSources(query, { meta });
  return context;
}
