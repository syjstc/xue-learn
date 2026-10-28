export type PreparedModulePublicationUnit = Readonly<{
  title: string;
  contentSummary: string;
  difficulty: "easy" | "medium" | "hard";
  capabilityRefs: readonly string[];
  milestoneRole: "introduce" | "practice" | "integrate" | "verify";
}>;

export type PreparedModulePublicationStructure = Readonly<{
  units: readonly PreparedModulePublicationUnit[];
  coverageRationale: string;
}>;

export type PublishPreparedModuleInput = Readonly<{
  userId: string;
  goalId: string;
  moduleId: string;
  generationBuildToken: string;
  capabilities: ReadonlyArray<Readonly<Record<string, unknown>>>;
  structure: PreparedModulePublicationStructure;
  baseUnitPlanningBrief: Readonly<Record<string, unknown>>;
  publishedAt: Date;
}>;

export type PublishPreparedModuleResult = Readonly<{
  moduleId: string;
  published: boolean;
  createdUnitCount: number;
  generationVersion: number;
}>;

/**
 * Publishes pre-navigation mastery lesson structure only. KACOM entities,
 * targets, relations, evidence, and cognitive publication remain separate.
 */
export interface PreparedModulePublicationRepository {
  publish(
    input: PublishPreparedModuleInput,
  ): Promise<PublishPreparedModuleResult>;
  publishMastery(input: Readonly<{
    userId: string; goalId: string; moduleId: string; generationBuildToken: string;
    orderIndex: number; curriculumKey: string; contentLanguage: string; mapOutcomeCount: number;
    foundations: readonly any[]; capabilities: readonly any[]; units: readonly PreparedModulePublicationUnit[];
    preparedExisting: boolean; publishedAt: Date;
  }>): Promise<Readonly<{ moduleId: string; createdUnitCount: number }>>;
}
