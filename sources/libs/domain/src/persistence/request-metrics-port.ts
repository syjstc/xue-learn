export type RequestMetricRecord = Readonly<{
  createdAt: Date;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}>;

/** Bounded observability read; aggregation remains deterministic application logic. */
export interface RequestMetricsRepository {
  listSince(since: Date): Promise<readonly RequestMetricRecord[]>;
}
