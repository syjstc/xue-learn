// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import type { Persistence, PersistenceClient } from "../../persistence/persistence-compat.js";
import type {
  LearnerStateMemoryInvalidationRepository,
  LearnerStateProjectionReadRepository,
} from "../../../../domain/src/index.js";
import { assertEvidenceClaim } from "../evidence.js";
import {
  calculateEvidenceContribution,
  DEFAULT_DIMENSION_INFERENCE_THRESHOLDS,
} from "../inference.js";
import {
  COGNITIVE_DIMENSIONS,
  EVIDENCE_SUFFICIENCY_REASONS,
  LEARNER_COGNITIVE_STATES,
  type CognitiveDimension,
  type EvidenceClaim as DomainEvidenceClaim,
  type EvidenceStrength,
  type EvidenceSufficiencyReason,
  type LearnerCognitiveState,
  isAssistanceLevel,
  isCognitiveDimension,
  isCognitiveEntityKind,
  isContextDistance,
  isEvidenceEvaluator,
  isEvidenceSource,
  isEvidenceStrength,
  isEvidenceTaskKind,
} from "../types.js";
import {
  CognitionPersistenceError,
  COGNITION_INFERENCE_VERSION,
} from "./error.js";
import {
  assistanceFromAttempt,
  canReadEntity,
  firstArtifactId,
  isRecord,
  jsonInput,
  nonEmpty,
  refreshGapProjection,
  taskPolicyFromContext,
  withLearnerEntityStateLock,
} from "./shared.js";
import {
  evidenceClaimIsActive,
  evidenceLifecycleStatus,
  latestEvidenceLifecycleEvent,
} from "./lifecycle.js";
import {
  buildLearnerDimensionProjection,
  buildLearnerEntityProjection,
  materializedDimensionProjection,
  summarizeLearnerDimensionProjections,
} from "./projection.js";
import type {
  EvidenceClaimDto,
  LearnerDimensionStateDto,
  LearnerEntityEvidenceDto,
  LearnerEntityProjection,
  LearnerEntityStateDto,
  LifecycleEventProjection,
} from "./types.js";

export type ClaimForInference = Persistence.EvidenceClaimGetPayload<{
  include: {
    cognitiveEntity: true;
    observation: { include: { attempt: { include: { task: true } } } };
    lifecycleEvents: true;
  };
}>;

/** Pure claim projection shared by Persistence and transaction-owned ORM adapters. */
export function claimToDomain(claim: ClaimForInference): DomainEvidenceClaim {
  const metadata = isRecord(claim.observation.metadata)
    ? claim.observation.metadata
    : {};
  const source = metadata.evidenceSource;
  const taskKind = metadata.evidenceTaskKind;
  const contextDistance = metadata.contextDistance;
  const assistanceValue = metadata.assistance;
  const assistance =
    isRecord(assistanceValue) &&
    isAssistanceLevel(assistanceValue.level) &&
    typeof assistanceValue.hintCount === "number" &&
    typeof assistanceValue.answerRevealed === "boolean"
      ? {
          level: assistanceValue.level,
          hintCount: assistanceValue.hintCount,
          answerRevealed: assistanceValue.answerRevealed,
        }
      : assistanceFromAttempt(claim.observation.attempt);
  if (
    !isEvidenceSource(source) ||
    !isEvidenceTaskKind(taskKind) ||
    !isContextDistance(contextDistance) ||
    !isCognitiveDimension(claim.dimension) ||
    !isCognitiveEntityKind(claim.cognitiveEntity.kind) ||
    !isEvidenceEvaluator(claim.observation.evaluatorType)
  ) {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      `claim ${claim.id} contains an invalid persisted evidence declaration`,
    );
  }
  const strengthValue = metadata.evidenceStrength;
  const strength: EvidenceStrength = isEvidenceStrength(strengthValue)
    ? strengthValue
    : claim.strength >= 2
      ? "decisive"
      : claim.strength >= 1.5
        ? "strong"
        : claim.strength >= 1
          ? "moderate"
          : "weak";
  const artifactId = firstArtifactId(claim.observation.attempt.artifactRefs);
  const policy = taskPolicyFromContext(claim.observation.attempt.task.context);
  const domainClaim: DomainEvidenceClaim = {
    id: claim.id,
    learnerId: claim.userId,
    target: {
      id: claim.cognitiveEntityId,
      kind: claim.cognitiveEntity.kind,
      definitionVersion: claim.definitionVersion,
    },
    task: {
      id: claim.observation.attempt.taskId,
      kind: taskKind,
      contextId: claim.contextKey,
      contextDistance,
      ...(claim.observation.attempt.durationMs
        ? { durationMs: claim.observation.attempt.durationMs }
        : {}),
      ...(typeof metadata.delayedDays === "number"
        ? { delayedDays: metadata.delayedDays }
        : {}),
      ...(artifactId ? { artifactId } : {}),
      ...(policy.rubricId ? { rubricId: policy.rubricId } : {}),
    },
    source,
    dimension: claim.dimension,
    score: claim.score,
    evaluator: claim.observation.evaluatorType,
    evaluatorReliability:
      claim.evaluatorReliability * claim.groundingReliability,
    strength,
    assistance,
    observedAt: claim.observation.observedAt.toISOString(),
  };
  assertEvidenceClaim(domainClaim);
  return domainClaim;
}

function learnerEntityProjectionDto(
  projection: LearnerEntityProjection,
  revision: LearnerStateRevisionMetadata,
): LearnerEntityStateDto {
  return {
    overallEstimate: projection.estimate,
    evidenceSufficiency: projection.evidenceSufficiency,
    status: projection.status,
    inferencePolicyVersion: COGNITION_INFERENCE_VERSION,
    stateRevision: revision.revision,
    evidenceCutoffAt: revision.evidenceCutoffAt?.toISOString() ?? null,
    lifecycleCutoffAt: revision.lifecycleCutoffAt?.toISOString() ?? null,
    dimensions: projection.dimensions.map((dimension) => ({
      dimension: dimension.dimension,
      estimate: dimension.estimate,
      evidenceSufficiency: dimension.evidenceSufficiency,
      evidenceSufficiencyReasons: dimension.evidenceSufficiencyReasons,
      status: dimension.status,
      effectiveEvidenceWeight: dimension.effectiveEvidenceWeight,
      lastObservedAt: dimension.lastObservedAt,
    })),
  };
}

