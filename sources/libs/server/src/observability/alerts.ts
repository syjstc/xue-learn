import type { RequestMetricsRepository } from "../../../domain/src/index.js";
import { requireRequestMetricsPersistence } from "./request-metrics-persistence.js";
import { getEnv } from "../env.js";
import {
  collectRequestMetrics,
  type RequestMetricsSnapshot,
} from "./request-metrics.js";
import {
  collectSystemMetrics,
  type SystemMetricsSnapshot,
} from "./system-metrics.js";

export type AlertSeverity = "warning" | "critical";

export type PerformanceAlert = {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  value: number;
  threshold: number;
};

export type MonitoringSnapshot = {
  system: SystemMetricsSnapshot;
  requests: RequestMetricsSnapshot;
  alerts: PerformanceAlert[];
};

export type AlertCheckResult = {
  snapshot: MonitoringSnapshot;
  fired: PerformanceAlert[];
  skippedCooldown: string[];
  webhookDelivered: boolean;
};

const lastFiredAt = new Map<string, number>();

export function resetAlertCooldownState(): void {
  lastFiredAt.clear();
}

function windowStats(
  requests: RequestMetricsSnapshot,
  minutes: number,
) {
  return requests.windows.find((w) => w.windowMinutes === minutes);
}

export function evaluatePerformanceAlerts(input: {
  system: SystemMetricsSnapshot;
  requests: RequestMetricsSnapshot;
}): PerformanceAlert[] {
  const env = getEnv();
  const alerts: PerformanceAlert[] = [];
  const memoryUsed = input.system.host.memory.usedPercent;
  const loadPerCpu = input.system.host.loadPerCpu;
  const maxDisk = input.system.disks.reduce(
    (max, disk) => Math.max(max, disk.usedPercent),
    0,
  );
  const oneMinute = windowStats(input.requests, 1);
  const fiveMinute = windowStats(input.requests, 5);

  if (memoryUsed >= env.ALERT_MEMORY_PERCENT) {
    alerts.push({
      id: "host.memory",
      severity: memoryUsed >= env.ALERT_MEMORY_PERCENT + 5 ? "critical" : "warning",
      title: "High memory usage",
      message: `Host memory is ${memoryUsed.toFixed(1)}% used (threshold ${env.ALERT_MEMORY_PERCENT}%).`,
      value: memoryUsed,
      threshold: env.ALERT_MEMORY_PERCENT,
    });
  }

  if (loadPerCpu >= env.ALERT_LOAD_PER_CPU) {
    alerts.push({
      id: "host.cpu_load",
      severity: loadPerCpu >= env.ALERT_LOAD_PER_CPU * 1.5 ? "critical" : "warning",
      title: "High CPU load",
      message: `Load per CPU is ${loadPerCpu.toFixed(2)} (1m load ${input.system.host.loadAverage.oneMinute.toFixed(2)} / ${input.system.host.cpuCount} CPUs; threshold ${env.ALERT_LOAD_PER_CPU}).`,
      value: loadPerCpu,
      threshold: env.ALERT_LOAD_PER_CPU,
    });
  }

  if (maxDisk >= env.LOG_DISK_WARNING_PERCENT) {
    const critical = maxDisk >= env.LOG_DISK_CRITICAL_PERCENT;
    alerts.push({
      id: "host.disk",
      severity: critical ? "critical" : "warning",
      title: critical ? "Critical disk usage" : "High disk usage",
      message: `Disk usage is ${maxDisk.toFixed(1)}% (warning ${env.LOG_DISK_WARNING_PERCENT}%, critical ${env.LOG_DISK_CRITICAL_PERCENT}%).`,
      value: maxDisk,
      threshold: critical
        ? env.LOG_DISK_CRITICAL_PERCENT
        : env.LOG_DISK_WARNING_PERCENT,
    });
  }

  if (
    oneMinute &&
    oneMinute.requestCount > 0 &&
    oneMinute.requestsPerMinute >= env.ALERT_REQUESTS_PER_MINUTE
  ) {
    alerts.push({
      id: "api.request_rate",
      severity:
        oneMinute.requestsPerMinute >= env.ALERT_REQUESTS_PER_MINUTE * 1.5
          ? "critical"
          : "warning",
      title: "High request rate",
      message: `API handled ${oneMinute.requestsPerMinute.toFixed(1)} req/min in the last minute (threshold ${env.ALERT_REQUESTS_PER_MINUTE}).`,
      value: oneMinute.requestsPerMinute,
      threshold: env.ALERT_REQUESTS_PER_MINUTE,
    });
  }

  if (
    fiveMinute &&
    fiveMinute.requestCount >= env.ALERT_ERROR_MIN_SAMPLES &&
    fiveMinute.errorRatePercent >= env.ALERT_ERROR_RATE_PERCENT
  ) {
    alerts.push({
      id: "api.error_rate",
      severity:
        fiveMinute.errorRatePercent >= env.ALERT_ERROR_RATE_PERCENT * 2
          ? "critical"
          : "warning",
      title: "Elevated 5xx error rate",
      message: `5xx rate is ${fiveMinute.errorRatePercent.toFixed(1)}% over 5 minutes (${fiveMinute.error5xxCount}/${fiveMinute.requestCount}; threshold ${env.ALERT_ERROR_RATE_PERCENT}%).`,
      value: fiveMinute.errorRatePercent,
      threshold: env.ALERT_ERROR_RATE_PERCENT,
    });
  }

  if (
    fiveMinute &&
    fiveMinute.requestCount >= env.ALERT_ERROR_MIN_SAMPLES &&
    fiveMinute.p95DurationMs >= env.ALERT_P95_MS
  ) {
    alerts.push({
      id: "api.latency_p95",
      severity:
        fiveMinute.p95DurationMs >= env.ALERT_P95_MS * 2 ? "critical" : "warning",
      title: "High API latency",
      message: `p95 latency is ${fiveMinute.p95DurationMs.toFixed(0)}ms over 5 minutes (threshold ${env.ALERT_P95_MS}ms).`,
      value: fiveMinute.p95DurationMs,
      threshold: env.ALERT_P95_MS,
    });
  }

  return alerts;
}

