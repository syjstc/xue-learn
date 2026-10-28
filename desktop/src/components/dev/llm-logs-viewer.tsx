"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { apiDelete, apiGet } from "@/shared/api";
import { useConfirm } from "@/hooks/use-confirm";
import { Button } from "@xue-learn/core/ui/button";
import { Card } from "@/components/ui/card";
import { LlmLogDetail } from "@/components/dev/llm-log-detail";
import { cn } from "@xue-learn/core/utils";
import { useT, type TranslationKey } from "@xue-learn/core/i18n";
import {
  type LlmLogRow,
  SPAN_STYLES,
  KIND_STYLES,
  aggregateLogMetrics,
  childDepth,
  displayTitle,
  extractLogMetrics,
  formatDurationMs,
  formatFirstResponseMs,
  formatLogTimestamp,
  formatLogTimeRange,
  formatTokenCount,
  formatTokenSummary,
  formatTps,
  formatUsageSummary,
  logPreview,
  isLogOk,
  isLogRecovered,
  isLogRunning,
  orderLogsForTimeline,
  type TokenUsageSummary,
} from "@/components/dev/llm-log-display";

const PAGE_SIZE = 50;

const fieldClass =
  "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type LogsResponse = {
  enabled: boolean;
  logDir: string;
  count: number;
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  logs: LlmLogRow[];
};

type LogDetailResponse = {
  log: LlmLogRow;
  childLogs: LlmLogRow[];
};

type GoalOption = {
  goalId: string;
  title: string;
  logCount: number;
  lastAt: string;
  usage: TokenUsageSummary;
};

type TraceOption = {
  traceId: string;
  logCount: number;
  startedAt: string;
  endedAt: string;
  operations: string[];
  kinds: string[];
  usage: TokenUsageSummary;
};

type GoalUsageCategory = TokenUsageSummary & {
  category: string;
};

type GoalUsageReport = {
  goalId: string;
  title: string;
  logCount: number;
  usage: TokenUsageSummary;
  byCategory: GoalUsageCategory[];
  byOperation: Array<TokenUsageSummary & { operation: string }>;
};

const CATEGORY_KEYS: Record<string, TranslationKey> = {
  map: "devLogs.category.map",
  course: "devLogs.category.course",
  survey: "devLogs.category.survey",
  tests: "devLogs.category.tests",
  agent: "devLogs.category.agent",
  retrieval: "devLogs.category.retrieval",
  embedding: "devLogs.category.embedding",
  images: "devLogs.category.images",
  audio: "devLogs.category.audio",
  persona: "devLogs.category.persona",
  other: "devLogs.category.other",
};

function StatusDot({ status }: { status: string }) {
  const running = status === "running";
  const recovered = status === "recovered";
  const ok = status === "success";
  return (
    <span
      className={cn(
        "mt-1.5 size-2 shrink-0 rounded-full",
        running && "animate-pulse bg-amber-500",
        ok && "bg-emerald-500",
        recovered && "bg-sky-500",
        !running && !ok && !recovered && "bg-red-500",
      )}
      title={status}
      aria-hidden
    />
  );
}

