export interface ProjectExperienceRepository {
  listProjects(input: { userId: string; goalId: string }): Promise<readonly Readonly<Record<string, unknown>>[] | null>;
  findProject(input: { userId: string; projectId: string }): Promise<Readonly<Record<string, unknown>> | null>;
  listPendingReviewAttempts(input: { limit: number }): Promise<readonly Readonly<Record<string, unknown>>[]>;
  findPendingReviewAttempt(attemptId: string): Promise<Readonly<Record<string, unknown>> | null>;
  findOwnedMilestone(input: { userId: string; projectId: string; milestoneId: string }): Promise<Readonly<Record<string, unknown>> | null>;
  findAttemptOwner(attemptId: string): Promise<string | null>;
  runDeterministicRubric(input: { userId: string; attemptId: string }): Promise<{
    attemptStatus: string;
    completedAt: Date | null;
    observations: readonly Readonly<Record<string, unknown>>[];
  }>;
  createAdminTestProject(input: {
    goalId: string;
    mode: "fixture" | "from_model";
  }): Promise<Readonly<Record<string, unknown>>>;
  recordAuthoritativeObservation(input: {
    actorRef: string;
    userId: string;
    attemptId: string;
    requirementId: string;
    score: number;
    evaluatorRunId: string;
    rawResult?: Readonly<Record<string, unknown>>;
    metadata?: Readonly<Record<string, unknown>>;
  }): Promise<Readonly<Record<string, unknown>>>;
}
