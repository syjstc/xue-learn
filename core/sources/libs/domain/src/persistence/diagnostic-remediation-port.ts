export type DiagnosticRemediationWeakTarget = Readonly<{
  learningTargetId: string;
  title: string;
  score: number;
}>;

export type UpsertDiagnosticRemediationInput = Readonly<{
  userId: string;
  sourceUnitId: string;
  attemptId: string;
  weakTargets: readonly DiagnosticRemediationWeakTarget[];
}>;

export type ResolveDiagnosticRemediationInput = Readonly<{
  userId: string;
  sourceUnitId: string;
  completedAt: Date;
}>;

/** Owns adaptive-unit regeneration without touching historical evidence. */
export interface DiagnosticRemediationRepository {
  upsert(input: UpsertDiagnosticRemediationInput): Promise<string | null>;
  resolve(input: ResolveDiagnosticRemediationInput): Promise<void>;
}
