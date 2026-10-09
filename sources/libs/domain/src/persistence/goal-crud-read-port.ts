export interface GoalCrudReadRepository {
  listFoundationGoals(userId: string, parentGoalId: string): Promise<any[]>;
  listOwnedOverview(userId: string): Promise<Readonly<{ goals: any[]; units: any[]; modules: any[]; pendingShares: any[] }>>;
  findDetail(userId: string, goalId: string): Promise<any | null>;
  findCognitiveStatus(userId: string, goalId: string): Promise<any | null>;
}
