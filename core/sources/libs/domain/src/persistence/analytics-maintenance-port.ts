export interface AnalyticsMaintenanceRepository {
  deleteGenerationEvents(cutoff: Date): Promise<number>;
  retainCognitiveModelRevisions(input: Readonly<{ staleCandidateCutoff: Date; supersededToKeep: number }>): Promise<Readonly<{ deletedSuperseded: number; deletedStaleCandidates: number; compactedFailed: number }>>;
  pruneObservability(input: Readonly<{ apiCutoff: Date; llmCutoff: Date; backendErrorCutoff: Date; maxBackendErrorGroups: number }>): Promise<Readonly<{ deletedApiLogs: number; deletedLlmLogs: number; deletedBackendErrorGroups: number; prunedBackendErrorGroups: number }>>;
}
