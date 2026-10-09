export type ModuleGenerationRetryInput = Readonly<{
  userId: string;
  goalId: string;
  moduleId: string;
}>;

export type ModuleGenerationRetryRecord = Readonly<{
  enqueued: boolean;
  status: string;
  rearmed?: boolean;
  /** True when an existing unpublished expand event was made due again. */
  nudged?: boolean;
}>;

/** Owner-scoped recovery of an unlocked sequential module's generation work. */
export interface ModuleGenerationRetryRepository {
  retryOwned(
    input: ModuleGenerationRetryInput,
  ): Promise<ModuleGenerationRetryRecord>;
}
