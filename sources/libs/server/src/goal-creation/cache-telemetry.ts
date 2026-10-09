export const AGENTIC_CACHE_ACCEPTANCE = {
  minWarmCallsPerGroup: 30,
  minMeasurementCoverage: 0.9,
  minTokenWeightedHitRate: 0.65,
} as const;

export type AuthoringCacheClass = "cold_seed" | "warm_fanout";

export function classifyAuthoringCacheClass(
  reason: string | undefined,
): AuthoringCacheClass {
  return reason === "fan_out" || reason === "warm_fanout"
    ? "warm_fanout"
    : "cold_seed";
}

export type CacheTelemetryCall = Readonly<{
  operation?: string;
  goalId?: string;
  sessionId?: string;
  cacheClass?: string;
  cacheReadTokens?: number | null;
  inputTokens?: number | null;
  uncachedInputTokens?: number | null;
  cost?: number | null;
}>;

export type CacheTelemetrySummary = Readonly<{
  totalCalls: number;
  measuredCalls: number;
  unknownCalls: number;
  measurementCoverage: number | "unknown";
  cacheReadTokens: number | "unknown";
  inputTokens: number | "unknown";
  uncachedInputTokens: number | "unknown";
  tokenWeightedHitRate: number | "unknown";
  cost: number | "unknown";
  meetsAcceptance: boolean | "unknown";
}>;

function knownNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function summarizeCacheTelemetry(
  calls: readonly CacheTelemetryCall[],
): CacheTelemetrySummary {
  const measured = calls.filter((call) => knownNumber(call.cacheReadTokens));
  const unknownCalls = calls.length - measured.length;
  if (calls.length === 0) {
    return {
      totalCalls: 0,
      measuredCalls: 0,
      unknownCalls: 0,
      measurementCoverage: "unknown",
      cacheReadTokens: "unknown",
      inputTokens: "unknown",
      uncachedInputTokens: "unknown",
      tokenWeightedHitRate: "unknown",
      cost: "unknown",
      meetsAcceptance: "unknown",
    };
  }
  if (measured.length === 0) {
    return {
      totalCalls: calls.length,
      measuredCalls: 0,
      unknownCalls,
      measurementCoverage: 0,
      cacheReadTokens: "unknown",
      inputTokens: "unknown",
      uncachedInputTokens: "unknown",
      tokenWeightedHitRate: "unknown",
      cost: "unknown",
      meetsAcceptance: "unknown",
    };
  }
  const cacheReadTokens = measured.reduce(
    (sum, call) => sum + (call.cacheReadTokens ?? 0),
    0,
  );
  const inputTokens = measured.reduce(
    (sum, call) => sum + (call.inputTokens ?? 0),
    0,
  );
  const uncachedInputTokens = measured.reduce((sum, call) => {
    if (knownNumber(call.uncachedInputTokens)) {
      return sum + call.uncachedInputTokens;
    }
    const input = call.inputTokens ?? 0;
    const cached = call.cacheReadTokens ?? 0;
    return sum + Math.max(0, input - cached);
  }, 0);
  const costMeasured = measured.filter((call) => knownNumber(call.cost));
  const tokenWeightedHitRate =
    inputTokens > 0 ? cacheReadTokens / inputTokens : "unknown";
  const coverage = measured.length / calls.length;
  const warmMeasured = measured.filter(
    (call) => call.cacheClass === "warm_fanout",
  ).length;
  const meetsAcceptance =
    tokenWeightedHitRate === "unknown"
      ? "unknown"
      : warmMeasured >= AGENTIC_CACHE_ACCEPTANCE.minWarmCallsPerGroup &&
        coverage >= AGENTIC_CACHE_ACCEPTANCE.minMeasurementCoverage &&
        tokenWeightedHitRate >= AGENTIC_CACHE_ACCEPTANCE.minTokenWeightedHitRate;
  return {
    totalCalls: calls.length,
    measuredCalls: measured.length,
    unknownCalls,
    measurementCoverage: coverage,
    cacheReadTokens,
    inputTokens,
    uncachedInputTokens,
    tokenWeightedHitRate,
    cost:
      costMeasured.length === 0
        ? "unknown"
        : costMeasured.reduce((sum, call) => sum + (call.cost ?? 0), 0),
    meetsAcceptance,
  };
}
