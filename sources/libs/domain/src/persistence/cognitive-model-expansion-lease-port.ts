export type ClaimCognitiveModelExpansionInput = Readonly<{
  userId: string;
  goalId: string;
  unitId: string;
  inputHash: string;
  token: string;
  startedAt: Date;
  staleBefore: Date;
  hasLearningTargets: boolean;
}>;

export type ClaimCognitiveModelExpansionResult = Readonly<{
  status: "claimed" | "join" | "complete";
}>;

/**
 * Owns only the goal/unit expansion lease. KACOM targets, entities, relations,
 * revisions, and snapshots remain outside this boundary.
 */
export interface CognitiveModelExpansionLeaseRepository {
  claim(
    input: ClaimCognitiveModelExpansionInput,
  ): Promise<ClaimCognitiveModelExpansionResult>;
  readState(input: {
    goalId: string;
    unitId: string;
  }): Promise<{
    unitStatus: string;
    unitInputHash: string | null;
    goalVersion: number;
    goalInputHash: string;
    goalPublishedHash: string;
    goalStatus: string;
  } | null>;
  fail(input: {
    goalId: string;
    unitId: string;
    inputHash: string;
    token: string;
    message: string;
    planningCoverageGap?: Readonly<{ affectedUnitIds: readonly string[] }>;
  }): Promise<void>;
}
