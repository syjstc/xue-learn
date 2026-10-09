// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import { createHash } from "node:crypto";
import type { Persistence, PersistenceClient } from "../persistence/persistence-compat.js";
import {
  ProjectAttemptValidationError,
  parseLearnerProjectAttemptSubmission as parsePortableLearnerProjectAttemptSubmission,
  validateProjectAttemptPayload as validatePortableProjectAttemptPayload,
  type ProjectBlueprintRepository,
} from "../../../domain/src/index.js";
import {
  CognitionPersistenceError,
  ensureLearningTask,
  recordTaskObservationCandidate,
  startTaskAttempt,
  type TaskRequirementDeclaration,
} from "./persistence.js";
import { allowedDimensionsForTask } from "./evidence.js";
import {
  type AssistanceLevel,
  type ContextDistance,
  type EvidenceTaskKind,
  isAssistanceLevel,
  isCognitiveDimension,
  isContextDistance,
} from "./types.js";

const PROJECT_SCHEMA_VERSION = 1 as const;
const PROJECT_TASK_KINDS = [
  "novel_application",
  "integration",
  "project",
] as const satisfies readonly EvidenceTaskKind[];
const PROJECT_EVALUATORS = ["deterministic", "llm", "human"] as const;
const PROJECT_DIFFICULTIES = ["easy", "medium", "hard"] as const;
const PROJECT_ASSISTANCE_KINDS = [
  "hint",
  "question",
  "example",
  "feedback",
  "answer",
] as const;
const PROJECT_PROCESS_KINDS = [
  "decision",
  "action",
  "verification",
  "revision",
  "note",
] as const;
const PROJECT_ARTIFACT_TYPES = [
  "code",
  "document",
  "presentation",
  "dataset",
  "media",
  "other",
] as const;

type JsonObject = Record<string, unknown>;
type ProjectEvaluator = (typeof PROJECT_EVALUATORS)[number];
type ProjectDifficulty = (typeof PROJECT_DIFFICULTIES)[number];

export class ProjectValidationError extends Error {
  readonly code:
    | "invalid_blueprint"
    | "immutable_blueprint"
    | "invalid_attempt"
    | "idempotency_conflict"
    | "not_found"
    | "ownership_mismatch"
    | "undeclared_evaluator";

  constructor(code: ProjectValidationError["code"], message: string) {
    super(message);
    this.name = "ProjectValidationError";
    this.code = code;
  }
}

export type ProjectCriterionDefinition = {
  ref: string;
  description: string;
  evaluators: readonly ProjectEvaluator[];
  deterministicRule?: ProjectDeterministicRule;
};

/**
 * Closed, server-owned rules that can be evaluated from the persisted project
 * attempt alone. They intentionally describe observable structure, not domain
 * correctness or a learner-state assertion.
 */
export type ProjectDeterministicRule =
  | {
      type: "artifact_present";
      deliverableKey: string;
      minVersions?: number;
    }
  | {
      type: "process_verification";
      deliverableKey?: string;
      minEntries?: number;
    }
  | {
      type: "assistance_ceiling";
      maxLevel: AssistanceLevel;
      maxEvents?: number;
    };

export type ProjectConstraintDefinition = {
  key: string;
  title: string;
  description: string;
  kind: "hard" | "soft";
  verification: ProjectCriterionDefinition;
};

export type ProjectDeliverableDefinition = {
  key: string;
  title: string;
  description: string;
  artifactType:
    "code" | "document" | "presentation" | "dataset" | "media" | "other";
  required: boolean;
  acceptanceCriteria: readonly ProjectCriterionDefinition[];
};

export type ProjectContextDefinition = {
  scenarioKey: string;
  title: string;
  description: string;
  domain: string;
  setting: string;
  stakeholders?: readonly string[];
};

export type ProjectStageEvidencePolicy = {
  taskKind: (typeof PROJECT_TASK_KINDS)[number];
  contextDistance: ContextDistance;
  rubricId: string;
};

export type ProjectStageDefinition = {
  stableKey: string;
  title: string;
  instructions: string;
  difficulty: ProjectDifficulty;
  constraints: readonly ProjectConstraintDefinition[];
  deliverables: readonly ProjectDeliverableDefinition[];
  evidencePolicy: ProjectStageEvidencePolicy;
  requirements: readonly TaskRequirementDeclaration[];
  rubric?: JsonObject;
};

export type ProjectMilestoneDefinition = ProjectStageDefinition & {
  orderIndex: number;
};

export type ProjectBlueprint = ProjectStageDefinition & {
  goalId: string;
  unitId?: string;
  definitionVersion: number;
  origin?: string;
  projectContext: ProjectContextDefinition;
  milestones: readonly ProjectMilestoneDefinition[];
};

export type ValidatedProjectBlueprint = {
  blueprintHash: string;
  contextKey: string;
  orderedMilestones: readonly ProjectMilestoneDefinition[];
};

export type ProjectArtifactVersionRef = {
  artifactId: string;
  deliverableKey: string;
  version: number;
  createdAt: string;
  uri?: string;
  checksum?: string;
  mediaType?: string;
};

export type ProjectProcessLogEntry = {
  sequence: number;
  occurredAt: string;
  kind: (typeof PROJECT_PROCESS_KINDS)[number];
  summary: string;
  artifactVersionRefs?: readonly string[];
  metadata?: JsonObject;
};

export type ProjectAssistanceTraceEntry = {
  sequence: number;
  occurredAt: string;
  source: "ai" | "human" | "system";
  kind: (typeof PROJECT_ASSISTANCE_KINDS)[number];
  level: AssistanceLevel;
  contentRef?: string;
};