function LogRow({
  log,
  selected,
  onSelect,
  onTraceClick,
  index,
  showIndex,
  depth,
  maxDuration,
}: {
  log: LlmLogRow;
  selected: boolean;
  onSelect: () => void;
  onTraceClick: (traceId: string) => void;
  index?: number;
  showIndex?: boolean;
  depth: number;
  maxDuration: number;
}) {
  const ok = isLogOk(log);
  const recovered = isLogRecovered(log);
  const running = isLogRunning(log);
  const spanClass = SPAN_STYLES[log.spanType] ?? SPAN_STYLES.llm;
  const kindClass = KIND_STYLES[log.kind] ?? "bg-muted text-muted-foreground";
  const preview = logPreview(log);
  const metrics = extractLogMetrics(log);
  const tokenSummary = formatTokenSummary(metrics);
  const outputTps = formatTps(metrics.outputTps);
  const ttfb = formatFirstResponseMs(
    metrics.firstResponseMs ?? log.firstResponseMs,
  );
  const barPct =
    maxDuration > 0 ? Math.max(3, (log.durationMs / maxDuration) * 100) : 3;

  return (
    <div
      data-log-id={log.id}
      className={cn(
        "border-b border-border last:border-0",
        selected && "bg-primary/5",
      )}
      style={{ paddingLeft: depth * 14 }}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          "flex w-full items-stretch gap-0 text-left transition-colors",
          "hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none",
          selected && "hover:bg-primary/10",
        )}
      >
        {showIndex ? (
          <div className="flex w-9 shrink-0 flex-col items-center border-r border-border/70 py-3">
            <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
              {index}
            </span>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 gap-3 px-3 py-2.5 sm:px-4">
          <StatusDot status={log.status} />

          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={cn(
                      "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                      spanClass,
                    )}
                  >
                    {log.spanType}
                  </span>
                  <span className="truncate text-sm font-medium text-foreground">
                    {displayTitle(log)}
                  </span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-medium",
                      kindClass,
                    )}
                  >
                    {log.kind}
                  </span>
                  {log.toolName ? (
                    <span className="truncate font-mono text-[10px] text-amber-800 dark:text-amber-200">
                      {log.toolName}
                    </span>
                  ) : null}
                  {running ? (
                    <span className="animate-pulse rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                      running
                    </span>
                  ) : null}
                  {recovered ? (
                    <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-900 dark:bg-sky-950/60 dark:text-sky-200">
                      recovered
                    </span>
                  ) : null}
                  {!ok && !running ? (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 dark:bg-red-950/60 dark:text-red-200">
                      error
                    </span>
                  ) : null}
                </div>

                {preview ? (
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                    {preview}
                  </p>
                ) : (
                  <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                    {log.operation}
                  </p>
                )}

                <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
                  <span
                    className="tabular-nums"
                    title={formatLogTimeRange(log)}
                  >
                    {formatLogTimestamp(log.createdAt)}
                  </span>
                  <span className="truncate">
                    {log.provider}/{log.model}
                  </span>
                  {log.traceId ? (
                    <span
                      role="link"
                      tabIndex={0}
                      className="cursor-pointer font-mono text-primary hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTraceClick(log.traceId!);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          onTraceClick(log.traceId!);
                        }
                      }}
                    >
                      {log.traceId.slice(0, 8)}…
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="hidden w-[9.5rem] shrink-0 flex-col items-end gap-0.5 text-right sm:flex">
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {formatDurationMs(log.durationMs)}
                </span>
                {ttfb ? (
                  <span className="text-[11px] tabular-nums text-sky-700 dark:text-sky-300">
                    {ttfb}
                  </span>
                ) : null}
                {tokenSummary ? (
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {tokenSummary}
                  </span>
                ) : null}
                {outputTps ? (
                  <span className="text-[11px] tabular-nums font-medium text-primary">
                    {outputTps}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-2 flex items-center gap-2 sm:hidden">
              <span className="text-xs font-semibold tabular-nums">
                {formatDurationMs(log.durationMs)}
              </span>
              {tokenSummary ? (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {tokenSummary}
                </span>
              ) : null}
              {outputTps ? (
                <span className="text-[11px] tabular-nums text-primary">
                  {outputTps}
                </span>
              ) : null}
            </div>

            <div className="mt-2 h-1 max-w-md overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full",
                  running
                    ? "bg-amber-400"
                    : ok
                      ? "bg-primary/70"
                      : "bg-red-400",
                )}
                style={{ width: `${barPct}%` }}
              />
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}

function FilterChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] text-foreground hover:bg-muted"
    >
      {label}
      <X className="size-3 opacity-60" aria-hidden />
      <span className="sr-only">{t("devLogs.viewer.clear")}</span>
    </button>
  );
}

