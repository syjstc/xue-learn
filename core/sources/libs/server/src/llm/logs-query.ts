import type { LlmLogQueryRepository } from "../../../domain/src/index.js";
import {
  aggregateTokenUsage,
  aggregateTokenUsageByCategory,
  type TokenAggregateLogRow,
  type TokenUsageCategoryBreakdown,
  type TokenUsageSummary,
} from "./token-aggregate.js";
import { parseStructuredIssuesJson } from "./validation-report.js";

export type {
  TokenUsageCategoryBreakdown,
  TokenUsageCategoryId,
  TokenUsageSummary,
} from "./token-aggregate.js";

export type LlmLogsDb = LlmLogQueryRepository;

export type LlmLogListItem = {
  id: string;
  createdAt: Date;
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
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  reasoningTokens: number | null;
  outputTps: number | null;
  requestPreview: string | null;
  responsePreview: string | null;
  artifactKey: string | null;
  artifactBackend: string | null;
  structuredContractId: string | null;
  structuredContractVersion: number | null;
  structuredSchemaHash: string | null;
  structuredInvocationId: string | null;
  structuredAttempt: number | null;
  structuredTransport: string | null;
  structuredStage: string | null;
  structuredSyntaxRepaired: boolean | null;
  structuredRepairType: string | null;
  structuredOutcome: string | null;
  structuredFailureCategory: string | null;
  structuredUnknownKeyCount: number | null;
  structuredIssuesJson: string | null;
  request?: unknown;
  response?: unknown;
  error: string | null;
};

export type LlmLogsQuery = {
  limit?: number;
  /** 1-based page index; ignored when offset is set explicitly */
  page?: number;
  offset?: number;
  operation?: string;
  kind?: string;
  spanType?: string;
  status?: string;
  provider?: string;
  traceId?: string;
  goalId?: string;
  scope?: string;
  /** When true and traceId is set, oldest-first for timeline view */
  traceTimeline?: boolean;
};

export type LogGoalOption = {
  goalId: string;
  title: string;
  logCount: number;
  lastAt: string;
  usage: TokenUsageSummary;
};

export type LogTraceOption = {
  traceId: string;
  logCount: number;
  startedAt: string;
  endedAt: string;
  operations: string[];
  kinds: string[];
  usage: TokenUsageSummary;
};

export type GoalTokenUsageReport = {
  goalId: string;
  title: string;
  logCount: number;
  usage: TokenUsageSummary;
  byCategory: TokenUsageCategoryBreakdown[];
  byOperation: Array<
    TokenUsageSummary & {
      operation: string;
    }
  >;
};

export type StructuredReliabilityRow = {
  contractId: string;
  contractVersion: number;
  provider: string;
  model: string;
  invocationCount: number;
  firstPassParseRate: number;
  firstPassSchemaValidRate: number;
  firstPassBusinessValidRate: number;
  finalSuccessRate: number;
  emptyOutputRate: number;
  syntaxRepairRate: number;
  modelRetryRate: number;
  positionalRepairRate: number;
  repeatedOutputRate: number;
  budgetExhaustionRate: number;
  averageAttempts: number;
  p95LatencyMs: number;
  tokensPerValidResult: number;
  creditCostPerValidResult: number;
  unknownKeyCount: number;
  failureCategories: Record<string, number>;
  recentFailures: Array<{
    logId: string;
    invocationId: string;
    createdAt: string;
    category: string;
    error: string | null;
  }>;
};

