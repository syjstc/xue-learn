/** Narrow query surface consumed by capability composition. */
export type LearningSystemPersistenceClient = {
  /** Actual ready content from strictly earlier lessons, never planned titles alone. */
  priorTeaching?: { findMany(input: { userId: string; unitId: string }): Promise<Array<{ title: string; blocks: unknown; keyTakeaways: unknown; contentRevision: number }>> };
  learningSystemAvailability: { findUnique(args: any): Promise<any> };
  goalLearningSystemBinding: { findFirst(args: any): Promise<any> };
  learningGoal: { findFirst(args: any): Promise<any>; findMany(args: any): Promise<any[]>; findUnique(args: any): Promise<any> };
  learningUnit: { findFirst(args: any): Promise<any>; findMany(args: any): Promise<any[]> };
  learningModule: {
    findMany(args: any): Promise<any[]>;
    findFirst(args: any): Promise<any>;
  };
  unitSessionState: { findFirst(args: any): Promise<any>; findMany(args: any): Promise<any[]> };
  goalCreationSession: { findUnique(args: any): Promise<any> };
  taskAttempt: { findMany(args: any): Promise<any[]> };
  unitScenarioTheater: { findUnique(args: any): Promise<any> };
  scenarioTheaterRun: { findFirst(args: any): Promise<any> };
  globalGenerationSettings: { findUnique(args: any): Promise<any> };
};
