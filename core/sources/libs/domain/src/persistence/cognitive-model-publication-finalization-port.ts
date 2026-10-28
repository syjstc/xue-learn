export type FinalizeCognitiveModelPublicationInput = Readonly<{
  goalId: string;
  unitId: string;
  inputHash: string;
  /** Snapshot assembled from the already-expanded objective rows. */
  snapshotJson: string;
  auditJson: string;
  /** Guards against publishing a snapshot from a different curriculum state. */
  allExpanded: boolean;
}>;

export type CognitiveModelPublicationFinalizationResult = Readonly<{
  goalId: string;
  unitId: string;
  inputHash: string;
  status: "already_expanded";
  published: true;
  version: number;
}>;

/** Owns the atomic finalization of an already-expanded cognitive-model build. */
export interface CognitiveModelPublicationFinalizationRepository {
  finalize(
    input: FinalizeCognitiveModelPublicationInput,
  ): Promise<CognitiveModelPublicationFinalizationResult | null>;
  promoteExisting(input: {
    goalId: string;
    unitId: string;
    inputHash: string;
  }): Promise<CognitiveModelPublicationFinalizationResult | null>;
}
