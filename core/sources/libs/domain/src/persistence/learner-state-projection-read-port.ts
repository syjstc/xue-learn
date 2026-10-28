export type LearnerStateDimensionReadRecord = Readonly<{
  dimension: string;
  estimate: number | null;
  evidenceSufficiency: number;
  evidenceSufficiencyReasons: unknown;
  status: string;
  effectiveEvidenceWeight: number;
  lastObservedAt: Date | null;
}>;

export type LearnerStateProjectionReadRecord = Readonly<{
  cognitiveEntityId: string;
  overallEstimate: number | null;
  evidenceSufficiency: number;
  status: string;
  inferencePolicyVersion: number;
  stateRevision: number;
  evidenceCutoffAt: Date | null;
  lifecycleCutoffAt: Date | null;
  dimensions: readonly LearnerStateDimensionReadRecord[];
}>;

export type LearnerCognitivePromptStateRecord = Readonly<{
  entity: Readonly<{ id: string; title: string; kind: string }>;
  state: LearnerStateProjectionReadRecord;
  latestEvidence: string | null;
}>;

/**
 * Read-only access to owner-scoped learner-state projections.
 * In-scope entities without a materialized row are unobserved; incomplete
 * materializations and out-of-scope ids return null so callers can replay
 * or fail closed.
 */
export interface LearnerStateProjectionReadRepository {
  listPromptStates(input: {
    userId: string;
    goalId?: string;
    asOf: Date;
  }): Promise<readonly LearnerCognitivePromptStateRecord[]>;
  findMany(input: {
    userId: string;
    cognitiveEntityIds: readonly string[];
    asOf: Date;
  }): Promise<readonly LearnerStateProjectionReadRecord[] | null>;
}
