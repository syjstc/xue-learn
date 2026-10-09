/** Shared types and helpers for the dev LLM log viewer. */

export type LogTokenUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_token_details?: Record<string, number>;
  output_token_details?: Record<string, number>;
};

export type LlmLogMetrics = {
  timestamp: string;
  durationMs: number;
  firstResponseMs?: number;
  usage?: LogTokenUsage;
  outputTps?: number;
  totalTps?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheHitRate?: number;
  uncachedInputTokens?: number;
};

export type LlmLogRow = {
  id: string;
  createdAt: string;
  traceId: string | null;
  goalId: string | null;
  scope: string | null;
  scopeId: string | null;
  operation: string;
  kind: string;
  spanType: string;
  parentId: string | null;
  label: string | null;
  toolName: string | null;
  provider: string;
  model: string;
  status: string;
  durationMs: number;
  firstResponseMs: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheCreationTokens?: number | null;
  reasoningTokens?: number | null;
  outputTps?: number | null;
  requestPreview?: string | null;
  responsePreview?: string | null;
  structuredContractId?: string | null;
  structuredContractVersion?: number | null;
  structuredSchemaHash?: string | null;
  structuredInvocationId?: string | null;
  structuredAttempt?: number | null;
  structuredTransport?: string | null;
  structuredStage?: string | null;
  structuredSyntaxRepaired?: boolean | null;
  structuredRepairType?: string | null;
  structuredOutcome?: string | null;
  structuredFailureCategory?: string | null;
  structuredUnknownKeyCount?: number | null;
  request?: unknown;
  response?: unknown;
  error: string | null;
};

function responseRecord(response: unknown): Record<string, unknown> | null {
  if (!response || typeof response !== "object") return null;
  return response as Record<string, unknown>;
}

function parseUsage(value: unknown): LogTokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
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
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: total ?? inputTokens + outputTokens,
    input_token_details:
      rec.input_token_details && typeof rec.input_token_details === "object"
        ? (rec.input_token_details as Record<string, number>)
        : undefined,
    output_token_details:
      rec.output_token_details && typeof rec.output_token_details === "object"
        ? (rec.output_token_details as Record<string, number>)
        : undefined,
  };
}

/** Extract timestamp, token counts, and throughput from a log row. */
export function extractLogMetrics(log: LlmLogRow): LlmLogMetrics {
  const res = responseRecord(expandCompactLogPayload(log.response));
  const responseUsage = parseUsage(res?.usage);
  const hasPersistedUsage =
    (log.inputTokens !== null && log.inputTokens !== undefined) ||
    (log.outputTokens !== null && log.outputTokens !== undefined) ||
    (log.totalTokens !== null && log.totalTokens !== undefined);
  const usage = hasPersistedUsage
    ? {
        input_tokens: log.inputTokens ?? 0,
        output_tokens: log.outputTokens ?? 0,
        total_tokens:
          log.totalTokens ?? (log.inputTokens ?? 0) + (log.outputTokens ?? 0),
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
        output_token_details: { reasoning: log.reasoningTokens ?? 0 },
      }
    : responseUsage;
  const durationMs = log.durationMs;
  const firstResponseMs =
    log.firstResponseMs ??
    (typeof res?.firstResponseMs === "number"
      ? res.firstResponseMs
      : undefined);
  const secs = durationMs > 0 ? durationMs / 1000 : 0;

  let outputTps =
    log.outputTps ??
    (typeof res?.outputTps === "number" ? res.outputTps : undefined);
  let totalTps = typeof res?.totalTps === "number" ? res.totalTps : undefined;

  if (usage && secs > 0) {
    outputTps ??= Math.round((usage.output_tokens / secs) * 10) / 10;
    totalTps ??= Math.round((usage.total_tokens / secs) * 10) / 10;
  }

  const cacheReadTokens = usage?.input_token_details?.cache_read;
  const cacheHitRate = calculateCacheHitRate(
    cacheReadTokens,
    usage?.input_tokens,
  );

  return {
    timestamp: log.createdAt,
    durationMs,
    firstResponseMs,
    usage,
    outputTps,
    totalTps,
    reasoningTokens: usage?.output_token_details?.reasoning,
    cacheReadTokens,
    cacheHitRate,
    uncachedInputTokens:
      cacheHitRate !== undefined && cacheReadTokens !== undefined && usage
        ? usage.input_tokens - cacheReadTokens
        : undefined,
  };
}