export type StructuredIssueHotspot = {
  operation: string;
  provider: string;
  expectedTool: string | null;
  issuePath: string;
  code: string;
  count: number;
};

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function listPreview(value: string | null | undefined): string | null {
  if (!value) return null;
  const maxChars = 500;
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}…`;
}

function mapRow(row: {
  id: string;
  createdAt: Date;
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
  firstResponseMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheCreationTokens?: number | null;
  reasoningTokens?: number | null;
  outputTps?: number | null;
  requestPreview?: string | null;
  responsePreview?: string | null;
  artifactKey?: string | null;
  artifactBackend?: string | null;
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
  structuredIssuesJson?: string | null;
  request: string;
  response: string;
  error: string | null;
}): LlmLogListItem {
  return {
    id: row.id,
    createdAt: row.createdAt,
    traceId: row.traceId,
    goalId: row.goalId,
    scope: row.scope,
    scopeId: row.scopeId,
    operation: row.operation,
    kind: row.kind,
    spanType: row.spanType,
    parentId: row.parentId,
    label: row.label,
    toolName: row.toolName,
    provider: row.provider,
    model: row.model,
    status: row.status,
    durationMs: row.durationMs,
    firstResponseMs: row.firstResponseMs ?? null,
    inputTokens: row.inputTokens ?? null,
    outputTokens: row.outputTokens ?? null,
    totalTokens: row.totalTokens ?? null,
    cacheReadTokens: row.cacheReadTokens ?? null,
    cacheCreationTokens: row.cacheCreationTokens ?? null,
    reasoningTokens: row.reasoningTokens ?? null,
    outputTps: row.outputTps ?? null,
    requestPreview: row.requestPreview ?? null,
    responsePreview: row.responsePreview ?? null,
    artifactKey: row.artifactKey ?? null,
    artifactBackend: row.artifactBackend ?? null,
    structuredContractId: row.structuredContractId ?? null,
    structuredContractVersion: row.structuredContractVersion ?? null,
    structuredSchemaHash: row.structuredSchemaHash ?? null,
    structuredInvocationId: row.structuredInvocationId ?? null,
    structuredAttempt: row.structuredAttempt ?? null,
    structuredTransport: row.structuredTransport ?? null,
    structuredStage: row.structuredStage ?? null,
    structuredSyntaxRepaired: row.structuredSyntaxRepaired ?? null,
    structuredRepairType: row.structuredRepairType ?? null,
    structuredOutcome: row.structuredOutcome ?? null,
    structuredFailureCategory: row.structuredFailureCategory ?? null,
    structuredUnknownKeyCount: row.structuredUnknownKeyCount ?? null,
    structuredIssuesJson: row.structuredIssuesJson ?? null,
    request: safeParseJson(row.request),
    response: safeParseJson(row.response),
    error: row.error,
  };
}

const llmLogListSelect = {
  id: true,
  createdAt: true,
  traceId: true,
  goalId: true,
  scope: true,
  scopeId: true,
  operation: true,
  kind: true,
  spanType: true,
  parentId: true,
  label: true,
  toolName: true,
  provider: true,
  model: true,
  status: true,
  durationMs: true,
  firstResponseMs: true,
  inputTokens: true,
  outputTokens: true,
  totalTokens: true,
  cacheReadTokens: true,
  cacheCreationTokens: true,
  reasoningTokens: true,
  outputTps: true,
  requestPreview: true,
  responsePreview: true,
  artifactKey: true,
  artifactBackend: true,
  structuredContractId: true,
  structuredContractVersion: true,
  structuredSchemaHash: true,
  structuredInvocationId: true,
  structuredAttempt: true,
  structuredTransport: true,
  structuredStage: true,
  structuredSyntaxRepaired: true,
  structuredRepairType: true,
  structuredOutcome: true,
  structuredFailureCategory: true,
  structuredUnknownKeyCount: true,
  structuredIssuesJson: true,
  error: true,
} as const;

function mapListRow(
  row: Omit<Parameters<typeof mapRow>[0], "request" | "response">,
): LlmLogListItem {
  return {
    id: row.id,
    createdAt: row.createdAt,
    traceId: row.traceId,
    goalId: row.goalId,
    scope: row.scope,
    scopeId: row.scopeId,
    operation: row.operation,
    kind: row.kind,
    spanType: row.spanType,
    parentId: row.parentId,
    label: row.label,
    toolName: row.toolName,
    provider: row.provider,
    model: row.model,
    status: row.status,
    durationMs: row.durationMs,
    firstResponseMs: row.firstResponseMs ?? null,
    inputTokens: row.inputTokens ?? null,
    outputTokens: row.outputTokens ?? null,
    totalTokens: row.totalTokens ?? null,
    cacheReadTokens: row.cacheReadTokens ?? null,
    cacheCreationTokens: row.cacheCreationTokens ?? null,
    reasoningTokens: row.reasoningTokens ?? null,
    outputTps: row.outputTps ?? null,
    requestPreview: listPreview(row.requestPreview),
    responsePreview: listPreview(row.responsePreview),
    artifactKey: row.artifactKey ?? null,
    artifactBackend: row.artifactBackend ?? null,
    structuredContractId: row.structuredContractId ?? null,
    structuredContractVersion: row.structuredContractVersion ?? null,
    structuredSchemaHash: row.structuredSchemaHash ?? null,
    structuredInvocationId: row.structuredInvocationId ?? null,
    structuredAttempt: row.structuredAttempt ?? null,
    structuredTransport: row.structuredTransport ?? null,
    structuredStage: row.structuredStage ?? null,
    structuredSyntaxRepaired: row.structuredSyntaxRepaired ?? null,
    structuredRepairType: row.structuredRepairType ?? null,
    structuredOutcome: row.structuredOutcome ?? null,
    structuredFailureCategory: row.structuredFailureCategory ?? null,
    structuredUnknownKeyCount: row.structuredUnknownKeyCount ?? null,
    structuredIssuesJson: row.structuredIssuesJson ?? null,
    error: row.error,
  };
}

export async function queryLlmLogs(db: LlmLogsDb, filters: LlmLogsQuery = {}) {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const page = Math.max(filters.page ?? 1, 1);
  const offset =
    filters.offset !== undefined
      ? Math.max(filters.offset, 0)
      : (page - 1) * limit;
  const where = {
    ...(filters.operation
      ? { operationContains: filters.operation }
      : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.spanType ? { spanType: filters.spanType } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.provider ? { provider: filters.provider } : {}),
    ...(filters.traceId ? { traceId: filters.traceId } : {}),
    ...(filters.goalId ? { goalId: filters.goalId } : {}),
    ...(filters.scope ? { scope: filters.scope } : {}),
  };

  const [total, rows] = await Promise.all([
    db.count(where),
    db.list({
      filter: where,
      order: filters.traceTimeline && filters.traceId ? "asc" : "desc",
      offset,
      limit,
    }),
  ]);

  const logs = (rows as Parameters<typeof mapListRow>[0][]).map(mapListRow);
  const resolvedPage = Math.floor(offset / limit) + 1;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    count: logs.length,
    total,
    page: resolvedPage,
    limit,
    totalPages,
    logs,
  };
}

export async function queryLlmLogDetail(db: LlmLogsDb, id: string) {
  const [row, childRows] = await Promise.all([
    db.find(id),
    db.list({ filter: { parentId: id }, order: "asc" }),
  ]);
  if (!row) return null;
  return {
    log: mapRow(row as Parameters<typeof mapRow>[0]),
    childLogs: (childRows as Parameters<typeof mapRow>[0][]).map(mapRow),
  };
}

function ratio(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 10_000) / 10_000 : 0;
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function structuredFailureCategory(error: string | null): string {
  const value = (error ?? "").toLowerCase();
  if (value.includes("empty") || value.includes("no parsed payload"))
    return "empty_output";
  if (value.includes("timeout") || value.includes("attempt exceeded"))
    return "timeout";
  if (
    value.includes("unauthor") ||
    value.includes("forbidden") ||
    value.includes("401") ||
    value.includes("403")
  )
    return "authorization";
  if (value.includes("cancel") || value.includes("abort"))
    return "cancellation";
  if (value.includes("repeated")) return "repeated_output";
  if (value.includes("budget") || value.includes("credit"))
    return "budget_exhaustion";
  if (value.includes("raw bytes") || value.includes("exceeded"))
    return "resource_limit";
  if (value.includes("unknown propert")) return "unknown_keys";
  if (value.includes("parse") || value.includes("json")) return "parse";
  if (value.includes("validation") || value.includes("invalid"))
    return "validation";
  return value ? "provider_or_transport" : "unknown";
}

export async function queryStructuredReliability(
  db: LlmLogsDb,
  hours = 24,
): Promise<{
  from: string;
  to: string;
  hours: number;
  rows: StructuredReliabilityRow[];
  issueHotspots: StructuredIssueHotspot[];
}> {
  const requestedHours = Number.isFinite(hours) ? Math.floor(hours) : 24;
  const boundedHours = Math.min(Math.max(requestedHours, 1), 24 * 30);
  const to = new Date();
  const from = new Date(to.getTime() - boundedHours * 60 * 60 * 1000);
  const logs = (await db.list({
    filter: { createdAtGte: from, structuredOnly: true },
    order: "desc",
    limit: 50_000,
  })) as Array<Record<string, any>>;
  const ledgerEntries =
    logs.length > 0
      ? await db.listCreditUsage(logs.map((log) => String(log.id)))
      : [];
  const costMinorByLogId = new Map<string, number>();
  for (const entry of ledgerEntries) {
    if (!entry.llmRequestLogId) continue;
    costMinorByLogId.set(
      entry.llmRequestLogId,
      (costMinorByLogId.get(entry.llmRequestLogId) ?? 0) +
        Math.abs(entry.amount),
    );
  }

  const groups = new Map<string, typeof logs>();
  for (const log of logs) {
    const key = [
      log.structuredContractId,
      log.structuredContractVersion ?? 1,
      log.provider,
      log.model,
    ].join("\u0000");
    const list = groups.get(key) ?? [];
    list.push(log);
    groups.set(key, list);
  }

  const rows = [...groups.values()].map((group): StructuredReliabilityRow => {
    const byInvocation = new Map<string, typeof group>();
    for (const log of group) {
      const id = log.structuredInvocationId!;
      const list = byInvocation.get(id) ?? [];
      list.push(log);
      byInvocation.set(id, list);
    }
    let firstParse = 0;
    let firstSchema = 0;
    let firstBusiness = 0;
    let finalSuccess = 0;
    let empty = 0;
    let syntaxRepair = 0;
    let modelRetry = 0;
    let positionalRepair = 0;
    let repeated = 0;
    let budget = 0;
    let attemptTotal = 0;
    let validTokens = 0;
    let validCostMinor = 0;
    let unknownKeyCount = 0;
    const durations: number[] = [];
    const failureCategories: Record<string, number> = {};
    const recentFailures: StructuredReliabilityRow["recentFailures"] = [];

    for (const invocation of byInvocation.values()) {
      const attempts = new Set(
        invocation.flatMap((log) =>
          log.structuredAttempt != null ? [log.structuredAttempt] : [],
        ),
      );
      const firstLogs = invocation.filter(
        (log) => (log.structuredAttempt ?? 1) === 1,
      );
      const isOkStatus = (status: string) =>
        status === "success" || status === "recovered";
      const firstParseOk =
        firstLogs.some(
          (log) =>
            log.structuredStage === "schema" ||
            log.structuredStage === "business" ||
            (log.structuredStage === "parse" && isOkStatus(log.status)) ||
            log.structuredStage === "tool-call",
        ) &&
        !firstLogs.some(
          (log) => log.structuredStage === "parse" && log.status === "error",
        );
      const firstSchemaOk =
        firstParseOk &&
        firstLogs.some(
          (log) =>
            isOkStatus(log.status) &&
            (log.structuredStage === "schema" ||
              log.structuredStage === "business" ||
              log.structuredStage === "tool-call"),
        );
      const succeeded = invocation.some(
        (log) => log.structuredOutcome === "final_success",
      );
      const failed = invocation.some(
        (log) => log.structuredOutcome === "final_error",
      );
      const repaired = invocation.some(
        (log) =>
          log.structuredStage === "repair" || log.structuredRepairType != null,
      );

      if (firstParseOk) firstParse += 1;
      if (firstSchemaOk) firstSchema += 1;
      if (firstSchemaOk && succeeded && !repaired && attempts.size <= 1) {
        firstBusiness += 1;
      }
      if (succeeded) {
        finalSuccess += 1;
        validTokens += invocation.reduce(
          (sum, log) => sum + (log.totalTokens ?? 0),
          0,
        );
        validCostMinor += invocation.reduce(
          (sum, log) => sum + (costMinorByLogId.get(log.id) ?? 0),
          0,
        );
      }
      if (
        invocation.some(
          (log) =>
            log.structuredFailureCategory === "empty_output" ||
            /empty|no parsed payload/i.test(log.error ?? ""),
        )
      )
        empty += 1;
      if (invocation.some((log) => log.structuredSyntaxRepaired))
        syntaxRepair += 1;
      if (attempts.size > 1) modelRetry += 1;
      if (repaired) positionalRepair += 1;
      if (
        invocation.some(
          (log) =>
            log.structuredFailureCategory === "repeated_output" ||
            /repeated/i.test(log.error ?? ""),
        )
      )
        repeated += 1;
      if (
        invocation.some(
          (log) =>
            log.structuredFailureCategory === "budget_exhaustion" ||
            /budget|exhausted/i.test(log.error ?? ""),
        )
      )
        budget += 1;
      attemptTotal += Math.max(attempts.size, 1);
      durations.push(invocation.reduce((sum, log) => sum + log.durationMs, 0));
      unknownKeyCount += invocation.reduce(
        (sum, log) => sum + (log.structuredUnknownKeyCount ?? 0),
        0,
      );
      if (failed || !succeeded) {
        const terminalLog =
          invocation.find((log) => log.structuredOutcome === "final_error") ??
          invocation.find((log) => log.status === "error") ??
          invocation[0]!;
        const category =
          [...invocation].reverse().find((log) => log.structuredFailureCategory)
            ?.structuredFailureCategory ??
          structuredFailureCategory(
            [...invocation].reverse().find((log) => log.error)?.error ?? null,
          );
        failureCategories[category] = (failureCategories[category] ?? 0) + 1;
        if (recentFailures.length < 10) {
          recentFailures.push({
            logId: terminalLog.id,
            invocationId: terminalLog.structuredInvocationId!,
            createdAt:
              terminalLog.createdAt instanceof Date
                ? terminalLog.createdAt.toISOString()
                : "",
            category,
            error: terminalLog.error?.trim().slice(0, 1_000) || null,
          });
        }
      }
    }

    const total = byInvocation.size;
    const first = group[0]!;
    return {
      contractId: first.structuredContractId!,
      contractVersion: first.structuredContractVersion ?? 1,
      provider: first.provider,
      model: first.model,
      invocationCount: total,
      firstPassParseRate: ratio(firstParse, total),
      firstPassSchemaValidRate: ratio(firstSchema, total),
      firstPassBusinessValidRate: ratio(firstBusiness, total),
      finalSuccessRate: ratio(finalSuccess, total),
      emptyOutputRate: ratio(empty, total),
      syntaxRepairRate: ratio(syntaxRepair, total),
      modelRetryRate: ratio(modelRetry, total),
      positionalRepairRate: ratio(positionalRepair, total),
      repeatedOutputRate: ratio(repeated, total),
      budgetExhaustionRate: ratio(budget, total),
      averageAttempts:
        total > 0 ? Math.round((attemptTotal / total) * 100) / 100 : 0,
      p95LatencyMs: percentile95(durations),
      tokensPerValidResult:
        finalSuccess > 0 ? Math.round(validTokens / finalSuccess) : 0,
      creditCostPerValidResult:
        finalSuccess > 0
          ? Math.round((validCostMinor / 100 / finalSuccess) * 10_000) / 10_000
          : 0,
      unknownKeyCount,
      failureCategories,
      recentFailures,
    };
  });

  const hotspotCounts = new Map<string, StructuredIssueHotspot>();
  for (const log of logs) {
    const request =
      typeof log.request === "string"
        ? safeParseJson(log.request)
        : log.request;
    const requestRecord =
      request && typeof request === "object" && !Array.isArray(request)
        ? (request as Record<string, unknown>)
        : {};
    const expectedTool =
      typeof requestRecord.expectedTool === "string"
        ? requestRecord.expectedTool
        : null;
    const issues = [
      ...parseStructuredIssuesJson(log.structuredIssuesJson),
      ...parseStructuredIssuesJson(
        typeof requestRecord.structuredIssuesJson === "string"
          ? requestRecord.structuredIssuesJson
          : "",
      ),
    ];
    for (const issue of issues) {
      const key = [
        log.operation,
        log.provider,
        expectedTool ?? "",
        issue.path,
        issue.code,
      ].join("\u0000");
      const existing = hotspotCounts.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      hotspotCounts.set(key, {
        operation: String(log.operation ?? ""),
        provider: String(log.provider ?? ""),
        expectedTool,
        issuePath: issue.path,
        code: issue.code,
        count: 1,
      });
    }
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    hours: boundedHours,
    rows: rows.sort(
      (left, right) => right.invocationCount - left.invocationCount,
    ),
    issueHotspots: [...hotspotCounts.values()]
      .sort((left, right) => right.count - left.count)
      .slice(0, 50),
  };
}

export async function queryLogGoals(
  db: LlmLogsDb,
  limit = 30,
): Promise<LogGoalOption[]> {
  const capped = Math.min(Math.max(limit, 1), 100);

  const rows = await db.groupGoals(capped);

  if (rows.length === 0) return [];

  const goalIds = rows.map((r) => r.goalId);
  const goals = await db.findGoals(goalIds);
  const titleById = new Map(goals.map((g) => [g.id, g.title]));

  const usageLogs = (await db.list({ filter: { goalIds } })) as Array<
    TokenAggregateLogRow & { goalId: string | null }
  >;

  const usageByGoal = new Map<string, typeof usageLogs>();
  for (const log of usageLogs) {
    if (!log.goalId) continue;
    const list = usageByGoal.get(log.goalId) ?? [];
    list.push(log);
    usageByGoal.set(log.goalId, list);
  }

  return rows.map((row) => ({
    goalId: row.goalId,
    title: titleById.get(row.goalId) ?? row.goalId,
    logCount: row.logCount,
    lastAt: row.lastAt.toISOString(),
    usage: aggregateTokenUsage(usageByGoal.get(row.goalId) ?? []),
  }));
}

export async function queryLogTraces(
  db: LlmLogsDb,
  goalId?: string,
  limit = 40,
): Promise<LogTraceOption[]> {
  const rows = (await db.list({
    filter: { traceIdPresent: true, ...(goalId ? { goalId } : {}) },
    order: "desc",
    limit: 2000,
  })) as Array<Record<string, any>>;

  const byTrace = new Map<
    string,
    {
      operations: Set<string>;
      kinds: Set<string>;
      times: Date[];
      logs: Array<{
        response: string;
        operation: string;
        kind: string;
        durationMs: number;
        inputTokens: number | null;
        outputTokens: number | null;
        totalTokens: number | null;
        cacheReadTokens: number | null;
        cacheCreationTokens: number | null;
        reasoningTokens: number | null;
      }>;
    }
  >();

  for (const row of rows) {
    if (!row.traceId) continue;
    let entry = byTrace.get(row.traceId);
    if (!entry) {
      entry = { operations: new Set(), kinds: new Set(), times: [], logs: [] };
      byTrace.set(row.traceId, entry);
    }
    entry.operations.add(row.operation);
    entry.kinds.add(row.kind);
    entry.times.push(row.createdAt);
    entry.logs.push({
      response: row.response,
      operation: row.operation,
      kind: row.kind,
      durationMs: row.durationMs,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      reasoningTokens: row.reasoningTokens,
    });
  }

  return [...byTrace.entries()]
    .map(([traceId, entry]) => {
      const sorted = entry.times.sort((a, b) => a.getTime() - b.getTime());
      return {
        traceId,
        logCount: entry.times.length,
        startedAt: sorted[0]!.toISOString(),
        endedAt: sorted[sorted.length - 1]!.toISOString(),
        operations: [...entry.operations],
        kinds: [...entry.kinds],
        usage: aggregateTokenUsage(entry.logs),
      };
    })
    .sort((a, b) => b.endedAt.localeCompare(a.endedAt))
    .slice(0, limit);
}

export async function queryGoalTokenUsage(
  db: LlmLogsDb,
  goalId: string,
): Promise<GoalTokenUsageReport | null> {
  const goal = await db.findGoal(goalId);
  if (!goal) return null;

  const logs = (await db.list({ filter: { goalId }, order: "asc" })) as Array<
    TokenAggregateLogRow
  >;

  const byOperation = new Map<
    string,
    Array<{
      response: string;
      operation: string;
      kind: string;
      durationMs: number;
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
      cacheReadTokens: number | null;
      cacheCreationTokens: number | null;
      reasoningTokens: number | null;
    }>
  >();

  for (const log of logs) {
    const list = byOperation.get(log.operation) ?? [];
    list.push(log as (typeof list)[number]);
    byOperation.set(log.operation, list);
  }

  return {
    goalId: goal.id,
    title: goal.title,
    logCount: logs.length,
    usage: aggregateTokenUsage(logs),
    byCategory: aggregateTokenUsageByCategory(logs),
    byOperation: [...byOperation.entries()]
      .map(([operation, operationLogs]) => ({
        operation,
        ...aggregateTokenUsage(operationLogs),
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens),
  };
}
