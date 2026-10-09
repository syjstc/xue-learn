import { randomUUID } from "node:crypto";
import { requireLlmRequestLogPersistence } from "./log-persistence.js";
import {
  beforeMeteredLlmRequest,
  afterMeteredLlmRequest,
  isMeteredLlmKind,
} from "./usage-accounting.js";
import { getEnv } from "../env.js";
import { getCurrentUserId } from "../user-context.js";
import { spanMetaForPayload } from "./log-span.js";
import {
  resolveImageModel,
  resolveImageProviderId,
} from "../images/providers/index.js";
import { getLlmRuntimeConfig } from "./runtime-config.js";
import {
  activeLlmRouteLogMeta,
  getActiveLlmOperationRoute,
} from "../providers/llm/operation-routing-context.js";
import { getExplicitLlmSelection } from "../providers/llm/explicit-selection-context.js";
import {
  getActiveParentLogId,
  getLlmTrace,
  setActiveParentLogId,
} from "./trace-context.js";
import {
  archivePayload,
  compactJsonColumn,
  compactPayload,
  extractUsageFields,
  getRequestContext,
  type UsageFields,
} from "../observability/index.js";
import {
  parseStructuredIssuesJson,
  serializeStructuredIssuesJson,
  type ValidationIssue,
} from "./validation-report.js";
import {
  recordActiveOperationLlmFinish,
  recordActiveOperationLlmStart,
  recordActiveOperationStructured,
  recordActiveOperationTelemetry,
} from "../generation/execution/evidence-collector.js";

export type LlmLogKind =
  "chat" | "embedding" | "search" | "rag" | "image" | "audio";
/** Terminal success after repair/retry uses `recovered` so operators can tell hard fails from healed ones. */
export type LlmLogStatus = "success" | "error" | "running" | "recovered";

function recoveryCounter(
  recovery: Record<string, unknown>,
  key: string,
): number {
  const value = recovery[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

/** True when a successful structured call needed repair, retry, or healed a prior error. */
export function hasStructuredRecoverySignals(
  request: Record<string, unknown>,
  response: Record<string, unknown> = {},
  priorStatus?: string | null,
): boolean {
  if (priorStatus === "error") return true;
  if (response.structuredSyntaxRepaired === true) return true;
  if (request.structuredSyntaxRepaired === true) return true;
  if (
    typeof response.structuredRepairType === "string" &&
    response.structuredRepairType.trim()
  ) {
    return true;
  }
  if (
    typeof request.structuredRepairType === "string" &&
    request.structuredRepairType.trim()
  ) {
    return true;
  }
  const attempt = request.structuredAttempt ?? response.structuredAttempt;
  if (typeof attempt === "number" && Number.isInteger(attempt) && attempt > 1) {
    return true;
  }
  const recovery =
    request.structuredRecovery &&
    typeof request.structuredRecovery === "object" &&
    !Array.isArray(request.structuredRecovery)
      ? (request.structuredRecovery as Record<string, unknown>)
      : null;
  if (!recovery) return false;
  return (
    recoveryCounter(recovery, "repairCount") > 0 ||
    recoveryCounter(recovery, "repairedValueCount") > 0 ||
    recoveryCounter(recovery, "fallbackCount") > 0
  );
}

/** Upgrade plain success to recovered when repair/retry signals are present. */
export function resolveTerminalLlmLogStatus(
  status: LlmLogStatus,
  request: Record<string, unknown>,
  response: Record<string, unknown> = {},
  priorStatus?: string | null,
): LlmLogStatus {
  if (status !== "success") return status;
  return hasStructuredRecoverySignals(request, response, priorStatus)
    ? "recovered"
    : "success";
}

export type LlmLogPayload = {
  operation: string;
  kind: LlmLogKind;
  status: LlmLogStatus;
  durationMs: number;
  firstResponseMs?: number;
  request: Record<string, unknown>;
  response?: Record<string, unknown>;
  error?: string;
  meta?: Record<string, unknown>;
  /** Override auto span type (llm | tool | parse | embedding). */
  spanType?: string;
  label?: string;
  toolName?: string;
  parentId?: string;
  /** After insert, set this log as parent for nested parse/tool spans. */
  setActiveSpan?: boolean;
};

export type LlmLogStartPayload = Omit<
  LlmLogPayload,
  "status" | "durationMs" | "response" | "error" | "firstResponseMs"
>;

export type LlmLogFinishPayload = Pick<
  LlmLogPayload,
  "status" | "durationMs" | "response" | "error" | "firstResponseMs"
>;

export type LlmRequestLogHandle = {
  readonly id: string;
  recordFirstResponse(): Promise<void>;
  finish(payload: LlmLogFinishPayload): Promise<void>;
};

function errorCauseChain(error: unknown): string[] {
  const chain: string[] = [];
  let current = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current) && chain.length < 5) {
    seen.add(current);
    chain.push(`${current.name || "Error"}: ${current.message}`);
    current = (current as Error & { cause?: unknown }).cause;
  }
  return chain;
}

