export type ModuleDiagnosticTaskRecord = Readonly<{
  id: string;
  goalId: string;
  moduleId: string;
  context: string;
  createdAt: Date;
}>;

export type ModuleDiagnosticAttemptRecord = Readonly<{
  id: string;
  taskId: string;
  userId: string;
  status: string;
  context: string;
  response: string;
  startedAt: Date;
  submittedAt: Date | null;
}>;

export type ModuleDiagnosticReadRecord = Readonly<{
  moduleId: string;
  goalId: string;
  title: string;
  curriculumKey: string;
  goalTitle: string;
  goalContentLanguage: string;
  goalLevel: string;
  goalGenerationOptions: string;
  goalKind: string;
  goalUserId: string;
  unlockStatus: string;
  generationStatus: string;
  completionMethod: string | null;
  latestTask: ModuleDiagnosticTaskRecord | null;
  latestAttempt: ModuleDiagnosticAttemptRecord | null;
}>;

export type ModuleDiagnosticSubmissionRecord = Readonly<{
  task: ModuleDiagnosticTaskRecord;
  legacyAttempt: ModuleDiagnosticAttemptRecord | null;
  existingEvaluatedAttemptId: string | null;
}>;

/** Learner-owned module diagnostic reads; completion remains a separate port. */
export interface ModuleDiagnosticReadRepository {
  findModule(input: {
    userId: string;
    goalId: string;
    moduleId: string;
  }): Promise<ModuleDiagnosticReadRecord | null>;
  findSubmission(input: {
    userId: string;
    goalId: string;
    moduleId: string;
    attemptId: string;
  }): Promise<ModuleDiagnosticSubmissionRecord | null>;
}
