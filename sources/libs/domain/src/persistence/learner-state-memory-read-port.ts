export type LearnerStateMemoryReadRecord = Readonly<{
  userId: string;
  schemaVersion: number;
  sourceSchemaVersion: number;
  inferencePolicyVersion: number;
  sourceFingerprint: string;
  sourceRevisionCutoffAt: Date | null;
  stateJson: unknown;
  refreshedAt: Date | null;
  invalidatedAt: Date | null;
  nextRefreshAt: Date | null;
  lastRefreshReason: string;
  lastError: string;
}>;

/** Read-only access to the rebuildable global learner-state memory cache. */
export interface LearnerStateMemoryReadRepository {
  findByUser(input: {
    userId: string;
  }): Promise<LearnerStateMemoryReadRecord | null>;
}