export type ProjectAttemptPayload = {
  artifactVersionRefs: readonly ProjectArtifactVersionRef[];
  processLog: readonly ProjectProcessLogEntry[];
  assistanceTrace: readonly ProjectAssistanceTraceEntry[];
  response?: JsonObject;
  durationMs?: number;
  status?: "started" | "submitted" | "evaluated" | "abandoned";
  startedAt?: Date;
  submittedAt?: Date;
  completedAt?: Date;
};

export type LearnerProjectAttemptSubmission = {
  idempotencyKey: string;
  artifactVersionRefs: readonly ProjectArtifactVersionRef[];
  processLog: readonly ProjectProcessLogEntry[];
  assistanceTrace: readonly ProjectAssistanceTraceEntry[];
  durationMs?: number;
};

export type ProjectObservationSubmission = {
  requirementId: string;
  score: number;
  evaluatorRunId: string;
  rawResult?: JsonObject;
  metadata?: JsonObject;
};

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validKey(value: unknown): value is string {
  return nonEmpty(value) && /^[a-z0-9][a-z0-9:_-]{1,127}$/i.test(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function includes<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function assertExactKeys(
  value: JsonObject,
  allowed: readonly string[],
  path: string,
  code: "invalid_attempt" | "undeclared_evaluator" = "invalid_attempt",
): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    throw new ProjectValidationError(
      code,
      `${path} contains undeclared fields: ${unexpected.join(", ")}`,
    );
  }
}

/**
 * Parses the learner-facing boundary. Entity, dimension, claim, state, score,
 * and evaluator fields are intentionally absent and rejected as extras.
 */
export function parseLearnerProjectAttemptSubmission(
  value: unknown,
): LearnerProjectAttemptSubmission {
  try {
    return parsePortableLearnerProjectAttemptSubmission(
      value,
    ) as LearnerProjectAttemptSubmission;
  } catch (error) {
    if (error instanceof ProjectAttemptValidationError) {
      throw new ProjectValidationError("invalid_attempt", error.message);
    }
    throw error;
  }
}

/**
 * Parses an admin review result. Evaluator identity, reliability and evidence
 * strength are intentionally absent: the server authority registry owns them.
 */
