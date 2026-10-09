export type LlmRouteRecord = Readonly<{
  provider: string;
  operationKey: string;
  model: string;
  reasoningMode: string;
  updatedAt: Date;
  updatedByUserId: string | null;
}>;

export type LlmRouteChange =
  | Readonly<{ action: "remove"; provider: string; operationKey: string }>
  | Readonly<{
      action: "upsert";
      provider: string;
      operationKey: string;
      model: string;
      reasoningMode: string;
    }>;

export interface LlmRoutingRepository {
  listRoutes(): Promise<readonly LlmRouteRecord[]>;
  applyChanges(
    changes: readonly LlmRouteChange[],
    updatedByUserId: string,
  ): Promise<void>;
}