export function calculateCacheHitRate(
  cacheReadTokens: number | null | undefined,
  inputTokens: number | null | undefined,
): number | undefined {
  if (
    cacheReadTokens === null ||
    cacheReadTokens === undefined ||
    inputTokens === null ||
    inputTokens === undefined ||
    !Number.isFinite(cacheReadTokens) ||
    !Number.isFinite(inputTokens) ||
    inputTokens <= 0 ||
    cacheReadTokens < 0 ||
    cacheReadTokens > inputTokens
  ) {
    return undefined;
  }
  return cacheReadTokens / inputTokens;
}

export function formatCacheHitRate(rate: number | undefined): string | null {
  if (rate === undefined || !Number.isFinite(rate)) return null;
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatLogTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const base = d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${base}.${ms}`;
}

/** When a log row's createdAt is the start time, derive the end instant. */
export function logEndedAtIso(
  log: Pick<LlmLogRow, "createdAt" | "durationMs" | "status">,
): string | null {
  if (log.status === "running" || log.durationMs <= 0) return null;
  const end = new Date(log.createdAt).getTime() + log.durationMs;
  if (Number.isNaN(end)) return null;
  return new Date(end).toISOString();
}

export function formatLogTimeRange(
  log: Pick<LlmLogRow, "createdAt" | "durationMs" | "status">,
): string {
  const ended = logEndedAtIso(log);
  if (!ended) return formatLogTimestamp(log.createdAt);
  return `${formatLogTimestamp(log.createdAt)} → ${formatLogTimestamp(ended)}`;
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

export function isLogRunning(log: LlmLogRow): boolean {
  return log.status === "running";
}

/** Billable / ultimately-ok terminal statuses (plain success or healed recovery). */
export function isLogOk(log: Pick<LlmLogRow, "status">): boolean {
  return log.status === "success" || log.status === "recovered";
}

export function isLogRecovered(log: Pick<LlmLogRow, "status">): boolean {
  return log.status === "recovered";
}

export function formatFirstResponseMs(
  ms: number | null | undefined,
): string | null {
  if (ms === null || ms === undefined || ms <= 0) return null;
  return `TTFB ${formatDurationMs(ms)}`;
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`;
  return String(n);
}

export function formatTps(tps: number | undefined): string | null {
  if (tps === undefined || !Number.isFinite(tps)) return null;
  return `${tps.toLocaleString(undefined, { maximumFractionDigits: 1 })} tok/s`;
}

export function formatTokenSummary(metrics: LlmLogMetrics): string | null {
  const { usage } = metrics;
  if (!usage) return null;
  const parts = [
    `↓${formatTokenCount(usage.input_tokens)}`,
    `↑${formatTokenCount(usage.output_tokens)}`,
  ];
  if (usage.total_tokens !== usage.input_tokens + usage.output_tokens) {
    parts.push(`Σ${formatTokenCount(usage.total_tokens)}`);
  }
  const cacheRate = formatCacheHitRate(metrics.cacheHitRate);
  if (cacheRate) parts.push(`cache ${cacheRate}`);
  return parts.join(" ");
}

export function aggregateLogMetrics(logs: LlmLogRow[]): {
  totalDurationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheMeasuredInputTokens: number;
  cacheReportedCallCount: number;
  reasoningTokens: number;
  llmCallCount: number;
  avgOutputTps?: number;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let cacheMeasuredInputTokens = 0;
  let cacheReportedCallCount = 0;
  let reasoningTokens = 0;
  let llmCallCount = 0;
  let outputTpsSum = 0;
  let outputTpsCount = 0;

  for (const log of logs) {
    const m = extractLogMetrics(log);
    if (m.usage) {
      inputTokens += m.usage.input_tokens;
      outputTokens += m.usage.output_tokens;
      totalTokens += m.usage.total_tokens;
      cacheReadTokens += m.usage.input_token_details?.cache_read ?? 0;
      cacheCreationTokens += m.usage.input_token_details?.cache_creation ?? 0;
      if (m.cacheReadTokens !== undefined) {
        cacheMeasuredInputTokens += m.usage.input_tokens;
        cacheReportedCallCount += 1;
      }
      reasoningTokens += m.usage.output_token_details?.reasoning ?? 0;
      llmCallCount += 1;
    }
    if (m.outputTps !== undefined) {
      outputTpsSum += m.outputTps;
      outputTpsCount += 1;
    }
  }

  return {
    totalDurationMs: traceTotalMs(logs),
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cacheMeasuredInputTokens,
    cacheReportedCallCount,
    reasoningTokens,
    llmCallCount,
    avgOutputTps:
      outputTpsCount > 0
        ? Math.round((outputTpsSum / outputTpsCount) * 10) / 10
        : undefined,
  };
}