export function LlmLogsViewer({
  initial,
  apiBasePath = "/api/llm/logs",
}: {
  initial: LogsResponse;
  apiBasePath?: string;
}) {
  const t = useT();
  const { confirm } = useConfirm();
  const listRef = useRef<HTMLDivElement>(null);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const [data, setData] = useState<LogsResponse>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    initial.logs[0]?.id ?? null,
  );
  const [selectedDetail, setSelectedDetail] =
    useState<LogDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [page, setPage] = useState(initial.page ?? 1);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [operation, setOperation] = useState("");
  const [kind, setKind] = useState("");
  const [spanType, setSpanType] = useState("");
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState("");
  const [traceId, setTraceId] = useState("");
  const [goalId, setGoalId] = useState("");
  const [scope, setScope] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "trace">("list");

  const [goals, setGoals] = useState<GoalOption[]>([]);
  const [traces, setTraces] = useState<TraceOption[]>([]);
  const [goalUsage, setGoalUsage] = useState<GoalUsageReport | null>(null);

  const loadGoals = useCallback(async () => {
    try {
      const json = await apiGet<{ goals: GoalOption[] }>(
        `${apiBasePath}/goals`,
      );
      setGoals(json.goals);
    } catch {
      /* ignore */
    }
  }, [apiBasePath]);

  const loadTraces = useCallback(
    async (forGoalId?: string) => {
      try {
        const params = new URLSearchParams();
        if (forGoalId) params.set("goalId", forGoalId);
        const json = await apiGet<{ traces: TraceOption[] }>(
          `${apiBasePath}/traces?${params}`,
        );
        setTraces(json.traces);
      } catch {
        /* ignore */
      }
    },
    [apiBasePath],
  );

  useEffect(() => {
    void loadGoals();
  }, [loadGoals]);

  useEffect(() => {
    void loadTraces(goalId || undefined);
  }, [goalId, loadTraces]);

  const loadGoalUsage = useCallback(
    async (forGoalId: string) => {
      if (!forGoalId) {
        setGoalUsage(null);
        return;
      }
      try {
        const report = await apiGet<GoalUsageReport>(
          `${apiBasePath}/goals/${encodeURIComponent(forGoalId)}/usage`,
        );
        setGoalUsage(report);
      } catch {
        setGoalUsage(null);
      }
    },
    [apiBasePath],
  );

  useEffect(() => {
    void loadGoalUsage(goalId);
  }, [goalId, loadGoalUsage]);

  const timelineActive = viewMode === "trace" && Boolean(traceId.trim());

  useEffect(() => {
    setPage(1);
  }, [
    operation,
    kind,
    spanType,
    status,
    provider,
    traceId,
    goalId,
    scope,
    viewMode,
  ]);

  const load = useCallback(async () => {
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const limit = timelineActive ? 500 : PAGE_SIZE;
      const params = new URLSearchParams({
        limit: String(limit),
        page: String(timelineActive ? 1 : page),
      });
      if (operation.trim()) params.set("operation", operation.trim());
      if (kind) params.set("kind", kind);
      if (spanType) params.set("spanType", spanType);
      if (status) params.set("status", status);
      if (provider) params.set("provider", provider);
      if (traceId.trim()) params.set("traceId", traceId.trim());
      if (goalId) params.set("goalId", goalId);
      if (scope) params.set("scope", scope);
      if (timelineActive) {
        params.set("traceTimeline", "1");
      }
      const next = await apiGet<LogsResponse>(`${apiBasePath}?${params}`);
      if (requestId !== listRequestRef.current) return;
      setData(next);
      const totalPages = next.totalPages ?? 0;
      if (!timelineActive && totalPages > 0 && page > totalPages) {
        setPage(totalPages);
      }
    } catch (e) {
      if (requestId !== listRequestRef.current) return;
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
    }
  }, [
    operation,
    kind,
    spanType,
    status,
    provider,
    traceId,
    goalId,
    scope,
    page,
    timelineActive,
    apiBasePath,
  ]);

  const orderedLogs = useMemo(() => {
    const logs = data?.logs ?? [];
    return timelineActive ? orderLogsForTimeline(logs) : logs;
  }, [data?.logs, timelineActive]);

  useEffect(() => {
    void load();
  }, [load]);

  // Local generation is streamed into the same SQLite rows that this page
  // displays. Keep an open log view in sync while a provider call is running;
  // otherwise a completed Mimo request can look permanently stuck at 0ms until
  // the learner presses Refresh manually.
  const hasRunningLogs = orderedLogs.some((log) => log.status === "running");
  useEffect(() => {
    if (apiBasePath !== "/api/local/logs/llm" || !hasRunningLogs) return;
    const timer = window.setInterval(() => {
      if (!loading) void load();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [apiBasePath, hasRunningLogs, load, loading]);

  const maxDuration = useMemo(
    () => Math.max(...orderedLogs.map((l) => l.durationMs), 1),
    [orderedLogs],
  );

  const selectedSummary =
    orderedLogs.find((l) => l.id === selectedId) ?? orderedLogs[0] ?? null;
  const selectedLog =
    selectedDetail?.log.id === selectedSummary?.id
      ? selectedDetail.log
      : selectedSummary;

  // Polling updates list rows; keep the open detail (and its JSON expansion)
  // unchanged until the user selects a different log.
  useEffect(() => {
    if (!selectedSummary) {
      detailRequestRef.current += 1;
      setSelectedDetail(null);
      setDetailError("");
      setDetailLoading(false);
      return;
    }
    const requestId = ++detailRequestRef.current;
    let active = true;
    setDetailLoading(true);
    setDetailError("");
    void apiGet<LogDetailResponse>(
      `${apiBasePath}/${encodeURIComponent(selectedSummary.id)}`,
    )
      .then((detail) => {
        if (active && requestId === detailRequestRef.current) {
          setSelectedDetail(detail);
        }
      })
      .catch((error: unknown) => {
        if (!active || requestId !== detailRequestRef.current) return;
        setSelectedDetail(null);
        setDetailError(error instanceof Error ? error.message : "加载详情失败");
      })
      .finally(() => {
        if (active && requestId === detailRequestRef.current) {
          setDetailLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [selectedSummary?.id, apiBasePath]);

  useEffect(() => {
    if (!orderedLogs.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !orderedLogs.some((l) => l.id === selectedId)) {
      setSelectedId(orderedLogs[0].id);
    }
  }, [orderedLogs, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-log-id="${CSS.escape(selectedId)}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const traceMetrics = useMemo(
    () => (timelineActive ? aggregateLogMetrics(orderedLogs) : null),
    [timelineActive, orderedLogs],
  );

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (operation.trim()) n += 1;
    if (kind) n += 1;
    if (spanType) n += 1;
    if (status) n += 1;
    if (provider) n += 1;
    if (scope) n += 1;
    if (traceId.trim() && !timelineActive) n += 1;
    return n;
  }, [
    operation,
    kind,
    spanType,
    status,
    provider,
    scope,
    traceId,
    timelineActive,
  ]);

  function selectTrace(id: string) {
    setTraceId(id);
    setViewMode("trace");
  }

  function clearTraceView() {
    setTraceId("");
    setViewMode("list");
  }

  function clearFilters() {
    setOperation("");
    setKind("");
    setSpanType("");
    setStatus("");
    setProvider("");
    setScope("");
    if (!timelineActive) setTraceId("");
  }

  const selectByOffset = useCallback(
    (delta: number) => {
      if (!orderedLogs.length) return;
      const currentIndex = selectedSummary
        ? orderedLogs.findIndex((l) => l.id === selectedSummary.id)
        : 0;
      const nextIndex = Math.max(
        0,
        Math.min(
          orderedLogs.length - 1,
          (currentIndex < 0 ? 0 : currentIndex) + delta,
        ),
      );
      setSelectedId(orderedLogs[nextIndex].id);
    },
    [orderedLogs, selectedSummary],
  );

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        selectByOffset(1);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        selectByOffset(-1);
      }
    }

    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [selectByOffset]);

  async function clearLogs() {
    const ok = await confirm({
      title: t("devLogs.viewer.clearLogsTitle"),
      description: t("devLogs.viewer.clearLogsDescription"),
      variant: "destructive",
      confirmLabel: t("devLogs.viewer.clearLogsConfirm"),
    });
    if (!ok) return;
    try {
      await apiDelete(apiBasePath);
    } catch {
      setError(t("devLogs.viewer.clearLogsError"));
      return;
    }

    // Drop every reference to the deleted rows before starting follow-up reads.
    // In particular, a pending list/detail request must not be allowed to put a
    // deleted selection back into the viewer.
    listRequestRef.current += 1;
    detailRequestRef.current += 1;
    setData((current) => ({
      ...current,
      count: 0,
      total: 0,
      page: 1,
      totalPages: 0,
      logs: [],
    }));
    setSelectedId(null);
    setSelectedDetail(null);
    setDetailLoading(false);
    setDetailError("");
    setGoals([]);
    setTraces([]);
    setGoalUsage(null);
    setGoalId("");
    setTraceId("");
    setViewMode("list");
    setPage(1);

    await Promise.all([loadGoals(), loadTraces()]);
    await load();
  }

  const selectedGoalTitle = goals.find((g) => g.goalId === goalId)?.title;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("devLogs.viewer.instructionsBeforeKeys")}
          <kbd className="rounded border border-border bg-muted px-1 text-[11px]">
            ↑
          </kbd>
          <kbd className="ml-0.5 rounded border border-border bg-muted px-1 text-[11px]">
            ↓
          </kbd>{" "}
          {t("devLogs.viewer.or")}{" "}
          <kbd className="rounded border border-border bg-muted px-1 text-[11px]">
            j
          </kbd>
          <kbd className="ml-0.5 rounded border border-border bg-muted px-1 text-[11px]">
            k
          </kbd>{" "}
          {t("devLogs.viewer.instructionsAfterKeys")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            {t("devLogs.viewer.refresh")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void clearLogs()}
          >
            <Trash2 className="size-3.5" />
            {t("devLogs.viewer.clearLogs")}
          </Button>
        </div>
      </div>

      <Card className="space-y-3 p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
          <label className="block text-sm">
            <span className="text-xs text-muted-foreground">
              {t("devLogs.viewer.learningGoal")}
            </span>
            <select
              className={fieldClass}
              value={goalId}
              onChange={(e) => setGoalId(e.target.value)}
            >
              <option value="">{t("devLogs.viewer.allPlans")}</option>
              {goals.map((g) => (
                <option key={g.goalId} value={g.goalId}>
                  {g.title} ({g.logCount}
                  {g.usage.totalTokens > 0
                    ? ` · ${formatTokenCount(g.usage.totalTokens)} tok`
                    : ""}
                  )
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-xs text-muted-foreground">
              {t("devLogs.viewer.trace")}
            </span>
            <select
              className={cn(fieldClass, "font-mono")}
              value={timelineActive ? traceId : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v) selectTrace(v);
                else clearTraceView();
              }}
            >
              <option value="">{t("devLogs.viewer.selectTrace")}</option>
              {traces.map((trace) => (
                <option key={trace.traceId} value={trace.traceId}>
                  {trace.traceId.slice(0, 8)}… ·{" "}
                  {t("devLogs.viewer.stepCount", { count: trace.logCount })} ·{" "}
                  {trace.kinds.join("+")}
                  {trace.usage.totalTokens > 0
                    ? ` · ${formatTokenCount(trace.usage.totalTokens)} tok`
                    : ""}{" "}
                  · {new Date(trace.startedAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <div
              className="inline-flex rounded-lg border border-border p-0.5"
              role="group"
              aria-label={t("devLogs.viewer.statusFilterAria")}
            >
              {[
                { value: "", label: t("devLogs.common.all") },
                { value: "error", label: t("devLogs.common.error") },
                { value: "recovered", label: t("devLogs.common.recovered") },
                { value: "running", label: t("devLogs.common.running") },
                { value: "success", label: t("devLogs.common.success") },
              ].map((opt) => (
                <button
                  key={opt.value || "all"}
                  type="button"
                  onClick={() => setStatus(opt.value)}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                    status === opt.value
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <Filter className="size-3.5" />
              {t("devLogs.viewer.filters")}
              {activeFilterCount > 0 ? (
                <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                  {activeFilterCount}
                </span>
              ) : null}
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  filtersOpen && "rotate-180",
                )}
              />
            </Button>
          </div>
        </div>

        {filtersOpen ? (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">
                  {t("devLogs.viewer.operationContains")}
                </span>
                <input
                  className={fieldClass}
                  value={operation}
                  onChange={(e) => setOperation(e.target.value)}
                  placeholder={t("devLogs.viewer.operationPlaceholder")}
                />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">span</span>
                <select
                  className={fieldClass}
                  value={spanType}
                  onChange={(e) => setSpanType(e.target.value)}
                >
                  <option value="">{t("devLogs.common.all")}</option>
                  <option value="llm">llm</option>
                  <option value="tool">tool</option>
                  <option value="parse">parse</option>
                  <option value="embedding">embedding</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">kind</span>
                <select
                  className={fieldClass}
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  <option value="">{t("devLogs.common.all")}</option>
                  <option value="chat">chat</option>
                  <option value="embedding">embedding</option>
                  <option value="search">search (Tavily)</option>
                  <option value="rag">rag (pgvector)</option>
                  <option value="image">image</option>
                  <option value="audio">audio (TTS)</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">provider</span>
                <select
                  className={fieldClass}
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                >
                  <option value="">{t("devLogs.common.all")}</option>
                  <option value="minimax">minimax</option>
                  <option value="openai">openai</option>
                  <option value="deepseek">deepseek</option>
                  <option value="fireworks">fireworks</option>
                  <option value="doubao">doubao</option>
                  <option value="bigmodel">bigmodel</option>
                  <option value="qwen">qwen</option>
                  <option value="ollama">ollama</option>
                  <option value="tavily">tavily</option>
                  <option value="anysearch">anysearch</option>
                  <option value="pgvector">pgvector</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-xs text-muted-foreground">scope</span>
                <select
                  className={fieldClass}
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="">{t("devLogs.common.all")}</option>
                  <option value="goal">goal</option>
                  <option value="unit">unit</option>
                </select>
              </label>
              <label className="block text-sm sm:col-span-2 lg:col-span-3">
                <span className="text-xs text-muted-foreground">
                  {t("devLogs.viewer.exactTraceId")}
                </span>
                <input
                  className={cn(fieldClass, "font-mono")}
                  value={traceId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTraceId(v);
                    if (!v.trim()) setViewMode("list");
                  }}
                  placeholder={t("devLogs.viewer.tracePlaceholder")}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSpanType("tool");
                  setKind("search");
                  setFiltersOpen(true);
                }}
              >
                {t("devLogs.viewer.tavilyOnly")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSpanType("tool");
                  setKind("rag");
                  setFiltersOpen(true);
                }}
              >
                {t("devLogs.viewer.ragOnly")}
              </Button>
              {activeFilterCount > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                >
                  {t("devLogs.viewer.clearFilters")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeFilterCount > 0 || goalId || timelineActive ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {goalId ? (
              <FilterChip
                label={`目标: ${selectedGoalTitle ?? goalId.slice(0, 8)}`}
                onClear={() => setGoalId("")}
              />
            ) : null}
            {timelineActive ? (
              <FilterChip
                label={`trace: ${traceId.slice(0, 8)}…`}
                onClear={clearTraceView}
              />
            ) : null}
            {operation.trim() ? (
              <FilterChip
                label={`op: ${operation.trim()}`}
                onClear={() => setOperation("")}
              />
            ) : null}
            {spanType ? (
              <FilterChip
                label={`span: ${spanType}`}
                onClear={() => setSpanType("")}
              />
            ) : null}
            {kind ? (
              <FilterChip label={`kind: ${kind}`} onClear={() => setKind("")} />
            ) : null}
            {provider ? (
              <FilterChip
                label={`provider: ${provider}`}
                onClear={() => setProvider("")}
              />
            ) : null}
            {scope ? (
              <FilterChip
                label={`scope: ${scope}`}
                onClear={() => setScope("")}
              />
            ) : null}
            {status ? (
              <FilterChip
                label={`status: ${status}`}
                onClear={() => setStatus("")}
              />
            ) : null}
            {!timelineActive && traceId.trim() ? (
              <FilterChip
                label={`traceId: ${traceId.trim().slice(0, 8)}…`}
                onClear={() => setTraceId("")}
              />
            ) : null}
          </div>
        ) : null}

        {goalId && goalUsage ? (
          <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/50 px-3 py-2.5 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium text-emerald-950 dark:text-emerald-100">
                {goalUsage.title}
              </span>
              <span className="text-xs text-emerald-800 dark:text-emerald-300">
                {t("devLogs.viewer.logCount", { count: goalUsage.logCount })} ·{" "}
                {formatDurationMs(goalUsage.usage.totalDurationMs)}
              </span>
              {formatUsageSummary(goalUsage.usage) ? (
                <span className="font-mono text-[11px] tabular-nums text-emerald-900 dark:text-emerald-200">
                  {formatUsageSummary(goalUsage.usage)}
                </span>
              ) : null}
            </div>
            {goalUsage.byCategory.length > 0 ? (
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {goalUsage.byCategory.map((row) => (
                  <div
                    key={row.category}
                    className="rounded-md border border-emerald-200/60 bg-background/70 px-2.5 py-1.5 dark:border-emerald-900/60"
                  >
                    <p className="text-[11px] font-medium text-emerald-900 dark:text-emerald-100">
                      {CATEGORY_KEYS[row.category]
                        ? t(CATEGORY_KEYS[row.category])
                        : row.category}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] tabular-nums text-emerald-800 dark:text-emerald-300">
                      {formatUsageSummary(row) ?? "—"}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {timelineActive ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
            <span className="font-medium">{t("devLogs.viewer.timeline")}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {traceId}
            </span>
            <span className="text-xs text-muted-foreground">
              {orderedLogs.length} spans ·{" "}
              {formatDurationMs(traceMetrics?.totalDurationMs ?? 0)}
              {traceMetrics && traceMetrics.totalTokens > 0 ? (
                <>
                  {" "}
                  · {formatUsageSummary(traceMetrics)}
                  {traceMetrics.avgOutputTps !== undefined ? (
                    <> · avg {traceMetrics.avgOutputTps} tok/s</>
                  ) : null}
                </>
              ) : null}
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="ml-auto"
              onClick={clearTraceView}
            >
              {t("devLogs.viewer.exitTrace")}
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <p>
            {t("devLogs.viewer.logs")}{" "}
            {data.enabled ? (
              <span className="font-medium text-emerald-700 dark:text-emerald-300">
                {t("devLogs.viewer.enabled")}
              </span>
            ) : (
              <span className="font-medium text-amber-700 dark:text-amber-300">
                {t("devLogs.viewer.disabled")}
              </span>
            )}
            {" · "}
            {t("devLogs.viewer.currentPageCount", { count: data.count })}
            {!timelineActive && (data.total ?? 0) > 0
              ? ` · ${t("devLogs.viewer.pageSummary", { page: data.page ?? page, totalPages: data.totalPages || 1, total: data.total ?? 0 })}`
              : null}
            {timelineActive ? " · 父子嵌套" : null}
          </p>
          <p className="font-mono truncate" title={data.logDir}>
            {data.logDir}
          </p>
        </div>
      </Card>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      ) : null}

      <div
        ref={listRef}
        tabIndex={0}
        className="grid gap-4 outline-none xl:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]"
      >
        <div className="min-w-0 space-y-3">
          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2">
              <p className="text-xs font-medium text-muted-foreground">
                {loading
                  ? t("devLogs.viewer.loading")
                  : t("devLogs.viewer.recordCount", {
                      count: orderedLogs.length,
                    })}
              </p>
              {selectedLog ? (
                <p className="truncate text-[11px] text-muted-foreground">
                  {t("devLogs.viewer.selected")}{" "}
                  <span className="font-medium text-foreground">
                    {displayTitle(selectedLog)}
                  </span>
                </p>
              ) : null}
            </div>

            {!orderedLogs.length && !loading ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {t("devLogs.viewer.empty")}
              </p>
            ) : (
              <div className="max-h-[min(70vh,52rem)] overflow-auto">
                {orderedLogs.map((log, i) => (
                  <LogRow
                    key={log.id}
                    log={log}
                    selected={selectedLog?.id === log.id}
                    onSelect={() => setSelectedId(log.id)}
                    onTraceClick={selectTrace}
                    index={i + 1}
                    showIndex={timelineActive}
                    depth={timelineActive ? childDepth(log, orderedLogs) : 0}
                    maxDuration={maxDuration}
                  />
                ))}
              </div>
            )}
          </Card>

          {!timelineActive && (data.totalPages ?? 0) > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>
                {t("devLogs.viewer.pagination", {
                  page: data.page ?? page,
                  totalPages: data.totalPages ?? 0,
                  total: data.total ?? 0,
                })}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading || page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  <ChevronLeft className="size-3.5" />
                  {t("devLogs.viewer.previousPage")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading || page >= (data.totalPages ?? 0)}
                  onClick={() => setPage((value) => value + 1)}
                >
                  {t("devLogs.viewer.nextPage")}
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          ) : null}

          {selectedLog ? (
            <Card className="p-4 xl:hidden">
              <p className="mb-3 text-sm font-semibold text-foreground">
                {displayTitle(selectedLog)}
              </p>
              {detailLoading ? (
                <p className="text-sm text-muted-foreground">
                  {t("devLogs.viewer.loading")}
                </p>
              ) : detailError ? (
                <p className="text-sm text-destructive">{detailError}</p>
              ) : (
                <LlmLogDetail
                  key={selectedLog.id}
                  log={selectedLog}
                  childLogs={selectedDetail?.childLogs ?? []}
                  parentLog={
                    selectedLog.parentId
                      ? orderedLogs.find(
                          (entry) => entry.id === selectedLog.parentId,
                        )
                      : undefined
                  }
                />
              )}
            </Card>
          ) : null}
        </div>

        <aside className="hidden min-w-0 xl:block">
          <Card className="sticky top-4 max-h-[calc(100vh-5rem)] overflow-hidden p-0">
            {selectedLog ? (
              <>
                <div className="border-b border-border px-4 py-3">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {displayTitle(selectedLog)}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {selectedLog.operation}
                  </p>
                </div>
                <div className="max-h-[calc(100vh-8.5rem)] overflow-auto p-4">
                  {detailLoading ? (
                    <p className="text-sm text-muted-foreground">
                      {t("devLogs.viewer.loading")}
                    </p>
                  ) : detailError ? (
                    <p className="text-sm text-destructive">{detailError}</p>
                  ) : (
                    <LlmLogDetail
                      key={selectedLog.id}
                      log={selectedLog}
                      childLogs={selectedDetail?.childLogs ?? []}
                      parentLog={
                        selectedLog.parentId
                          ? orderedLogs.find(
                              (entry) => entry.id === selectedLog.parentId,
                            )
                          : undefined
                      }
                    />
                  )}
                </div>
              </>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">
                {t("devLogs.viewer.selectLog")}
              </p>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
