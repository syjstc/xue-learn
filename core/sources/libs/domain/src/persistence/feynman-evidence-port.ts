export type FeynmanEvidenceJsonObject = Readonly<Record<string, unknown>>;

export type FeynmanEvidenceRequirement = Readonly<{
  cognitiveEntityId: string;
  learningTargetId: string;
  dimension: "understanding";
  criterionRef: string;
  definitionVersion: number;
  required: boolean;
  weight: number;
  orderIndex: number;
  rubricCriterion: FeynmanEvidenceJsonObject;
}>;

export type FeynmanEvidenceTask = Readonly<{
  stableKey: string;
  targetId: string;
  title: string;
  instructions: string;
  definitionVersion: number;
  requirements: readonly FeynmanEvidenceRequirement[];
}>;

export type FeynmanEvidenceObservation = Readonly<{
  task: FeynmanEvidenceTask;
  criterionRef: string;
  score: number;
  rationale: string;
}>;

export type RecordFeynmanEvidenceInput = Readonly<{
  userId: string;
  goalId: string;
  unitId: string;
  userText: string;
  feedback: FeynmanEvidenceJsonObject;
  passed: boolean;
  observations: readonly FeynmanEvidenceObservation[];
}>;

export type RecordFeynmanEvidenceResult = Readonly<{
  feynmanSessionId: string;
  observationCount: number;
}>;

/**
 * Atomic hosted persistence for one deterministic Feynman evaluation.
 * Implementations own the session, task declarations, attempts, evidence
 * claims, and learner-state projection in one transaction.
 */
export interface FeynmanEvidenceRepository {
  record(
    input: RecordFeynmanEvidenceInput,
  ): Promise<RecordFeynmanEvidenceResult>;
}
