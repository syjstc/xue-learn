export type DeepPlanningResearchLeaseContext = Readonly<{
  ownerKey: string;
  goalId?: string;
  moduleKey?: string;
}>;

export type DeepPlanningResearchConcurrencySnapshot = Readonly<{
  deepPlanningResearchConcurrency: number;
  updatedAt: Date;
  updatedByUserId: string | null;
  activeResearchCount: number;
  queuedResearchCount: number;
  expiredLeaseCount: number;
}>;

/** Owns the global deep-research queue, concurrency fence, and lease lifecycle. */
export interface DeepPlanningResearchRepository {
  getSnapshot(now: Date): Promise<DeepPlanningResearchConcurrencySnapshot>;
  updateConcurrency(input: {
    value: number;
    updatedByUserId: string;
    now: Date;
  }): Promise<void>;
  enqueue(
    input: DeepPlanningResearchLeaseContext & {
      id: string;
      now: Date;
    },
  ): Promise<void>;
  tryAcquire(input: {
    id: string;
    now: Date;
    expiresAt: Date;
  }): Promise<boolean>;
  cancelQueued(id: string, now: Date): Promise<void>;
  renew(input: { id: string; now: Date; expiresAt: Date }): Promise<boolean>;
  release(id: string, now: Date): Promise<void>;
}
