import type { RequestMetricsRepository } from "../../../domain/src/index.js";
let configured: RequestMetricsRepository | null = null;
export function configureRequestMetricsPersistence(repository: RequestMetricsRepository): void { configured = repository; }
export function requireRequestMetricsPersistence(): RequestMetricsRepository {
  if (!configured) throw new Error("Request metrics persistence is not configured.");
  return configured;
}
