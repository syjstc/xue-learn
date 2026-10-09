export type UnitDiagnosticAttemptRecord = Readonly<{
  id: string;
  status: string;
  questions: string;
  results: string;
  perLearningTargetResults: string;
  overallScore: number | null;
  passed: boolean | null;
  createdAt: Date;
  submittedAt: Date | null;
}>;

export type UnitDiagnosticReadRecord = Readonly<{
  unitId: string;
  goalId: string;
  goalKind: string;
  learningMode: string;
  unitKind: string;
  status: string;
  completionMethod: string | null;
  childCount: number;
  remediationUnitId: string | null;
  latestAttempt: UnitDiagnosticAttemptRecord | null;
}>;

/** Learner-owned diagnostic query surface; completion remains a separate port. */
export interface UnitDiagnosticReadRepository {
  listGoalUnits(input: {
    userId: string;
    goalId: string;
  }): Promise<readonly Readonly<{
    id: string;
    parentUnitId: string | null;
    unitKind: string;
    orderIndex: number;
    status: string;
  }>[] >;
  findUnit(input: {
    userId: string;
    unitId: string;
  }): Promise<UnitDiagnosticReadRecord | null>;
  findAttempt(input: {
    userId: string;
    unitId: string;
    attemptId: string;
  }): Promise<UnitDiagnosticAttemptRecord | null>;
}