export type TokenUsageSummary = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheMeasuredInputTokens: number;
  cacheReportedCallCount: number;
  reasoningTokens: number;
  llmCallCount: number;
  totalDurationMs: number;
};

export function formatUsageSummary(usage: TokenUsageSummary): string | null {
  if (usage.llmCallCount === 0 && usage.totalTokens === 0) return null;
  const parts = [
    `↓${formatTokenCount(usage.inputTokens)}`,
    `↑${formatTokenCount(usage.outputTokens)}`,
    `Σ${formatTokenCount(usage.totalTokens)}`,
  ];
  if (usage.cacheReadTokens > 0) {
    parts.push(`cache ${formatTokenCount(usage.cacheReadTokens)}`);
  }
  const cacheRate = formatCacheHitRate(
    calculateCacheHitRate(
      usage.cacheReadTokens,
      usage.cacheMeasuredInputTokens,
    ),
  );
  if (cacheRate) {
    parts.push(`hit ${cacheRate}`);
    parts.push(
      `uncached ${formatTokenCount(
        usage.cacheMeasuredInputTokens - usage.cacheReadTokens,
      )}`,
    );
    if (usage.cacheMeasuredInputTokens < usage.inputTokens) {
      const coverage = formatCacheHitRate(
        calculateCacheHitRate(
          usage.cacheMeasuredInputTokens,
          usage.inputTokens,
        ),
      );
      if (coverage) parts.push(`coverage ${coverage}`);
    }
  } else if (usage.cacheReportedCallCount === 0) {
    parts.push("cache n/a");
  }
  if (usage.reasoningTokens > 0) {
    parts.push(`think ${formatTokenCount(usage.reasoningTokens)}`);
  }
  return parts.join(" · ");
}

export const SPAN_STYLES: Record<string, string> = {
  llm: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-200 dark:border-blue-800",
  tool: "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800",
  parse:
    "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950/50 dark:text-violet-200 dark:border-violet-800",
  embedding: "bg-muted text-foreground border-border",
};

export const KIND_STYLES: Record<string, string> = {
  chat: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200",
  embedding:
    "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-200",
  search: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  rag: "bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200",
  image:
    "bg-fuchsia-50 text-fuchsia-800 dark:bg-fuchsia-950/40 dark:text-fuchsia-200",
  audio: "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200",
};

export type ParsedBlock = {
  /** May be a string, or structured JSON after compact-preview unwrapping. */
  text?: unknown;
  thinking?: unknown;
  toolCalls?: Array<{ name: string; args?: unknown }>;
  jsonPreview?: unknown;
};

export function parsedFromResponse(response: unknown): ParsedBlock | null {
  const res = responseRecord(response);
  if (!res) return null;
  // Current logs expose the original provider output directly. Keep support
  // for legacy `parsed` rows, but never require parsing to display a bad reply.
  if (res.raw !== undefined || Array.isArray(res.toolCalls)) {
    return {
      text: res.raw,
      toolCalls: Array.isArray(res.toolCalls)
        ? (res.toolCalls as ParsedBlock["toolCalls"])
        : undefined,
    };
  }
  const parsed = res.parsed;
  if (parsed && typeof parsed === "object") return parsed as ParsedBlock;
  return null;
}

/** True when model text/thinking should be shown (string or structured JSON). */
export function hasLogText(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (value === null || value === undefined) return false;
  if (typeof value === "object") return true;
  return false;
}

/** Safe preview string for list rows — never returns a React-invalid object. */
export function formatLogTextPreview(value: unknown, max = 160): string {
  if (typeof value === "string") return value.slice(0, max);
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return String(value).slice(0, max);
  }
}

