export const COGNITIVE_MODEL_SCHEMA_VERSION = 1 as const;

export const COGNITIVE_MODEL_VIEWS = ["atoms", "constructs", "full"] as const;
export type CognitiveModelView = (typeof COGNITIVE_MODEL_VIEWS)[number];

export const COGNITIVE_DIMENSIONS = [
  "memory",
  "understanding",
  "application",
  "transfer",
  "fluency",
  "stability",
  "independence",
] as const;
export type CognitiveDimension = (typeof COGNITIVE_DIMENSIONS)[number];

export type SnapshotEntity = {
  id: string;
  stableKey: string;
  kind: "atom" | "concept" | "skill" | "competency";
  title: string;
  description: string;
  language: string;
  definitionVersion: number;
  status: "active" | "deprecated";
  atom: null | {
    statement: string;
    explanation: string;
    boundary: unknown;
    knowledgeForm: string;
  };
  construct: null | {
    objective: string;
    inputs: string[];
    outputs: string[];
    qualityCriteria: string[];
    compositionStrategy: unknown;
    aggregationPolicy:
      | "all_required"
      | "weighted_geometric"
      | "alternative_paths";
  };
};

export type SnapshotRelation = {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationType:
    | "prerequisite"
    | "part_of"
    | "causes"
    | "contrasts"
    | "constrains"
    | "supports"
    | "enables";
  strength: "required" | "recommended";
  rationale: string;
  status: "active" | "deprecated";
};

export type SnapshotComponent = {
  id: string;
  constructId: string;
  componentEntityId: string;
  relationType: string;
  role: string;
  requirementMode: "required" | "optional" | "alternative_path";
  componentGroup: string;
  threshold: number;
  gate: boolean;
  weight: number;
  orderIndex: number;
  rationale: string;
};

export type SnapshotTargetRequirement = {
  entityId: string;
  dimension: CognitiveDimension;
  required: boolean;
  weight: number;
  threshold: number;
  gate: boolean;
};

export type SnapshotLearningTarget = {
  id: string;
  stableKey: string;
  title: string;
  description: string;
  learningObjective: string;
  assessmentCriteria: Array<{ ref: string; text: string }>;
  targetCognitiveLevel: string;
  importance: string;
  importanceWeight: number;
  difficulty: string;
  planningOutcomeRefs?: string[];
  requirements: SnapshotTargetRequirement[];
  mappings: Array<{
    unitId: string;
    localRef: string;
    required: boolean;
    weight: number;
    orderIndex: number;
    role: string;
    isEntry: boolean;
    isExit: boolean;
  }>;
};

export type SnapshotUnit = {
  unitId: string;
  curriculumKey: string;
  title: string;
  parentUnitId: string | null;
  unitKind: string;
  curriculumOrder: number;
  modelStatus: string;
  planAreaRef?: string;
  planningOutcomeRefs?: string[];
  prerequisiteUnitIds: string[];
  learningTargetIds: string[];
};

/**
 * Full, objective-only revision payload. Learner attempts, observations,
 * claims, gaps, and inferred state are deliberately impossible to represent.
 */
export type CognitiveModelSnapshot = {
  schemaVersion: typeof COGNITIVE_MODEL_SCHEMA_VERSION;
  goalId: string;
  inputHash: string;
  entities: SnapshotEntity[];
  relations: SnapshotRelation[];
  components: SnapshotComponent[];
  learningTargets: SnapshotLearningTarget[];
  units: SnapshotUnit[];
  audit: Record<string, unknown>;
};

export type PresentedDimensionState = {
  dimension: CognitiveDimension;
  status: "unobserved" | "forming" | "demonstrated" | "robust" | "revalidate";
  estimate: number | null;
  evidenceSufficiency: number;
  effectiveEvidenceWeight: number;
  dueAt: null;
  lastObservedAt: string | null;
};

export type PresentedEntityState = {
  status: "unobserved" | "forming" | "demonstrated" | "robust" | "revalidate";
  overallEstimate: number | null;
  evidenceSufficiency: number;
  dimensions: PresentedDimensionState[];
  inferencePolicyVersion: number;
  nextAction: string | null;
};
