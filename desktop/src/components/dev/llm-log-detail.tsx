"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { CollapsibleJsonView } from "@/components/dev/collapsible-json-view";
import { Button } from "@xue-learn/core/ui/button";
import { cn } from "@xue-learn/core/utils";
import { copyTextToClipboard } from "@xue-learn/core/utils";
import { useT } from "@xue-learn/core/i18n";
import {
  type LlmLogRow,
  displayTitle,
  expandCompactLogPayload,
  extractLogMetrics,
  formatCacheHitRate,
  formatDurationMs,
  formatFirstResponseMs,
  formatLogTimeRange,
  formatTokenCount,
  formatTps,
  hasLogText,
  normalizeLogJsonValue,
  parsedFromResponse,
} from "@/components/dev/llm-log-display";
import {
  extractSearchLogPayload,
  LlmSearchLogPanel,
} from "@/components/dev/llm-search-log-panel";

function JsonBlock({ value }: { value: unknown }) {
  return <CollapsibleJsonView value={value} />;
}

/** Render model text that may be a string or unwrapped structured JSON. */
function ModelTextBlock({ value }: { value: unknown }) {
  if (typeof value === "string") {
    // Provider `raw` stays a string for fidelity, but JSON-shaped replies
    // (Survey items, structured objects) should use the collapsible viewer.
    const asJson = normalizeLogJsonValue(value);
    if (asJson !== value && typeof asJson === "object" && asJson !== null) {
      return (
        <CollapsibleJsonView value={asJson} defaultExpandDepth={2} />
      );
    }
    return (
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-foreground">
        {value}
      </pre>
    );
  }
  return <JsonBlock value={value} />;
}

function CopyableValue({
  value,
  mono = true,
  truncate = false,
}: {
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);

  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span
        className={cn("text-xs", mono && "font-mono", truncate && "truncate")}
        title={value}
      >
        {value}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="shrink-0"
        onClick={() => {
          void copyTextToClipboard(value).then((ok) => {
            if (ok) setCopied(true);
          });
        }}
        aria-label={
          copied ? t("devLogs.common.copied") : t("devLogs.common.copy")
        }
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </Button>
    </span>
  );
}

