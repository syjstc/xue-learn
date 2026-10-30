/**
 * The successful KACOM expansion commit crosses the persistence boundary as
 * validated JSON envelopes. The generation kernel owns the authoritative
 * schema; this port owns only the transaction and lifecycle fence.
 */
export type PublishCognitiveModelExpansionInput = Readonly<{
  goalId: string;
  unitId: string;
  inputHash: string;
  buildToken: string;
  curriculumKey: string;
  language: string;
  moduleCapabilityRefsJson: string;
  moduleRole: string;
  proposalJson: string;
  externalEntitiesJson: string;
  generationAuditJson: string;
  /** Approved goal-scoped KACOM identities; no learner state or evidence. */
  pathEntityKeys?: readonly string[];
}>;

export type CognitiveModelPublicationResult = Readonly<{
  goalId: string;
  unitId: string;
  inputHash: string;
  status: "expanded";
  published: boolean;
  version: number;
}>;

/** Owns the complete successful unit-expansion publication transaction. */
export interface CognitiveModelPublicationRepository {
  ensureSkeleton(input: {
    goalId: string;
    inputHash: string;
  }): Promise<{
    goalId: string;
    inputHash: string;
    version: number;
    status: string;
    changed: boolean;
    candidateRevisionId: string | null;
  }>;
  publishExpandedUnit(
    input: PublishCognitiveModelExpansionInput,
  ): Promise<CognitiveModelPublicationResult>;
  publishMappingOnlyRevision(input: {
    goalId: string;
    reason: string;
  }): Promise<number>;
}
