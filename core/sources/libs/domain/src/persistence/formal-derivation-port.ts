export type FormalDerivationRunStatus =
  | "draft"
  | "running"
  | "validating"
  | "complete"
  | "needs_attention"
  | "cancelled"
  | "failed";

export type FormalDerivationRunRecord = Readonly<{
  id: string;
  title: string;
  locale: string;
  schemaVersion: number;
  promptVersion: string;
  requirementJson: string;
  documentJson: string;
  eventsJson: string;
  nextEventSequence: number;
  status: FormalDerivationRunStatus;
  revision: number;
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

export type FormalDerivationStepRecord = Readonly<{
  id: string;
  runId: string;
  ordinal: number;
  baseRevision: number;
  afterRevision: number;
  kind: string;
  actionsJson: string;
  presentationJson: string;
  metadataJson: string;
  createdAt: Date;
}>;

export type FormalDerivationCheckpointRecord = Readonly<{
  id: string;
  runId: string;
  stepOrdinal: number;
  revision: number;
  stateJson: string;
  createdAt: Date;
}>;

export type FormalDerivationEventRecord = Readonly<{
  sequence: number;
  eventJson: string;
}>;

export type CreateFormalDerivationRunInput = Readonly<{
  id: string;
  title: string;
  locale: string;
  schemaVersion: number;
  promptVersion: string;
  requirementJson: string;
  documentJson: string;
  status?: FormalDerivationRunStatus;
  operation: string;
  ownerUserId?: string | null;
  unitId?: string | null;
  sectionId?: string | null;
  now: Date;
}>;

export type UpdateFormalDerivationRunInput = Readonly<{
  id: string;
  status?: FormalDerivationRunStatus;
  revision?: number;
  documentJson?: string;
  validationSummaryJson?: string | null;
  tokenSummaryJson?: string | null;
  routedProvider?: string | null;
  routedModel?: string | null;
  completedAt?: Date | null;
  now: Date;
}>;

export type AppendFormalDerivationStepInput = Readonly<{
  runId: string;
  expectedRevision: number;
  documentJson: string;
  revision: number;
  step: Omit<FormalDerivationStepRecord, "createdAt">;
  checkpoint?: Omit<FormalDerivationCheckpointRecord, "createdAt">;
  now: Date;
}>;

export type ReplaceFormalDerivationStepsInput = Readonly<{
  runId: string;
  expectedRevision: number;
  documentJson: string;
  revision: number;
  steps: ReadonlyArray<Omit<FormalDerivationStepRecord, "createdAt">>;
  now: Date;
}>;

/** Durable admin derivation runs, semantic steps, checkpoints, and SSE audit. */
export interface FormalDerivationRepository {
  createRun(input: CreateFormalDerivationRunInput): Promise<void>;
  getRun(id: string): Promise<FormalDerivationRunRecord | null>;
  listRuns(limit?: number): Promise<readonly FormalDerivationRunRecord[]>;
  listRunsBySection(
    sectionId: string,
    limit?: number,
  ): Promise<readonly FormalDerivationRunRecord[]>;
  updateRun(input: UpdateFormalDerivationRunInput): Promise<boolean>;
  appendStep(input: AppendFormalDerivationStepInput): Promise<boolean>;
  replaceSteps(input: ReplaceFormalDerivationStepsInput): Promise<boolean>;
  listSteps(runId: string): Promise<readonly FormalDerivationStepRecord[]>;
  listCheckpoints(
    runId: string,
  ): Promise<readonly FormalDerivationCheckpointRecord[]>;
  appendEvent(input: {
    runId: string;
    eventJson: string;
    now: Date;
  }): Promise<FormalDerivationEventRecord>;
  listEvents(
    runId: string,
    afterSequence?: number,
  ): Promise<readonly FormalDerivationEventRecord[]>;
  saveCheckpoint(
    input: Omit<FormalDerivationCheckpointRecord, "createdAt"> & { now: Date },
  ): Promise<void>;
}
