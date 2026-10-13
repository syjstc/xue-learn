export type TeachingDerivationRunStatus =
  | "draft"
  | "running"
  | "validating"
  | "complete"
  | "needs_attention"
  | "cancelled"
  | "failed";

export type TeachingDerivationRunRecord = Readonly<{
  id: string;
  title: string;
  locale: string;
  schemaVersion: number;
  promptVersion: string;
  requirementJson: string;
  documentJson: string;
  derivedJson: string;
  eventsJson: string;
  nextEventSequence: number;
  parserVersion: string;
  analyzerVersion: string;
  matcherVersion: string;
  compilerVersion: string;
  status: TeachingDerivationRunStatus;
  revision: number;
  repairAttempts: number;
  generationToken: string | null;
  operation: string;
  routedProvider: string | null;
  routedModel: string | null;
  validationSummaryJson: string | null;
  tokenSummaryJson: string | null;
  ownerUserId: string | null;
  unitId: string | null;
  sectionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}>;

export type TeachingDerivationStepRecord = Readonly<{
  id: string;
  runId: string;
  ordinal: number;
  stepJson: string;
  derivedJson: string;
  createdAt: Date;
}>;

export type TeachingDerivationEventRecord = Readonly<{
  sequence: number;
  eventJson: string;
}>;

export type CreateTeachingDerivationRunInput = Readonly<{
  id: string;
  title: string;
  locale: string;
  schemaVersion: number;
  promptVersion: string;
  requirementJson: string;
  documentJson: string;
  derivedJson?: string;
  parserVersion: string;
  analyzerVersion: string;
  matcherVersion: string;
  compilerVersion: string;
  status?: TeachingDerivationRunStatus;
  generationToken?: string | null;
  operation: string;
  ownerUserId?: string | null;
  unitId?: string | null;
  sectionId?: string | null;
  now: Date;
}>;

export type UpdateTeachingDerivationRunInput = Readonly<{
  id: string;
  /** Optional CAS fence. Omission preserves historical callers. */
  expectedGenerationToken?: string | null;
  status?: TeachingDerivationRunStatus;
  revision?: number;
  repairAttempts?: number;
  documentJson?: string;
  derivedJson?: string;
  generationToken?: string | null;
  validationSummaryJson?: string | null;
  tokenSummaryJson?: string | null;
  routedProvider?: string | null;
  routedModel?: string | null;
  completedAt?: Date | null;
  now: Date;
}>;

export type AppendTeachingDerivationStepInput = Readonly<{
  runId: string;
  expectedRevision: number;
  expectedGenerationToken?: string | null;
  documentJson: string;
  derivedJson: string;
  revision: number;
  repairAttempts: number;
  step: Omit<TeachingDerivationStepRecord, "createdAt">;
  now: Date;
}>;

/** Durable teaching-derivation runs and published snapshots. Independent of formal derivation. */
export interface TeachingDerivationRepository {
  createRun(input: CreateTeachingDerivationRunInput): Promise<void>;
  getRun(id: string): Promise<TeachingDerivationRunRecord | null>;
  listRunsBySection(
    sectionId: string,
    limit?: number,
  ): Promise<readonly TeachingDerivationRunRecord[]>;
  updateRun(input: UpdateTeachingDerivationRunInput): Promise<boolean>;
  appendStep(input: AppendTeachingDerivationStepInput): Promise<boolean>;
  getStepByOrdinal(
    runId: string,
    ordinal: number,
  ): Promise<TeachingDerivationStepRecord | null>;
  listSteps(runId: string): Promise<readonly TeachingDerivationStepRecord[]>;
  appendEvent(input: {
    runId: string;
    eventJson: string;
    now: Date;
  }): Promise<TeachingDerivationEventRecord>;
}