export function displayTitle(log: LlmLogRow): string {
  return log.label ?? log.operation;
}

export function logPreview(log: LlmLogRow): string {
  const previewPayload = (value: unknown, preview?: string | null) => {
    if (value !== undefined) return expandCompactLogPayload(value);
    if (!preview) return undefined;
    try {
      return JSON.parse(preview) as unknown;
    } catch {
      return preview;
    }
  };
  const req = previewPayload(log.request, log.requestPreview) as Record<
    string,
    unknown
  > | null;
  const responsePayload = previewPayload(log.response, log.responsePreview);
  const res = responseRecord(responsePayload);

  if (log.status === "error") {
    const failurePhase =
      (typeof res?.failurePhase === "string" && res.failurePhase) ||
      (typeof req?.failurePhase === "string" && req.failurePhase);
    const providerNotCalled =
      res?.providerRequestStarted === false ||
      req?.providerRequestStarted === false;
    if (failurePhase) {
      return `${failurePhase}${providerNotCalled ? " · provider not called" : ""}`;
    }
    if (log.error) return log.error.slice(0, 160);
  }

  if (log.status === "recovered") {
    const recoveredFrom =
      typeof res?.recoveredFromError === "string"
        ? res.recoveredFromError
        : typeof log.error === "string" && log.error.trim()
          ? log.error
          : null;
    const repairType =
      (typeof res?.structuredRepairType === "string" &&
        res.structuredRepairType) ||
      (typeof req?.structuredRepairType === "string" &&
        req.structuredRepairType) ||
      null;
    if (recoveredFrom) return `recovered · ${recoveredFrom.slice(0, 140)}`;
    if (repairType) return `recovered · ${repairType}`;
    return "recovered after repair/retry";
  }

  if (log.kind === "audio") {
    const textPreview =
      typeof req?.textPreview === "string" ? req.textPreview : null;
    const durationMs = res?.extra_info as { audio_length?: number } | undefined;
    const audioLen =
      typeof durationMs?.audio_length === "number"
        ? durationMs.audio_length
        : null;
    const subtitleCount =
      typeof res?.subtitleCount === "number" ? res.subtitleCount : null;
    const parts = [
      textPreview ? textPreview.slice(0, 120) : null,
      audioLen !== null ? `${audioLen}ms audio` : null,
      subtitleCount !== null && subtitleCount > 0
        ? `${subtitleCount} subtitles`
        : null,
    ].filter(Boolean);
    return parts.join(" · ") || log.operation;
  }

  if (log.spanType === "tool" || log.kind === "search" || log.kind === "rag") {
    const toolCall = req?.toolCall as { name?: string } | undefined;
    const query = typeof req?.query === "string" ? req.query : null;
    const sources = res?.sources;
    const content = typeof res?.content === "string" ? res.content : null;
    const nextStep = typeof res?.nextStep === "string" ? res.nextStep : null;
    if (content) {
      const prefix = toolCall?.name ? `${toolCall.name} → ` : "";
      const suffix = nextStep ? ` · next: ${nextStep}` : "";
      return `${prefix}${content.slice(0, 120)}${suffix}`;
    }
    if (Array.isArray(sources) && sources.length > 0) {
      const first = sources[0] as { title?: string; url?: string };
      const more = sources.length > 1 ? ` +${sources.length - 1} more` : "";
      const label = first.url ?? first.title ?? "source";
      return query
        ? `${query.slice(0, 80)} → ${label}${more}`
        : `${label}${more}`;
    }
    if (query) return query.slice(0, 160);
    const hits = res?.hitCount ?? res?.resultCount;
    if (hits !== undefined) return `${hits} hit(s)`;
    return log.toolName ?? log.operation;
  }

  if (log.spanType === "parse") {
    if (log.status === "error") return log.error ?? "Parse failed";
    return "JSON validated";
  }

  const parsed = parsedFromResponse(responsePayload);
  if (parsed?.toolCalls?.length) {
    const names = parsed.toolCalls.map((t) => t.name).join(", ");
    return `Tool calls: ${names}`;
  }
  if (hasLogText(parsed?.text)) {
    return formatLogTextPreview(parsed?.text);
  }
  if (typeof res?.content === "string" && res.content.trim()) {
    return res.content.slice(0, 160);
  }
  if (typeof res?.raw === "string") return res.raw.slice(0, 160);

  const messages = Array.isArray(req?.messages) ? req.messages : null;
  if (messages?.length) {
    const lastUser = [...messages]
      .reverse()
      .find(
        (message) =>
          message &&
          typeof message === "object" &&
          (message as { role?: string }).role === "user" &&
          typeof (message as { content?: string }).content === "string",
      ) as { content: string } | undefined;
    if (lastUser?.content.trim()) {
      return lastUser.content.slice(0, 160);
    }
    return `${messages.length} messages`;
  }

  const prompt = typeof req?.prompt === "string" ? req.prompt : null;
  if (prompt) return prompt.slice(0, 120) + "…";
  return (log.responsePreview ?? log.requestPreview ?? "").slice(0, 160);
}

