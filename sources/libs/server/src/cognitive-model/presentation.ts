import type { PersistenceClient } from "../persistence/persistence-compat.js";
import type {
  CognitiveModelGoalReadRecord,
  CognitiveModelPresentationReadRepository,
  CognitiveModelExpansionLeaseRepository,
  CognitiveModelRevisionReadRecord,
  CognitiveModelUnitReadRecord,
  LearnerStateProjectionReadRepository,
} from "../../../domain/src/index.js";
import {
  getLearnerEntityStates,
  type LearnerEntityStateDto,
} from "../cognition/persistence.js";
import {
  aggregateLearningTargetState,
  completeness,
  presentDirectEntityState,
  projectSymmetricRelations,
  validateCognitiveModelSnapshot,
  type DirectEntityState,
} from "./pure.js";
import {
  COGNITIVE_MODEL_SCHEMA_VERSION,
  COGNITIVE_MODEL_VIEWS,
  type CognitiveModelSnapshot,
  type CognitiveModelView,
  type PresentedEntityState,
  type SnapshotLearningTarget,
} from "./types.js";
import { projectUnitConceptMap } from "./unit-concept-map.js";

function parseSnapshot(value: unknown): CognitiveModelSnapshot | null {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const snapshot = value as CognitiveModelSnapshot;
    validateCognitiveModelSnapshot(snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function lastGoodSnapshotFromRevisions(
  revisions: readonly CognitiveModelRevisionReadRecord[],
) {
  for (const revision of revisions) {
    if (revision.status !== "published" && revision.status !== "superseded") {
      continue;
    }
    if (
      !revision.isFullSnapshot ||
      revision.snapshotSchemaVersion !== COGNITIVE_MODEL_SCHEMA_VERSION
    ) {
      continue;
    }
    const snapshot = parseSnapshot(revision.snapshotJson);
    if (snapshot) return { revision, snapshot };
  }
  return null;
}

async function lastGoodSnapshot(persistence: PersistenceClient, goalId: string) {
  const revisions = await persistence.cognitiveModelRevision.findMany({
    where: {
      goalId,
      status: { in: ["published", "superseded"] },
      isFullSnapshot: true,
      snapshotSchemaVersion: COGNITIVE_MODEL_SCHEMA_VERSION,
    },
    orderBy: { version: "desc" },
  });
  for (const revision of revisions) {
    const snapshot = parseSnapshot(revision.snapshotJson);
    if (snapshot) return { revision, snapshot };
  }
  return null;
}

function targetCriterionText(
  criteria: Array<{ ref: string; text: string }>,
): string[] {
  return criteria.map((criterion) => criterion.text);
}

function stateMap(
  rows: ReadonlyMap<string, LearnerEntityStateDto>,
): Map<string, DirectEntityState> {
  return new Map(
    [...rows].map(([cognitiveEntityId, row]) => [
      cognitiveEntityId,
      {
        cognitiveEntityId,
        estimate: row.overallEstimate,
        evidenceSufficiency: row.evidenceSufficiency,
        status: row.status,
        inferenceVersion: row.inferencePolicyVersion,
        dimensions: row.dimensions.map((dimension) => ({
          dimension: dimension.dimension,
          estimate: dimension.estimate,
          evidenceSufficiency: dimension.evidenceSufficiency,
          evidenceWeight: dimension.effectiveEvidenceWeight,
          status: dimension.status,
          lastObservedAt: dimension.lastObservedAt,
        })),
      },
    ]),
  );
}

export type CognitiveModelPresentationInput = Readonly<{
  goalId: string;
  status: "pending" | "building" | "ready" | "needs_reconciliation" | "failed";
  version: number;
  view?: CognitiveModelView;
  snapshot: CognitiveModelSnapshot;
  states?: ReadonlyMap<string, DirectEntityState>;
  isStale: boolean;
  revision?: Record<string, unknown> | null;
}>;

function unmetPrerequisites(params: {
  target: SnapshotLearningTarget;
  snapshot: CognitiveModelSnapshot;
  states: ReadonlyMap<string, DirectEntityState>;
  includeLearnerState: boolean;
}) {
  if (!params.includeLearnerState) return [];
  const targetEntityIds = new Set(
    params.target.requirements.map((row) => row.entityId),
  );
  const prerequisites = params.snapshot.relations.filter(
    (relation) =>
      relation.relationType === "prerequisite" &&
      targetEntityIds.has(relation.toEntityId),
  );
  return prerequisites
    .map((relation) => {
      const entity = params.snapshot.entities.find(
        (candidate) => candidate.id === relation.fromEntityId,
      );
      if (!entity) return null;
      const requiredEstimate = Math.max(
        0.7,
        ...params.target.requirements
          .filter((requirement) => requirement.entityId === relation.toEntityId)
          .map((requirement) => requirement.threshold),
      );
      const state = params.states.get(entity.id);
      const ready =
        state?.estimate != null &&
        state.estimate >= requiredEstimate &&
        state.evidenceSufficiency >= 0.5 &&
        state.status !== "revalidate";
      const reason = ready
        ? null
        : state?.status === "revalidate"
          ? "revalidate"
          : state?.estimate == null
            ? "unverified"
            : state.evidenceSufficiency < 0.5
              ? "insufficient_evidence"
              : "below_threshold";
      return {
        entityId: entity.id,
        title: entity.title,
        requiredEstimate,
        estimate: state?.estimate ?? null,
        evidenceSufficiency: state?.evidenceSufficiency ?? 0,
        reason,
        ready,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null && !row.ready);
}

function presentTarget(params: {
  target: SnapshotLearningTarget;
  snapshot: CognitiveModelSnapshot;
  states: ReadonlyMap<string, DirectEntityState>;
  includeLearnerState: boolean;
  unitId?: string;
  visibleEntityIds: ReadonlySet<string>;
}) {
  const mapping =
    (params.unitId
      ? params.target.mappings.find(
          (candidate) => candidate.unitId === params.unitId,
        )
      : params.target.mappings[0]) ?? params.target.mappings[0];
  if (!mapping) return null;
  const state = params.includeLearnerState
    ? aggregateLearningTargetState(params.target, params.states)
    : null;
  const unmet = unmetPrerequisites({
    target: params.target,
    snapshot: params.snapshot,
    states: params.states,
    includeLearnerState: params.includeLearnerState,
  });
  let readiness:
    "ready" | "check_recommended" | "bridge_needed" | "demonstrated" = "ready";
  if (state?.status === "demonstrated" || state?.status === "robust") {
    readiness = "demonstrated";
  } else if (unmet.some((row) => row.reason === "below_threshold")) {
    readiness = "bridge_needed";
  } else if (unmet.length > 0) {
    readiness = "check_recommended";
  }
  return {
    id: params.target.id,
    stableKey: params.target.stableKey,
    localRef: mapping.localRef,
    title: params.target.title,
    description: params.target.description,
    learningObjective: params.target.learningObjective,
    assessmentCriteria: targetCriterionText(params.target.assessmentCriteria),
    targetCognitiveLevel: params.target.targetCognitiveLevel,
    importance: params.target.importance,
    importanceWeight: params.target.importanceWeight,
    difficulty: params.target.difficulty,
    planningOutcomeRefs: params.target.planningOutcomeRefs ?? [],
    requirements: params.target.requirements
      .filter((requirement) =>
        params.visibleEntityIds.has(requirement.entityId),
      )
      .map((requirement) => ({ ...requirement })),
    role: mapping.role,
    isEntry: mapping.isEntry,
    isExit: mapping.isExit,
    readiness,
    unmetPrerequisites: unmet,
    coverage: {
      summativeQuestions: 0,
      flashcards: 0,
    },
    unitIds: params.target.mappings.map((candidate) => candidate.unitId),
    state,
  };
}

export async function getGoalCognitiveModel(
  persistence: PersistenceClient | undefined,
  goalId: string,
  options: {
    view?: CognitiveModelView;
    userId?: string;
    presentationRead?: CognitiveModelPresentationReadRepository;
    stateRead?: LearnerStateProjectionReadRepository;
  } = {},
) {
  const view = options.view ?? "full";
  if (!COGNITIVE_MODEL_VIEWS.includes(view))
    throw new Error(`Invalid cognitive-model view ${view}`);
  if (!options.presentationRead && !persistence) {
    throw new Error(
      "Cognitive-model presentation persistence is not configured",
    );
  }
  const goal = options.presentationRead
    ? await options.presentationRead.findGoal({ goalId })
    : await persistence!.learningGoal.findUnique({
        where: { id: goalId },
        select: {
          id: true,
          cognitiveModelStatus: true,
          cognitiveModelVersion: true,
          cognitiveModelInputHash: true,
          cognitiveModelPublishedHash: true,
        },
      });
  if (!goal) throw new Error("Goal not found");
  const lastGood = options.presentationRead
    ? lastGoodSnapshotFromRevisions(
        (goal as CognitiveModelGoalReadRecord).revisions,
      )
    : await lastGoodSnapshot(persistence!, goalId);
  const emptySnapshot: CognitiveModelSnapshot = {
    schemaVersion: COGNITIVE_MODEL_SCHEMA_VERSION,
    goalId,
    inputHash: goal.cognitiveModelInputHash,
    entities: [],
    relations: [],
    components: [],
    learningTargets: [],
    units: [],
    audit: {},
  };
  const snapshot = lastGood?.snapshot ?? emptySnapshot;
  const allEntityIds = snapshot.entities.map((entity) => entity.id);
  const learnerRows = options.userId
    ? await getLearnerEntityStates(
        persistence,
        options.userId,
        allEntityIds,
        new Date(),
        options.stateRead,
      )
    : new Map<string, LearnerEntityStateDto>();
  const states = stateMap(learnerRows);
  return presentCognitiveModelSnapshot({
    goalId,
    status:
      goal.cognitiveModelStatus as CognitiveModelPresentationInput["status"],
    version: lastGood?.revision.version ?? 0,
    view,
    snapshot,
    states: options.userId ? states : undefined,
    isStale:
      goal.cognitiveModelInputHash !== goal.cognitiveModelPublishedHash ||
      snapshot.inputHash !== goal.cognitiveModelInputHash,
    revision: lastGood
      ? {
          version: lastGood.revision.version,
          status: lastGood.revision.status,
          scope: lastGood.revision.scope,
          inputHash: lastGood.revision.inputHash,
          snapshotSchemaVersion: lastGood.revision.snapshotSchemaVersion,
          isFullSnapshot: lastGood.revision.isFullSnapshot,
          audit: parseJsonValue(lastGood.revision.auditJson),
          publishedAt: lastGood.revision.publishedAt?.toISOString() ?? null,
          createdAt: lastGood.revision.createdAt.toISOString(),
        }
      : null,
  });
}

/** Shared hosted/local DTO boundary over an objective last-good snapshot. */
export function presentCognitiveModelSnapshot(
  input: CognitiveModelPresentationInput,
) {
  const { snapshot } = input;
  const view = input.view ?? "full";
  if (!COGNITIVE_MODEL_VIEWS.includes(view))
    throw new Error(`Invalid cognitive-model view ${view}`);
  const states = input.states ?? new Map<string, DirectEntityState>();
  const includeLearnerState = input.states !== undefined;
  const visibleEntities = snapshot.entities.filter((entity) =>
    view === "full"
      ? true
      : view === "atoms"
        ? entity.kind === "atom"
        : entity.kind !== "atom",
  );
  const visibleEntityIds = new Set(visibleEntities.map((entity) => entity.id));
  const visibleTargets = snapshot.learningTargets.filter((target) =>
    target.requirements.some((requirement) =>
      visibleEntityIds.has(requirement.entityId),
    ),
  );
  const targetIds = new Set(visibleTargets.map((target) => target.id));
  const relations = projectSymmetricRelations(snapshot.relations).filter(
    (relation) =>
      visibleEntityIds.has(relation.fromEntityId) &&
      visibleEntityIds.has(relation.toEntityId),
  );
  const learningTargets = visibleTargets
    .map((target) =>
      presentTarget({
        target,
        snapshot,
        states,
        includeLearnerState,
        visibleEntityIds,
      }),
    )
    .filter((target): target is NonNullable<typeof target> => target != null);
  const units = snapshot.units.map((unit) => ({
    unitId: unit.unitId,
    title: unit.title,
    parentUnitId: unit.parentUnitId,
    unitKind: unit.unitKind,
    curriculumOrder: unit.curriculumOrder,
    modelStatus: unit.modelStatus,
    prerequisiteUnitIds: unit.prerequisiteUnitIds,
    learningTargetIds: unit.learningTargetIds.filter((id) => targetIds.has(id)),
  }));
  const recommendationUnit =
    units.find((unit) => unit.modelStatus === "building") ??
    units.find((unit) => unit.modelStatus === "expanded") ??
    units.find((unit) => unit.unitKind === "lesson");
  return {
    goalId: input.goalId,
    status: input.status,
    version: input.version,
    view,
    entities: visibleEntities.map((entity) => ({
      id: entity.id,
      stableKey: entity.stableKey,
      kind: entity.kind,
      title: entity.title,
      description: entity.description,
      definitionVersion: entity.definitionVersion,
      language: entity.language,
      status: entity.status,
      atom: entity.atom
        ? {
            statement: entity.atom.statement,
            explanation: entity.atom.explanation,
            boundary:
              typeof entity.atom.boundary === "string"
                ? entity.atom.boundary
                : JSON.stringify(entity.atom.boundary),
            knowledgeForm: entity.atom.knowledgeForm,
          }
        : null,
      construct: entity.construct
        ? {
            inputDescription: entity.construct.inputs.join("；"),
            outputDescription: entity.construct.outputs.join("；"),
            qualityCriteria: entity.construct.qualityCriteria,
            aggregationPolicy: entity.construct.aggregationPolicy,
          }
        : null,
      state: includeLearnerState
        ? presentDirectEntityState(states.get(entity.id))
        : null,
    })),
    learningTargets,
    relations,
    units,
    completeness: completeness(snapshot.units),
    recommendation: recommendationUnit
      ? {
          unitId: recommendationUnit.unitId,
          reasonCode:
            recommendationUnit.modelStatus === "building"
              ? "continue_in_progress"
              : recommendationUnit.modelStatus === "expanded"
                ? "prerequisites_ready"
                : "expand_next",
        }
      : null,
    isStale: input.isStale,
    revision: input.revision ?? null,
  };
}

export async function getUnitLearningTargetsV2(
  persistence: PersistenceClient | undefined,
  unitId: string,
  options: {
    userId?: string;
    presentationRead?: CognitiveModelPresentationReadRepository;
    stateRead?: LearnerStateProjectionReadRepository;
  } = {},
) {
  const unit = options.presentationRead
    ? await options.presentationRead.findUnit({ unitId })
    : await persistence!.learningUnit.findUnique({
        where: { id: unitId },
        select: { goalId: true },
      });
  if (!unit) throw new Error("Unit not found");
  const snapshotResult = options.presentationRead
    ? lastGoodSnapshotFromRevisions(
        (unit as CognitiveModelUnitReadRecord).revisions,
      )
    : await lastGoodSnapshot(persistence!, unit.goalId);
  if (!snapshotResult) return { learningTargets: [] };
  const statesRows = options.userId
    ? await getLearnerEntityStates(
        persistence,
        options.userId,
        snapshotResult.snapshot.entities.map((entity) => entity.id),
        new Date(),
        options.stateRead,
      )
    : new Map<string, LearnerEntityStateDto>();
  const states = stateMap(statesRows);
  const visibleEntityIds = new Set(
    snapshotResult.snapshot.entities.map((entity) => entity.id),
  );
  const learningTargets = snapshotResult.snapshot.learningTargets
    .filter((target) =>
      target.mappings.some((mapping) => mapping.unitId === unitId),
    )
    .map((target) =>
      presentTarget({
        target,
        snapshot: snapshotResult.snapshot,
        states,
        includeLearnerState: Boolean(options.userId),
        unitId,
        visibleEntityIds,
      }),
    )
    .filter((target): target is NonNullable<typeof target> => target != null);
  return { learningTargets };
}

export async function getUnitConceptMap(
  persistence: PersistenceClient | undefined,
  unitId: string,
  presentationRead?: CognitiveModelPresentationReadRepository,
) {
  const readUnit = presentationRead
    ? await presentationRead.findUnit({ unitId })
    : null;
  const unit =
    readUnit ??
    (await persistence!.learningUnit.findUnique({
      where: { id: unitId },
      select: {
        goalId: true,
        title: true,
        cognitiveModelStatus: true,
        cognitiveModelBuildInputHash: true,
        goal: {
          select: {
            cognitiveModelStatus: true,
            cognitiveModelInputHash: true,
            cognitiveModelPublishedHash: true,
          },
        },
      },
    }));
  if (!unit) throw new Error("Unit not found");

  const lastGood = readUnit
    ? lastGoodSnapshotFromRevisions(readUnit.revisions)
    : await lastGoodSnapshot(persistence!, unit.goalId);
  const projected = lastGood
    ? projectUnitConceptMap(lastGood.snapshot, unitId)
    : null;
  const goalStatus = readUnit
    ? readUnit.goalCognitiveModelStatus
    : (
        unit as {
          goal: { cognitiveModelStatus: string };
        }
      ).goal.cognitiveModelStatus;
  const goalInputHash = readUnit
    ? readUnit.goalCognitiveModelInputHash
    : (
        unit as {
          goal: { cognitiveModelInputHash: string };
        }
      ).goal.cognitiveModelInputHash;
  const goalPublishedHash = readUnit
    ? readUnit.goalCognitiveModelPublishedHash
    : (
        unit as {
          goal: { cognitiveModelPublishedHash: string | null };
        }
      ).goal.cognitiveModelPublishedHash;
  const isBuilding =
    unit.cognitiveModelStatus === "building" || goalStatus === "building";
  const isStale = Boolean(
    lastGood &&
    (goalInputHash !== goalPublishedHash ||
      lastGood.snapshot.inputHash !== goalInputHash),
  );

  if (!projected || projected.nodes.length < 2) {
    return {
      unitId,
      title: projected?.title ?? unit.title,
      status: isBuilding ? ("building" as const) : ("unavailable" as const),
      modelVersion: lastGood?.revision.version ?? 0,
      isStale,
      nodes: [],
      edges: [],
    };
  }

  return {
    ...projected,
    status: "ready" as const,
    modelVersion: lastGood?.revision.version ?? 0,
    isStale,
  };
}

export async function waitForUnitLearningTargetsPublication(
  persistence: PersistenceClient | undefined,
  unitId: string,
  inputHash: string,
  options: {
    userId?: string;
    timeoutMs?: number;
    pollMs?: number;
    expansionLease?: CognitiveModelExpansionLeaseRepository;
    presentationRead?: CognitiveModelPresentationReadRepository;
    stateRead?: LearnerStateProjectionReadRepository;
  } = {},
) {
  const unit = options.presentationRead
    ? await options.presentationRead.findUnit({ unitId })
    : await persistence!.learningUnit.findUnique({
        where: { id: unitId },
        select: { goalId: true },
      });
  if (!unit) throw new Error("Unit not found");

  const deadline = Date.now() + (options.timeoutMs ?? 15 * 60 * 1_000);
  const pollMs = options.pollMs ?? 2_000;
  while (Date.now() <= deadline) {
    const portableState = options.expansionLease
      ? await options.expansionLease.readState({ goalId: unit.goalId, unitId })
      : null;
    const [goal, currentUnit] = portableState
      ? [
          {
            cognitiveModelInputHash: portableState.goalInputHash,
            cognitiveModelPublishedHash: portableState.goalPublishedHash,
            cognitiveModelStatus: portableState.goalStatus,
          },
          {
            cognitiveModelStatus: portableState.unitStatus,
            cognitiveModelBuildInputHash: portableState.unitInputHash,
          },
        ]
      : await Promise.all([
      persistence!.learningGoal.findUnique({
        where: { id: unit.goalId },
        select: {
          cognitiveModelInputHash: true,
          cognitiveModelPublishedHash: true,
          cognitiveModelStatus: true,
        },
      }),
      persistence!.learningUnit.findUnique({
        where: { id: unitId },
        select: {
          cognitiveModelStatus: true,
          cognitiveModelBuildInputHash: true,
        },
      }),
    ]);
    if (!goal || !currentUnit) throw new Error("Goal or unit not found");
    if (goal.cognitiveModelInputHash !== inputHash) {
      throw new Error(
        "Course map changed while waiting for cognitive-model publication",
      );
    }
    if (
      goal.cognitiveModelPublishedHash === inputHash &&
      currentUnit.cognitiveModelStatus === "expanded" &&
      currentUnit.cognitiveModelBuildInputHash === inputHash
    ) {
      const result = await getUnitLearningTargetsV2(persistence, unitId, {
        ...(options.userId ? { userId: options.userId } : {}),
        presentationRead: options.presentationRead,
        stateRead: options.stateRead,
      });
      if (result.learningTargets.length === 0) {
        throw new Error(
          "Cognitive model published without learning targets for the unit",
        );
      }
      return result;
    }
    if (goal.cognitiveModelStatus === "failed") {
      throw new Error("Cognitive-model publication failed");
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error("Timed out waiting for cognitive-model publication");
}
