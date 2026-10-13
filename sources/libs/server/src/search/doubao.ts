import { getRuntimeEnvironment } from "../env.js";
import { beginSearchRequestLog } from "../llm/request-log.js";
import {
  type ContentSource,
  formatWebResultsForPrompt,
  sourcesFromWebResults,
} from "../rag/content-sources.js";
import { buildDoubaoSearchLogResponse } from "./doubao-log.js";
import type { LearningPathSearchPurpose } from "./tavily.js";

/** @see https://www.volcengine.com/docs/87772/2548026 */
const DEFAULT_BASE_URL = "https://open.feedcoopapi.com";
const GLOBAL_SEARCH_PATH = "/search_api/global_search";
const DEFAULT_MAX_SNIPPET_LENGTH = 500;

const LEARNING_PATH_SEARCH_PRESETS = {
  answer: { maxResults: 5 },
  summary: { maxResults: 5 },
  map: { maxResults: 8 },
  deep_plan: { maxResults: 10 },
  module_research: { maxResults: 8 },
} as const;

type DoubaoWebResult = {
  title: string;
  url: string;
  content: string;
};

type GlobalSearchSnippet = {
  Type?: string;
  Text?: string;
};

type GlobalSearchDocument = {
  Url?: string;
  Title?: string;
  Snippet?: GlobalSearchSnippet[];
};

function getApiKey(): string | null {
  const apiKey = getRuntimeEnvironment().DOUBAO_SEARCH_API_KEY?.trim();
  return apiKey || null;
}

function getBaseUrl(): string {
  return (
    getRuntimeEnvironment().DOUBAO_SEARCH_BASE_URL?.trim().replace(/\/$/, "") ||
    DEFAULT_BASE_URL
  );
}

function readString(
  record: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function snippetText(snippet: GlobalSearchSnippet[]): string {
  return snippet
    .filter((item) => item.Type === "text" || !item.Type)
    .map((item) => item.Text?.trim() ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizeDocument(raw: unknown): DoubaoWebResult | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as GlobalSearchDocument;
  const url = record.Url?.trim();
  if (!url) return null;
  const title = record.Title?.trim() || url;
  const content = snippetText(
    Array.isArray(record.Snippet) ? record.Snippet : [],
  );
  return { title, url, content };
}

function extractWebResults(response: unknown): DoubaoWebResult[] {
  if (!response || typeof response !== "object") return [];
  const root = response as Record<string, unknown>;
  const result = root.Result ?? root.result;
  if (!result || typeof result !== "object") return [];
  const resultRecord = result as Record<string, unknown>;
  const documents =
    resultRecord.Documents ??
    resultRecord.documents ??
    resultRecord.WebResults ??
    resultRecord.webResults;
  if (!Array.isArray(documents)) return [];
  return documents
    .map((item) => normalizeDocument(item))
    .filter((item): item is DoubaoWebResult => Boolean(item));
}

function parseApiError(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const root = response as Record<string, unknown>;
  const metadata = root.ResponseMetadata ?? root.responseMetadata;
  if (metadata && typeof metadata === "object") {
    const error = (metadata as Record<string, unknown>).Error;
    if (error && typeof error === "object") {
      const message = readString(error as Record<string, unknown>, "Message");
      if (message) return message;
    }
  }
  const result = root.Result ?? root.result;
  if (result && typeof result === "object") {
    const resultRecord = result as Record<string, unknown>;
    const errorCode = resultRecord.ErrorCode ?? resultRecord.errorCode;
    if (typeof errorCode === "number" && errorCode !== 0) {
      return (
        readString(resultRecord, "ErrorMsg", "errorMsg") ||
        `ErrorCode ${errorCode}`
      );
    }
  }
  return null;
}

export type DoubaoSearchPayload = {
  context: string;
  sources: ContentSource[];
  sourceContents: Record<string, string>;
};

async function runDoubaoSearch(
  operation: string,
  query: string,
  options: {
    maxResults: number;
    meta?: Record<string, unknown>;
  },
): Promise<DoubaoSearchPayload> {
  const apiKey = getApiKey();
  if (!apiKey) return { context: "", sources: [], sourceContents: {} };

  const logHandle = await beginSearchRequestLog({
    operation,
    request: {
      query,
      docCount: options.maxResults,
      maxSnippetLength: DEFAULT_MAX_SNIPPET_LENGTH,
    },
    meta: {
      ...options.meta,
      provider: "doubao",
      searchType: "global",
    },
  });
  const started = Date.now();

  try {
    const response = await fetch(`${getBaseUrl()}${GLOBAL_SEARCH_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        Query: query,
        DocCount: options.maxResults,
        MaxSnippetLength: DEFAULT_MAX_SNIPPET_LENGTH,
      }),
    });
    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(
        `Doubao Global Search returned non-JSON (${response.status}): ${text.slice(0, 400)}`,
      );
    }

    const apiError = parseApiError(json);
    if (!response.ok || apiError) {
      throw new Error(
        apiError ||
          `Doubao Global Search error (${response.status}): ${text.slice(0, 400)}`,
      );
    }

    const results = extractWebResults(json);
    const sources = sourcesFromWebResults(results);
    const sourceContents = Object.fromEntries(
      results.map((result) => [result.url, result.content]),
    );
    const snippetBody = formatWebResultsForPrompt(results);
    const promptContext = snippetBody.trim();

    await logHandle?.finish({
      status: "success",
      durationMs: Date.now() - started,
      response: buildDoubaoSearchLogResponse({
        results,
        sources,
        promptContext,
      }),
    });

    return { context: promptContext, sources, sourceContents };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logHandle?.finish({
      status: "error",
      durationMs: Date.now() - started,
      error: message,
    });
    console.warn("[doubao-search] search failed:", message);
    return { context: "", sources: [], sourceContents: {} };
  }
}

/** 豆包搜索 Global 版 — text web search for plan summary / cognitive map. */
export async function searchLearningPathWithDoubaoSources(
  query: string,
  options?: {
    purpose?: LearningPathSearchPurpose;
    maxResults?: number;
    meta?: Record<string, unknown>;
  },
): Promise<DoubaoSearchPayload> {
  const purpose = options?.purpose ?? "map";
  const preset = LEARNING_PATH_SEARCH_PRESETS[purpose];
  return runDoubaoSearch(
    "doubao.search_learning_path",
    purpose === "answer" ? query : `${query} learning path syllabus curriculum`,
    {
      maxResults: options?.maxResults ?? preset.maxResults,
      meta: options?.meta,
    },
  );
}