/** Order logs for timeline: parents before children, preserve trace order. */
export function orderLogsForTimeline(logs: LlmLogRow[]): LlmLogRow[] {
  const byId = new Map(logs.map((l) => [l.id, l]));
  const children = new Map<string, LlmLogRow[]>();
  const roots: LlmLogRow[] = [];

  for (const log of logs) {
    if (log.parentId && byId.has(log.parentId)) {
      const list = children.get(log.parentId) ?? [];
      list.push(log);
      children.set(log.parentId, list);
    } else {
      roots.push(log);
    }
  }

  const out: LlmLogRow[] = [];
  function walk(node: LlmLogRow) {
    out.push(node);
    for (const child of children.get(node.id) ?? []) walk(child);
  }
  for (const root of roots) walk(root);
  return out.length === logs.length ? out : logs;
}

export function childLogsFor(log: LlmLogRow, logs: LlmLogRow[]): LlmLogRow[] {
  return logs.filter((child) => child.parentId === log.id);
}

export function childDepth(log: LlmLogRow, logs: LlmLogRow[]): number {
  let depth = 0;
  let parentId = log.parentId;
  const ids = new Set(logs.map((l) => l.id));
  while (parentId && ids.has(parentId)) {
    depth++;
    parentId = logs.find((l) => l.id === parentId)?.parentId ?? null;
  }
  return depth;
}

export function traceTotalMs(logs: LlmLogRow[]): number {
  return logs.reduce((sum, l) => sum + l.durationMs, 0);
}

const TRUNCATION_SUFFIX_RE = /(?:…|\.\.\.)\s*\[truncated (\d+) chars\]\s*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Close open strings/brackets so truncated LLM log previews can still parse. */
export function repairTruncatedJson(text: string): unknown | undefined {
  let s = text.trimEnd();
  if (!s.startsWith("{") && !s.startsWith("[")) return undefined;

  for (let attempt = 0; attempt < 48; attempt += 1) {
    const closed = closeJsonFragment(s);
    if (closed !== undefined) return closed;

    const trimTo = Math.max(
      s.lastIndexOf(","),
      s.lastIndexOf("\n"),
      s.lastIndexOf(" "),
    );
    if (trimTo <= 0) break;
    s = s.slice(0, trimTo).replace(/,\s*$/u, "");
  }
  return undefined;
}

