/** Learner-facing module projection assembled at the persistence boundary. */
export interface GoalModuleReadRepository {
  listJourney(goalId: string): Promise<any[]>;
  findDetail(goalId: string, moduleId: string): Promise<any | null>;
  findCognitive(userId: string, goalId: string, moduleId: string): Promise<any | null>;
  listActiveRelations(entityIds: readonly string[]): Promise<any[]>;
  findModule(goalId: string, moduleId: string): Promise<any | null>;
  listForReplan(goalId: string): Promise<any[]>;
  listReadinessCandidates(goalId: string): Promise<any[]>;
  settleReadinessFailure(input: Readonly<{ moduleId: string; goalId: string; currentError: string | null; failureReason: string; eventType: string; retryLimit: number }>): Promise<"retried" | "failed">;
  markReadinessReady(moduleId: string): Promise<void>;
}
