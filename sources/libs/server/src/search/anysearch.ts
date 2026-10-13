import { getRuntimeEnvironment } from "../env.js";
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
import { buildAnySearchLogResponse } from "./anysearch-log.js";
import {
  parseAnySearchExtractMarkdown,
  parseAnySearchResultsMarkdown,
} from "./anysearch-parse.js";
import type { LearningPathSearchPurpose } from "./tavily.js";

/** @see https://anysearch.com/docs — MCP JSON-RPC at api.anysearch.com */
const ENDPOINT = "https://api.anysearch.com/mcp";
const CLIENT_HEADER = "xue-learn/1.0.0";

/** Total chars budget for extracted page bodies in the LLM prompt. */
const EXTRACT_MAX_CHARS = 10_000;

const LEARNING_PATH_SEARCH_PRESETS = {
  answer: { maxResults: 5, extractTopUrls: 3 },
  summary: { maxResults: 5, extractTopUrls: 2 },
  map: { maxResults: 8, extractTopUrls: 4 },
  deep_plan: { maxResults: 10, extractTopUrls: 4 },
  module_research: { maxResults: 8, extractTopUrls: 4 },
} as const;

export type AnySearchPayload = {
  context: string;
  sources: ContentSource[];
  sourceContents: Record<string, string>;
};

type SearchRunOptions = {
  maxResults: number;
  extractTopUrls?: number;
  meta?: Record<string, unknown>;
};

function getApiKey(): string | null {
  const apiKey = getRuntimeEnvironment().ANYSEARCH_API_KEY?.trim();
  return apiKey || null;
}

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

type McpToolCallResult = {
  text: string;
  requestId?: string;
};

async function callAnySearchTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("ANYSEARCH_API_KEY is not configured");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Anysearch-Client": CLIENT_HEADER,
    Authorization: `Bearer ${apiKey}`,
  };

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });

  const raw = await response.text();
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(
      `AnySearch returned non-JSON (${response.status}): ${raw.slice(0, 400)}`,
    );
  }

  if (!response.ok) {
    throw new Error(`AnySearch HTTP ${response.status}: ${raw.slice(0, 400)}`);
  }

  if (!json || typeof json !== "object") {
    throw new Error("AnySearch returned an empty response");
  }

  const root = json as Record<string, unknown>;
  if (root.error && typeof root.error === "object") {
    const err = root.error as Record<string, unknown>;
    const message =
      typeof err.message === "string" ? err.message : JSON.stringify(err);
    throw new Error(`AnySearch error: ${message}`);
  }

  const result = root.result;
  if (!result || typeof result !== "object") {
    throw new Error("AnySearch response missing result");
  }

  const resultRecord = result as Record<string, unknown>;
  const meta =
    resultRecord._meta && typeof resultRecord._meta === "object"
      ? (resultRecord._meta as Record<string, unknown>)
      : undefined;
  const requestId =
    typeof meta?.request_id === "string" ? meta.request_id : undefined;

  const content = resultRecord.content;
  if (!Array.isArray(content)) {
    throw new Error("AnySearch result content is not an array");
  }

  const textItem = content.find(
    (item) =>
      item &&
      typeof item === "object" &&
      (item as { type?: string }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string",
  ) as { text: string } | undefined;

  if (!textItem?.text) {
    throw new Error("AnySearch result has no text content");
  }

  return { text: textItem.text, requestId };
}

async function extractPagesForPrompt(
  urls: string[],
  sourceIndexByUrl?: Map<string, number>,
): Promise<{
  promptSection: string;
  pages: { url: string; title: string | null; rawContent: string }[];
  failed: { url: string; error: string }[];
}> {
  if (urls.length === 0) {
    return { promptSection: "", pages: [], failed: [] };
  }

  const pages: { url: string; title: string | null; rawContent: string }[] = [];
  const failed: { url: string; error: string }[] = [];

  for (const url of urls) {
    try {
      const { text } = await callAnySearchTool("extract", { url });
      const page = parseAnySearchExtractMarkdown(text, url);
      if (page.rawContent.trim()) {
        pages.push(page);
      } else {
        failed.push({ url, error: "empty extract" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ url, error: message });
    }
  }

  const body = formatExtractedPagesForPrompt(
    pages,
    EXTRACT_MAX_CHARS,
    sourceIndexByUrl,
  );
  const promptSection = body
    ? `Full page excerpts (use for facts; snippets above are secondary):\n\n${body}`
    : "";
  return { promptSection, pages, failed };
}

async function runSearchWithSources(
  operation: string,
  query: string,
  options: SearchRunOptions,
): Promise<AnySearchPayload> {
  const userId =
    typeof options.meta?.userId === "string" ? options.meta.userId : undefined;
  if (!(await isWebSearchAvailable(userId)))
    return { context: "", sources: [], sourceContents: {} };
  if (!getApiKey()) return { context: "", sources: [], sourceContents: {} };

  const extractTopUrls = options.extractTopUrls ?? 0;
  const maxResults = Math.min(Math.max(options.maxResults, 1), 10);
  const logHandle = await beginSearchRequestLog({
    operation,
    request: {
      query,
      maxResults,
      extractTopUrls,
    },
    meta: {
      ...options.meta,
      extractTopUrls,
      provider: "anysearch",
    },
  });
  const started = Date.now();

  try {
    const { text, requestId } = await callAnySearchTool("search", {
      query,
      max_results: maxResults,
    });
    const parsed = parseAnySearchResultsMarkdown(text);
    const results = parsed.results;
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
    const snippetBody = formatWebResultsForPrompt(results);
    if (snippetBody) parts.push(snippetBody);

    let extractLog: ReturnType<typeof buildAnySearchLogResponse>["extract"];
    if (extractTopUrls > 0 && results.length > 0) {
      const urls = uniqueUrls(results, extractTopUrls);
      const { promptSection, pages, failed } = await extractPagesForPrompt(
        urls,
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

    const promptContext = parts.join("\n\n");

    await logHandle?.finish({
      status: "success",
      durationMs: Date.now() - started,
      response: {
        ...buildAnySearchLogResponse({
          results,
          sources,
          promptContext,
          responseTimeMs: parsed.responseTimeMs,
          extract: extractLog,
        }),
        ...(requestId ? { requestId } : {}),
      },
    });

    return { context: promptContext, sources, sourceContents };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logHandle?.finish({
      status: "error",
      durationMs: Date.now() - started,
      error: message,
    });
    console.warn("[anysearch] search failed:", message);
    return { context: "", sources: [], sourceContents: {} };
  }
}

/** Web search for plan summary / cognitive map when no uploaded materials. */
export async function searchLearningPathWithAnySearchSources(
  query: string,
  options?: {
    purpose?: LearningPathSearchPurpose;
    maxResults?: number;
    extractTopUrls?: number;
    meta?: Record<string, unknown>;
  },
): Promise<AnySearchPayload> {
  const purpose = options?.purpose ?? "map";
  const preset = LEARNING_PATH_SEARCH_PRESETS[purpose];
  return runSearchWithSources(
    "anysearch.search_learning_path",
    purpose === "answer" ? query : `${query} learning path syllabus curriculum`,
    {
      maxResults: options?.maxResults ?? preset.maxResults,
      extractTopUrls: options?.extractTopUrls ?? preset.extractTopUrls,
      meta: options?.meta,
    },
  );
}
