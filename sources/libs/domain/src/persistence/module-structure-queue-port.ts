export type ModuleStructureQueueInput = Readonly<{
  userId: string;
  goalId: string;
}>;

export type ModuleStructureQueueRecord = Readonly<{
  enqueuedCount: number;
}>;

/** Owner-scoped queueing of sequential module structure preparation. */
export interface ModuleStructureQueueRepository {
  enqueueOwned(
    input: ModuleStructureQueueInput,
  ): Promise<ModuleStructureQueueRecord>;
  enqueueInitialKacom(goalId: string): Promise<Readonly<{
    enqueued: boolean;
    moduleId?: string;
    authorizeExpansion?: boolean;
  }>>;
}