export async function collectMonitoringSnapshot(
  repository: RequestMetricsRepository = requireRequestMetricsPersistence(),
): Promise<MonitoringSnapshot> {
  const [system, requests] = await Promise.all([
    collectSystemMetrics(),
    collectRequestMetrics(repository),
  ]);
  return {
    system,
    requests,
    alerts: evaluatePerformanceAlerts({ system, requests }),
  };
}

function applyCooldown(alerts: PerformanceAlert[]): {
  fired: PerformanceAlert[];
  skippedCooldown: string[];
} {
  const env = getEnv();
  const cooldownMs = env.ALERT_COOLDOWN_MINUTES * 60 * 1000;
  const now = Date.now();
  const fired: PerformanceAlert[] = [];
  const skippedCooldown: string[] = [];

  for (const alert of alerts) {
    const last = lastFiredAt.get(alert.id) ?? 0;
    if (now - last < cooldownMs) {
      skippedCooldown.push(alert.id);
      continue;
    }
    lastFiredAt.set(alert.id, now);
    fired.push(alert);
  }

  return { fired, skippedCooldown };
}

export async function deliverAlertWebhook(
  alerts: PerformanceAlert[],
  snapshot: MonitoringSnapshot,
): Promise<boolean> {
  const env = getEnv();
  const url = env.ALERT_WEBHOOK_URL?.trim();
  if (!url || alerts.length === 0) return false;

  const lines = alerts.map(
    (alert) =>
      `[${alert.severity.toUpperCase()}] ${alert.title}: ${alert.message}`,
  );
  const text = [
    `XueLearn API alert (${snapshot.system.hostname})`,
    ...lines,
    `Memory ${snapshot.system.host.memory.usedPercent.toFixed(1)}% · Load/CPU ${snapshot.system.host.loadPerCpu.toFixed(2)} · Disk max ${Math.max(0, ...snapshot.system.disks.map((d) => d.usedPercent)).toFixed(1)}%`,
  ].join("\n");

  const body = {
    text,
    content: text,
    msgtype: "text",
    msg: { text },
    alerts,
    hostname: snapshot.system.hostname,
    collectedAt: snapshot.system.collectedAt,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function runPerformanceAlertCheck(
  repository: RequestMetricsRepository = requireRequestMetricsPersistence(),
): Promise<AlertCheckResult> {
  const snapshot = await collectMonitoringSnapshot(repository);
  const { fired, skippedCooldown } = applyCooldown(snapshot.alerts);
  const webhookDelivered = await deliverAlertWebhook(fired, snapshot);
  return {
    snapshot,
    fired,
    skippedCooldown,
    webhookDelivered,
  };
}
