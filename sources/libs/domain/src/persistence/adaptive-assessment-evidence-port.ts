export type AdaptiveAssessmentEvidenceRecord = Readonly<{
  learningTargetId: string | null;
  cognitiveEntityId: string;
  dimension: string;
  contextKey: string;
  evaluatorReliability: number;
  groundingReliability: number;
  observation: Readonly<{
    observedAt: Date;
    metadata: unknown;
    attempt: Readonly<{
      assistanceLevel: number;
      task: Readonly<{
        taskType: string;
        origin: string;
      }>;
    }>;
  }>;
}>;

/** Read-only evidence projection used to plan adaptive assessment slots. */
export interface AdaptiveAssessmentEvidenceRepository {
  findActive(input: {
    userId: string;
    learningTargetIds: readonly string[];
    asOf?: Date;
  }): Promise<readonly AdaptiveAssessmentEvidenceRecord[]>;
}
