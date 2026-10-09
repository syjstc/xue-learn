export type AdaptiveAssessmentTaskRequirement = Readonly<{
  learningTargetId: string;
  cognitiveEntityId: string;
  dimension: string;
  criterionRef: string;
  definitionVersion: number;
  role?: "primary" | "supporting";
  required: boolean;
  weight: number;
  orderIndex: number;
  rubricCriterion: Readonly<Record<string, unknown>>;
}>;

export type AdaptiveAssessmentTaskDeclaration = Readonly<{
  slotId: string;
  goalId: string;
  moduleId?: string;
  unitId?: string;
  stableKey: string;
  taskType: "diagnostic";
  title: string;
  instructions: string;
  context: Readonly<Record<string, unknown>>;
  rubric: Readonly<Record<string, unknown>>;
  difficulty: string;
  definitionVersion: number;
  origin: "adaptive_assessment_v2";
  evidencePolicy: Readonly<Record<string, unknown>>;
  requirements: readonly AdaptiveAssessmentTaskRequirement[];
}>;

export type AdaptiveAssessmentTaskRecord = Readonly<{
  slotId: string;
  taskId: string;
}>;

/** Atomically materializes adaptive assessment task blueprints. */
export interface AdaptiveAssessmentTaskRepository {
  publishTasks(input: {
    userId: string;
    goalId: string;
    moduleId?: string;
    unitId?: string;
    purpose: "mastery" | "readiness";
    tasks: readonly AdaptiveAssessmentTaskDeclaration[];
  }): Promise<readonly AdaptiveAssessmentTaskRecord[]>;
}
