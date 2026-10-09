import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, RefreshCw, TriangleAlert, X } from "lucide-react";
import { apiGet } from "@/shared/api";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

type ErrorSource = "api" | "worker" | "internal";
type StatusFilter = "5xx" | "409" | "422" | "429" | "";

type ErrorGroup = {
  id: string;
  fingerprint: string;
  source: ErrorSource;
  service: string;
  errorCode: string | null;
  message: string;
  statusCode: number | null;
  method: string | null;
  route: string | null;
  operation: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
};

type ErrorList = {
  items: ErrorGroup[];
  nextCursor: string | null;
  windowHours: number;
};

type ErrorDetail = {
  group: ErrorGroup & { stack: string | null };
  recentApiOccurrences: Array<{
    id: string;
    createdAt: string;
    requestId: string;
    traceId: string;
    statusCode: number;
    durationMs: number;
  }>;
};

function location(group: ErrorGroup) {
  return group.route
    ? `${group.method ?? ""} ${group.route}`.trim()
    : (group.operation ?? "—");
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function formatDuration(ms: number) {
  return ms < 1_000 ? `${ms} ms` : `${(ms / 1_000).toFixed(1)} s`;
}

export function LocalErrorLogsPage() {
  const t = useT();
  const [hours, setHours] = useState(24);
  const [source, setSource] = useState<ErrorSource | "">("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [cursors, setCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const filterKey = `${hours}|${source}|${status}|${search}`;
  useEffect(() => {
    setCursors([undefined]);
    setPage(0);
    setSelectedId(null);
  }, [filterKey]);

  const params = useMemo(() => {
    const next = new URLSearchParams({ hours: String(hours), limit: "25" });
    if (cursors[page]) next.set("cursor", cursors[page]);
    if (source) next.set("source", source);
    if (status) next.set("status", status);
    if (search) next.set("search", search);
    return next;
  }, [cursors, hours, page, search, source, status]);

  const list = useQuery({
    queryKey: ["desktop-local", "logs", "errors", params.toString()],
    queryFn: () => apiGet<ErrorList>(`/api/local/logs/errors?${params}`),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const detail = useQuery({
    queryKey: ["desktop-local", "logs", "errors", "detail", selectedId],
    queryFn: () =>
      apiGet<ErrorDetail>(
        `/api/local/logs/errors/${encodeURIComponent(selectedId ?? "")}`,
      ),
    enabled: Boolean(selectedId),
  });

  function nextPage() {
    if (!list.data?.nextCursor) return;
    setCursors((current) => [
      ...current.slice(0, page + 1),
      list.data?.nextCursor ?? undefined,
    ]);
    setPage((current) => current + 1);
    setSelectedId(null);
  }

  return (
    <section className="space-y-5" aria-labelledby="local-error-logs-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-amber-500/10 p-2.5 text-amber-700">
            <TriangleAlert className="size-5" aria-hidden />
          </span>
          <div>
            <h2 id="local-error-logs-title" className="text-xl font-semibold">
              {t("desktop.errorLogs.title")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("desktop.errorLogs.description")}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
          onClick={() => void list.refetch()}
          disabled={list.isFetching}
        >
          <RefreshCw
            className={`size-4 ${list.isFetching ? "animate-spin" : ""}`}
            aria-hidden
          />
          {t("devLogs.viewer.refresh")}
        </button>
      </div>

      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1.5 block text-muted-foreground">
            {t("desktop.errorLogs.window")}
          </span>
          <select
            className="compact-native-select w-full rounded-lg border bg-background"
            value={hours}
            onChange={(event) => setHours(Number(event.target.value))}
          >
            <option value={24}>{t("desktop.errorLogs.last24h")}</option>
            <option value={168}>{t("desktop.errorLogs.last7d")}</option>
            <option value={720}>{t("desktop.errorLogs.last30d")}</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block text-muted-foreground">
            {t("desktop.errorLogs.source")}
          </span>
          <select
            className="compact-native-select w-full rounded-lg border bg-background"
            value={source}
            onChange={(event) =>
              setSource(event.target.value as ErrorSource | "")
            }
          >
            <option value="">{t("desktop.errorLogs.allSources")}</option>
            <option value="api">{t("desktop.errorLogs.sourceApi")}</option>
            <option value="worker">{t("desktop.errorLogs.sourceWorker")}</option>
            <option value="internal">
              {t("desktop.errorLogs.sourceInternal")}
            </option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block text-muted-foreground">
            {t("desktop.errorLogs.status")}
          </span>
          <select
            className="compact-native-select w-full rounded-lg border bg-background"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
          >
            <option value="">{t("desktop.errorLogs.allStatuses")}</option>
            <option value="5xx">5xx</option>
            <option value="409">409</option>
            <option value="422">422</option>
            <option value="429">429</option>
          </select>
        </label>
        <label className="text-sm sm:col-span-3">
          <span className="mb-1.5 block text-muted-foreground">
            {t("desktop.errorLogs.search")}
          </span>
          <input
            className="w-full rounded-lg border bg-background px-3 py-2"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder={t("desktop.errorLogs.searchPlaceholder")}
          />
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {list.isPending ? (
          <p className="p-4 text-sm text-muted-foreground">
            {t("desktop.errorLogs.loading")}
          </p>
        ) : list.isError ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {list.error instanceof Error
              ? list.error.message
              : t("desktop.errorLogs.loadError")}
          </p>
        ) : !list.data.items.length ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {t("desktop.errorLogs.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[54rem] text-left text-sm">
              <thead className="border-b bg-muted/45 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">
                    {t("desktop.errorLogs.lastSeen")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("desktop.errorLogs.count")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("desktop.errorLogs.source")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("desktop.errorLogs.status")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("desktop.errorLogs.route")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("desktop.errorLogs.message")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((group) => (
                  <tr
                    key={group.id}
                    className="border-b last:border-0 hover:bg-muted/30"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-xs">
                      {formatDate(group.lastSeenAt)}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {group.occurrenceCount}
                    </td>
                    <td className="px-4 py-3">
                      <span className="block">{group.source}</span>
                      <span className="text-xs text-muted-foreground">
                        {group.service}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {group.statusCode ?? group.errorCode ?? "—"}
                    </td>
                    <td className="max-w-52 truncate px-4 py-3 font-mono text-xs">
                      {location(group)}
                    </td>
                    <td className="max-w-sm px-4 py-3">
                      <button
                        type="button"
                        className="line-clamp-2 text-left text-[var(--brand-700)] hover:underline"
                        onClick={() => setSelectedId(group.id)}
                      >
                        {group.message}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
          <span>
            {t("desktop.errorLogs.pageSummary", {
              page: page + 1,
              hours: list.data?.windowHours ?? hours,
            })}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border px-2.5 py-1.5 disabled:opacity-40"
              disabled={page === 0}
              onClick={() => {
                setPage((current) => Math.max(0, current - 1));
                setSelectedId(null);
              }}
            >
              {t("desktop.errorLogs.previous")}
            </button>
            <button
              type="button"
              className="rounded-md border px-2.5 py-1.5 disabled:opacity-40"
              disabled={!list.data?.nextCursor}
              onClick={nextPage}
            >
              {t("desktop.errorLogs.next")}
            </button>
          </div>
        </div>
      </div>

      {selectedId ? (
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="font-semibold">{t("desktop.errorLogs.detail")}</h3>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
              onClick={() => setSelectedId(null)}
            >
              <X className="size-4" aria-hidden /> {t("common.close")}
            </button>
          </div>
          {detail.isPending ? (
            <p className="text-sm text-muted-foreground">
              {t("desktop.errorLogs.loadingDetail")}
            </p>
          ) : detail.isError || !detail.data ? (
            <p className="text-sm text-destructive">
              {t("desktop.errorLogs.detailError")}
            </p>
          ) : (
            <div className="space-y-4">
              <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("desktop.errorLogs.fingerprint")}
                  </dt>
                  <dd className="mt-1 break-all font-mono text-xs">
                    {detail.data.group.fingerprint}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("desktop.errorLogs.firstSeen")}
                  </dt>
                  <dd className="mt-1">
                    {formatDate(detail.data.group.firstSeenAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("desktop.errorLogs.occurrences")}
                  </dt>
                  <dd className="mt-1">{detail.data.group.occurrenceCount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("desktop.errorLogs.location")}
                  </dt>
                  <dd className="mt-1 font-mono text-xs">
                    {location(detail.data.group)}
                  </dd>
                </div>
              </dl>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-medium">
                    {t("desktop.errorLogs.stack")}
                  </h4>
                  {detail.data.group.stack ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        void navigator.clipboard.writeText(
                          detail.data.group.stack ?? "",
                        )
                      }
                    >
                      <Copy className="size-3.5" aria-hidden />{" "}
                      {t("devLogs.common.copy")}
                    </button>
                  ) : null}
                </div>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs">
                  {detail.data.group.stack ?? t("desktop.errorLogs.noStack")}
                </pre>
              </div>
              {detail.data.recentApiOccurrences.length ? (
                <div>
                  <h4 className="mb-2 text-sm font-medium">
                    {t("desktop.errorLogs.recentApi")}
                  </h4>
                  <div className="space-y-1">
                    {detail.data.recentApiOccurrences.map((item) => (
                      <div
                        key={item.id}
                        className="grid gap-2 rounded-lg border p-2 text-xs sm:grid-cols-[1fr_auto_auto] items-center"
                      >
                        <span>
                          {formatDate(item.createdAt)} · {item.traceId}
                        </span>
                        <span>{item.statusCode}</span>
                        <span>{formatDuration(item.durationMs)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
