import type { CognitiveDimension } from "../module-objective-authority.js";

export type AssessmentTargetEntityKind =
  "atom" | "concept" | "skill" | "competency";

export type AssessmentTargetRecord = Readonly<{
  id: string;
  localRef: string;
  title: string;
  description: string;
  learningObjective: string;
  assessmentCriteria: readonly Readonly<{ ref: string; text: string }>[];
  required: boolean;
  weight: number;
  role: string;
  isEntry: boolean;
  isExit: boolean;
  importance: "core" | "supporting" | "enrichment";
  importanceWeight: number;
  difficulty: "easy" | "medium" | "hard";
  targetCognitiveLevel:
    "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
  estimatedMinutes: number;
  requirements: readonly Readonly<{
    cognitiveEntityId: string;
    entityKind: AssessmentTargetEntityKind;
    entityDefinitionVersion: number;
    dimension: CognitiveDimension;
    required: boolean;
    gate: boolean;
    weight: number;
    threshold: number;
  }>[];
}>;

/** Read-only target bindings shared by adaptive and diagnostic assessment. */
export interface AssessmentTargetRepository {
  ensureQuizAssessableForUnit(input: {
    userId: string;
    unitId: string;
  }): Promise<readonly AssessmentTargetRecord[]>;
  ensureQuizAssessableForModule(input: {
    userId: string;
    moduleId: string;
  }): Promise<readonly AssessmentTargetRecord[]>;
  findForUnit(input: {
    userId: string;
    unitId: string;
  }): Promise<readonly AssessmentTargetRecord[]>;
  findForModule(input: {
    userId: string;
    moduleId: string;
    role?: "entry" | "exit";
  }): Promise<readonly AssessmentTargetRecord[]>;
  findForGoal(input: {
    userId: string;
    goalId: string;
  }): Promise<readonly AssessmentTargetRecord[]>;
}