function closeJsonFragment(text: string): unknown | undefined {
  let s = text;
  let inString = false;
  let escape = false;
  const stack: Array<"{" | "["> = [];

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") stack.push("{");
    else if (ch === "[") stack.push("[");
    else if (ch === "}" || ch === "]") {
      if (stack.length > 0) stack.pop();
    }
  }

  if (inString) s += '"';
  // Drop incomplete trailing keys/values only (never strip a finished string value).
  s = s
    .replace(/,\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*:\s*$/u, "")
    .replace(/,\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*$/u, "")
    .replace(/\{\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*:\s*$/u, "{")
    .replace(/\{\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*$/u, "{")
    .replace(/\[\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*$/u, "[")
    .replace(/:\s*$/u, "")
    .replace(/,\s*$/u, "");

  // Recompute stack after cleanup.
  inString = false;
  escape = false;
  stack.length = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") stack.push("{");
    else if (ch === "[") stack.push("[");
    else if (ch === "}" || ch === "]") {
      if (stack.length > 0) stack.pop();
    }
  }
  if (inString) s += '"';

  while (stack.length > 0) {
    s = s.replace(/,\s*$/u, "");
    const open = stack.pop()!;
    s += open === "{" ? "}" : "]";
  }

  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function tryParseJsonBlob(
  value: string,
): { parsed: unknown; truncatedChars?: number } | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;

  const truncMatch = trimmed.match(TRUNCATION_SUFFIX_RE);
  const truncatedChars = truncMatch
    ? Number.parseInt(truncMatch[1]!, 10)
    : undefined;
  const candidate = truncMatch
    ? trimmed.slice(0, truncMatch.index).trimEnd()
    : trimmed;

  try {
    return { parsed: JSON.parse(candidate), truncatedChars };
  } catch {
    /* try repair below */
  }

  const repaired = repairTruncatedJson(candidate);
  if (repaired !== undefined) {
    return { parsed: repaired, truncatedChars };
  }

  if (
    !truncMatch &&
    ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]")))
  ) {
    try {
      return { parsed: JSON.parse(trimmed) };
    } catch {
      /* keep raw string */
    }
  }

  return null;
}

/** Unwrap JSON stored as strings (DB fields, double-encoded / truncated previews). */
export function normalizeLogJsonValue(value: unknown): unknown {
  if (typeof value === "string") {
    const parsed = tryParseJsonBlob(value);
    if (!parsed) return value;
    const nested = normalizeLogJsonValue(parsed.parsed);
    if (
      parsed.truncatedChars !== undefined &&
      isPlainObject(nested) &&
      nested._previewTruncatedChars === undefined
    ) {
      return {
        ...nested,
        _previewTruncatedChars: parsed.truncatedChars,
      };
    }
    return nested;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeLogJsonValue);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // `raw` is the exact provider output and must remain byte-for-byte text.
      // Other JSON-shaped strings can still be expanded for legacy log fields.
      out[k] =
        k === "raw" && typeof v === "string" ? v : normalizeLogJsonValue(v);
    }
    return out;
  }
  return value;
}

/**
 * Compact LLM log rows store `{ compact: true, preview, hash, usage? }`.
 * Expand `preview` (string or object) into the real request/response shape for admin UI.
 */
export function expandCompactLogPayload(value: unknown): unknown {
  const normalized = normalizeLogJsonValue(value);
  if (!isPlainObject(normalized) || normalized.compact !== true) {
    return normalized;
  }

  const {
    compact: _compact,
    preview,
    hash,
    usage,
    outputTps,
    ...rest
  } = normalized;
  const truncatedChars =
    typeof rest._previewTruncatedChars === "number"
      ? rest._previewTruncatedChars
      : typeof preview === "object" &&
          preview &&
          !Array.isArray(preview) &&
          typeof (preview as Record<string, unknown>)._previewTruncatedChars ===
            "number"
        ? ((preview as Record<string, unknown>)
            ._previewTruncatedChars as number)
        : undefined;

  if (isPlainObject(preview)) {
    const { _previewTruncatedChars: _nestedTrunc, ...previewBody } = preview;
    return {
      ...previewBody,
      ...(usage !== undefined ? { usage } : {}),
      ...(outputTps !== undefined ? { outputTps } : {}),
      ...(typeof hash === "string" ? { _payloadHash: hash } : {}),
      ...(truncatedChars !== undefined
        ? { _previewTruncatedChars: truncatedChars }
        : {}),
    };
  }

  if (typeof preview === "string" && preview.trim()) {
    return {
      preview,
      ...(usage !== undefined ? { usage } : {}),
      ...(outputTps !== undefined ? { outputTps } : {}),
      ...(typeof hash === "string" ? { _payloadHash: hash } : {}),
      ...(truncatedChars !== undefined
        ? { _previewTruncatedChars: truncatedChars }
        : {}),
    };
  }

  return normalized;
}

/** Pretty-print log payloads for the dev viewer (wrap-friendly, no minified lines). */
export function formatLogJson(value: unknown): string {
  const normalized = expandCompactLogPayload(value);
  if (typeof normalized === "string") {
    return normalized;
  }
  try {
    return JSON.stringify(normalized, null, 2);
  } catch {
    return String(normalized);
  }
}
