import type { RequestMetricRecord, RequestMetricsRepository } from "../../../domain/src/index.js";
import { requireRequestMetricsPersistence } from "./request-metrics-persistence.js";

export type RequestWindowStats = {
  windowMinutes: number;
  since: string;
  requestCount: number;
  requestsPerMinute: number;
  error4xxCount: number;
  error5xxCount: number;
  errorRatePercent: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
};

export type RequestBucket = {
  bucketStart: string;
  requestCount: number;
  error5xxCount: number;
  avgDurationMs: number;
};

export type TopRouteStats = {
  method: string;
  route: string;
  requestCount: number;
  error5xxCount: number;
  avgDurationMs: number;
  p95DurationMs: number;
};

export type RequestMetricsSnapshot = {
  collectedAt: string;
  windows: RequestWindowStats[];
  series: RequestBucket[];
  topRoutes: TopRouteStats[];
};

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower] ?? 0;
  const weight = position - lower;
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
}

function aggregateWindow(
  records: readonly RequestMetricRecord[],
  since: Date,
  windowMinutes: number,
): Promise<RequestWindowStats> {
  const window = records.filter((record) => record.createdAt >= since);
  const durations = window.map((record) => record.durationMs).sort((a, b) => a - b);
  const requestCount = window.length;
  const error5xxCount = window.filter((record) => record.statusCode >= 500).length;
  const error4xxCount = window.filter((record) => record.statusCode >= 400 && record.statusCode < 500).length;
  return Promise.resolve({
    windowMinutes,
    since: since.toISOString(),
    requestCount,
    requestsPerMinute: round(requestCount / Math.max(1, windowMinutes), 2),
    error4xxCount,
    error5xxCount,
    errorRatePercent:
      requestCount > 0 ? round((error5xxCount / requestCount) * 100, 2) : 0,
    avgDurationMs: round(durations.reduce((sum, value) => sum + value, 0) / Math.max(1, durations.length), 1),
    p50DurationMs: round(percentile(durations, 0.5), 1),
    p95DurationMs: round(percentile(durations, 0.95), 1),
    p99DurationMs: round(percentile(durations, 0.99), 1),
  });
}

export async function collectRequestMetrics(
  repository: RequestMetricsRepository = requireRequestMetricsPersistence(),
  options?: {
    windowsMinutes?: number[];
    seriesMinutes?: number;
    topRoutesLimit?: number;
  },
): Promise<RequestMetricsSnapshot> {
  const windowsMinutes = options?.windowsMinutes ?? [1, 5, 15, 60];
  const seriesMinutes = options?.seriesMinutes ?? 60;
  const topRoutesLimit = Math.min(
    50,
    Math.max(1, Math.floor(options?.topRoutesLimit ?? 10)),
  );
  const now = Date.now();
  const seriesSince = new Date(now - seriesMinutes * 60 * 1000);
  const topSince = new Date(now - 15 * 60 * 1000);
  const maxWindow = Math.max(seriesMinutes, 15, ...windowsMinutes);
  const records = await repository.listSince(new Date(now - maxWindow * 60 * 1000));
  const windows = await Promise.all(windowsMinutes.map((minutes) =>
    aggregateWindow(records, new Date(now - minutes * 60 * 1000), minutes),
  ));
  const buckets = new Map<string, RequestMetricRecord[]>();
  for (const record of records) {
    if (record.createdAt < seriesSince) continue;
    const minute = new Date(Math.floor(record.createdAt.getTime() / 60_000) * 60_000).toISOString();
    buckets.set(minute, [...(buckets.get(minute) ?? []), record]);
  }
  const routeGroups = new Map<string, RequestMetricRecord[]>();
  for (const record of records) {
    if (record.createdAt < topSince) continue;
    const key = `${record.method}\u0000${record.route}`;
    routeGroups.set(key, [...(routeGroups.get(key) ?? []), record]);
  }

  return {
    collectedAt: new Date().toISOString(),
    windows,
    series: [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bucketStart, items]) => ({
      bucketStart, requestCount: items.length,
      error5xxCount: items.filter((item) => item.statusCode >= 500).length,
      avgDurationMs: round(items.reduce((sum, item) => sum + item.durationMs, 0) / Math.max(1, items.length), 1),
    })),
    topRoutes: [...routeGroups.entries()].map(([key, items]) => {
      const [method, route] = key.split("\u0000");
      const durations = items.map((item) => item.durationMs).sort((a, b) => a - b);
      return { method: method!, route: route!, requestCount: items.length,
        error5xxCount: items.filter((item) => item.statusCode >= 500).length,
        avgDurationMs: round(durations.reduce((sum, value) => sum + value, 0) / Math.max(1, durations.length), 1),
        p95DurationMs: round(percentile(durations, 0.95), 1) };
    }).sort((a, b) => b.requestCount - a.requestCount).slice(0, topRoutesLimit),
  };
}
