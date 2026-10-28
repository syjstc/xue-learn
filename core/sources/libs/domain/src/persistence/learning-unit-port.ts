export type LearningUnitCognitiveModelStatus =
  "pending" | "building" | "expanded" | "failed" | "provisional";

/**
 * The unit projection required to fingerprint and order a curriculum.
 *
 * JSON-backed planning references are normalized by an adapter before they
 * cross this boundary. Progress, authored content, assessment, and session
 * fields belong to later curriculum/GELC capabilities and are deliberately
 * not part of this port.
 */
export type LearningUnitRecord = Readonly<{
  id: string;
  goalId: string;
  curriculumKey: string;
  parentUnitId: string | null;
  unitKind: string;
  title: string;
  contentSummary: string;
  orderIndex: number;
  difficulty: string;
  prerequisites: string;
  planAreaRef: string;
  planningOutcomeRefs: readonly string[];
  cognitiveModelStatus: LearningUnitCognitiveModelStatus;
  cognitiveModelBuildStartedAt: Date | null;
  cognitiveModelBuildToken: string | null;
  cognitiveModelBuildInputHash: string | null;
}>;

export type InvalidateLearningUnitCognitiveModelInput = Readonly<{
  goalId: string;
  nextInputHash: string;
  preserveExpanded: boolean;
}>;

export type InvalidateLearningUnitCognitiveModelResult = Readonly<{
  resetCount: number;
  preservedExpandedCount: number;
}>;

export type UnitModulePromptContext = Readonly<{
  moduleTitle: string;
  moduleObjective: string;
  moduleCapabilityRefs: readonly string[];
  learningTargets: readonly Readonly<{
    localRef: string;
    role: string;
    title: string;
    learningObjective: string;
  }>[];
}>;

/**
 * Capability-specific persistence for curriculum structure and cognitive
 * invalidation state. This is intentionally not a generic unit repository:
 * there are no unconstrained create/update/delete/query operations here.
 */
export interface LearningUnitRepository {
  findModulePromptContext(
    unitId: string,
  ): Promise<UnitModulePromptContext | null>;
  listForCurriculum(goalId: string): Promise<readonly LearningUnitRecord[]>;
  invalidateCognitiveModel(
    input: InvalidateLearningUnitCognitiveModelInput,
  ): Promise<InvalidateLearningUnitCognitiveModelResult>;
  healCompletedStatuses(unitIds: readonly string[]): Promise<void>;
}
