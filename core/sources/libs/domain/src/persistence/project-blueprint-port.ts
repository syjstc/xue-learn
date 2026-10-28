/** A task requirement declaration persisted as part of an immutable project. */
export type ProjectBlueprintRequirementInput = Readonly<{
  learningTargetId?: string | null;
  cognitiveEntityId: string;
  entityDefinitionVersion: number;
  dimension: string;
  role: "primary" | "supporting";
  required: boolean;
  weight: number;
  orderIndex: number;
  rubricCriterion: unknown;
}>;

/** One root or milestone task in a project blueprint publication. */
export type ProjectBlueprintStageInput = Readonly<{
  goalId: string;
  unitId?: string | null;
  stableKey: string;
  projectRole: "root" | "milestone";
  parentStableKey?: string | null;
  milestoneOrder: number | null;
  projectBlueprintHash: string;
  constraintDefinitions: unknown;
  deliverableDefinitions: unknown;
  title: string;
  instructions: string;
  context: unknown;
  rubric: unknown;
  difficulty: string;
  definitionVersion: number;
  origin: string;
  evidencePolicy: Readonly<{
    source: "project";
    taskKind: "novel_application" | "integration" | "project";
    contextKey: string;
    contextDistance: "same" | "near" | "far";
    rubricId: string;
  }>;
  requirements: readonly ProjectBlueprintRequirementInput[];
}>;

export type ProjectBlueprintTaskRecord = Readonly<{
  id: string;
  stableKey: string;
  title: string;
  projectRole: "root" | "milestone";
  parentTaskId: string | null;
  milestoneOrder: number | null;
  projectBlueprintHash: string;
}>;

export type PublishProjectBlueprintInput = Readonly<{
  goalId: string;
  blueprintHash: string;
  stages: readonly ProjectBlueprintStageInput[];
}>;

export type PublishProjectBlueprintResult = Readonly<{
  blueprintHash: string;
  root: ProjectBlueprintTaskRecord;
  milestones: readonly ProjectBlueprintTaskRecord[];
  deprecatedTaskCount: number;
}>;

/** Owns immutable project task publication and stale-capstone rollback. */
export interface ProjectBlueprintRepository {
  findCurrentPublication(goalId: string): Promise<{
    goalStatus: string;
    goalVersion: number;
    inputHash: string;
    publishedHash: string;
    revision: null | Readonly<{
      version: number;
      inputHash: string;
      snapshotJson: unknown;
      publishedAt: Date | null;
    }>;
  } | null>;
  deprecateStale(input: {
    goalId: string;
    blueprintHash?: string;
  }): Promise<number>;

  publish(
    input: PublishProjectBlueprintInput,
  ): Promise<PublishProjectBlueprintResult>;
}
