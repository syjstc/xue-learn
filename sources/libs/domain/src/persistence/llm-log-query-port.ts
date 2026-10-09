export type LlmLogQueryFilter = Readonly<{
  operationContains?: string;
  kind?: string;
  spanType?: string;
  status?: string;
  provider?: string;
  traceId?: string;
  traceIdPresent?: boolean;
  goalId?: string;
  goalIds?: readonly string[];
  scope?: string;
  parentId?: string;
  createdAtGte?: Date;
  structuredOnly?: boolean;
}>;

export interface LlmLogQueryRepository {
  recoverRunningBefore(input: Readonly<{
    cutoff: Date;
    error: string;
    durationMs: number;
  }>): Promise<number>;
  count(filter: LlmLogQueryFilter): Promise<number>;
  list(input: {
    filter?: LlmLogQueryFilter;
    order?: "asc" | "desc";
    offset?: number;
    limit?: number;
  }): Promise<readonly Readonly<Record<string, unknown>>[]>;
  find(id: string): Promise<Readonly<Record<string, unknown>> | null>;
  deleteAll(): Promise<number>;
  groupGoals(limit: number): Promise<readonly Readonly<{
    goalId: string;
    logCount: number;
    lastAt: Date;
  }>[] >;
  findGoals(ids: readonly string[]): Promise<readonly Readonly<{
    id: string;
    title: string;
  }>[] >;
  findGoal(id: string): Promise<Readonly<{ id: string; title: string }> | null>;
  listCreditUsage(logIds: readonly string[]): Promise<readonly Readonly<{
    llmRequestLogId: string | null;
    amount: number;
  }>[] >;
  summarizeLocalTokenUsage(days: number): Promise<
    Readonly<{
      models: readonly Readonly<Record<string, unknown>>[];
      daily: readonly Readonly<Record<string, unknown>>[];
      pricing: readonly Readonly<Record<string, unknown>>[];
    }>
  >;
  upsertLocalModelPricing(
    input: Readonly<{
      provider: string;
      model: string;
      uncachedInputUsdPerMillion: number;
      cachedInputUsdPerMillion: number;
      outputUsdPerMillion: number;
    }>,
  ): Promise<void>;
  deleteLocalModelPricing(provider: string, model: string): Promise<void>;
}