export function parseProjectObservationSubmission(
  value: unknown,
): ProjectObservationSubmission {
  if (!isRecord(value)) {
    throw new ProjectValidationError(
      "invalid_attempt",
      "project observation submission must be an object",
    );
  }
  assertExactKeys(
    value,
    ["requirementId", "score", "evaluatorRunId", "rawResult", "metadata"],
    "project observation submission",
    "undeclared_evaluator",
  );
  if (
    !nonEmpty(value.requirementId) ||
    typeof value.score !== "number" ||
    !Number.isFinite(value.score) ||
    value.score < 0 ||
    value.score > 1 ||
    !nonEmpty(value.evaluatorRunId) ||
    (value.rawResult !== undefined && !isRecord(value.rawResult)) ||
    (value.metadata !== undefined && !isRecord(value.metadata))
  ) {
    throw new ProjectValidationError(
      "invalid_attempt",
      "project observation submission is malformed",
    );
  }
  return value as ProjectObservationSubmission;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function jsonInput(value: unknown): Persistence.InputJsonValue {
  return canonicalValue(value) as Persistence.InputJsonValue;
}

function assertRuleExactKeys(
  value: JsonObject,
  allowed: readonly string[],
): void {
  const allowedKeys = new Set(allowed);
  const extras = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (extras.length > 0) {
    throw new ProjectValidationError(
      "invalid_blueprint",
      `deterministic rule contains undeclared fields: ${extras.join(", ")}`,
    );
  }
}

export function parseProjectDeterministicRule(
  value: unknown,
): ProjectDeterministicRule {
  if (!isRecord(value) || !nonEmpty(value.type)) {
    throw new ProjectValidationError(
      "invalid_blueprint",
      "deterministic rule must declare a supported type",
    );
  }
  if (value.type === "artifact_present") {
    assertRuleExactKeys(value, ["type", "deliverableKey", "minVersions"]);
    if (
      !validKey(value.deliverableKey) ||
      (value.minVersions !== undefined && !positiveInteger(value.minVersions))
    ) {
      throw new ProjectValidationError(
        "invalid_blueprint",
        "artifact_present requires a deliverable key and positive minVersions",
      );
    }
    return value as ProjectDeterministicRule;
  }
  if (value.type === "process_verification") {
    assertRuleExactKeys(value, ["type", "deliverableKey", "minEntries"]);
    if (
      (value.deliverableKey !== undefined && !validKey(value.deliverableKey)) ||
      (value.minEntries !== undefined && !positiveInteger(value.minEntries))
    ) {
      throw new ProjectValidationError(
        "invalid_blueprint",
        "process_verification has an invalid deliverable key or minEntries",
      );
    }
    return value as ProjectDeterministicRule;
  }
  if (value.type === "assistance_ceiling") {
    assertRuleExactKeys(value, ["type", "maxLevel", "maxEvents"]);
    if (
      !isAssistanceLevel(value.maxLevel) ||
      (value.maxEvents !== undefined && !nonNegativeInteger(value.maxEvents))
    ) {
      throw new ProjectValidationError(
        "invalid_blueprint",
        "assistance_ceiling requires a valid maxLevel and non-negative maxEvents",
      );
    }
    return value as ProjectDeterministicRule;
  }
  throw new ProjectValidationError(
    "invalid_blueprint",
    `unsupported deterministic rule ${value.type}`,
  );
}

function assertProjectCriterion(
  criterion: unknown,
  path: string,
): asserts criterion is ProjectCriterionDefinition {
  if (!isRecord(criterion)) {
    throw new ProjectValidationError(
      "invalid_blueprint",
      `${path} must be an object`,
    );
  }
  const evaluators = Array.isArray(criterion.evaluators)
    ? criterion.evaluators
    : [];
  if (
    !validKey(criterion.ref) ||
    !nonEmpty(criterion.description) ||
    evaluators.length === 0 ||
    new Set(evaluators).size !== evaluators.length ||
    evaluators.some((evaluator) => !includes(PROJECT_EVALUATORS, evaluator)) ||
    (evaluators.includes("deterministic") &&
      !isRecord(criterion.deterministicRule)) ||
    (!evaluators.includes("deterministic") &&
      criterion.deterministicRule !== undefined)
  ) {
    throw new ProjectValidationError(
      "invalid_blueprint",
      `${path} must declare a stable ref, description, allowed evaluators, and deterministic rule when applicable`,
    );
  }
  if (evaluators.includes("deterministic")) {
    parseProjectDeterministicRule(criterion.deterministicRule);
  }
}

function validateStage(stage: unknown, path: string): void {
  if (!isRecord(stage) || !isRecord(stage.evidencePolicy)) {
    throw new ProjectValidationError(
      "invalid_blueprint",
      `${path} must be an object with an evidence policy`,
    );
  }
  if (
    !validKey(stage.stableKey) ||
    !nonEmpty(stage.title) ||
    !nonEmpty(stage.instructions) ||
    !includes(PROJECT_DIFFICULTIES, stage.difficulty) ||
    !Array.isArray(stage.constraints) ||
    !Array.isArray(stage.deliverables) ||
    stage.deliverables.length === 0 ||
    !Array.isArray(stage.requirements) ||
    stage.requirements.length === 0 ||
    (stage.rubric !== undefined && !isRecord(stage.rubric)) ||
    !includes(PROJECT_TASK_KINDS, stage.evidencePolicy.taskKind) ||
    !isContextDistance(stage.evidencePolicy.contextDistance) ||
    !validKey(stage.evidencePolicy.rubricId)
  ) {
    throw new ProjectValidationError(
      "invalid_blueprint",
      `${path} lacks a valid identity, task policy, requirements, or deliverables`,
    );
  }

  const constraintKeys = new Set<string>();
  const deliverableKeys = new Set<string>();
  const criterionRefs = new Set<string>();
  const deterministicCriteria: ProjectCriterionDefinition[] = [];
  for (const [index, constraint] of stage.constraints.entries()) {
    if (
      !isRecord(constraint) ||
      !validKey(constraint.key) ||
      !nonEmpty(constraint.title) ||
      !nonEmpty(constraint.description) ||
      (constraint.kind !== "hard" && constraint.kind !== "soft") ||
      constraintKeys.has(constraint.key)
    ) {
      throw new ProjectValidationError(
        "invalid_blueprint",
        `${path}.constraints[${index}] is invalid or duplicated`,
      );
    }
    constraintKeys.add(constraint.key);
    const verification = constraint.verification;
    assertProjectCriterion(
      verification,
      `${path}.constraints[${index}].verification`,
    );
    if (criterionRefs.has(verification.ref)) {
      throw new ProjectValidationError(
        "invalid_blueprint",
        `${path} repeats criterion ${verification.ref}`,
      );
    }
    criterionRefs.add(verification.ref);
    if (verification.evaluators.includes("deterministic")) {
      deterministicCriteria.push(verification);
    }
  }
  for (const [index, deliverable] of stage.deliverables.entries()) {
    if (
      !isRecord(deliverable) ||
      !validKey(deliverable.key) ||
      !nonEmpty(deliverable.title) ||
      !nonEmpty(deliverable.description) ||
      !includes(PROJECT_ARTIFACT_TYPES, deliverable.artifactType) ||
      typeof deliverable.required !== "boolean" ||
      deliverableKeys.has(deliverable.key) ||
      !Array.isArray(deliverable.acceptanceCriteria) ||
      deliverable.acceptanceCriteria.length === 0
    ) {
      throw new ProjectValidationError(
        "invalid_blueprint",
        `${path}.deliverables[${index}] is invalid or duplicated`,
      );
    }
    deliverableKeys.add(deliverable.key);
    for (const [
      criterionIndex,
      criterion,
    ] of deliverable.acceptanceCriteria.entries()) {
      assertProjectCriterion(
        criterion,
        `${path}.deliverables[${index}].acceptanceCriteria[${criterionIndex}]`,
      );
      if (criterionRefs.has(criterion.ref)) {
        throw new ProjectValidationError(
          "invalid_blueprint",
          `${path} repeats criterion ${criterion.ref}`,
        );
      }
      criterionRefs.add(criterion.ref);
      if (criterion.evaluators.includes("deterministic")) {
        deterministicCriteria.push(criterion);
      }
    }
  }

  for (const criterion of deterministicCriteria) {
    const rule = parseProjectDeterministicRule(criterion.deterministicRule);
    if (
      (rule.type === "artifact_present" ||
        rule.type === "process_verification") &&
      rule.deliverableKey !== undefined &&
      !deliverableKeys.has(rule.deliverableKey)
    ) {
      throw new ProjectValidationError(
        "invalid_blueprint",
        `criterion ${criterion.ref} references undeclared deliverable ${rule.deliverableKey}`,
      );
    }
  }

  const requirementSignatures = new Set<string>();
  const criterionCatalog = projectCriterionCatalog(
    stage.constraints,
    stage.deliverables,
  );
  for (const [index, requirement] of stage.requirements.entries()) {
    if (!isRecord(requirement)) {
      throw new ProjectValidationError(
        "invalid_blueprint",
        `${path}.requirements[${index}] must be an object`,
      );
    }
    const signature = `${requirement.cognitiveEntityId}\u001f${requirement.learningTargetId ?? ""}\u001f${requirement.dimension}\u001f${requirement.criterionRef}`;
    if (
      !nonEmpty(requirement.cognitiveEntityId) ||
      !isCognitiveDimension(requirement.dimension) ||
      !validKey(requirement.criterionRef) ||
      !positiveInteger(requirement.definitionVersion) ||
      !criterionRefs.has(requirement.criterionRef) ||
      requirementSignatures.has(signature) ||
      !allowedDimensionsForTask(stage.evidencePolicy.taskKind).includes(
        requirement.dimension,
      ) ||
      (requirement.learningTargetId !== undefined &&
        !nonEmpty(requirement.learningTargetId)) ||
      (requirement.role !== undefined &&
        requirement.role !== "primary" &&
        requirement.role !== "supporting") ||
      (requirement.required !== undefined &&
        typeof requirement.required !== "boolean") ||
      (requirement.orderIndex !== undefined &&
        !nonNegativeInteger(requirement.orderIndex)) ||
      (requirement.rubricCriterion !== undefined &&
        !isRecord(requirement.rubricCriterion)) ||
      (requirement.weight !== undefined && !positiveFinite(requirement.weight))
    ) {
      throw new ProjectValidationError(
        "invalid_blueprint",
        `${path}.requirements[${index}] is undeclared, duplicated, or invalid`,
      );
    }
    if (
      requirement.dimension === "transfer" &&
      stage.evidencePolicy.contextDistance === "same"
    ) {
      throw new ProjectValidationError(
        "invalid_blueprint",
        `${path} can only declare transfer evidence in a near or far context`,
      );
    }
    const criterion = criterionCatalog.get(requirement.criterionRef);
    if (
      criterion?.evaluators.length === 1 &&
      criterion.evaluators[0] === "deterministic" &&
      requirement.required !== false
    ) {
      throw new ProjectValidationError(
        "invalid_blueprint",
        `${path} deterministic learner-structure checks must be optional because they cannot create cognitive evidence`,
      );
    }
    requirementSignatures.add(signature);
  }
}

export function validateProjectBlueprint(
  blueprint: ProjectBlueprint,
): ValidatedProjectBlueprint {
  if (
    !isRecord(blueprint) ||
    !nonEmpty(blueprint.goalId) ||
    (blueprint.unitId !== undefined && !nonEmpty(blueprint.unitId)) ||
    (blueprint.origin !== undefined && !nonEmpty(blueprint.origin)) ||
    !positiveInteger(blueprint.definitionVersion) ||
    !isRecord(blueprint.projectContext) ||
    !validKey(blueprint.projectContext.scenarioKey) ||
    !nonEmpty(blueprint.projectContext.title) ||
    !nonEmpty(blueprint.projectContext.description) ||
    !nonEmpty(blueprint.projectContext.domain) ||
    !nonEmpty(blueprint.projectContext.setting) ||
    (blueprint.projectContext.stakeholders !== undefined &&
      (!Array.isArray(blueprint.projectContext.stakeholders) ||
        blueprint.projectContext.stakeholders.some((item) => !nonEmpty(item)) ||
        new Set(blueprint.projectContext.stakeholders).size !==
          blueprint.projectContext.stakeholders.length)) ||
    !Array.isArray(blueprint.milestones) ||
    blueprint.milestones.length === 0 ||
    blueprint.milestones.some(
      (milestone) =>
        !isRecord(milestone) || !nonNegativeInteger(milestone.orderIndex),
    )
  ) {
    throw new ProjectValidationError(
      "invalid_blueprint",
      "project requires a goal, version, explicit context, and milestones",
    );
  }
  validateStage(blueprint, "project");
  const orderedMilestones = [...blueprint.milestones].sort(
    (left, right) => left.orderIndex - right.orderIndex,
  );
  const stableKeys = new Set([blueprint.stableKey]);
  for (const [index, milestone] of orderedMilestones.entries()) {
    if (milestone.orderIndex !== index || stableKeys.has(milestone.stableKey)) {
      throw new ProjectValidationError(
        "invalid_blueprint",
        "milestone order must be contiguous and stable keys must be unique",
      );
    }
    stableKeys.add(milestone.stableKey);
    validateStage(milestone, `milestones[${index}]`);
  }
  const blueprintHash = createHash("sha256")
    .update(canonicalJson({ ...blueprint, milestones: orderedMilestones }))
    .digest("hex");
  return {
    blueprintHash,
    contextKey: `project:${blueprint.goalId}:${blueprint.stableKey}:v${blueprint.definitionVersion}`,
    orderedMilestones,
  };
}

function taskContext(
  blueprint: ProjectBlueprint,
  validated: ValidatedProjectBlueprint,
  role: "root" | "milestone",
  milestoneOrder: number | null,
): JsonObject {
  return {
    project: {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      blueprintHash: validated.blueprintHash,
      role,
      rootStableKey: blueprint.stableKey,
      milestoneOrder,
      context: blueprint.projectContext,
    },
  };
}

function projectEvidencePolicy(
  stage: ProjectStageDefinition,
  contextKey: string,
) {
  return {
    source: "project" as const,
    taskKind: stage.evidencePolicy.taskKind,
    contextKey,
    contextDistance: stage.evidencePolicy.contextDistance,
    rubricId: stage.evidencePolicy.rubricId,
  };
}

type ProjectTaskShape = {
  id: string;
  taskType: string;
  projectRole: string;
  parentTaskId: string | null;
  milestoneOrder: number | null;
  projectBlueprintHash: string;
  constraintDefinitions: unknown;
  deliverableDefinitions: unknown;
  title: string;
  instructions: string;
  difficulty: string;
  definitionVersion: number;
};

function assertStoredTask(
  task: ProjectTaskShape,
  stage: ProjectStageDefinition,
  role: "root" | "milestone",
  parentTaskId: string | null,
  milestoneOrder: number | null,
  blueprintHash: string,
): void {
  if (
    task.taskType !== "project" ||
    task.projectRole !== role ||
    task.parentTaskId !== parentTaskId ||
    task.milestoneOrder !== milestoneOrder ||
    task.projectBlueprintHash !== blueprintHash ||
    task.title !== stage.title ||
    task.instructions !== stage.instructions ||
    task.difficulty !== stage.difficulty ||
    canonicalJson(task.constraintDefinitions) !==
      canonicalJson(stage.constraints) ||
    canonicalJson(task.deliverableDefinitions) !==
      canonicalJson(stage.deliverables)
  ) {
    throw new ProjectValidationError(
      "immutable_blueprint",
      `project task ${stage.stableKey} conflicts with its immutable blueprint`,
    );
  }
}

export async function ensureProjectBlueprint(
  persistence: PersistenceClient | null,
  blueprint: ProjectBlueprint,
  projectBlueprintRepository?: ProjectBlueprintRepository,
) {
  const validated = validateProjectBlueprint(blueprint);
  if (projectBlueprintRepository) {
    const stages = [
      {
        goalId: blueprint.goalId,
        unitId: blueprint.unitId ?? null,
        stableKey: blueprint.stableKey,
        projectRole: "root" as const,
        parentStableKey: null,
        milestoneOrder: null,
        projectBlueprintHash: validated.blueprintHash,
        constraintDefinitions: blueprint.constraints,
        deliverableDefinitions: blueprint.deliverables,
        title: blueprint.title,
        instructions: blueprint.instructions,
        context: {
          ...taskContext(blueprint, validated, "root", null),
          evidencePolicy: projectEvidencePolicy(
            blueprint,
            `${validated.contextKey}:root:root:${blueprint.stableKey}`,
          ),
        },
        rubric: blueprint.rubric ?? {},
        difficulty: blueprint.difficulty,
        definitionVersion: blueprint.definitionVersion,
        origin: blueprint.origin ?? "generated",
        evidencePolicy: projectEvidencePolicy(
          blueprint,
          `${validated.contextKey}:root:root:${blueprint.stableKey}`,
        ),
        requirements: blueprint.requirements.map((requirement, index) => ({
          learningTargetId: requirement.learningTargetId ?? null,
          cognitiveEntityId: requirement.cognitiveEntityId,
          entityDefinitionVersion: requirement.definitionVersion,
          dimension: requirement.dimension,
          role: requirement.role ?? "primary",
          required: requirement.required ?? true,
          weight: requirement.weight ?? 1,
          orderIndex: requirement.orderIndex ?? index,
          rubricCriterion: {
            ...(requirement.rubricCriterion ?? {}),
            ref: requirement.criterionRef,
            definitionVersion: requirement.definitionVersion,
          },
        })),
      },
      ...validated.orderedMilestones.map((milestone) => {
        const stageContextKey = `${validated.contextKey}:milestone:${milestone.orderIndex}:${milestone.stableKey}`;
        const evidencePolicy = projectEvidencePolicy(
          milestone,
          stageContextKey,
        );
        return {
          goalId: blueprint.goalId,
          unitId: blueprint.unitId ?? null,
          stableKey: milestone.stableKey,
          projectRole: "milestone" as const,
          parentStableKey: blueprint.stableKey,
          milestoneOrder: milestone.orderIndex,
          projectBlueprintHash: validated.blueprintHash,
          constraintDefinitions: milestone.constraints,
          deliverableDefinitions: milestone.deliverables,
          title: milestone.title,
          instructions: milestone.instructions,
          context: {
            ...taskContext(
              blueprint,
              validated,
              "milestone",
              milestone.orderIndex,
            ),
            evidencePolicy,
          },
          rubric: milestone.rubric ?? {},
          difficulty: milestone.difficulty,
          definitionVersion: blueprint.definitionVersion,
          origin: blueprint.origin ?? "generated",
          evidencePolicy,
          requirements: milestone.requirements.map((requirement, index) => ({
            learningTargetId: requirement.learningTargetId ?? null,
            cognitiveEntityId: requirement.cognitiveEntityId,
            entityDefinitionVersion: requirement.definitionVersion,
            dimension: requirement.dimension,
            role: requirement.role ?? "primary",
            required: requirement.required ?? true,
            weight: requirement.weight ?? 1,
            orderIndex: requirement.orderIndex ?? index,
            rubricCriterion: {
              ...(requirement.rubricCriterion ?? {}),
              ref: requirement.criterionRef,
              definitionVersion: requirement.definitionVersion,
            },
          })),
        };
      }),
    ];
    return projectBlueprintRepository.publish({
      goalId: blueprint.goalId,
      blueprintHash: validated.blueprintHash,
      stages,
    });
  }
  if (!persistence) throw new Error("Project blueprint repository is required");
  return persistence.$transaction(async (tx) => {
    const client = tx as unknown as PersistenceClient;
    const ensureStage = async (
      stage: ProjectStageDefinition,
      role: "root" | "milestone",
      parentTaskId: string | null,
      milestoneOrder: number | null,
    ) => {
      const stageContextKey = `${validated.contextKey}:${role}:${
        milestoneOrder ?? "root"
      }:${stage.stableKey}`;
      const existing = await tx.learningTask.findUnique({
        where: {
          goalId_stableKey: {
            goalId: blueprint.goalId,
            stableKey: stage.stableKey,
          },
        },
      });
      const base = await ensureLearningTask(client, {
        goalId: blueprint.goalId,
        ...(blueprint.unitId ? { unitId: blueprint.unitId } : {}),
        stableKey: stage.stableKey,
        taskType: "project",
        title: stage.title,
        instructions: stage.instructions,
        context: taskContext(blueprint, validated, role, milestoneOrder),
        rubric: stage.rubric ?? {},
        difficulty: stage.difficulty,
        definitionVersion: blueprint.definitionVersion,
        origin: blueprint.origin ?? "generated",
        evidencePolicy: projectEvidencePolicy(stage, stageContextKey),
        requirements: stage.requirements,
      });
      if (existing) {
        assertStoredTask(
          existing,
          stage,
          role,
          parentTaskId,
          milestoneOrder,
          validated.blueprintHash,
        );
        return tx.learningTask.findUniqueOrThrow({
          where: { id: base.id },
          include: { requirements: true },
        });
      }
      return tx.learningTask.update({
        where: { id: base.id },
        data: {
          projectRole: role,
          parentTaskId,
          milestoneOrder,
          projectBlueprintHash: validated.blueprintHash,
          constraintDefinitions: jsonInput(stage.constraints),
          deliverableDefinitions: jsonInput(stage.deliverables),
        },
        include: { requirements: true },
      });
    };

    const root = await ensureStage(blueprint, "root", null, null);
    const milestones = [];
    for (const milestone of validated.orderedMilestones) {
      milestones.push(
        await ensureStage(
          milestone,
          "milestone",
          root.id,
          milestone.orderIndex,
        ),
      );
    }
    const storedChildren = await tx.learningTask.findMany({
      where: { parentTaskId: root.id },
      select: { stableKey: true },
      orderBy: { milestoneOrder: "asc" },
    });
    if (
      canonicalJson(storedChildren.map((item) => item.stableKey)) !==
      canonicalJson(milestones.map((item) => item.stableKey))
    ) {
      throw new ProjectValidationError(
        "immutable_blueprint",
        "stored project contains milestones outside the immutable blueprint",
      );
    }
    return {
      blueprintHash: validated.blueprintHash,
      root,
      milestones,
    };
  });
}

function parseDeliverables(value: unknown): ProjectDeliverableDefinition[] {
  if (!Array.isArray(value)) {
    throw new ProjectValidationError(
      "invalid_attempt",
      "project task has invalid deliverable definitions",
    );
  }
  return value as ProjectDeliverableDefinition[];
}

export function validateProjectAttemptPayload(
  payload: ProjectAttemptPayload,
  deliverables: readonly ProjectDeliverableDefinition[],
) {
  try {
    return validatePortableProjectAttemptPayload(payload, deliverables);
  } catch (error) {
    if (error instanceof ProjectAttemptValidationError) {
      throw new ProjectValidationError("invalid_attempt", error.message);
    }
    throw error;
  }
}

export async function startProjectTaskAttempt(
  persistence: PersistenceClient,
  input: {
    taskId: string;
    userId: string;
    idempotencyKey: string;
    payload: ProjectAttemptPayload;
  },
) {
  if (
    !nonEmpty(input.taskId) ||
    !nonEmpty(input.userId) ||
    !nonEmpty(input.idempotencyKey)
  ) {
    throw new ProjectValidationError(
      "invalid_attempt",
      "project attempt requires task, learner, and idempotency identity",
    );
  }
  return persistence.$transaction(async (tx) => {
    const task = await tx.learningTask.findUnique({
      where: { id: input.taskId },
      include: { goal: { select: { userId: true } } },
    });
    if (
      !task ||
      task.status !== "active" ||
      task.taskType !== "project" ||
      (task.projectRole !== "root" && task.projectRole !== "milestone")
    ) {
      throw new ProjectValidationError(
        "not_found",
        "active project task not found",
      );
    }
    if (task.goal.userId !== input.userId) {
      throw new ProjectValidationError(
        "ownership_mismatch",
        "project task belongs to another learner",
      );
    }
    const deliverables = parseDeliverables(task.deliverableDefinitions);
    const validated = validateProjectAttemptPayload(
      input.payload,
      deliverables,
    );
    const client = tx as unknown as PersistenceClient;
    let attemptResult;
    try {
      attemptResult = await startTaskAttempt(client, {
        taskId: task.id,
        userId: input.userId,
        ...(task.unitId ? { unitId: task.unitId } : {}),
        idempotencyKey: input.idempotencyKey,
        context: {
          project: {
            rootTaskId: task.parentTaskId ?? task.id,
            projectRole: task.projectRole,
            milestoneOrder: task.milestoneOrder,
            blueprintHash: task.projectBlueprintHash,
          },
        },
        response: input.payload.response ?? {},
        artifactRefs: validated.artifactKeys,
        artifactVersionRefs: input.payload.artifactVersionRefs,
        processLog: input.payload.processLog,
        assistanceTrace: input.payload.assistanceTrace,
        assistance: validated.assistance,
        ...(input.payload.durationMs
          ? { durationMs: input.payload.durationMs }
          : {}),
        status: validated.status,
        startedAt: input.payload.startedAt,
        submittedAt: input.payload.submittedAt,
        completedAt: input.payload.completedAt,
      });
    } catch (error) {
      if (
        error instanceof CognitionPersistenceError &&
        error.code === "idempotency_conflict"
      ) {
        throw new ProjectValidationError("idempotency_conflict", error.message);
      }
      throw error;
    }
    const expectedArtifacts = canonicalJson(input.payload.artifactVersionRefs);
    const expectedProcess = canonicalJson(input.payload.processLog);
    const expectedAssistance = canonicalJson(input.payload.assistanceTrace);
    const expectedResponse = canonicalJson(input.payload.response ?? {});
    if (attemptResult.replayed) {
      if (
        canonicalJson(attemptResult.attempt.artifactVersionRefs) !==
          expectedArtifacts ||
        canonicalJson(attemptResult.attempt.processLog) !== expectedProcess ||
        canonicalJson(attemptResult.attempt.assistanceTrace) !==
          expectedAssistance ||
        canonicalJson(attemptResult.attempt.response) !== expectedResponse ||
        canonicalJson(attemptResult.attempt.artifactRefs) !==
          canonicalJson(validated.artifactKeys) ||
        attemptResult.attempt.status !== validated.status ||
        attemptResult.attempt.durationMs !== (input.payload.durationMs ?? null)
      ) {
        throw new ProjectValidationError(
          "idempotency_conflict",
          "project attempt replay has different artifacts or traces",
        );
      }
      return attemptResult;
    }
    return attemptResult;
  });
}

export function projectCriterionCatalog(
  constraintsValue: unknown,
  deliverablesValue: unknown,
): Map<string, ProjectCriterionDefinition> {
  const constraints = Array.isArray(constraintsValue)
    ? (constraintsValue as ProjectConstraintDefinition[])
    : [];
  const deliverables = parseDeliverables(deliverablesValue);
  return new Map([
    ...constraints.map(
      (constraint) =>
        [constraint.verification.ref, constraint.verification] as const,
    ),
    ...deliverables.flatMap((deliverable) =>
      deliverable.acceptanceCriteria.map(
        (criterion) => [criterion.ref, criterion] as const,
      ),
    ),
  ]);
}

const CONTEXT_DIFFERENCE_AXES = [
  "domain",
  "constraints",
  "stakeholders",
  "setting",
] as const;

export function validateTransferContextAssessment(
  rawResult: JsonObject | undefined,
  artifactVersionRefs: unknown,
): {
  observedContextRef: string;
  differenceAxes: string[];
  digest: string;
} {
  const assessment = rawResult?.contextValidation;
  if (!isRecord(assessment)) {
    throw new ProjectValidationError(
      "invalid_attempt",
      "transfer evidence requires an authoritative contextValidation",
    );
  }
  assertExactKeys(
    assessment,
    [
      "baselineContextRef",
      "observedContextRef",
      "materialDifferences",
      "noveltyConfirmed",
      "assessedArtifactVersionRefs",
    ],
    "contextValidation",
  );
  if (
    !nonEmpty(assessment.baselineContextRef) ||
    !nonEmpty(assessment.observedContextRef) ||
    assessment.baselineContextRef === assessment.observedContextRef ||
    assessment.noveltyConfirmed !== true ||
    !Array.isArray(assessment.materialDifferences) ||
    assessment.materialDifferences.length === 0 ||
    !Array.isArray(assessment.assessedArtifactVersionRefs) ||
    assessment.assessedArtifactVersionRefs.length === 0
  ) {
    throw new ProjectValidationError(
      "invalid_attempt",
      "transfer contextValidation must confirm a materially different context and inspected artifact versions",
    );
  }
  const axes = new Set<string>();
  for (const [index, difference] of assessment.materialDifferences.entries()) {
    if (!isRecord(difference)) {
      throw new ProjectValidationError(
        "invalid_attempt",
        `contextValidation.materialDifferences[${index}] is invalid`,
      );
    }
    assertExactKeys(
      difference,
      ["axis", "description"],
      `contextValidation.materialDifferences[${index}]`,
    );
    if (
      !includes(CONTEXT_DIFFERENCE_AXES, difference.axis) ||
      !nonEmpty(difference.description) ||
      axes.has(difference.axis)
    ) {
      throw new ProjectValidationError(
        "invalid_attempt",
        "transfer context differences must use distinct controlled axes with an explanation",
      );
    }
    axes.add(difference.axis);
  }
  const availableArtifactRefs = new Set(
    Array.isArray(artifactVersionRefs)
      ? artifactVersionRefs.flatMap((artifact) =>
          isRecord(artifact) &&
          nonEmpty(artifact.artifactId) &&
          positiveInteger(artifact.version)
            ? [`${artifact.artifactId}@${artifact.version}`]
            : [],
        )
      : [],
  );
  if (
    assessment.assessedArtifactVersionRefs.some(
      (ref) => !nonEmpty(ref) || !availableArtifactRefs.has(ref),
    )
  ) {
    throw new ProjectValidationError(
      "invalid_attempt",
      "transfer contextValidation references an artifact version outside the attempt",
    );
  }
  return {
    observedContextRef: assessment.observedContextRef,
    differenceAxes: [...axes].sort(),
    digest: createHash("sha256")
      .update(
        canonicalJson({
          baselineContextRef: assessment.baselineContextRef,
          observedContextRef: assessment.observedContextRef,
          differenceAxes: [...axes].sort(),
        }),
      )
      .digest("hex"),
  };
}

export function declaredTaskContextKey(context: unknown): string {
  const evidencePolicy =
    isRecord(context) && isRecord(context.evidencePolicy)
      ? context.evidencePolicy
      : null;
  if (!evidencePolicy || !nonEmpty(evidencePolicy.contextKey)) {
    throw new ProjectValidationError(
      "invalid_attempt",
      "project task lacks a declared evidence context",
    );
  }
  return evidencePolicy.contextKey;
}

/**
 * Evaluators submit rubric-scoped observations only. The shared persistence
 * layer revalidates the declaration before deriving any claim or learner state.
 */
export async function recordProjectObservation(
  persistence: PersistenceClient,
  input: {
    userId: string;
    attemptId: string;
    requirementId: string;
    score: number;
    evaluatorRunId: string;
    evaluator: {
      type: ProjectEvaluator;
      ref: string;
      evaluatorReliability: number;
      groundingReliability: number;
      evidenceStrength?: "weak" | "moderate" | "strong" | "decisive";
    };
    rawResult?: JsonObject;
    metadata?: JsonObject;
    observedAt?: Date;
  },
) {
  if (
    !includes(PROJECT_EVALUATORS, input.evaluator.type) ||
    !nonEmpty(input.evaluator.ref)
  ) {
    throw new ProjectValidationError(
      "invalid_attempt",
      "project observation requires a declared evaluator identity",
    );
  }
  const attempt = await persistence.taskAttempt.findUnique({
    where: { id: input.attemptId },
    include: { task: true },
  });
  if (
    !attempt ||
    attempt.userId !== input.userId ||
    attempt.task.taskType !== "project" ||
    (attempt.task.projectRole !== "root" &&
      attempt.task.projectRole !== "milestone") ||
    (attempt.status !== "submitted" && attempt.status !== "evaluated")
  ) {
    throw new ProjectValidationError(
      "not_found",
      "submitted project attempt not found",
    );
  }
  const requirement = await persistence.taskRequirement.findFirst({
    where: { id: input.requirementId, taskId: attempt.taskId },
    select: { rubricCriterion: true, dimension: true },
  });
  const rubric = requirement?.rubricCriterion;
  const criterionRef =
    isRecord(rubric) && nonEmpty(rubric.ref) ? rubric.ref : null;
  const criterion = criterionRef
    ? projectCriterionCatalog(
        attempt.task.constraintDefinitions,
        attempt.task.deliverableDefinitions,
      ).get(criterionRef)
    : undefined;
  if (
    !requirement ||
    !criterion ||
    !criterion.evaluators.includes(input.evaluator.type)
  ) {
    throw new ProjectValidationError(
      "undeclared_evaluator",
      "evaluator is not allowed for this project rubric criterion",
    );
  }
  let validatedContextLineage:
    | {
        key: string;
        observedContextRef: string;
        differenceAxes: string[];
      }
    | undefined;
  if (requirement.dimension === "transfer") {
    if (input.evaluator.type === "deterministic") {
      throw new ProjectValidationError(
        "undeclared_evaluator",
        "transfer novelty requires an authoritative human or grounded LLM evaluator",
      );
    }
    const validatedContext = validateTransferContextAssessment(
      input.rawResult,
      attempt.artifactVersionRefs,
    );
    validatedContextLineage = {
      key: `${declaredTaskContextKey(attempt.task.context)}#observed:${validatedContext.digest}`,
      observedContextRef: validatedContext.observedContextRef,
      differenceAxes: validatedContext.differenceAxes,
    };
  }
  const result = await recordTaskObservationCandidate(persistence, {
    userId: input.userId,
    attemptId: input.attemptId,
    candidate: {
      requirementId: input.requirementId,
      score: input.score,
      evaluatorRunId: input.evaluatorRunId,
      rawResult: input.rawResult ?? {},
      metadata: {
        ...(input.metadata ?? {}),
        projectEvaluatorRef: input.evaluator.ref,
        ...(validatedContextLineage ? { validatedContextLineage } : {}),
      },
      observedAt: input.observedAt,
    },
    evaluator: {
      evaluatorType: input.evaluator.type,
      evaluatorRef: input.evaluator.ref,
      ...(validatedContextLineage
        ? { contextLineageKey: validatedContextLineage.key }
        : {}),
      evaluatorReliability: input.evaluator.evaluatorReliability,
      groundingReliability: input.evaluator.groundingReliability,
      evidenceStrength: input.evaluator.evidenceStrength,
    },
  });
  const remainingRequired = await persistence.taskRequirement.count({
    where: {
      taskId: attempt.taskId,
      required: true,
      observations: {
        none: {
          attemptId: attempt.id,
          evidenceClaims: { some: { status: "active" } },
        },
      },
    },
  });
  if (remainingRequired === 0) {
    await persistence.taskAttempt.updateMany({
      where: { id: attempt.id, status: "submitted" },
      data: { status: "evaluated", completedAt: new Date() },
    });
  }
  return {
    ...result,
    attemptStatus:
      remainingRequired === 0 ? ("evaluated" as const) : ("submitted" as const),
  };
}
