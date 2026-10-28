export type CognitiveModelExpansionCurriculumUnit = Readonly<{
  id: string;
  curriculumKey: string;
  parentUnitId: string | null;
  moduleId: string | null;
  unitKind: string;
  title: string;
  contentSummary: string;
  orderIndex: number;
  difficulty: string;
  prerequisites: string;
  planAreaRef?: string;
  planningOutcomeRefs: unknown;
}>;

export type CognitiveModelExpansionEntity = Readonly<{
  id: string;
  stableKey: string;
  kind: string;
  title: string;
  description: string;
  provenance: unknown;
}>;

export type CognitiveModelExpansionContext = Readonly<{
  unit: Readonly<{
    id: string;
    goalId: string;
    moduleId: string | null;
    parentUnitId: string | null;
    unitKind: string;
    curriculumKey: string;
    title: string;
    contentSummary: string;
    prerequisites: string;
    planningOutcomeRefs: unknown;
    moduleCapabilityRefs: unknown;
    moduleMilestoneRole: string;
    hasLearningTargets: boolean;
  }>;
  goal: Readonly<{
    id: string;
    userId: string | null;
    goalKind: string;
    title: string;
    level: string;
    domainTag: string;
    topicCategory: string;
    contentLanguage: string;
    pathSource: string;
    curriculumVersion: number;
    mapPlanJson: string;
    mapPlanStatus: string;
    cognitiveModelInputHash: string;
    cognitiveModelPublishedHash: string;
    cognitiveModelVersion: number;
    units: readonly CognitiveModelExpansionCurriculumUnit[];
  }>;
  module: Readonly<{
    curriculumKey: string;
    title: string;
    objective: string;
    learningTargets: readonly Readonly<{
      localRef: string;
      role: string;
      title: string;
      learningObjective: string;
    }>[];
  }> | null;
  existingEntities: readonly CognitiveModelExpansionEntity[];
  predecessorEntities: readonly Omit<CognitiveModelExpansionEntity, "provenance">[];
}>;

/** Read-only generation context for one KACOM unit expansion. */
export interface CognitiveModelExpansionContextRepository {
  load(unitId: string): Promise<CognitiveModelExpansionContext | null>;
}
