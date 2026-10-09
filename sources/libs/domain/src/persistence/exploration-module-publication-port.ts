export type ExplorationModulePublicationUnit = Readonly<{
  title: string;
  contentSummary: string;
  difficulty: "easy" | "medium" | "hard";
  milestoneRole: "introduce" | "practice" | "integrate" | "verify";
}>;

export type PublishExplorationModuleInput = Readonly<{
  userId: string;
  goalId: string;
  moduleId: string;
  generationBuildToken: string;
  orderIndex: number;
  units: readonly ExplorationModulePublicationUnit[];
  publishedAt: Date;
}>;

export type PublishExplorationModuleResult = Readonly<{
  moduleId: string;
  published: boolean;
  createdUnitCount: number;
  generationVersion: number;
}>;

/**
 * Publishes the KACOM-free lesson structure for an exploration module.
 * Cognitive entities, targets, relations, evidence, and assessment remain
 * outside this capability.
 */
export interface ExplorationModulePublicationRepository {
  publish(
    input: PublishExplorationModuleInput,
  ): Promise<PublishExplorationModuleResult>;
}
