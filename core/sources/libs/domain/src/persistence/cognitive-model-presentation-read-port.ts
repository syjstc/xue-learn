export type CognitiveModelRevisionReadRecord = Readonly<{
  version: number;
  status: string;
  scope: string;
  inputHash: string;
  snapshotSchemaVersion: number;
  isFullSnapshot: boolean;
  snapshotJson: unknown;
  auditJson: unknown;
  publishedAt: Date | null;
  createdAt: Date;
}>;

export type CognitiveModelGoalReadRecord = Readonly<{
  id: string;
  cognitiveModelStatus: string;
  cognitiveModelVersion: number;
  cognitiveModelInputHash: string;
  cognitiveModelPublishedHash: string | null;
  revisions: readonly CognitiveModelRevisionReadRecord[];
}>;

export type CognitiveModelUnitReadRecord = Readonly<{
  unitId: string;
  goalId: string;
  title: string;
  goalKind: string;
  learningMode: string;
  moduleUnlockStatus: string | null;
  moduleGenerationStatus: string | null;
  canonicalTargetCount: number;
  cognitiveModelStatus: string;
  cognitiveModelBuildInputHash: string | null;
  goalCognitiveModelStatus: string;
  goalCognitiveModelInputHash: string;
  goalCognitiveModelPublishedHash: string | null;
  revisions: readonly CognitiveModelRevisionReadRecord[];
}>;

/** Read-only last-good cognitive-model projection inputs. */
export interface CognitiveModelPresentationReadRepository {
  findGoal(input: {
    goalId: string;
  }): Promise<CognitiveModelGoalReadRecord | null>;
  findUnit(input: {
    unitId: string;
  }): Promise<CognitiveModelUnitReadRecord | null>;
}