function MetricCard({
  label,
  value,
  mono = false,
  emphasize = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 text-xs",
          mono && "font-mono",
          emphasize && "font-semibold text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

type LogMessage = {
  role?: string;
  content?: unknown;
  toolCallId?: string;
  toolCalls?: Array<{ id?: string; name?: string; args?: unknown }>;
};

function AgentMessagesPanel({ messages }: { messages: LogMessage[] }) {
  return (
    <div className="space-y-2">
      {messages.map((message, index) => (
        <div
          key={`${message.role}-${index}`}
          className="rounded-lg border border-border bg-card p-3"
        >
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {message.role}
            {message.toolCallId ? ` · ${message.toolCallId}` : ""}
          </p>
          {typeof message.content === "string" && message.content.trim() ? (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-foreground">
              {message.content}
            </pre>
          ) : message.content != null && typeof message.content === "object" ? (
            <JsonBlock value={message.content} />
          ) : null}
          {message.toolCalls?.length ? (
            <div className="mt-2 space-y-2">
              {message.toolCalls.map((toolCall, toolIndex) => (
                <div
                  key={toolCall.id ?? `${toolCall.name}-${toolIndex}`}
                  className="rounded-md border border-amber-200 bg-amber-50/60 p-2 dark:border-amber-800 dark:bg-amber-950/40"
                >
                  <p className="font-mono text-xs font-semibold text-amber-900 dark:text-amber-200">
                    {toolCall.name}
                  </p>
                  <JsonBlock value={toolCall.args ?? {}} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

type Tab = "overview" | "sources" | "input" | "output" | "tools";

function CapabilityUsagePanel({
  request,
}: {
  request: Record<string, unknown> | null;
}) {
  const t = useT();
  const mode =
    typeof request?.generationContextMode === "string"
      ? request.generationContextMode
      : null;
  const applied =
    typeof request?.generationContextApplied === "boolean"
      ? request.generationContextApplied
      : null;
  const bypassReason =
    typeof request?.generationContextBypassReason === "string"
      ? request.generationContextBypassReason
      : null;
  const usage = Array.isArray(request?.generationContextCapabilityUsage)
    ? request.generationContextCapabilityUsage
    : [];
  const availableTools = Array.isArray(
    request?.generationContextAvailableQueryTools,
  )
    ? request.generationContextAvailableQueryTools
    : [];

  if (!mode && usage.length === 0 && availableTools.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-foreground">
          {t("devLogs.detail.capabilities")}
        </p>
        {mode ? (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            {mode}
          </span>
        ) : null}
        {applied !== null ? (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium",
              applied
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
                : "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
            )}
          >
            {applied
              ? t("devLogs.detail.applied")
              : t("devLogs.detail.notApplied")}
          </span>
        ) : null}
        {bypassReason ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            {bypassReason}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("devLogs.detail.capabilityUsage", {
          usageCount: usage.length,
          toolCount: availableTools.length,
        })}
      </p>
      {usage.length > 0 || availableTools.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            {t("devLogs.detail.contextSummary")}
          </summary>
          {usage.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {usage.map((entry, index) => {
                const item = entry as { key?: unknown; capabilityId?: unknown };
                const key =
                  typeof item.key === "string" ? item.key : `view-${index + 1}`;
                const owner =
                  typeof item.capabilityId === "string"
                    ? item.capabilityId
                    : null;
                return (
                  <span
                    key={`${key}-${index}`}
                    className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground"
                    title={owner ?? undefined}
                  >
                    {key}
                  </span>
                );
              })}
            </div>
          ) : null}
          {availableTools.length > 0 ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t("devLogs.detail.availableQueryTools")}:{" "}
              {availableTools.join(", ")}
            </p>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

function stringField(
  value: Record<string, unknown> | null,
  key: string,
): string | null {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

function stringListField(
  value: Record<string, unknown> | null,
  key: string,
): string[] {
  const candidate = value?.[key];
  return Array.isArray(candidate)
    ? candidate.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function FailureDiagnosisPanel({
  log,
  request,
  response,
  parentLog,
}: {
  log: LlmLogRow;
  request: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
  parentLog?: LlmLogRow;
}) {
  const t = useT();
  const originalError =
    (typeof log.error === "string" && log.error.trim() ? log.error : null) ??
    stringField(response, "recoveredFromError") ??
    stringField(request, "recoveredFromError");

  // Hard failures always show; recovered rows show the healed original error.
  if (
    log.status !== "error" &&
    !(log.status === "recovered" && originalError)
  ) {
    return null;
  }

  const failurePhase =
    stringField(response, "failurePhase") ??
    stringField(request, "failurePhase") ??
    stringField(response, "structuredValidationStage") ??
    log.structuredStage ??
    stringField(request, "structuredStage") ??
    t("devLogs.detail.failurePhaseUnknown");
  const failureSource = stringField(response, "failureSource");
  const providerRequestStarted =
    response?.providerRequestStarted ?? request?.providerRequestStarted;
  const causeChain = stringListField(response, "errorCauseChain");

  return (
    <section className="rounded-lg border border-red-200 bg-red-50/70 p-3 text-sm dark:border-red-900 dark:bg-red-950/30">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-red-900 dark:text-red-100">
          {t("devLogs.detail.failureDiagnosis")}
        </h3>
        <span className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-[10px] text-red-900 dark:bg-red-950 dark:text-red-100">
          {failurePhase}
        </span>
        {providerRequestStarted === false ? (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            {t("devLogs.detail.providerNotCalled")}
          </span>
        ) : null}
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <div>
          <dt className="text-[10px] font-medium uppercase tracking-wide text-red-800/75 dark:text-red-200/75">
            {t("devLogs.detail.failedOperation")}
          </dt>
          <dd className="mt-0.5 font-mono text-xs text-red-950 dark:text-red-50">
            {log.operation}
          </dd>
        </div>
        {parentLog ? (
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wide text-red-800/75 dark:text-red-200/75">
              {t("devLogs.detail.parentOperation")}
            </dt>
            <dd className="mt-0.5 font-mono text-xs text-red-950 dark:text-red-50">
              {parentLog.operation}
            </dd>
          </div>
        ) : null}
        {failureSource ? (
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wide text-red-800/75 dark:text-red-200/75">
              {t("devLogs.detail.failureSource")}
            </dt>
            <dd className="mt-0.5 font-mono text-xs text-red-950 dark:text-red-50">
              {failureSource}
            </dd>
          </div>
        ) : null}
      </dl>
      {originalError ? (
        <p className="mt-3 break-words text-red-900 dark:text-red-100">
          {originalError}
        </p>
      ) : null}
      {causeChain.length > 0 ? (
        <ol className="mt-3 space-y-1 border-l border-red-200 pl-3 text-xs text-red-900 dark:border-red-800 dark:text-red-100">
          {causeChain.map((cause, index) => (
            <li key={`${cause}-${index}`}>{cause}</li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function RecoveryDiagnosisPanel({
  log,
  request,
  response,
}: {
  log: LlmLogRow;
  request: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
}) {
  const t = useT();
  if (log.status !== "recovered") return null;

  const repairType =
    stringField(response, "structuredRepairType") ??
    stringField(request, "structuredRepairType");
  const outcome =
    stringField(response, "structuredOutcome") ??
    stringField(request, "structuredOutcome");
  // Stale pre-heal outcomes like "error" are noise once status is recovered.
  const outcomeBadge =
    outcome && outcome !== "error" && outcome !== "final_error"
      ? outcome
      : null;

  return (
    <section className="rounded-lg border border-sky-200 bg-sky-50/70 p-3 text-sm dark:border-sky-900 dark:bg-sky-950/30">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-sky-900 dark:text-sky-100">
          {t("devLogs.detail.recoveryDiagnosis")}
        </h3>
        {repairType ? (
          <span className="rounded bg-sky-100 px-1.5 py-0.5 font-mono text-[10px] text-sky-900 dark:bg-sky-950 dark:text-sky-100">
            {repairType}
          </span>
        ) : null}
        {outcomeBadge ? (
          <span className="rounded bg-sky-100 px-1.5 py-0.5 font-mono text-[10px] text-sky-900 dark:bg-sky-950 dark:text-sky-100">
            {outcomeBadge}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sky-900 dark:text-sky-100">
        {t("devLogs.detail.recoverySummary")}
      </p>
    </section>
  );
}

function ToolExecutionPanel({ log }: { log: LlmLogRow }) {
  const t = useT();
  const req = expandCompactLogPayload(log.request) as Record<
    string,
    unknown
  > | null;
  const res = expandCompactLogPayload(log.response) as Record<
    string,
    unknown
  > | null;
  const toolCall = req?.toolCall as
    { id?: string; name?: string; args?: unknown } | undefined;

  return (
    <div className="space-y-3">
      <CapabilityUsagePanel request={req} />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-medium",
            log.status === "success" &&
              "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
            log.status === "recovered" &&
              "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
            log.status === "running" &&
              "animate-pulse bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
            log.status !== "success" &&
              log.status !== "recovered" &&
              log.status !== "running" &&
              "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200",
          )}
        >
          {log.status}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {formatDurationMs(log.durationMs)}
        </span>
        {toolCall?.id ? <CopyableValue value={toolCall.id} /> : null}
      </div>
      {toolCall ? (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("devLogs.detail.arguments")}
          </p>
          <JsonBlock value={toolCall.args ?? {}} />
        </div>
      ) : null}
      {res && Object.keys(res).length > 0 ? (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("devLogs.detail.result")}
          </p>
          <JsonBlock value={res} />
        </div>
      ) : log.status === "running" ? (
        <p className="text-xs text-amber-800 dark:text-amber-200">
          {t("devLogs.detail.toolRunning")}
        </p>
      ) : null}
      {log.error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {log.error}
        </p>
      ) : null}
    </div>
  );
}

export function LlmLogDetail({
  log,
  childLogs = [],
  parentLog,
}: {
  log: LlmLogRow;
  childLogs?: LlmLogRow[];
  parentLog?: LlmLogRow;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("overview");
  const metrics = extractLogMetrics(log);
  const response = expandCompactLogPayload(log.response);
  const request = expandCompactLogPayload(log.request);
  const parsed = parsedFromResponse(response);
  const toolCalls = parsed?.toolCalls ?? [];
  const hasTools = toolCalls.length > 0;
  const toolExecutionLogs = childLogs.filter(
    (child) => child.spanType === "tool",
  );
  const isToolExecutionLog = log.spanType === "tool";
  const res =
    response && typeof response === "object"
      ? (response as Record<string, unknown>)
      : null;
  const req =
    request && typeof request === "object"
      ? (request as Record<string, unknown>)
      : null;
  const agentMessages = Array.isArray(req?.messages)
    ? (req.messages as LogMessage[])
    : null;
  const isToolCallLog = req?.outputFormat === "tool_call";
  const searchPayload = extractSearchLogPayload(response);
  const hasSearchPayload = Boolean(
    searchPayload?.promptContext || searchPayload?.sources?.length,
  );

  const visibleTabs = useMemo(
    () =>
      (
        [
          {
            id: "overview" as const,
            label: t("devLogs.detail.overview"),
            show: true,
          },
          {
            id: "sources" as const,
            label: t("devLogs.detail.sources", {
              count: searchPayload?.sources?.length ?? 0,
            }),
            show: hasSearchPayload,
          },
          {
            id: "input" as const,
            label: t("devLogs.detail.input"),
            show: true,
          },
          {
            id: "output" as const,
            label: t("devLogs.detail.output"),
            show: true,
          },
          {
            id: "tools" as const,
            label: t("devLogs.detail.tools", {
              count: toolCalls.length || toolExecutionLogs.length,
            }),
            show: hasTools || toolExecutionLogs.length > 0,
          },
        ] satisfies { id: Tab; label: string; show: boolean }[]
      ).filter((t) => t.show),
    [
      hasSearchPayload,
      hasTools,
      searchPayload?.sources?.length,
      toolCalls.length,
      toolExecutionLogs.length,
      t,
    ],
  );

  useEffect(() => {
    if (!visibleTabs.some((t) => t.id === tab)) {
      setTab("overview");
    }
  }, [tab, visibleTabs]);

  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap gap-1 rounded-lg bg-muted/50 p-1"
        role="tablist"
        aria-label={t("devLogs.detail.sectionsAria")}
      >
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              tab === t.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && isToolExecutionLog ? (
        <ToolExecutionPanel log={log} />
      ) : null}

      {tab === "overview" && !isToolExecutionLog ? (
        <div className="space-y-3 text-sm">
          <dl className="grid gap-2 sm:grid-cols-2">
            <MetricCard
              label={t("devLogs.detail.time")}
              value={formatLogTimeRange(log)}
              mono
            />
            <MetricCard
              label={t("devLogs.detail.duration")}
              value={`${formatDurationMs(metrics.durationMs)} (${log.durationMs} ms)`}
              mono
              emphasize
            />
            {metrics.firstResponseMs !== undefined ||
            log.firstResponseMs !== null ? (
              <MetricCard
                label={t("devLogs.detail.firstResponse")}
                value={
                  formatFirstResponseMs(
                    metrics.firstResponseMs ?? log.firstResponseMs,
                  ) ?? "—"
                }
                mono
              />
            ) : null}
            <MetricCard
              label={t("devLogs.detail.operation")}
              value={<CopyableValue value={log.operation} truncate />}
            />
            {log.toolName ? (
              <MetricCard
                label={t("devLogs.detail.tool")}
                value={<CopyableValue value={log.toolName} />}
              />
            ) : null}
            <MetricCard
              label={t("devLogs.detail.providerModel")}
              value={`${log.provider} / ${log.model}`}
            />
            {log.traceId ? (
              <MetricCard
                label={t("devLogs.detail.trace")}
                value={<CopyableValue value={log.traceId} truncate />}
              />
            ) : null}
            {metrics.usage ? (
              <>
                <MetricCard
                  label={t("devLogs.detail.tokens")}
                  value={`↓${formatTokenCount(metrics.usage.input_tokens)} ↑${formatTokenCount(metrics.usage.output_tokens)} Σ${formatTokenCount(metrics.usage.total_tokens)}`}
                  mono
                  emphasize
                />
              </>
            ) : null}
            {metrics.outputTps !== undefined ? (
              <MetricCard
                label={t("devLogs.detail.outputThroughput")}
                value={formatTps(metrics.outputTps) ?? "—"}
                mono
                emphasize
              />
            ) : null}
            {metrics.totalTps !== undefined ? (
              <MetricCard
                label={t("devLogs.detail.totalThroughput")}
                value={formatTps(metrics.totalTps) ?? "—"}
                mono
              />
            ) : null}
            {metrics.reasoningTokens !== undefined ? (
              <MetricCard
                label={t("devLogs.detail.reasoningTokens")}
                value={formatTokenCount(metrics.reasoningTokens)}
                mono
              />
            ) : null}
            {metrics.cacheReadTokens !== undefined ? (
              <MetricCard
                label={t("devLogs.detail.cacheReadTokens")}
                value={formatTokenCount(metrics.cacheReadTokens)}
                mono
              />
            ) : null}
            {metrics.usage ? (
              <MetricCard
                label={t("devLogs.detail.cacheHitRate")}
                value={formatCacheHitRate(metrics.cacheHitRate) ?? "—"}
                mono
                emphasize
              />
            ) : null}
            {metrics.uncachedInputTokens !== undefined ? (
              <MetricCard
                label={t("devLogs.detail.uncachedInputTokens")}
                value={formatTokenCount(metrics.uncachedInputTokens)}
                mono
              />
            ) : null}
          </dl>
          <RecoveryDiagnosisPanel
            log={log}
            request={req}
            response={res}
          />
          <FailureDiagnosisPanel
            log={log}
            request={req}
            response={res}
            parentLog={parentLog}
          />
          <CapabilityUsagePanel request={req} />
        </div>
      ) : null}

      {tab === "sources" && searchPayload ? (
        <LlmSearchLogPanel payload={searchPayload} />
      ) : null}

      {tab === "input" ? (
        <div className="space-y-3">
          {agentMessages?.length ? (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("devLogs.detail.messages", { count: agentMessages.length })}
              </p>
              <AgentMessagesPanel messages={agentMessages} />
            </div>
          ) : null}
          {!isToolCallLog || !agentMessages?.length ? (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("devLogs.detail.fullRequest")}
              </p>
              <JsonBlock value={request} />
            </div>
          ) : (
            <details className="rounded-lg border border-border bg-card p-3">
              <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("devLogs.detail.fullRequest")}
              </summary>
              <div className="mt-2">
                <JsonBlock value={request} />
              </div>
            </details>
          )}
        </div>
      ) : null}

      {tab === "output" ? (
        <div className="space-y-3">
          {parsed && (hasLogText(parsed.text) || parsed.toolCalls?.length) ? (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("devLogs.detail.modelResponse")}
              </p>
              {hasLogText(parsed.text) ? (
                <div className="mb-3">
                  <ModelTextBlock value={parsed.text} />
                </div>
              ) : null}
              {parsed.toolCalls?.length ? (
                <div className="space-y-2">
                  {parsed.toolCalls.map((toolCall, index) => (
                    <div
                      key={`${toolCall.name}-${index}`}
                      className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-800 dark:bg-amber-950/40"
                    >
                      <p className="font-mono text-sm font-semibold text-amber-900 dark:text-amber-200">
                        {toolCall.name}
                      </p>
                      <JsonBlock value={toolCall.args ?? {}} />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {parsed?.jsonPreview !== undefined ? (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("devLogs.detail.extractedJson")}
              </p>
              <JsonBlock value={parsed.jsonPreview} />
            </div>
          ) : null}
          {res?.structured !== undefined ? (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {log.status === "error"
                  ? t("devLogs.detail.structuredFailed")
                  : t("devLogs.detail.structuredObject")}
              </p>
              <JsonBlock value={res.structured} />
            </div>
          ) : null}
          {!isToolCallLog || !parsed ? (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("devLogs.detail.fullResponse")}
              </p>
              <JsonBlock value={response} />
            </div>
          ) : (
            <details className="rounded-lg border border-border bg-card p-3">
              <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Full response payload
              </summary>
              <div className="mt-2">
                <JsonBlock value={response} />
              </div>
            </details>
          )}
        </div>
      ) : null}

      {tab === "tools" && (hasTools || toolExecutionLogs.length > 0) ? (
        <div className="space-y-4">
          {hasTools ? (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Model tool calls (intent)
              </p>
              {toolCalls.map((tc, i) => (
                <div
                  key={tc.name + i}
                  className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-800 dark:bg-amber-950/40"
                >
                  <p className="font-mono text-sm font-semibold text-amber-900 dark:text-amber-200">
                    {tc.name}
                  </p>
                  <JsonBlock value={tc.args ?? {}} />
                </div>
              ))}
            </div>
          ) : null}
          {toolExecutionLogs.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Execution ({toolExecutionLogs.length})
              </p>
              {toolExecutionLogs.map((child) => (
                <div
                  key={child.id}
                  className="rounded-lg border border-border bg-card p-3"
                >
                  <p className="mb-2 font-mono text-sm font-semibold text-foreground">
                    {displayTitle(child)}
                  </p>
                  <ToolExecutionPanel log={child} />
                </div>
              ))}
            </div>
          ) : hasTools ? (
            <p className="text-xs text-muted-foreground">
              No execution logs yet. Filter by trace timeline or refresh — tool
              runs appear as nested <span className="font-mono">tool</span>{" "}
              spans under this LLM call.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