function llmRequestLogDb() {
  const repository = requireLlmRequestLogPersistence();
  return {
    create: (args: { data: Record<string, unknown> }) => repository.create(args.data),
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => repository.patch(args.where.id, args.data),
    findUnique: (args: { where: { id: string }; select?: Record<string, boolean> }) => repository.find(args.where.id) as Promise<any>,
  };
}

function llmLogConfig() {
  const env = getEnv();
  return {
    /** Console output only; DB billing logs always persist. */
    consoleEnabled: env.LLM_LOG_ENABLED ?? true,
    maxChars: env.LLM_LOG_MAX_CHARS,
  };
}

function isEvaluationExecution(): boolean {
  return getLlmTrace()?.meta?.executionPurpose === "evaluation";
}

function truncateValue(value: unknown, maxChars: number): unknown {
  if (typeof value === "string") {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}… [truncated ${value.length - maxChars} chars]`;
  }
  if (Array.isArray(value)) {
    return value.map((v) => truncateValue(v, maxChars));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = truncateValue(v, maxChars);
    }
    return out;
  }
  return value;
}

function sanitizePayload(
  payload: LlmLogPayload,
  maxChars: number,
): LlmLogPayload {
  return {
    ...payload,
    request: truncateValue(payload.request, maxChars) as Record<
      string,
      unknown
    >,
    response: payload.response
      ? (truncateValue(payload.response, maxChars) as Record<string, unknown>)
      : undefined,
    error: payload.error
      ? (truncateValue(payload.error, maxChars) as string)
      : undefined,
  };
}

function resolveLogScope(meta?: Record<string, unknown>): {
  goalId: string | null;
  scope: string | null;
  scopeId: string | null;
} {
  if (!meta) return { goalId: null, scope: null, scopeId: null };
  const scope = typeof meta.scope === "string" ? meta.scope : null;
  const scopeId = typeof meta.scopeId === "string" ? meta.scopeId : null;
  const explicitGoal =
    typeof meta.goalId === "string" ? meta.goalId.trim() || null : null;
  const goalId = explicitGoal ?? (scope === "goal" && scopeId ? scopeId : null);
  return { goalId, scope, scopeId };
}

function formatConsoleUsage(response: unknown): string {
  if (!response || typeof response !== "object") return "";
  const res = response as Record<string, unknown>;
  const usage = res.usage as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== "object") return "";

  const parts: string[] = [];
  if (typeof usage.input_tokens === "number") {
    parts.push(`in=${usage.input_tokens}`);
  }
  if (typeof usage.output_tokens === "number") {
    parts.push(`out=${usage.output_tokens}`);
  }
  if (typeof res.outputTps === "number") {
    parts.push(`${res.outputTps} tok/s`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function formatConsoleTtfb(firstResponseMs: unknown): string {
  if (typeof firstResponseMs !== "number" || firstResponseMs <= 0) return "";
  return ` ttfb=${firstResponseMs}ms`;
}

function printConsole(record: Record<string, unknown>) {
  const { operation, kind, spanType, label, status, durationMs, error } =
    record;
  const typeLabel =
    spanType === "tool"
      ? `tool:${record.toolName ?? operation}`
      : spanType === "parse"
        ? "parse"
        : kind === "search"
          ? "search"
          : kind === "rag"
            ? "rag"
            : kind === "image"
              ? "image"
              : kind === "audio"
                ? "audio"
                : `LLM ${kind}`;
  const title = typeof label === "string" ? label : operation;
  const usageSuffix = formatConsoleUsage(record.response);
  const ttfbSuffix = formatConsoleTtfb(record.firstResponseMs);
  const prefix = `[${typeLabel}] ${title} ${status} ${durationMs}ms${ttfbSuffix}${usageSuffix}`;
  if (status === "error") {
    console.error(prefix, error ?? record);
  } else if (status === "running") {
    console.info(prefix);
  } else {
    console.info(prefix);
  }
  if (process.env.LLM_LOG_VERBOSE === "true") {
    console.info(JSON.stringify(record, null, 2));
  }
}

export function getLlmModelInfo(): {
  provider: string;
  chatModel: string;
  embeddingModel: string;
  embeddingProvider?: string;
} {
  const runtime = getLlmRuntimeConfig();
  const explicit = getExplicitLlmSelection();
  const route = getActiveLlmOperationRoute();
  return {
    provider: explicit?.id ?? route?.provider ?? runtime.provider,
    chatModel:
      explicit?.model ??
      explicit?.options?.chatModel ??
      route?.model ??
      runtime.chatModel,
    embeddingModel: runtime.embeddingModel,
    embeddingProvider:
      runtime.embeddingProvider !== runtime.provider
        ? runtime.embeddingProvider
        : undefined,
  };
}

function buildRequestPayload(payload: LlmLogPayload): Record<string, unknown> {
  const trace = getLlmTrace();
  return {
    ...payload.request,
    ...activeLlmRouteLogMeta(),
    ...(payload.meta ?? {}),
    ...(trace?.meta ?? {}),
  };
}

type ResolvedLogFields = {
  trace: ReturnType<typeof getLlmTrace>;
  requestId: string | null;
  traceId: string | null;
  request: Record<string, unknown>;
  scopeFields: ReturnType<typeof resolveLogScope>;
  spanType: string;
  label: string | undefined;
  toolName: string | undefined;
  parentId: string | null;
  provider: string;
  model: string;
  userId: string | null;
};

function resolveProviderModel(
  payload: LlmLogPayload,
  request: Record<string, unknown>,
): { provider: string; model: string } {
  if (payload.kind === "search") {
    return {
      provider: "tavily",
      model:
        typeof payload.meta?.searchDepth === "string"
          ? payload.meta.searchDepth
          : "search",
    };
  }
  if (payload.kind === "rag") {
    return {
      provider: "pgvector",
      model:
        typeof payload.meta?.mode === "string" ? payload.meta.mode : "retrieve",
    };
  }
  if (payload.kind === "image") {
    let provider: string = resolveImageProviderId(getEnv());
    let model: string = resolveImageModel();
    if (typeof payload.response?.provider === "string") {
      provider = payload.response.provider;
    }
    if (typeof payload.response?.model === "string") {
      model = payload.response.model;
    }
    return { provider, model };
  }
  if (payload.kind === "audio") {
    return {
      provider:
        typeof request.provider === "string" ? request.provider : "minimax",
      model:
        typeof request.model === "string" ? request.model : "speech-2.8-turbo",
    };
  }
  const info = getLlmModelInfo();
  return {
    provider: info.provider,
    model: payload.kind === "chat" ? info.chatModel : info.embeddingModel,
  };
}

function resolveLogFields(payload: LlmLogPayload): ResolvedLogFields {
  const trace = getLlmTrace();
  const requestContext = getRequestContext();
  const request = buildRequestPayload(payload);
  const scopeFields = resolveLogScope({
    ...trace?.meta,
    ...(payload.meta ?? {}),
  });
  const autoSpan = spanMetaForPayload(payload.kind, payload.operation);
  const { provider, model } = resolveProviderModel(payload, request);

  return {
    trace,
    requestId: requestContext?.requestId ?? null,
    traceId: trace?.traceId ?? requestContext?.traceId ?? null,
    request,
    scopeFields,
    spanType: payload.spanType ?? autoSpan.spanType,
    label: payload.label ?? autoSpan.label,
    toolName: payload.toolName ?? autoSpan.toolName,
    parentId: payload.parentId ?? getActiveParentLogId() ?? null,
    provider,
    model,
    userId:
      // Callers usually put platformFunded on options.meta, which is merged into
      // the request payload (and optionally the LLM trace). Treat any of those as
      // platform-funded so admin/diagnostic/verification calls skip learner credits.
      request.platformFunded === true || payload.meta?.platformFunded === true
        ? null
        : typeof payload.meta?.userId === "string"
          ? payload.meta.userId
          : (getCurrentUserId() ?? null),
  };
}

function buildLogRecord(
  payload: LlmLogPayload,
  fields: ResolvedLogFields,
  maxChars: number,
  logId?: string,
): Record<string, unknown> {
  return {
    ...(logId ? { id: logId } : {}),
    ts: new Date().toISOString(),
    userId: fields.userId,
    requestId: fields.requestId,
    traceId: fields.traceId,
    goalId: fields.scopeFields.goalId,
    scope: fields.scopeFields.scope,
    scopeId: fields.scopeFields.scopeId,
    provider: fields.provider,
    model: fields.model,
    spanType: fields.spanType,
    parentId: fields.parentId,
    label: fields.label,
    toolName: fields.toolName ?? null,
    firstResponseMs: payload.firstResponseMs ?? null,
    ...sanitizePayload({ ...payload, request: fields.request }, maxChars),
  };
}

function dbCreateData(
  payload: LlmLogPayload,
  fields: ResolvedLogFields,
  record: Record<string, unknown>,
  compact: {
    request: ReturnType<typeof compactPayload>;
    response: ReturnType<typeof compactPayload>;
    usage: UsageFields;
  },
) {
  const structured = structuredLogFields(record.request, record.response);
  return {
    requestId: fields.requestId,
    traceId: fields.traceId,
    userId: fields.userId,
    goalId: fields.scopeFields.goalId,
    scope: fields.scopeFields.scope,
    scopeId: fields.scopeFields.scopeId,
    operation: payload.operation,
    kind: payload.kind,
    spanType: fields.spanType,
    parentId: fields.parentId,
    label: fields.label,
    toolName: fields.toolName ?? null,
    provider: fields.provider,
    model: fields.model,
    status: payload.status,
    durationMs: payload.durationMs,
    firstResponseMs: payload.firstResponseMs ?? null,
    inputTokens: compact.usage.inputTokens,
    outputTokens: compact.usage.outputTokens,
    totalTokens: compact.usage.totalTokens,
    cacheReadTokens: compact.usage.cacheReadTokens,
    cacheCreationTokens: compact.usage.cacheCreationTokens,
    reasoningTokens: compact.usage.reasoningTokens,
    outputTps: compact.usage.outputTps,
    requestPreview: compact.request.preview,
    responsePreview: compact.response.preview,
    requestHash: compact.request.hash,
    responseHash: compact.response.hash,
    ...structured,
    request: compactJsonColumn(record.request, compact.request),
    response: compactJsonColumn(
      record.response ?? {},
      compact.response,
      compact.usage,
    ),
    error: payload.error ?? null,
  };
}

function structuredLogFields(
  requestValue: unknown,
  responseValue?: unknown,
): Record<string, unknown> {
  const request =
    requestValue && typeof requestValue === "object"
      ? (requestValue as Record<string, unknown>)
      : {};
  const response =
    responseValue && typeof responseValue === "object"
      ? (responseValue as Record<string, unknown>)
      : {};
  const stringValue = (value: unknown) =>
    typeof value === "string" && value.trim() ? value : undefined;
  const integerValue = (value: unknown) =>
    typeof value === "number" && Number.isInteger(value) ? value : undefined;
  const booleanValue = (value: unknown) =>
    typeof value === "boolean" ? value : undefined;
  return {
    structuredContractId: stringValue(request.structuredContractId),
    structuredContractVersion: integerValue(request.structuredContractVersion),
    structuredSchemaHash: stringValue(request.structuredSchemaHash),
    structuredInvocationId: stringValue(request.structuredInvocationId),
    structuredAttempt: integerValue(request.structuredAttempt),
    structuredTransport: stringValue(request.structuredTransport),
    structuredStage: stringValue(
      response.structuredValidationStage ?? request.structuredStage,
    ),
    structuredSyntaxRepaired: booleanValue(
      response.structuredSyntaxRepaired ?? request.structuredSyntaxRepaired,
    ),
    structuredRepairType: stringValue(
      request.structuredRepairType ?? response.structuredRepairType,
    ),
    structuredOutcome: stringValue(
      response.structuredOutcome ?? request.structuredOutcome,
    ),
    structuredFailureCategory: stringValue(
      response.structuredFailureCategory ?? request.structuredFailureCategory,
    ),
    structuredUnknownKeyCount: integerValue(
      response.structuredUnknownKeyCount ?? request.structuredUnknownKeyCount,
    ),
    structuredIssuesJson: (() => {
      const fromColumn =
        typeof response.structuredIssuesJson === "string"
          ? response.structuredIssuesJson
          : typeof request.structuredIssuesJson === "string"
            ? request.structuredIssuesJson
            : undefined;
      if (fromColumn?.trim()) return fromColumn;
      const issues = response.structuredIssues ?? request.structuredIssues;
      if (!Array.isArray(issues)) return undefined;
      return serializeStructuredIssuesJson(issues as ValidationIssue[]);
    })(),
  };
}

function compactLogPayloads(record: Record<string, unknown>) {
  const previewChars = getEnv().LLM_LOG_PREVIEW_CHARS;
  const usage = extractUsageFields(record.response ?? {});
  return {
    request: compactPayload(record.request ?? {}, previewChars),
    response: compactPayload(record.response ?? {}, previewChars),
    usage,
  };
}

/** Create a log row immediately when an LLM request starts. */
export async function startLlmRequestLog(
  payload: LlmLogStartPayload,
): Promise<string | undefined> {
  const fullPayload: LlmLogPayload = {
    ...payload,
    status: "running",
    durationMs: 0,
  };
  const fields = resolveLogFields(fullPayload);
  if (isEvaluationExecution()) {
    const id = randomUUID();
    if (payload.setActiveSpan) setActiveParentLogId(id);
    recordActiveOperationLlmStart({
      id,
      parentId: fields.parentId ?? undefined,
      operation: payload.operation,
      provider: fields.provider,
      model: fields.model,
      kind:
        fields.spanType === "tool"
          ? "tool"
          : fields.spanType === "parse"
            ? "parse"
            : "llm",
    });
    return id;
  }
  if (isMeteredLlmKind(fullPayload.kind)) {
    await beforeMeteredLlmRequest(
      fields.userId ?? undefined,
      fields.provider,
      fields.model,
      fullPayload.kind,
    );
  }

  const { consoleEnabled, maxChars } = llmLogConfig();
  if (!consoleEnabled) {
    // DB row still created below for billing/charge attribution.
  }

  const record = buildLogRecord(fullPayload, fields, maxChars);
  const compact = compactLogPayloads(record);

  if (consoleEnabled) {
    printConsole(record);
  }

  try {
    const row = await llmRequestLogDb().create({
      data: dbCreateData(fullPayload, fields, record, compact),
    });

    if (payload.setActiveSpan) {
      setActiveParentLogId(row.id);
    }

    recordActiveOperationLlmStart({
      id: row.id,
      parentId: fields.parentId ?? undefined,
      operation: payload.operation,
      provider: fields.provider,
      model: fields.model,
      kind:
        fields.spanType === "tool"
          ? "tool"
          : fields.spanType === "parse"
            ? "parse"
            : "llm",
    });

    return row.id;
  } catch (e) {
    console.error("[LLM log] failed to write database:", e);
    return undefined;
  }
}

/** Patch a running log (e.g. record time-to-first-token). */
export async function patchLlmRequestLog(
  logId: string,
  patch: {
    status?: LlmLogStatus;
    error?: string | null;
    firstResponseMs?: number;
    request?: Record<string, unknown>;
    response?: Record<string, unknown>;
  },
): Promise<void> {
  if (isEvaluationExecution()) {
    if (patch.firstResponseMs !== undefined) {
      recordActiveOperationTelemetry({
        type: "timing",
        timeToFirstResponseMs: patch.firstResponseMs,
      });
    }
    if (patch.request || patch.response) {
      recordActiveOperationStructured({
        ...(patch.request?.structuredContractId
          ? { contractId: String(patch.request.structuredContractId) }
          : {}),
        ...(patch.request?.structuredInvocationId
          ? { invocationId: String(patch.request.structuredInvocationId) }
          : {}),
        ...(patch.response?.structuredOutcome
          ? { outcome: String(patch.response.structuredOutcome) }
          : {}),
      });
    }
    return;
  }
  try {
    const data: {
      status?: LlmLogStatus;
      error?: string | null;
      firstResponseMs?: number;
      request?: string;
      response?: string;
    } = {};
    if (patch.status !== undefined) {
      data.status = patch.status;
    }
    if (patch.error !== undefined) {
      data.error = patch.error;
    }
    if (patch.firstResponseMs !== undefined) {
      data.firstResponseMs = patch.firstResponseMs;
    }
    if (patch.response !== undefined) {
      const existing = await llmRequestLogDb().findUnique({
        where: { id: logId },
        select: { request: true, response: true },
      });
      const currentResponse = safeParseJson(existing?.response ?? "{}");
      const nextResponse = { ...currentResponse, ...patch.response };
      data.response = JSON.stringify(nextResponse);
      Object.assign(
        data,
        structuredLogFields(
          safeParseJson(existing?.request ?? "{}"),
          nextResponse,
        ),
      );
    }
    if (patch.request !== undefined) {
      const existing = await llmRequestLogDb().findUnique({
        where: { id: logId },
        select: { request: true },
      });
      const currentRequest = safeParseJson(existing?.request ?? "{}");
      const currentRecovery =
        currentRequest.structuredRecovery &&
        typeof currentRequest.structuredRecovery === "object" &&
        !Array.isArray(currentRequest.structuredRecovery)
          ? (currentRequest.structuredRecovery as Record<string, unknown>)
          : {};
      const nextRecovery =
        patch.request.structuredRecovery &&
        typeof patch.request.structuredRecovery === "object" &&
        !Array.isArray(patch.request.structuredRecovery)
          ? (patch.request.structuredRecovery as Record<string, unknown>)
          : undefined;
      data.request = JSON.stringify({
        ...currentRequest,
        ...patch.request,
        ...(nextRecovery
          ? {
              structuredRecovery: {
                ...currentRecovery,
                ...nextRecovery,
                ...(Array.isArray(currentRecovery.issueCategories) ||
                Array.isArray(nextRecovery.issueCategories)
                  ? {
                      issueCategories: [
                        ...new Set([
                          ...(Array.isArray(currentRecovery.issueCategories)
                            ? currentRecovery.issueCategories
                            : []),
                          ...(Array.isArray(nextRecovery.issueCategories)
                            ? nextRecovery.issueCategories
                            : []),
                        ]),
                      ],
                    }
                  : {}),
              },
            }
          : {}),
      });
    }
    if (Object.keys(data).length === 0) return;
    await llmRequestLogDb().update({ where: { id: logId }, data });
  } catch (e) {
    console.error("[LLM log] failed to patch database:", e);
  }
}

/** Attach non-private recovery counters to the currently active LLM span. */
export async function patchActiveLlmRecoveryMetadata(
  recovery: Record<string, unknown>,
): Promise<void> {
  recordActiveOperationStructured({
    normalizationCount:
      typeof recovery.normalizedCount === "number"
        ? recovery.normalizedCount
        : undefined,
    repairCount:
      typeof recovery.repairCount === "number" ? recovery.repairCount : undefined,
    repairedValueCount:
      typeof recovery.repairedValueCount === "number"
        ? recovery.repairedValueCount
        : undefined,
    fallbackCount:
      typeof recovery.fallbackCount === "number"
        ? recovery.fallbackCount
        : undefined,
  });
  const logId = getActiveParentLogId();
  if (!logId) return;
  await patchLlmRequestLog(logId, {
    request: {
      structuredRecovery: recovery,
      ...(Array.isArray(recovery.structuredIssues)
        ? { structuredIssues: recovery.structuredIssues }
        : {}),
    },
  });
}

export async function patchActiveLlmStructuredOutcome(
  outcome: "final_success" | "final_error",
  details?: Record<string, unknown>,
  error?: string,
): Promise<void> {
  recordActiveOperationStructured({
    outcome,
    finalValid: outcome === "final_success",
    stage:
      typeof details?.structuredValidationStage === "string"
        ? details.structuredValidationStage
        : undefined,
    failureCategory:
      typeof details?.structuredFailureCategory === "string"
        ? details.structuredFailureCategory
        : undefined,
  });
  const logId = getActiveParentLogId();
  if (!logId) return;
  if (outcome === "final_error") {
    const issues = Array.isArray(details?.structuredIssues)
      ? (details.structuredIssues as ValidationIssue[])
      : parseStructuredIssuesJson(details?.structuredIssuesJson);
    await patchLlmRequestLog(logId, {
      status: "error",
      ...(error ? { error } : {}),
      response: {
        structuredOutcome: outcome,
        ...(details ?? {}),
        ...(issues.length > 0
          ? {
              structuredIssues: issues,
              structuredIssuesJson: serializeStructuredIssuesJson(issues),
            }
          : {}),
      },
    });
    return;
  }

  try {
    const existing = await llmRequestLogDb().findUnique({
      where: { id: logId },
      select: { status: true, error: true, request: true, response: true },
    });
    const request = safeParseJson(existing?.request ?? "{}");
    const priorResponse = safeParseJson(existing?.response ?? "{}");
    const nextResponse: Record<string, unknown> = {
      ...priorResponse,
      structuredOutcome: outcome,
      ...(details ?? {}),
    };
    const priorError =
      typeof existing?.error === "string" && existing.error.trim()
        ? existing.error
        : typeof priorResponse.recoveredFromError === "string"
          ? priorResponse.recoveredFromError
          : null;
    if (priorError) {
      nextResponse.recoveredFromError = priorError;
    }
    const status = resolveTerminalLlmLogStatus(
      "success",
      request,
      nextResponse,
      existing?.status,
    );
    // Keep the healed original error on recovered rows so operators can
    // inspect both the recovery outcome and the failure that was repaired.
    await patchLlmRequestLog(logId, {
      status,
      error: status === "recovered" ? priorError : null,
      response: nextResponse,
    });
  } catch (e) {
    console.error("[LLM log] failed to patch structured outcome:", e);
  }
}

/** Mark a provider call failed when its successful transport response cannot be parsed. */
export async function markActiveLlmStructuredParseFailed(
  error: string,
  details?: Record<string, unknown>,
): Promise<void> {
  const logId = getActiveParentLogId();
  if (!logId) return;
  await patchLlmRequestLog(logId, {
    status: "error",
    error,
    response: {
      structuredOutcome: "error",
      ...(details ?? {}),
    },
  });
}

/** Finalize a log row started with {@link startLlmRequestLog}. */
export async function finishLlmRequestLog(
  logId: string,
  payload: LlmLogFinishPayload,
): Promise<void> {
  if (isEvaluationExecution()) {
    const usage = extractUsageFields(payload.response ?? {});
    recordActiveOperationLlmFinish({
      id: logId,
      status: payload.status,
      durationMs: payload.durationMs,
      firstResponseMs: payload.firstResponseMs,
      response: payload.response,
    });
    recordActiveOperationTelemetry({
      type: "usage",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      reasoningTokens: usage.reasoningTokens,
    });
    recordActiveOperationTelemetry({
      type: "timing",
      durationMs: payload.durationMs,
      timeToFirstResponseMs: payload.firstResponseMs,
    });
    return;
  }
  const { consoleEnabled, maxChars } = llmLogConfig();

  try {
    const existing = await llmRequestLogDb().findUnique({
      where: { id: logId },
    });
    if (!existing) return;

    const request = safeParseJson(existing.request);
    const mergedResponse = {
      ...safeParseJson(existing.response),
      ...(payload.response ?? {}),
    };
    const priorError =
      typeof existing.error === "string" && existing.error.trim()
        ? existing.error
        : typeof mergedResponse.recoveredFromError === "string"
          ? mergedResponse.recoveredFromError
          : typeof payload.error === "string" && payload.error.trim()
            ? payload.error
            : null;
    if (
      payload.status === "success" &&
      priorError &&
      typeof mergedResponse.recoveredFromError !== "string"
    ) {
      mergedResponse.recoveredFromError = priorError;
    }
    const status = resolveTerminalLlmLogStatus(
      payload.status,
      request,
      mergedResponse,
      existing.status,
    );
    const firstResponseMs =
      payload.firstResponseMs ?? existing.firstResponseMs ?? null;
    // Recovered rows keep the original failure text; status carries the heal.
    const error =
      status === "recovered" ? priorError : (payload.error ?? null);

    const record = {
      id: logId,
      ts: existing.createdAt.toISOString(),
      userId: existing.userId,
      traceId: existing.traceId,
      goalId: existing.goalId,
      scope: existing.scope,
      scopeId: existing.scopeId,
      provider: existing.provider,
      model: existing.model,
      spanType: existing.spanType,
      parentId: existing.parentId,
      label: existing.label,
      toolName: existing.toolName,
      operation: existing.operation,
      kind: existing.kind,
      status,
      durationMs: payload.durationMs,
      firstResponseMs,
      request,
      response: mergedResponse,
      error,
    };
    const structured = structuredLogFields(record.request, mergedResponse);
    const compact = compactLogPayloads(record);
    const archive = await archivePayload({
      logId,
      status,
      traceId: existing.traceId,
      operation: existing.operation,
      kind: existing.kind,
      record,
    });

    if (consoleEnabled) {
      printConsole(record);
    }

    await llmRequestLogDb().update({
      where: { id: logId },
      data: {
        status,
        durationMs: payload.durationMs,
        firstResponseMs,
        inputTokens: compact.usage.inputTokens,
        outputTokens: compact.usage.outputTokens,
        totalTokens: compact.usage.totalTokens,
        cacheReadTokens: compact.usage.cacheReadTokens,
        cacheCreationTokens: compact.usage.cacheCreationTokens,
        reasoningTokens: compact.usage.reasoningTokens,
        outputTps: compact.usage.outputTps,
        responsePreview: compact.response.preview,
        responseHash: compact.response.hash,
        response: compactJsonColumn(
          mergedResponse ?? {},
          compact.response,
          compact.usage,
        ),
        artifactKey: archive?.key,
        artifactBackend: archive?.backend,
        ...structured,
        error,
      },
    });
    const usage = compact.usage;
    recordActiveOperationLlmFinish({
      id: logId,
      status,
      durationMs: payload.durationMs,
      firstResponseMs,
      provider: existing.provider,
      model: existing.model,
      request,
      response: mergedResponse,
    });
    recordActiveOperationTelemetry({
      type: "usage",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      reasoningTokens: usage.reasoningTokens,
    });
    recordActiveOperationTelemetry({
      type: "timing",
      durationMs: payload.durationMs,
      timeToFirstResponseMs: firstResponseMs ?? undefined,
    });
    await afterMeteredLlmRequest(logId);
  } catch (e) {
    console.error("[LLM log] failed to finish database log:", e);
  }
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Start a log immediately; finish or record TTFB via the returned handle. */
export async function beginLlmRequestLog(
  payload: LlmLogStartPayload,
): Promise<LlmRequestLogHandle | undefined> {
  const id = await startLlmRequestLog(payload);
  if (!id) return undefined;

  const startedAt = Date.now();
  let firstResponseRecorded = false;

  return {
    id,
    async recordFirstResponse() {
      if (firstResponseRecorded) return;
      firstResponseRecorded = true;
      const firstResponseMs = Date.now() - startedAt;
      await patchLlmRequestLog(id, { firstResponseMs });
    },
    async finish(finishPayload: LlmLogFinishPayload) {
      await finishLlmRequestLog(id, finishPayload);
    },
  };
}

/**
 * Record a failed LLM invocation even when preparation stops before a request
 * reaches a provider. This deliberately creates a distinct span instead of
 * patching whichever parent span happens to be active.
 */
export async function logLlmContextResolutionFailure(params: {
  operation: string;
  request: Record<string, unknown>;
  startedAt: number;
  error: unknown;
}): Promise<void> {
  try {
    const handle = await beginLlmRequestLog({
      operation: params.operation,
      kind: "chat",
      request: {
        ...params.request,
        failurePhase: "generation_context_resolution",
        providerRequestStarted: false,
      },
      setActiveSpan: true,
    });
    await handle?.finish({
      status: "error",
      durationMs: Date.now() - params.startedAt,
      response: {
        failurePhase: "generation_context_resolution",
        failureSource: "learning_system_context",
        providerRequestStarted: false,
        errorName: params.error instanceof Error ? params.error.name : "Error",
        errorCauseChain: errorCauseChain(params.error),
        structuredOutcome: "error",
        structuredFailureCategory: "context_resolution",
      },
      error:
        params.error instanceof Error
          ? params.error.message
          : String(params.error),
    });
  } catch (loggingError) {
    console.error(
      "[LLM log] failed to record context-resolution failure:",
      loggingError,
    );
  }
}

/** Persist one LLM call to console and database. Returns new row id. */
export async function logLlmRequest(
  payload: LlmLogPayload,
): Promise<string | undefined> {
  const status = resolveTerminalLlmLogStatus(
    payload.status,
    payload.request,
    payload.response ?? {},
  );
  const normalizedPayload: LlmLogPayload = {
    ...payload,
    status,
    // Recovered rows may still carry the original failure for diagnosis.
    error: payload.error,
  };
  const fields = resolveLogFields(normalizedPayload);
  if (isEvaluationExecution()) {
    const id = randomUUID();
    if (normalizedPayload.setActiveSpan) setActiveParentLogId(id);
    recordActiveOperationLlmStart({
      id,
      parentId: fields.parentId ?? undefined,
      operation: normalizedPayload.operation,
      provider: fields.provider,
      model: fields.model,
      kind:
        fields.spanType === "tool"
          ? "tool"
          : fields.spanType === "parse"
            ? "parse"
            : "llm",
    });
    const usage = extractUsageFields(normalizedPayload.response ?? {});
    recordActiveOperationLlmFinish({
      id,
      status: normalizedPayload.status,
      durationMs: normalizedPayload.durationMs,
      firstResponseMs: normalizedPayload.firstResponseMs,
      response: normalizedPayload.response,
    });
    recordActiveOperationTelemetry({
      type: "usage",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      reasoningTokens: usage.reasoningTokens,
    });
    recordActiveOperationTelemetry({
      type: "timing",
      durationMs: normalizedPayload.durationMs,
      timeToFirstResponseMs: normalizedPayload.firstResponseMs,
    });
    return id;
  }
  if (isMeteredLlmKind(normalizedPayload.kind)) {
    await beforeMeteredLlmRequest(
      fields.userId ?? undefined,
      fields.provider,
      fields.model,
      normalizedPayload.kind,
    );
  }

  const { consoleEnabled, maxChars } = llmLogConfig();

  const record = buildLogRecord(normalizedPayload, fields, maxChars);
  const compact = compactLogPayloads(record);

  if (consoleEnabled) {
    printConsole(record);
  }

  try {
    const row = await llmRequestLogDb().create({
      data: dbCreateData(normalizedPayload, fields, record, compact),
    });
    try {
      const archive = await archivePayload({
        logId: row.id,
        status: normalizedPayload.status,
        traceId: fields.traceId,
        operation: normalizedPayload.operation,
        kind: normalizedPayload.kind,
        record,
      });
      if (archive) {
        await llmRequestLogDb().update({
          where: { id: row.id },
          data: { artifactKey: archive.key, artifactBackend: archive.backend },
        });
      }
    } catch (e) {
      console.error("[LLM log] failed to archive payload:", e);
    }

    if (normalizedPayload.setActiveSpan) {
      setActiveParentLogId(row.id);
    }

    await afterMeteredLlmRequest(row.id);
    return row.id;
  } catch (e) {
    console.error("[LLM log] failed to write database:", e);
    return undefined;
  }
}
