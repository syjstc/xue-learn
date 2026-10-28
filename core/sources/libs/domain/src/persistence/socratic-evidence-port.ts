export type SocraticEvidenceJsonObject = Readonly<Record<string, unknown>>;

export type SocraticEvidenceDimension = "understanding" | "independence";

export type SocraticEvidenceRequirement = Readonly<{
  cognitiveEntityId: string;
  learningTargetId?: string;
  dimension: SocraticEvidenceDimension;
  criterionRef: string;
  definitionVersion: number;
  required: boolean;
  weight: number;
  orderIndex: number;
  rubricCriterion?: SocraticEvidenceJsonObject;
}>;

export type SocraticEvidenceTask = Readonly<{
  stableKey: string;
  targetId: string;
  title: string;
  instructions: string;
  definitionVersion: number;
  requirements: readonly SocraticEvidenceRequirement[];
}>;

export type RecordSocraticEvidenceInput = Readonly<{
  userId: string;
  goalId: string;
  unitId: string;
  threadId: string;
  turn: number;
  answer: string;
  resolved: boolean;
  terminatedByLimit: boolean;
  task: SocraticEvidenceTask;
}>;

export type RecordSocraticEvidenceResult = Readonly<{
  observationCount: number;
}>;

/**
 * Atomic hosted persistence for one Socratic turn. Implementations own the
 * immutable task declaration, evaluated attempt, verified observation/claim,
 * and learner-state replay; the runtime owns their transaction.
 */
export interface SocraticEvidenceRepository {
  record(
    input: RecordSocraticEvidenceInput,
  ): Promise<RecordSocraticEvidenceResult>;
}
