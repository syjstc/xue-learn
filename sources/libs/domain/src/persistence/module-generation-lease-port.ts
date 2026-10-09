export type ModuleGenerationLeaseClaimInput = Readonly<{
  goalId: string;
  moduleId: string;
  token: string;
  startedAt: Date;
  allowLockedBeforeNavigation: boolean;
}>;

export type ModuleGenerationLeaseClaimRecord = Readonly<{
  claimed: boolean;
}>;

export type ModuleGenerationLeaseFailureInput = Readonly<{
  goalId: string;
  moduleId: string;
  token: string;
  message: string;
}>;

export type ModuleGenerationLeaseFailureRecord = Readonly<{
  applied: boolean;
}>;

export type ModuleGenerationLeaseReleaseInput = Readonly<{
  goalId: string;
  moduleId: string;
  token: string;
}>;

export type ModuleGenerationLeaseReleaseRecord = Readonly<{
  applied: boolean;
}>;

/** Internal outbox-worker claim of a sequential module generation lease. */
export interface ModuleGenerationLeaseRepository {
  claim(
    input: ModuleGenerationLeaseClaimInput,
  ): Promise<ModuleGenerationLeaseClaimRecord>;
  fail(
    input: ModuleGenerationLeaseFailureInput,
  ): Promise<ModuleGenerationLeaseFailureRecord>;
  release(
    input: ModuleGenerationLeaseReleaseInput,
  ): Promise<ModuleGenerationLeaseReleaseRecord>;
  loadContext(input: Readonly<{ goalId: string; moduleId: string; priorEntityLimit: number }>): Promise<any | null>;
  markExistingExplorationReady(moduleId: string): Promise<void>;
  rearmFailedUnits(moduleId: string): Promise<void>;
  setGenerationInputHash(moduleId: string, inputHash: string): Promise<void>;
  loadGenerationHashContexts(goalId: string): Promise<readonly any[]>;
}
