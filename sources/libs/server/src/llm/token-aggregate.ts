import type { LogTokenUsage } from "./token-usage.js";

export type { LogTokenUsage };

export type TokenUsageSummary = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Input-token denominator from calls that explicitly reported cache usage. */
  cacheMeasuredInputTokens: number;
  cacheReportedCallCount: number;
  reasoningTokens: number;
  /** Logs that reported token usage (chat / embedding with metadata). */
  llmCallCount: number;
  totalDurationMs: number;
};

export type TokenUsageCategoryId =
  | "map"
  | "course"
  | "survey"
  | "tests"
  | "agent"
  | "retrieval"
  | "embedding"
  | "images"
  | "audio"
  | "persona"
  | "other";

export type TokenUsageCategoryBreakdown = TokenUsageSummary & {
  category: TokenUsageCategoryId;
};

export type TokenAggregateLogRow = {
  response: unknown;
  operation: string;
  kind: string;
  durationMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheCreationTokens?: number | null;
  reasoningTokens?: number | null;
};

const EMPTY_SUMMARY = (): TokenUsageSummary => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  cacheMeasuredInputTokens: 0,
  cacheReportedCallCount: 0,
  reasoningTokens: 0,
  llmCallCount: 0,
  totalDurationMs: 0,
});

function responseRecord(response: unknown): Record<string, unknown> | null {
  if (!response || typeof response !== "object") return null;
  return response as Record<string, unknown>;
}

function parseJsonResponse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function normalizeResponse(response: unknown): unknown {
  if (typeof response === "string") return parseJsonResponse(response);
  return response;
}

/** Read `usage` from a persisted LLM log response payload. */
export function parseUsageFromLogResponse(
  response: unknown,
): LogTokenUsage | undefined {
  const res = responseRecord(normalizeResponse(response));
  const usage = res?.usage;
  if (!usage || typeof usage !== "object") return undefined;

  const rec = usage as Record<string, unknown>;
  const input =
    typeof rec.input_tokens === "number" ? rec.input_tokens : undefined;
  const output =
    typeof rec.output_tokens === "number" ? rec.output_tokens : undefined;
  const total =
    typeof rec.total_tokens === "number" ? rec.total_tokens : undefined;

  if (input === undefined && output === undefined && total === undefined) {
    return undefined;
  }

  const inputTokens = input ?? 0;
  const outputTokens = output ?? 0;

  const detailRecord = (value: unknown): Record<string, number> | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: total ?? inputTokens + outputTokens,
    input_token_details: detailRecord(rec.input_token_details),
    output_token_details: detailRecord(rec.output_token_details),
  };
}

function parseUsageFromColumns(
  log: TokenAggregateLogRow,
): LogTokenUsage | undefined {
  if (
    log.inputTokens === undefined &&
    log.outputTokens === undefined &&
    log.totalTokens === undefined
  ) {
    return undefined;
  }
  const inputTokens = log.inputTokens ?? 0;
  const outputTokens = log.outputTokens ?? 0;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: log.totalTokens ?? inputTokens + outputTokens,
    input_token_details:
      (log.cacheReadTokens !== null && log.cacheReadTokens !== undefined) ||
      (log.cacheCreationTokens !== null &&
        log.cacheCreationTokens !== undefined)
        ? {
            ...(log.cacheReadTokens !== null &&
            log.cacheReadTokens !== undefined
              ? { cache_read: log.cacheReadTokens }
              : {}),
            ...(log.cacheCreationTokens !== null &&
            log.cacheCreationTokens !== undefined
              ? { cache_creation: log.cacheCreationTokens }
              : {}),
          }
        : undefined,
    output_token_details: {
      reasoning: log.reasoningTokens ?? 0,
    },
  };
}

function addUsageToSummary(
  summary: TokenUsageSummary,
  usage: LogTokenUsage,
  durationMs: number,
): void {
  summary.inputTokens += usage.input_tokens;
  summary.outputTokens += usage.output_tokens;
  summary.totalTokens += usage.total_tokens;
  summary.cacheReadTokens += usage.input_token_details?.cache_read ?? 0;
  summary.cacheCreationTokens += usage.input_token_details?.cache_creation ?? 0;
  if (
    usage.input_token_details &&
    Object.prototype.hasOwnProperty.call(
      usage.input_token_details,
      "cache_read",
    )
  ) {
    summary.cacheMeasuredInputTokens += usage.input_tokens;
    summary.cacheReportedCallCount += 1;
  }
  summary.reasoningTokens += usage.output_token_details?.reasoning ?? 0;
  summary.llmCallCount += 1;
  summary.totalDurationMs += durationMs;
}

/** Sum token usage across log rows (trace, goal, or arbitrary filter). */
export function aggregateTokenUsage(
  logs: TokenAggregateLogRow[],
): TokenUsageSummary {
  const summary = EMPTY_SUMMARY();

  for (const log of logs) {
    const usage =
      parseUsageFromColumns(log) ?? parseUsageFromLogResponse(log.response);
    if (!usage) {
      summary.totalDurationMs += log.durationMs;
      continue;
    }
    addUsageToSummary(summary, usage, log.durationMs);
  }

  return summary;
}

/** Classify a log row into a goal-level usage bucket. */
export function classifyLogCategory(
  operation: string,
  kind: string,
): TokenUsageCategoryId {
  if (kind === "audio") return "audio";
  if (kind === "image") return "images";
  if (kind === "search" || kind === "rag") return "retrieval";

  if (
    /^(decompose|goal\.(plan|map|summary|micro_unit)|expand_map_branch)/.test(
      operation,
    )
  ) {
    return "map";
  }
  if (
    /^(unit\.learning_material|goal\.batch_material|unit\.material_follow_up|unit\.subdivide|unit\.follow_up)/.test(
      operation,
    )
  ) {
    return "course";
  }
  if (/^(unit\.sq_|unit\.section_plan|goal\.batch_sq)/.test(operation)) return "survey";
  if (/^unit\.(quiz_|drills|cornell|feynman|socratic)/.test(operation)) {
    return "tests";
  }
  if (/^agent\./.test(operation)) return "agent";
  if (kind === "embedding" || /^rag\./.test(operation)) return "embedding";
  if (/^(unit\.illustration|goal\.icon)/.test(operation)) {
    return "images";
  }
  if (/^persona\./.test(operation)) return "persona";
  return "other";
}

const CATEGORY_ORDER: TokenUsageCategoryId[] = [
  "map",
  "course",
  "survey",
  "tests",
  "agent",
  "retrieval",
  "embedding",
  "images",
  "audio",
  "persona",
  "other",
];

/** Per-category token totals for one goal (map, course, survey, tests, …). */
export function aggregateTokenUsageByCategory(
  logs: TokenAggregateLogRow[],
): TokenUsageCategoryBreakdown[] {
  const byCategory = new Map<TokenUsageCategoryId, TokenUsageSummary>();

  for (const log of logs) {
    const category = classifyLogCategory(log.operation, log.kind);
    const bucket = byCategory.get(category) ?? EMPTY_SUMMARY();
    const usage =
      parseUsageFromColumns(log) ?? parseUsageFromLogResponse(log.response);
    if (usage) {
      addUsageToSummary(bucket, usage, log.durationMs);
    } else {
      bucket.totalDurationMs += log.durationMs;
    }
    byCategory.set(category, bucket);
  }

  return CATEGORY_ORDER.filter((category) => byCategory.has(category)).map(
    (category) => ({
      category,
      ...byCategory.get(category)!,
    }),
  );
}