type LearnerStateRevisionMetadata = {
  revision: number;
  evidenceCutoffAt: Date | null;
  lifecycleCutoffAt: Date | null;
};

type RevisionClaim = {
  id: string;
  createdAt: Date;
  lifecycleEvents?: readonly LifecycleEventProjection[];
};

function laterCutoff(
  first: Date | null | undefined,
  second: Date | null | undefined,
): Date | null {
  if (!first) return second ?? null;
  if (!second) return first;
  return first >= second ? first : second;
}

function stableJsonStringify(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (isRecord(item)) {
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, normalize(item[key])]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

async function appendLearnerStateRevisionIfChanged(
  persistence: PersistenceClient,
  input: {
    userId: string;
    cognitiveEntityId: string;
    projection: LearnerEntityProjection;
    claims: readonly RevisionClaim[];
    asOf: Date;
  },
): Promise<LearnerStateRevisionMetadata> {
  const revisionRepository = (
    persistence as unknown as {
      learnerStateRevision?: PersistenceClient["learnerStateRevision"];
    }
  ).learnerStateRevision;
  if (!revisionRepository) {
    return {
      revision: 0,
      evidenceCutoffAt:
        [...input.claims]
          .filter((claim) => claim.createdAt <= input.asOf)
          .sort(
            (left, right) =>
              right.createdAt.getTime() - left.createdAt.getTime(),
          )[0]?.createdAt ?? null,
      lifecycleCutoffAt:
        input.claims
          .flatMap((claim) => claim.lifecycleEvents ?? [])
          .filter((event) => event.createdAt <= input.asOf)
          .reduce<Date | null>(
            (latest, event) => laterCutoff(latest, event.createdAt),
            null,
          ) ?? null,
    };
  }
  const previous = await revisionRepository.findFirst({
    where: {
      userId: input.userId,
      cognitiveEntityId: input.cognitiveEntityId,
    },
    orderBy: { revision: "desc" },
  });
  const latestClaim = [...input.claims]
    .filter((claim) => claim.createdAt <= input.asOf)
    .sort(
      (left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() ||
        right.id.localeCompare(left.id),
    )[0];
  const claimCutoff = latestClaim?.createdAt ?? null;
  const lifecycleCutoff = input.claims
    .flatMap((claim) => claim.lifecycleEvents ?? [])
    .filter((event) => event.createdAt <= input.asOf)
    .reduce<Date | null>(
      (latest, event) => laterCutoff(latest, event.createdAt),
      null,
    );
  const evidenceCutoffAt = laterCutoff(previous?.evidenceCutoffAt, claimCutoff);
  const evidenceCutoffClaimId =
    claimCutoff &&
    (!previous?.evidenceCutoffAt || claimCutoff >= previous.evidenceCutoffAt)
      ? latestClaim?.id
      : previous?.evidenceCutoffClaimId;
  const lifecycleCutoffAt = laterCutoff(
    previous?.lifecycleCutoffAt,
    lifecycleCutoff,
  );
  const summarySnapshot = {
    estimate: input.projection.estimate,
    evidenceSufficiency: input.projection.evidenceSufficiency,
    status: input.projection.status,
    lastObservedAt: input.projection.lastObservedAt?.toISOString() ?? null,
  };
  const dimensionSnapshot = input.projection.dimensions.map((dimension) => ({
    dimension: dimension.dimension,
    estimate: dimension.estimate,
    evidenceSufficiency: dimension.evidenceSufficiency,
    evidenceSufficiencyReasons: dimension.evidenceSufficiencyReasons,
    status: dimension.status,
    alpha: dimension.alpha,
    beta: dimension.beta,
    effectiveEvidenceWeight: dimension.effectiveEvidenceWeight,
    observationCount: dimension.observationCount,
    lastObservedAt: dimension.lastObservedAt,
  }));
  const unchanged = Boolean(
    previous &&
    previous.inferenceVersion === COGNITION_INFERENCE_VERSION &&
    stableJsonStringify(previous.summarySnapshot) ===
      stableJsonStringify(summarySnapshot) &&
    stableJsonStringify(previous.dimensionSnapshot) ===
      stableJsonStringify(dimensionSnapshot),
  );
  if (unchanged && previous) {
    return {
      revision: previous.revision,
      evidenceCutoffAt: previous.evidenceCutoffAt,
      lifecycleCutoffAt: previous.lifecycleCutoffAt,
    };
  }
  const created = await revisionRepository.create({
    data: {
      userId: input.userId,
      cognitiveEntityId: input.cognitiveEntityId,
      revision: (previous?.revision ?? 0) + 1,
      evidenceCutoffAt,
      evidenceCutoffClaimId,
      lifecycleCutoffAt,
      inferenceVersion: COGNITION_INFERENCE_VERSION,
      estimate: input.projection.estimate,
      evidenceSufficiency: input.projection.evidenceSufficiency,
      status: input.projection.status,
      summarySnapshot: jsonInput(summarySnapshot),
      dimensionSnapshot: jsonInput(dimensionSnapshot),
    },
  });
  return {
    revision: created.revision,
    evidenceCutoffAt: created.evidenceCutoffAt,
    lifecycleCutoffAt: created.lifecycleCutoffAt,
  };
}

async function replayLearnerEntityStateUnlocked(
  persistence: PersistenceClient,
  userId: string,
  cognitiveEntityId: string,
  asOf = new Date(),
): Promise<LearnerEntityStateDto> {
  const entity = await persistence.cognitiveEntity.findUnique({
    where: { id: cognitiveEntityId },
    select: {
      id: true,
      kind: true,
      title: true,
      definitionVersion: true,
      status: true,
      scope: true,
      ownerUserId: true,
      goal: { select: { userId: true } },
    },
  });
  if (
    !entity ||
    entity.status !== "active" ||
    !isCognitiveEntityKind(entity.kind) ||
    !canReadEntity(entity, userId)
  ) {
    throw new CognitionPersistenceError(
      "not_found",
      "active cognitive entity not found",
    );
  }
  const persistedClaimRows = await persistence.evidenceClaim.findMany({
    where: {
      userId,
      cognitiveEntityId,
      definitionVersion: entity.definitionVersion,
      validFrom: { lte: asOf },
    },
    include: {
      cognitiveEntity: true,
      observation: { include: { attempt: { include: { task: true } } } },
      lifecycleEvents: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const claimRows = persistedClaimRows.filter((claim) =>
    evidenceClaimIsActive(claim, asOf),
  );
  const claims = claimRows.map(claimToDomain);
  const projection = buildLearnerEntityProjection(
    userId,
    cognitiveEntityId,
    entity.kind,
    entity.definitionVersion,
    claims,
    asOf,
  );
  const latestClaim = [...claimRows].sort(claimRecency)[0];
  const state = await persistence.learnerEntityState.upsert({
    where: { userId_cognitiveEntityId: { userId, cognitiveEntityId } },
    create: {
      userId,
      cognitiveEntityId,
      estimate: projection.estimate,
      evidenceSufficiency: projection.evidenceSufficiency,
      status: projection.status,
      lastObservedAt: projection.lastObservedAt,
      lastEvidenceClaimId: latestClaim?.id,
      inferenceVersion: COGNITION_INFERENCE_VERSION,
    },
    update: {
      estimate: projection.estimate,
      evidenceSufficiency: projection.evidenceSufficiency,
      status: projection.status,
      lastObservedAt: projection.lastObservedAt,
      lastEvidenceClaimId: latestClaim?.id ?? null,
      inferenceVersion: COGNITION_INFERENCE_VERSION,
    },
  });
  await Promise.all(
    projection.dimensions.map((dimension) =>
      persistence.learnerDimensionState.upsert({
        where: {
          learnerEntityStateId_dimension: {
            learnerEntityStateId: state.id,
            dimension: dimension.dimension,
          },
        },
        create: {
          learnerEntityStateId: state.id,
          dimension: dimension.dimension,
          estimate: dimension.estimate,
          evidenceSufficiency: dimension.evidenceSufficiency,
          evidenceSufficiencyReasons: jsonInput(
            dimension.evidenceSufficiencyReasons,
          ),
          status: dimension.status,
          alpha: dimension.alpha,
          beta: dimension.beta,
          evidenceWeight: dimension.effectiveEvidenceWeight,
          observationCount: dimension.observationCount,
          lastObservedAt: dimension.lastObservedAt
            ? new Date(dimension.lastObservedAt)
            : null,
          inferenceVersion: COGNITION_INFERENCE_VERSION,
        },
        update: {
          estimate: dimension.estimate,
          evidenceSufficiency: dimension.evidenceSufficiency,
          evidenceSufficiencyReasons: jsonInput(
            dimension.evidenceSufficiencyReasons,
          ),
          status: dimension.status,
          alpha: dimension.alpha,
          beta: dimension.beta,
          evidenceWeight: dimension.effectiveEvidenceWeight,
          observationCount: dimension.observationCount,
          lastObservedAt: dimension.lastObservedAt
            ? new Date(dimension.lastObservedAt)
            : null,
          inferenceVersion: COGNITION_INFERENCE_VERSION,
        },
      }),
    ),
  );
  const revision = await appendLearnerStateRevisionIfChanged(persistence, {
    userId,
    cognitiveEntityId,
    projection,
    claims: persistedClaimRows,
    asOf,
  });
  return learnerEntityProjectionDto(projection, revision);
}

export async function replayLearnerEntityState(
  persistence: PersistenceClient,
  userId: string,
  cognitiveEntityId: string,
  asOf = new Date(),
): Promise<LearnerEntityStateDto> {
  return withLearnerEntityStateLock(persistence, userId, cognitiveEntityId, (tx) =>
    replayLearnerEntityStateUnlocked(
      tx as unknown as PersistenceClient,
      userId,
      cognitiveEntityId,
      asOf,
    ),
  );
}

/**
 * Bounded append path: query and infer only the changed dimension, then fold
 * that result into the seven already-materialized dimension projections.
 * Lifecycle changes and definition/policy upgrades intentionally fall back to
 * full replay because they can remove or reinterpret prior contributions.
 */
async function refreshLearnerEntityStateUnlocked(
  persistence: PersistenceClient,
  userId: string,
  cognitiveEntityId: string,
  changedDimension: CognitiveDimension,
  asOf = new Date(),
): Promise<LearnerEntityStateDto> {
  if (!isCognitiveDimension(changedDimension)) {
    throw new CognitionPersistenceError(
      "invalid_candidate",
      "incremental refresh requires the changed cognitive dimension",
    );
  }
  const entity = await persistence.cognitiveEntity.findUnique({
    where: { id: cognitiveEntityId },
    select: {
      id: true,
      kind: true,
      definitionVersion: true,
      status: true,
      scope: true,
      ownerUserId: true,
      goal: { select: { userId: true } },
    },
  });
  if (
    !entity ||
    entity.status !== "active" ||
    !isCognitiveEntityKind(entity.kind) ||
    !canReadEntity(entity, userId)
  ) {
    throw new CognitionPersistenceError(
      "not_found",
      "active cognitive entity not found",
    );
  }
  const materialized = await persistence.learnerEntityState.findUnique({
    where: { userId_cognitiveEntityId: { userId, cognitiveEntityId } },
    include: {
      dimensions: true,
      lastEvidenceClaim: {
        select: {
          definitionVersion: true,
          observation: { select: { observedAt: true } },
        },
      },
    },
  });
  const storedDimensions = materialized?.dimensions ?? [];
  const storedDimensionNames = new Set(
    storedDimensions.map((dimension) => dimension.dimension),
  );
  const invalidMaterialization = Boolean(
    materialized &&
    (materialized.inferenceVersion !== COGNITION_INFERENCE_VERSION ||
      storedDimensions.length !== COGNITIVE_DIMENSIONS.length ||
      storedDimensionNames.size !== COGNITIVE_DIMENSIONS.length ||
      storedDimensions.some(
        (dimension) =>
          !isCognitiveDimension(dimension.dimension) ||
          dimension.inferenceVersion !== COGNITION_INFERENCE_VERSION,
      ) ||
      (materialized.lastEvidenceClaim &&
        materialized.lastEvidenceClaim.definitionVersion !==
          entity.definitionVersion)),
  );
  if (invalidMaterialization) {
    return replayLearnerEntityStateUnlocked(
      persistence,
      userId,
      cognitiveEntityId,
      asOf,
    );
  }

  const persistedClaimRows = await persistence.evidenceClaim.findMany({
    where: {
      userId,
      cognitiveEntityId,
      dimension: changedDimension,
      definitionVersion: entity.definitionVersion,
      validFrom: { lte: asOf },
    },
    include: {
      cognitiveEntity: true,
      observation: { include: { attempt: { include: { task: true } } } },
      lifecycleEvents: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const claimRows = persistedClaimRows.filter((claim) =>
    evidenceClaimIsActive(claim, asOf),
  );
  const changedProjection = buildLearnerDimensionProjection(
    userId,
    cognitiveEntityId,
    entity.kind,
    entity.definitionVersion,
    changedDimension,
    claimRows.map(claimToDomain),
    asOf,
  );
  const storedByDimension = new Map(
    storedDimensions.flatMap((dimension) =>
      isCognitiveDimension(dimension.dimension)
        ? ([[dimension.dimension, dimension]] as const)
        : [],
    ),
  );
  const dimensions = COGNITIVE_DIMENSIONS.map((dimension) =>
    dimension === changedDimension
      ? changedProjection
      : materializedDimensionProjection(
          dimension,
          storedByDimension.get(dimension) ?? null,
          asOf,
        ),
  );
  const summary = summarizeLearnerDimensionProjections(dimensions);
  const projection: LearnerEntityProjection = { ...summary, dimensions };
  const latestChangedClaim = [...claimRows].sort(claimRecency)[0];
  const existingLastObservedAt =
    materialized?.lastEvidenceClaim?.observation.observedAt ??
    materialized?.lastObservedAt ??
    null;
  const changedIsLatest = Boolean(
    latestChangedClaim &&
    (!existingLastObservedAt ||
      latestChangedClaim.observation.observedAt.getTime() >=
        existingLastObservedAt.getTime()),
  );
  const lastEvidenceClaimId = changedIsLatest
    ? latestChangedClaim!.id
    : (materialized?.lastEvidenceClaimId ?? null);
  const state = await persistence.learnerEntityState.upsert({
    where: { userId_cognitiveEntityId: { userId, cognitiveEntityId } },
    create: {
      userId,
      cognitiveEntityId,
      estimate: projection.estimate,
      evidenceSufficiency: projection.evidenceSufficiency,
      status: projection.status,
      lastObservedAt: projection.lastObservedAt,
      lastEvidenceClaimId: lastEvidenceClaimId ?? undefined,
      inferenceVersion: COGNITION_INFERENCE_VERSION,
    },
    update: {
      estimate: projection.estimate,
      evidenceSufficiency: projection.evidenceSufficiency,
      status: projection.status,
      lastObservedAt: projection.lastObservedAt,
      lastEvidenceClaimId,
      inferenceVersion: COGNITION_INFERENCE_VERSION,
    },
  });
  const projectionsToPersist = materialized
    ? dimensions.filter((dimension) => {
        if (dimension.dimension === changedDimension) return true;
        const stored = storedByDimension.get(dimension.dimension);
        return Boolean(stored && stored.status !== dimension.status);
      })
    : dimensions;
  await Promise.all(
    projectionsToPersist.map((dimension) =>
      persistence.learnerDimensionState.upsert({
        where: {
          learnerEntityStateId_dimension: {
            learnerEntityStateId: state.id,
            dimension: dimension.dimension,
          },
        },
        create: {
          learnerEntityStateId: state.id,
          dimension: dimension.dimension,
          estimate: dimension.estimate,
          evidenceSufficiency: dimension.evidenceSufficiency,
          evidenceSufficiencyReasons: jsonInput(
            dimension.evidenceSufficiencyReasons,
          ),
          status: dimension.status,
          alpha: dimension.alpha,
          beta: dimension.beta,
          evidenceWeight: dimension.effectiveEvidenceWeight,
          observationCount: dimension.observationCount,
          lastObservedAt: dimension.lastObservedAt
            ? new Date(dimension.lastObservedAt)
            : null,
          inferenceVersion: COGNITION_INFERENCE_VERSION,
        },
        update: {
          estimate: dimension.estimate,
          evidenceSufficiency: dimension.evidenceSufficiency,
          evidenceSufficiencyReasons: jsonInput(
            dimension.evidenceSufficiencyReasons,
          ),
          status: dimension.status,
          alpha: dimension.alpha,
          beta: dimension.beta,
          evidenceWeight: dimension.effectiveEvidenceWeight,
          observationCount: dimension.observationCount,
          lastObservedAt: dimension.lastObservedAt
            ? new Date(dimension.lastObservedAt)
            : null,
          inferenceVersion: COGNITION_INFERENCE_VERSION,
        },
      }),
    ),
  );
  const revision = await appendLearnerStateRevisionIfChanged(persistence, {
    userId,
    cognitiveEntityId,
    projection,
    claims: persistedClaimRows,
    asOf,
  });
  return learnerEntityProjectionDto(projection, revision);
}

export async function refreshLearnerEntityState(
  persistence: PersistenceClient,
  userId: string,
  cognitiveEntityId: string,
  changedDimension: CognitiveDimension,
  asOf = new Date(),
): Promise<LearnerEntityStateDto> {
  if (!isCognitiveDimension(changedDimension)) {
    throw new CognitionPersistenceError(
      "invalid_candidate",
      "incremental refresh requires the changed cognitive dimension",
    );
  }
  return withLearnerEntityStateLock(persistence, userId, cognitiveEntityId, (tx) =>
    refreshLearnerEntityStateUnlocked(
      tx as unknown as PersistenceClient,
      userId,
      cognitiveEntityId,
      changedDimension,
      asOf,
    ),
  );
}

function emptyDimension(
  dimension: CognitiveDimension,
): LearnerDimensionStateDto {
  return {
    dimension,
    estimate: null,
    evidenceSufficiency: 0,
    evidenceSufficiencyReasons: ["no_evidence"],
    status: "unobserved",
    effectiveEvidenceWeight: 0,
    lastObservedAt: null,
  };
}

type MaterializedLearnerEntityState = Persistence.LearnerEntityStateGetPayload<{
  include: { dimensions: true };
}>;

type StateFreshnessClaim = {
  id: string;
  cognitiveEntityId: string;
  dimension: string;
  definitionVersion: number;
  status: string;
  validFrom: Date;
  createdAt: Date;
  observation: { observedAt: Date };
  lifecycleEvents: LifecycleEventProjection[];
};

function emptyLearnerEntityState(): LearnerEntityStateDto {
  return {
    overallEstimate: null,
    evidenceSufficiency: 0,
    status: "unobserved",
    inferencePolicyVersion: COGNITION_INFERENCE_VERSION,
    stateRevision: 0,
    evidenceCutoffAt: null,
    lifecycleCutoffAt: null,
    dimensions: COGNITIVE_DIMENSIONS.map(emptyDimension),
  };
}

function projectionReadDto(
  state: import("../../../../domain/src/index.js").LearnerStateProjectionReadRecord,
): LearnerEntityStateDto {
  const dimensions = new Map(
    state.dimensions
      .filter((dimension) => isCognitiveDimension(dimension.dimension))
      .map((dimension) => [dimension.dimension, dimension] as const),
  );
  return {
    overallEstimate: state.overallEstimate,
    evidenceSufficiency: state.evidenceSufficiency,
    status: state.status as LearnerCognitiveState,
    inferencePolicyVersion: state.inferencePolicyVersion,
    stateRevision: state.stateRevision,
    evidenceCutoffAt: state.evidenceCutoffAt?.toISOString() ?? null,
    lifecycleCutoffAt: state.lifecycleCutoffAt?.toISOString() ?? null,
    dimensions: COGNITIVE_DIMENSIONS.map((dimension) => {
      const stored = dimensions.get(dimension);
      if (!stored) return emptyDimension(dimension);
      const reasons = Array.isArray(stored.evidenceSufficiencyReasons)
        ? stored.evidenceSufficiencyReasons.filter(
            (reason): reason is EvidenceSufficiencyReason =>
              typeof reason === "string" &&
              EVIDENCE_SUFFICIENCY_REASONS.includes(
                reason as EvidenceSufficiencyReason,
              ),
          )
        : [];
      return {
        dimension,
        estimate: stored.estimate,
        evidenceSufficiency: stored.evidenceSufficiency,
        evidenceSufficiencyReasons:
          reasons.length > 0
            ? reasons
            : stored.estimate === null
              ? ["no_evidence"]
              : ["low_effective_weight"],
        status: stored.status as LearnerCognitiveState,
        effectiveEvidenceWeight: stored.effectiveEvidenceWeight,
        lastObservedAt: stored.lastObservedAt?.toISOString() ?? null,
      };
    }),
  };
}

function materializedStateDto(
  state: MaterializedLearnerEntityState,
  revision: LearnerStateRevisionMetadata = {
    revision: 0,
    evidenceCutoffAt: null,
    lifecycleCutoffAt: null,
  },
): LearnerEntityStateDto {
  const byDimension = new Map(
    state.dimensions.flatMap((dimension) =>
      isCognitiveDimension(dimension.dimension)
        ? ([[dimension.dimension, dimension]] as const)
        : [],
    ),
  );
  return {
    overallEstimate: state.estimate,
    evidenceSufficiency: state.evidenceSufficiency,
    status: state.status as LearnerCognitiveState,
    inferencePolicyVersion: state.inferenceVersion,
    stateRevision: revision.revision,
    evidenceCutoffAt: revision.evidenceCutoffAt?.toISOString() ?? null,
    lifecycleCutoffAt: revision.lifecycleCutoffAt?.toISOString() ?? null,
    dimensions: COGNITIVE_DIMENSIONS.map((dimension) => {
      const stored = byDimension.get(dimension);
      return stored
        ? {
            dimension,
            estimate: stored.estimate,
            evidenceSufficiency: stored.evidenceSufficiency,
            evidenceSufficiencyReasons: Array.isArray(
              stored.evidenceSufficiencyReasons,
            )
              ? stored.evidenceSufficiencyReasons.filter(
                  (reason): reason is EvidenceSufficiencyReason =>
                    typeof reason === "string" &&
                    EVIDENCE_SUFFICIENCY_REASONS.includes(
                      reason as EvidenceSufficiencyReason,
                    ),
                )
              : stored.estimate === null
                ? ["no_evidence"]
                : ["low_effective_weight"],
            status: stored.status as LearnerCognitiveState,
            effectiveEvidenceWeight: stored.evidenceWeight,
            lastObservedAt: stored.lastObservedAt?.toISOString() ?? null,
          }
        : emptyDimension(dimension);
    }),
  };
}

function claimRecency(
  left: StateFreshnessClaim,
  right: StateFreshnessClaim,
): number {
  return (
    right.observation.observedAt.getTime() -
      left.observation.observedAt.getTime() ||
    right.createdAt.getTime() - left.createdAt.getTime() ||
    right.id.localeCompare(left.id)
  );
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

function materializationIsFresh(params: {
  state: MaterializedLearnerEntityState | undefined;
  claims: readonly StateFreshnessClaim[];
  asOf: Date;
}): boolean {
  const { state, claims: persistedClaims, asOf } = params;
  const claims = persistedClaims.filter((claim) =>
    evidenceClaimIsActive(claim, asOf),
  );
  if (!state) return claims.length === 0;
  if (
    state.inferenceVersion !== COGNITION_INFERENCE_VERSION ||
    !LEARNER_COGNITIVE_STATES.includes(state.status as LearnerCognitiveState)
  ) {
    return false;
  }
  const byDimension = new Map(
    state.dimensions.map((dimension) => [dimension.dimension, dimension]),
  );
  if (
    state.dimensions.length !== COGNITIVE_DIMENSIONS.length ||
    byDimension.size !== COGNITIVE_DIMENSIONS.length ||
    COGNITIVE_DIMENSIONS.some((dimension) => !byDimension.has(dimension)) ||
    state.dimensions.some(
      (dimension) =>
        !isCognitiveDimension(dimension.dimension) ||
        dimension.inferenceVersion !== COGNITION_INFERENCE_VERSION ||
        !LEARNER_COGNITIVE_STATES.includes(
          dimension.status as LearnerCognitiveState,
        ),
    )
  ) {
    return false;
  }

  const latestClaim = [...claims].sort(claimRecency)[0];
  if (state.lastEvidenceClaimId !== (latestClaim?.id ?? null)) return false;
  if (
    !sameInstant(
      state.lastObservedAt,
      latestClaim?.observation.observedAt ?? null,
    )
  ) {
    return false;
  }
  const newestClaimCreatedAt = claims.reduce<Date | null>(
    (latest, claim) =>
      !latest || claim.createdAt > latest ? claim.createdAt : latest,
    null,
  );
  if (newestClaimCreatedAt && state.updatedAt < newestClaimCreatedAt) {
    return false;
  }
  const newestLifecycleAt = persistedClaims
    .flatMap((claim) => claim.lifecycleEvents)
    .reduce<Date | null>(
      (latest, event) =>
        !latest || event.createdAt > latest ? event.createdAt : latest,
      null,
    );
  if (newestLifecycleAt && state.updatedAt < newestLifecycleAt) return false;

  for (const dimension of COGNITIVE_DIMENSIONS) {
    const stored = byDimension.get(dimension)!;
    const dimensionClaims = claims.filter(
      (claim) => claim.dimension === dimension,
    );
    if (stored.observationCount !== dimensionClaims.length) return false;
    const latestDimensionClaim = [...dimensionClaims].sort(claimRecency)[0];
    if (
      !sameInstant(
        stored.lastObservedAt,
        latestDimensionClaim?.observation.observedAt ?? null,
      )
    ) {
      return false;
    }
    const newestDimensionClaimCreatedAt = dimensionClaims.reduce<Date | null>(
      (latest, claim) =>
        !latest || claim.createdAt > latest ? claim.createdAt : latest,
      null,
    );
    if (
      newestDimensionClaimCreatedAt &&
      stored.updatedAt < newestDimensionClaimCreatedAt
    ) {
      return false;
    }
    const ageDays = stored.lastObservedAt
      ? (asOf.getTime() - stored.lastObservedAt.getTime()) / 86_400_000
      : 0;
    if (
      stored.evidenceSufficiency >= 1 &&
      (stored.status === "demonstrated" || stored.status === "robust") &&
      ageDays >= DEFAULT_DIMENSION_INFERENCE_THRESHOLDS.revalidateAfterDays
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Read-through projection guard shared by entity, model and target reads.
 * It detects definition/inference drift and interrupted materialization using
 * the immutable claim count/timestamps, then performs bounded full replays.
 */
export async function getLearnerEntityStates(
  persistence: PersistenceClient | undefined,
  userId: string,
  cognitiveEntityIds: readonly string[],
  asOf = new Date(),
  projectionRead?: LearnerStateProjectionReadRepository,
): Promise<Map<string, LearnerEntityStateDto>> {
  const uniqueEntityIds = [...new Set(cognitiveEntityIds)];
  if (uniqueEntityIds.length === 0) return new Map();
  if (projectionRead) {
    const projected = await projectionRead.findMany({
      userId,
      cognitiveEntityIds: uniqueEntityIds,
      asOf,
    });
    if (projected) {
      const result = new Map(
        projected.map((state) => [
          state.cognitiveEntityId,
          projectionReadDto(state),
        ]),
      );
      if (uniqueEntityIds.every((entityId) => result.has(entityId))) {
        return result;
      }
      if (!persistence) {
        for (const cognitiveEntityId of uniqueEntityIds) {
          if (!result.has(cognitiveEntityId)) {
            result.set(cognitiveEntityId, emptyLearnerEntityState());
          }
        }
        return result;
      }
    }
  }
  if (!persistence) {
    throw new Error("Learner-state projection persistence is not configured");
  }
  const entities = await persistence.cognitiveEntity.findMany({
    where: { id: { in: uniqueEntityIds } },
    select: {
      id: true,
      kind: true,
      definitionVersion: true,
      status: true,
      scope: true,
      ownerUserId: true,
      goal: { select: { userId: true } },
    },
  });
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  for (const cognitiveEntityId of uniqueEntityIds) {
    const entity = entityById.get(cognitiveEntityId);
    if (
      !entity ||
      entity.status !== "active" ||
      !isCognitiveEntityKind(entity.kind) ||
      !canReadEntity(entity, userId)
    ) {
      throw new CognitionPersistenceError(
        "not_found",
        "active cognitive entity not found",
      );
    }
  }

  const revisionRepository = (
    persistence as unknown as {
      learnerStateRevision?: PersistenceClient["learnerStateRevision"];
    }
  ).learnerStateRevision;
  const [materializedRows, freshnessClaimRows, revisionRows] =
    await Promise.all([
      persistence.learnerEntityState.findMany({
        where: {
          userId,
          cognitiveEntityId: { in: uniqueEntityIds },
        },
        include: { dimensions: true },
      }),
      persistence.evidenceClaim.findMany({
        where: {
          userId,
          cognitiveEntityId: { in: uniqueEntityIds },
          validFrom: { lte: asOf },
        },
        select: {
          id: true,
          cognitiveEntityId: true,
          dimension: true,
          definitionVersion: true,
          status: true,
          validFrom: true,
          createdAt: true,
          observation: { select: { observedAt: true } },
          lifecycleEvents: {
            select: {
              id: true,
              eventType: true,
              createdAt: true,
              replacementClaimId: true,
            },
          },
        },
      }),
      revisionRepository
        ? revisionRepository.findMany({
            where: {
              userId,
              cognitiveEntityId: { in: uniqueEntityIds },
            },
            orderBy: [{ cognitiveEntityId: "asc" }, { revision: "desc" }],
            select: {
              cognitiveEntityId: true,
              revision: true,
              evidenceCutoffAt: true,
              lifecycleCutoffAt: true,
            },
          })
        : Promise.resolve([]),
    ]);
  const stateByEntityId = new Map(
    materializedRows.map((state) => [state.cognitiveEntityId, state]),
  );
  const claimsByEntityId = new Map<string, StateFreshnessClaim[]>();
  const revisionByEntityId = new Map<string, LearnerStateRevisionMetadata>();
  for (const revision of revisionRows) {
    if (revisionByEntityId.has(revision.cognitiveEntityId)) continue;
    revisionByEntityId.set(revision.cognitiveEntityId, revision);
  }
  for (const claim of freshnessClaimRows) {
    const entity = entityById.get(claim.cognitiveEntityId)!;
    if (claim.definitionVersion !== entity.definitionVersion) continue;
    const claims = claimsByEntityId.get(claim.cognitiveEntityId) ?? [];
    claims.push(claim);
    claimsByEntityId.set(claim.cognitiveEntityId, claims);
  }

  const result = new Map<string, LearnerEntityStateDto>();
  const staleEntityIds: string[] = [];
  for (const cognitiveEntityId of uniqueEntityIds) {
    const state = stateByEntityId.get(cognitiveEntityId);
    const claims = claimsByEntityId.get(cognitiveEntityId) ?? [];
    if (materializationIsFresh({ state, claims, asOf })) {
      result.set(
        cognitiveEntityId,
        state
          ? materializedStateDto(
              state,
              revisionByEntityId.get(cognitiveEntityId),
            )
          : emptyLearnerEntityState(),
      );
    } else {
      staleEntityIds.push(cognitiveEntityId);
    }
  }

  const replayBatchSize = 5;
  for (
    let offset = 0;
    offset < staleEntityIds.length;
    offset += replayBatchSize
  ) {
    const batch = staleEntityIds.slice(offset, offset + replayBatchSize);
    const replayed = await Promise.all(
      batch.map((cognitiveEntityId) =>
        replayLearnerEntityState(persistence, userId, cognitiveEntityId, asOf),
      ),
    );
    batch.forEach((cognitiveEntityId, index) => {
      result.set(cognitiveEntityId, replayed[index]);
    });
  }
  return result;
}

export async function getLearnerEntityState(
  persistence: PersistenceClient | undefined,
  userId: string,
  cognitiveEntityId: string,
  projectionRead?: LearnerStateProjectionReadRepository,
): Promise<LearnerEntityStateDto> {
  const states = await getLearnerEntityStates(
    persistence,
    userId,
    [cognitiveEntityId],
    new Date(),
    projectionRead,
  );
  const state = states.get(cognitiveEntityId);
  if (!state) {
    throw new CognitionPersistenceError(
      "not_found",
      "active cognitive entity not found",
    );
  }
  return state;
}

export type ClaimForDto = Persistence.EvidenceClaimGetPayload<{
  include: {
    cognitiveEntity: true;
    observation: { include: { attempt: { include: { task: true } } } };
    lifecycleEvents: true;
  };
}>;

/** Pure learner-facing evidence serialization shared by Persistence and ORM reads. */
export function claimToDto(claim: ClaimForDto): EvidenceClaimDto {
  const metadata = isRecord(claim.observation.metadata)
    ? claim.observation.metadata
    : {};
  if (
    !isCognitiveDimension(claim.dimension) ||
    !isEvidenceSource(metadata.evidenceSource) ||
    !isEvidenceTaskKind(metadata.evidenceTaskKind) ||
    !isContextDistance(metadata.contextDistance) ||
    !isEvidenceEvaluator(claim.observation.evaluatorType)
  ) {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      `claim ${claim.id} cannot be serialized safely`,
    );
  }
  const domainClaim = claimToDomain(claim);
  const latestLifecycle = latestEvidenceLifecycleEvent(claim);
  const lifecycleStatus: EvidenceClaimDto["lifecycleStatus"] =
    evidenceLifecycleStatus(claim);
  return {
    id: claim.id,
    entityId: claim.cognitiveEntityId,
    dimension: claim.dimension,
    source: domainClaim.source,
    taskKind: domainClaim.task.kind,
    taskTitle: claim.observation.attempt.task.title,
    contextDistance: domainClaim.task.contextDistance,
    assistanceLevel: domainClaim.assistance.level,
    evaluator: domainClaim.evaluator,
    criterionRef: claim.criterionRef,
    definitionVersion: claim.definitionVersion,
    outcome: claim.score,
    effectiveWeight: calculateEvidenceContribution(domainClaim).effectiveWeight,
    lifecycleStatus,
    taskId: claim.observation.attempt.taskId,
    attemptId: claim.observation.attemptId,
    observedAt: claim.observation.observedAt.toISOString(),
    ...(latestLifecycle?.reason ? { explanation: latestLifecycle.reason } : {}),
  };
}

export async function getLearnerEntityEvidence(
  persistence: PersistenceClient,
  userId: string,
  cognitiveEntityId: string,
): Promise<LearnerEntityEvidenceDto> {
  const entity = await persistence.cognitiveEntity.findUnique({
    where: { id: cognitiveEntityId },
    select: {
      scope: true,
      ownerUserId: true,
      goal: { select: { userId: true } },
    },
  });
  if (!entity || !canReadEntity(entity, userId)) {
    throw new CognitionPersistenceError(
      "not_found",
      "cognitive entity not found",
    );
  }
  const claims = await persistence.evidenceClaim.findMany({
    where: { userId, cognitiveEntityId },
    include: {
      cognitiveEntity: true,
      observation: { include: { attempt: { include: { task: true } } } },
      lifecycleEvents: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return { claims: claims.map(claimToDto) };
}

export async function retractPersistedEvidenceClaim(
  persistence: PersistenceClient,
  input: {
    claimId: string;
    userId: string;
    reason: string;
    actorUserId?: string;
  },
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
): Promise<LearnerEntityStateDto> {
  const { acquireCognitionTransactionLock } =
    await import("../transaction-lock.js");
  if (!nonEmpty(input.reason)) {
    throw new CognitionPersistenceError(
      "invalid_candidate",
      "evidence retraction requires a reason",
    );
  }
  const result = await persistence.$transaction(async (tx) => {
    await acquireCognitionTransactionLock(tx, "evidence-claim", input.claimId);
    const claim = await tx.evidenceClaim.findUnique({
      where: { id: input.claimId },
      include: { lifecycleEvents: true },
    });
    if (!claim || claim.userId !== input.userId) {
      throw new CognitionPersistenceError(
        "not_found",
        "evidence claim not found",
      );
    }
    const lifecycleStatus = evidenceLifecycleStatus(claim);
    if (lifecycleStatus === "retracted") {
      return {
        state: await replayLearnerEntityState(
          tx as unknown as PersistenceClient,
          input.userId,
          claim.cognitiveEntityId,
        ),
        cognitiveEntityId: claim.cognitiveEntityId,
      };
    }
    if (lifecycleStatus !== "active") {
      throw new CognitionPersistenceError(
        "inactive_evidence",
        "only active evidence can be retracted",
      );
    }
    const lifecycleAt = new Date();
    await tx.evidenceLifecycleEvent.create({
      data: {
        evidenceClaimId: claim.id,
        eventType: "retracted",
        reason: input.reason,
        actorUserId: input.actorUserId,
        createdAt: lifecycleAt,
      },
    });
    await tx.evidenceClaim.update({
      where: { id: claim.id },
      data: { status: "retracted", validUntil: lifecycleAt },
    });
    return {
      state: await replayLearnerEntityState(
        tx as unknown as PersistenceClient,
        input.userId,
        claim.cognitiveEntityId,
      ),
      cognitiveEntityId: claim.cognitiveEntityId,
    };
  });
  await refreshGapProjection(persistence, input.userId, result.cognitiveEntityId);
  const { invalidateLearnerStateMemory } =
    await import("../../learner-state-memory/index.js");
  await invalidateLearnerStateMemory(
    input.userId,
    "evidence_retracted",
    persistence,
    learnerStateMemoryInvalidation,
  );
  return result.state;
}

export async function supersedePersistedEvidenceClaim(
  persistence: PersistenceClient,
  input: {
    claimId: string;
    replacementClaimId: string;
    userId: string;
    reason: string;
    actorUserId?: string;
  },
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
): Promise<LearnerEntityStateDto> {
  const { acquireCognitionTransactionLock } =
    await import("../transaction-lock.js");
  if (!nonEmpty(input.reason) || input.claimId === input.replacementClaimId) {
    throw new CognitionPersistenceError(
      "invalid_candidate",
      "evidence supersession requires distinct claims and a reason",
    );
  }
  const result = await persistence.$transaction(async (tx) => {
    for (const claimId of [input.claimId, input.replacementClaimId].sort()) {
      await acquireCognitionTransactionLock(tx, "evidence-claim", claimId);
    }
    const claims = await tx.evidenceClaim.findMany({
      where: { id: { in: [input.claimId, input.replacementClaimId] } },
      include: { lifecycleEvents: true },
    });
    const current = claims.find((claim) => claim.id === input.claimId);
    const replacement = claims.find(
      (claim) => claim.id === input.replacementClaimId,
    );
    if (
      !current ||
      !replacement ||
      current.userId !== input.userId ||
      replacement.userId !== input.userId
    ) {
      throw new CognitionPersistenceError(
        "not_found",
        "evidence claim not found",
      );
    }
    const currentLifecycleStatus = evidenceLifecycleStatus(current);
    const replacementLifecycleStatus = evidenceLifecycleStatus(replacement);
    const currentLifecycle = latestEvidenceLifecycleEvent(current);
    if (
      currentLifecycleStatus === "superseded" &&
      currentLifecycle?.replacementClaimId === replacement.id
    ) {
      return {
        state: await replayLearnerEntityState(
          tx as unknown as PersistenceClient,
          input.userId,
          current.cognitiveEntityId,
        ),
        cognitiveEntityId: current.cognitiveEntityId,
      };
    }
    if (
      currentLifecycleStatus !== "active" ||
      replacementLifecycleStatus !== "active"
    ) {
      throw new CognitionPersistenceError(
        "inactive_evidence",
        "supersession requires active current and replacement claims",
      );
    }
    if (
      current.cognitiveEntityId !== replacement.cognitiveEntityId ||
      current.dimension !== replacement.dimension ||
      current.criterionRef !== replacement.criterionRef
    ) {
      throw new CognitionPersistenceError(
        "invalid_candidate",
        "replacement must preserve entity, dimension, and rubric criterion identity",
      );
    }
    const lifecycleAt = new Date();
    await tx.evidenceLifecycleEvent.create({
      data: {
        evidenceClaimId: current.id,
        eventType: "superseded",
        reason: input.reason,
        actorUserId: input.actorUserId,
        replacementClaimId: replacement.id,
        createdAt: lifecycleAt,
      },
    });
    await tx.evidenceClaim.update({
      where: { id: current.id },
      data: { status: "superseded", validUntil: lifecycleAt },
    });
    return {
      state: await replayLearnerEntityState(
        tx as unknown as PersistenceClient,
        input.userId,
        current.cognitiveEntityId,
      ),
      cognitiveEntityId: current.cognitiveEntityId,
    };
  });
  await refreshGapProjection(persistence, input.userId, result.cognitiveEntityId);
  const { invalidateLearnerStateMemory } =
    await import("../../learner-state-memory/index.js");
  await invalidateLearnerStateMemory(
    input.userId,
    "evidence_superseded",
    persistence,
    learnerStateMemoryInvalidation,
  );
  return result.state;
}
