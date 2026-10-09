export type AiGenerationRunRecord = Readonly<{
  id: string;
  userId: string | null;
  scope: string;
  scopeId: string;
  operation: string;
  status: string;
  eventsJson: string;
  tokenPreview: string;
  statusMessage: string;
  resultJson: string;
  errorMessage: string | null;
  nextEventSequence: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type AiGenerationRunEventRecord = Readonly<{
  sequence: number;
  type: string;
  payload: string;
  snapshotKey: string | null;
}>;

export interface AiGenerationRunRepository {
  appendContentVerificationAudit(input: {
    runId: string;
    artifactKind: string;
    mode: string;
    status: string;
    provider: string;
    model: string;
    blockCount: number;
    repairedCount: number;
    issuesJson: string;
    createdAt: Date;
  }): Promise<void>;
  create(input: {
    id: string;
    userId: string | null;
    scope: string;
    scopeId: string;
    operation: string;
    now: Date;
  }): Promise<void>;
  find(runId: string): Promise<AiGenerationRunRecord | null>;
  updateScopeId(runId: string, scopeId: string): Promise<void>;
  listRunning(input: {
    scope: string;
    scopeId: string;
    operation?: string;
    userId?: string;
  }): Promise<readonly AiGenerationRunRecord[]>;
  listEventsAfter(
    runId: string,
    sequence: number,
  ): Promise<readonly AiGenerationRunEventRecord[]>;
  touchRunning(runId: string, now: Date): Promise<boolean>;
  appendEvent(input: {
    runId: string;
    type: string;
    payload: string;
    snapshotKey?: string;
    tokenDelta?: string;
    statusMessage?: string;
    now: Date;
  }): Promise<AiGenerationRunEventRecord | null>;
  transition(input: {
    runId: string;
    status: "completed" | "cancelled" | "error";
    type: string;
    payload: string;
    statusMessage?: string;
    errorMessage?: string;
    resultJson?: string;
    staleBefore?: Date;
    now: Date;
  }): Promise<AiGenerationRunEventRecord | null>;
  failRunningLlmRequests(runId: string, message: string): Promise<void>;
  recoverInterrupted(message: string, eventPayload: string): Promise<{
    runs: number;
    llmLogs: number;
  }>;
}
