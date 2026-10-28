export interface PrerequisiteBridgeRepository {
  sync(input: {
    userId: string;
    goalId: string;
    moduleId: string;
    triggerAttemptId?: string;
  }): Promise<string | null>;
}
