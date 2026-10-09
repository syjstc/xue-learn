/** Token usage extracted from LangChain AIMessage / AIMessageChunk. */
export type LogTokenUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_token_details?: Record<string, number>;
  output_token_details?: Record<string, number>;
};

function tokenDetailRecord(
  value: unknown,
): Record<string, number> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const parsed = number(v);
    if (parsed !== undefined) out[k] = parsed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Accept finite numbers and numeric strings from OpenAI-compatible gateways. */
function number(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = number(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

const CACHE_ALIAS_DETAIL_KEYS = new Set([
  "cached_tokens",
  "cache_tokens",
  "cache_read",
  "cache_write_tokens",
  "cache_creation_tokens",
  "cache_creation",
]);

function omitCacheAliasKeys(
  details: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!details) return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(details)) {
    if (CACHE_ALIAS_DETAIL_KEYS.has(key)) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Normalize cache-read tokens across OpenAI, DeepSeek, Anthropic-via-compat,
 * and common gateway aliases (Singularity / NewAPI / OneAPI style).
 */
function cacheReadTokens(usage: Record<string, unknown>): number | undefined {
  const promptDetails = record(usage.prompt_tokens_details);
  const inputDetails = record(usage.input_tokens_details);
  // LangChain normalizes OpenAI usage into input_token_details.cache_read.
  const langChainDetails = record(usage.input_token_details);
  return firstNumber(
    usage.prompt_cache_hit_tokens,
    usage.cache_read_input_tokens,
    usage.cache_read_tokens,
    usage.num_cached_tokens,
    usage.cached_tokens,
    usage.cache_tokens,
    usage.prompt_cache_tokens,
    usage.cache_hit_tokens,
    promptDetails?.cached_tokens,
    promptDetails?.cache_tokens,
    promptDetails?.cache_read,
    inputDetails?.cached_tokens,
    inputDetails?.cache_tokens,
    inputDetails?.cache_read,
    langChainDetails?.cached_tokens,
    langChainDetails?.cache_tokens,
    langChainDetails?.cache_read,
  );
}

function cacheCreationTokens(
  usage: Record<string, unknown>,
): number | undefined {
  const promptDetails = record(usage.prompt_tokens_details);
  const inputDetails = record(usage.input_tokens_details);
  const langChainDetails = record(usage.input_token_details);
  return firstNumber(
    usage.cache_creation_input_tokens,
    usage.cache_creation_tokens,
    promptDetails?.cache_write_tokens,
    promptDetails?.cache_creation_tokens,
    promptDetails?.cache_creation,
    inputDetails?.cache_write_tokens,
    inputDetails?.cache_creation_tokens,
    inputDetails?.cache_creation,
    langChainDetails?.cache_write_tokens,
    langChainDetails?.cache_creation_tokens,
    langChainDetails?.cache_creation,
  );
}

function rawProviderUsage(msg: {
  response_metadata?: unknown;
}): LogTokenUsage | undefined {
  const metadata = record(msg.response_metadata);
  const usage = record(metadata?.usage);
  if (!usage) return undefined;

  const inputDetails = record(usage.input_tokens_details);
  const completionDetails = record(usage.completion_tokens_details);
  const outputDetails = record(usage.output_tokens_details);
  const cacheRead = cacheReadTokens(usage);
  const cacheCreation = cacheCreationTokens(usage);
  const cacheMiss = number(usage.prompt_cache_miss_tokens);
  const input =
    firstNumber(usage.input_tokens, usage.prompt_tokens) ??
    (cacheRead !== undefined && cacheMiss !== undefined
      ? cacheRead + cacheMiss
      : undefined);
  const output = firstNumber(usage.output_tokens, usage.completion_tokens);
  const total = number(usage.total_tokens);

  if (input === undefined && output === undefined && total === undefined) {
    return undefined;
  }

  const inputTokens = input ?? 0;
  const outputTokens = output ?? 0;
  const inputTokenDetails = {
    ...(cacheRead !== undefined ? { cache_read: cacheRead } : {}),
    ...(cacheCreation !== undefined ? { cache_creation: cacheCreation } : {}),
    // Keep non-cache provider detail keys (e.g. audio) without duplicating
    // aliased cache field names beside the normalized cache_read/creation.
    ...omitCacheAliasKeys(tokenDetailRecord(inputDetails)),
  };
  const reasoning = firstNumber(
    completionDetails?.reasoning_tokens,
    outputDetails?.reasoning_tokens,
    outputDetails?.reasoning,
  );
  const outputTokenDetails = {
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...tokenDetailRecord(outputDetails),
  };

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: total ?? inputTokens + outputTokens,
    input_token_details:
      Object.keys(inputTokenDetails).length > 0
        ? inputTokenDetails
        : undefined,
    output_token_details:
      Object.keys(outputTokenDetails).length > 0
        ? outputTokenDetails
        : undefined,
  };
}

export type TokenUsageMessage = {
  usage_metadata?: unknown;
  response_metadata?: unknown;
};

function hasCacheRead(usage: LogTokenUsage | undefined): boolean {
  return usage?.input_token_details?.cache_read !== undefined;
}

/** Read usage_metadata from a LangChain AI message or streamed chunk. */
export function extractTokenUsage(
  msg: TokenUsageMessage | undefined | null,
): LogTokenUsage | undefined {
  if (!msg) return undefined;
  const providerUsage = rawProviderUsage(msg);
  const raw = msg.usage_metadata;
  if (!raw || typeof raw !== "object") return providerUsage;

  const rec = raw as Record<string, unknown>;
  const metadataCacheRead = cacheReadTokens(rec);
  const metadataCacheCreation = cacheCreationTokens(rec);
  const metadataCacheMiss = number(rec.prompt_cache_miss_tokens);
  const input =
    firstNumber(rec.input_tokens, rec.prompt_tokens) ??
    (metadataCacheRead !== undefined && metadataCacheMiss !== undefined
      ? metadataCacheRead + metadataCacheMiss
      : undefined);
  const output = firstNumber(rec.output_tokens, rec.completion_tokens);
  const total = number(rec.total_tokens);

  if (input === undefined && output === undefined && total === undefined) {
    return providerUsage;
  }

  const inputTokens = input ?? 0;
  const outputTokens = output ?? 0;

  const inputDetails = {
    ...(providerUsage?.input_token_details ?? {}),
    ...(metadataCacheRead !== undefined
      ? { cache_read: metadataCacheRead }
      : {}),
    ...(metadataCacheCreation !== undefined
      ? { cache_creation: metadataCacheCreation }
      : {}),
    ...(omitCacheAliasKeys(tokenDetailRecord(rec.input_token_details)) ?? {}),
  };
  const outputDetails = {
    ...(providerUsage?.output_token_details ?? {}),
    ...(tokenDetailRecord(rec.output_token_details) ?? {}),
  };

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: total ?? inputTokens + outputTokens,
    input_token_details:
      Object.keys(inputDetails).length > 0 ? inputDetails : undefined,
    output_token_details:
      Object.keys(outputDetails).length > 0 ? outputDetails : undefined,
  };
}

/**
 * Keep the latest stream chunk that reports token usage.
 * Prefer a chunk that already carries cache telemetry over a later bare totals
 * chunk so OpenAI-compatible gateways that emit usage twice do not drop hits.
 */
export function rememberStreamUsageChunk<T extends TokenUsageMessage>(
  previous: T | undefined,
  chunk: T | undefined,
): T | undefined {
  const nextUsage = extractTokenUsage(chunk);
  if (!nextUsage) return previous;
  const previousUsage = extractTokenUsage(previous);
  if (hasCacheRead(previousUsage) && !hasCacheRead(nextUsage)) {
    return previous;
  }
  return chunk;
}

/** Attach usage + derived throughput fields to an LLM log response payload. */
export function usageLogFields(
  usage: LogTokenUsage | undefined,
  durationMs: number,
): Record<string, unknown> {
  if (!usage) return {};

  const secs = durationMs > 0 ? durationMs / 1000 : 0;
  const outputTps =
    secs > 0 ? Math.round((usage.output_tokens / secs) * 10) / 10 : undefined;
  const totalTps =
    secs > 0 ? Math.round((usage.total_tokens / secs) * 10) / 10 : undefined;

  return {
    usage,
    outputTps,
    totalTps,
  };
}
