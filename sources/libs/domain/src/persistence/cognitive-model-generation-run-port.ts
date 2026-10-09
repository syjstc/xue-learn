export type CognitiveModelRunStatus = "running" | "completed" | "error";

export type StartCognitiveModelRunInput = Readonly<{
  userId: string | null;
  unitId: string;
  statusMessage: string;
}>;

export type CognitiveModelRunRecord = Readonly<{
  id: string;
  status: CognitiveModelRunStatus;
}>;

export type FindCognitiveModelRunInput = Readonly<{
  unitId: string;
  statuses: readonly CognitiveModelRunStatus[];
}>;

export type ReadCognitiveModelRunEventInput = Readonly<{
  runId: string;
  type: string;
}>;

export type CognitiveModelRunEventRecord = Readonly<{
  payloadJson: string;
}>;

export type AppendCognitiveModelRunEventInput = Readonly<{
  runId: string;
  type: string;
  payloadJson: string;
  snapshotKey?: string;
}>;

export type FinishCognitiveModelRunInput = Readonly<{
  runId: string;
  status: Exclude<CognitiveModelRunStatus, "running">;
  resultJson?: string;
}>;

/** Owns only unit cognitive-generation run/event lifecycle rows. */
export interface CognitiveModelGenerationRunRepository {
  start(input: StartCognitiveModelRunInput): Promise<CognitiveModelRunRecord>;
  findLatest(
    input: FindCognitiveModelRunInput,
  ): Promise<CognitiveModelRunRecord | null>;
  readLatestEvent(
    input: ReadCognitiveModelRunEventInput,
  ): Promise<CognitiveModelRunEventRecord | null>;
  appendEvent(input: AppendCognitiveModelRunEventInput): Promise<boolean>;
  finish(input: FinishCognitiveModelRunInput): Promise<boolean>;
}
