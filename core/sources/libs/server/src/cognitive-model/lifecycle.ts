// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import { randomUUID } from "node:crypto";
import type { Persistence, PersistenceClient } from "../persistence/persistence-compat.js";
import { ensureGoalCapstoneProject } from "../cognition/goal-capstone.js";
import { parsePrereqs } from "../domain/unit-status.js";
import { resolveBoundUnitPath } from "./path-contract.js";
import {
  generateUnitCognitiveModel,
  type UnitCognitiveModelGenerationParams,
} from "./generation.js";
import {
  generateUnitCognitiveModelTargetFirst,
  type UnitCognitiveModelTargetsReady,
} from "./target-first.js";
import {
  COGNITIVE_MODEL_TRANSACTION_OPTIONS,
  acquireCognitiveModelWriteLock,
} from "./lock.js";
import {
  computeCognitiveModelInputHash,
  orderCurriculumUnits,
  validateUnitPrerequisiteGraph,
} from "./pure.js";
import { pruneSupersededCognitiveModelRevisions } from "./retention.js";
import {
  buildObjectiveSnapshot,
  persistUnitCognitiveProposal,
} from "./snapshot.js";
import { COGNITIVE_MODEL_SCHEMA_VERSION } from "./types.js";
import { parseMapPlan } from "../goals/map-plan.js";
import {
  goalPlanOutcomes,
  parsePlanningOutcomeRefs,
} from "../goals/plan-coverage.js";
import {
  PlanningCoverageError,
  validateSnapshotPlanningCoverage,
} from "./planning-coverage.js";
import { moduleCognitiveEntityBudget } from "../llm/module-curriculum.js";
import { runWithLlmTraceAsync } from "../llm/trace-context.js";
import { cognitiveModelPersistence } from "./persistence.js";
import type {
  CognitiveModelExpansionLeaseRepository,
  CognitiveModelExpansionContextRepository,
  CognitiveModelExpansionCurriculumUnit,
  CognitiveModelGenerationRunRepository,
  CognitiveModelPublicationRepository,
  CognitiveModelPublicationFinalizationRepository,
  LearnerStateMemoryInvalidationRepository,
  ProjectBlueprintRepository,
  KnowledgeActivity,
} from "../../../domain/src/index.js";

const EXPANSION_LEASE_MS = 15 * 60 * 1_000;
const JOIN_POLL_MS = 250;
const TARGET_FIRST_KACOM_ENABLED =
  process.env.KACOM_TARGET_FIRST_NDJSON !== "false";

type GoalWithUnits = NonNullable<Awaited<ReturnType<typeof loadGoalWithUnits>>>;

function inputJson(value: unknown): Persistence.InputJsonValue {
  return value as Persistence.InputJsonValue;
}

/**
 * Curriculum v2 materializes modules sequentially. Lessons of module 1 can all
 * be expanded while later modules are still `pending` stubs — that must not be
 * treated as goal-complete planning coverage (or we fail on o_2.. and wipe the
 * finished prefix).
 */
async function hasUnmaterializedSequentialModules(
  tx: Persistence.TransactionClient,
  goalId: string,
  curriculumVersion: number,
): Promise<boolean> {
  if (curriculumVersion !== 2) return false;
  const pending = await tx.learningModule.count({
    where: { goalId, generationStatus: "pending" },
  });
  return pending > 0;
}

function lessonsFullyExpandedForHash(
  units: Array<{
    cognitiveModelStatus: string;
    cognitiveModelBuildInputHash: string | null;
    learningTargets: unknown[];
  }>,
  inputHash: string,
): boolean {
  return units.every(
    (row) =>
      row.cognitiveModelStatus === "expanded" &&
      row.cognitiveModelBuildInputHash === inputHash &&
      row.learningTargets.length > 0,
  );
}

async function isGoalCognitiveModelComplete(
  tx: Persistence.TransactionClient,
  params: {
    goalId: string;
    curriculumVersion: number;
    inputHash: string;
    units: Array<{
      cognitiveModelStatus: string;
      cognitiveModelBuildInputHash: string | null;
      learningTargets: unknown[];
    }>;
  },
): Promise<boolean> {
  if (!lessonsFullyExpandedForHash(params.units, params.inputHash)) {
    return false;
  }
  return !(await hasUnmaterializedSequentialModules(
    tx,
    params.goalId,
    params.curriculumVersion,
  ));
}

async function appendCognitiveRunEvent(
  persistence: PersistenceClient | null,
  runId: string,
  type: string,
  payload: unknown,
  snapshotKey?: string,
  generationRun?: CognitiveModelGenerationRunRepository,
) {
  if (generationRun) {
    await generationRun.appendEvent({
      runId,
      type,
      payloadJson: JSON.stringify(payload),
      ...(snapshotKey ? { snapshotKey } : {}),
    });
    return;
  }
  if (!persistence) throw new Error("Cognitive-model generation-run repository is required");
  await persistence.$transaction(async (tx) => {
    const run = await tx.aiGenerationRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    if (!run || run.status !== "running") return;
    const updated = await tx.aiGenerationRun.update({
      where: { id: runId },
      data: { nextEventSequence: { increment: 1 } },
      select: { nextEventSequence: true },
    });
    const data = {
      runId,
      sequence: updated.nextEventSequence,
      type,
      payload: JSON.stringify(payload),
    };
    if (snapshotKey) {
      await tx.aiGenerationRunEvent.upsert({
        where: { runId_snapshotKey: { runId, snapshotKey } },
        create: { ...data, snapshotKey },
        update: data,
      });
    } else {
      await tx.aiGenerationRunEvent.create({ data });
    }
  });
}

async function finishCognitiveRun(
  persistence: PersistenceClient | null,
  runId: string,
  status: "completed" | "error",
  result: unknown,
  generationRun?: CognitiveModelGenerationRunRepository,
) {
  if (generationRun) {
    await generationRun.finish({
      runId,
      status,
      resultJson:
        status === "completed" ? JSON.stringify(result) : String(result),
    });
    return;
  }
  if (!persistence) throw new Error("Cognitive-model generation-run repository is required");
  await persistence.aiGenerationRun.updateMany({
    where: { id: runId, status: "running" },
    data:
      status === "completed"
        ? { status, resultJson: JSON.stringify(result), statusMessage: "" }
        : { status, errorMessage: String(result) },
  });
}

async function readJoinedTargetsReady(
  persistence: PersistenceClient | null,
  runId: string,
  generationRun?: CognitiveModelGenerationRunRepository,
): Promise<UnitCognitiveModelTargetsReady | null> {
  const payloadJson = generationRun
    ? (
        await generationRun.readLatestEvent({
          runId,
          type: "learning_targets_ready",
        })
      )?.payloadJson
    : persistence
      ? (
        await persistence.aiGenerationRunEvent.findFirst({
          where: { runId, type: "learning_targets_ready" },
          orderBy: { sequence: "desc" },
        })
        )?.payload
      : undefined;
  if (!payloadJson) return null;
  try {
    const parsed = JSON.parse(payloadJson) as {
      contract?: UnitCognitiveModelTargetsReady["contract"];
      prefixHash?: string;
    };
    return parsed.contract && parsed.prefixHash
      ? { contract: parsed.contract, prefixHash: parsed.prefixHash }
      : null;
  } catch {
    return null;
  }
}

export async function getLatestUnitCognitiveModelTargetsReady(
  persistence: PersistenceClient | null,
  unitId: string,
  generationRun?: CognitiveModelGenerationRunRepository,
): Promise<UnitCognitiveModelTargetsReady | null> {
  const run = generationRun
    ? await generationRun.findLatest({
        unitId,
        statuses: ["running", "completed"],
      })
    : persistence
      ? await persistence.aiGenerationRun.findFirst({
        where: {
          scope: "unit",
          scopeId: unitId,
          operation: "unit.cognitive_model",
          status: { in: ["running", "completed"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
        })
      : null;
  return run ? readJoinedTargetsReady(persistence, run.id, generationRun) : null;
}

async function waitForJoinedExpansion(
  persistence: PersistenceClient | null,
  params: {
    goalId: string;
    unitId: string;
    inputHash: string;
    runId?: string;
    signal?: AbortSignal;
    onTargetsReady?: (
      value: UnitCognitiveModelTargetsReady,
    ) => void | Promise<void>;
    onKnowledgeActivity?: (activity: KnowledgeActivity) => void | Promise<void>;
    generationRun?: CognitiveModelGenerationRunRepository;
    expansionLease?: CognitiveModelExpansionLeaseRepository;
  },
): Promise<ExpansionResult> {
  let deliveredPrefix = false;
  let joinedRunId = params.runId;
  const deadline = Date.now() + EXPANSION_LEASE_MS;
  while (Date.now() < deadline) {
    if (params.signal?.aborted)
      throw params.signal.reason ?? new Error("Cognitive-model wait aborted");
    if (!joinedRunId) {
      const run = params.generationRun
        ? await params.generationRun.findLatest({
            unitId: params.unitId,
            statuses: ["running"],
          })
        : persistence
          ? await persistence.aiGenerationRun.findFirst({
            where: {
              scope: "unit",
              scopeId: params.unitId,
              operation: "unit.cognitive_model",
              status: "running",
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
            })
          : null;
      joinedRunId = run?.id;
    }
    if (!deliveredPrefix && joinedRunId && params.onTargetsReady) {
      const ready = await readJoinedTargetsReady(
        persistence,
        joinedRunId,
        params.generationRun,
      );
      if (ready) {
        deliveredPrefix = true;
        await params.onTargetsReady(ready);
      }
    }
    const state = params.expansionLease
      ? await params.expansionLease.readState({
          goalId: params.goalId,
          unitId: params.unitId,
        })
      : null;
    const [unit, goal] = state
      ? [
          {
            cognitiveModelStatus: state.unitStatus,
            cognitiveModelBuildInputHash: state.unitInputHash,
          },
          { cognitiveModelVersion: state.goalVersion },
        ]
      : persistence
        ? await Promise.all([
            persistence.learningUnit.findUnique({
              where: { id: params.unitId },
              select: {
                cognitiveModelStatus: true,
                cognitiveModelBuildInputHash: true,
              },
            }),
            persistence.learningGoal.findUnique({
              where: { id: params.goalId },
              select: { cognitiveModelVersion: true },
            }),
          ])
        : [null, null];
    if (!unit || !goal) throw new Error("Unit not found");
    if (
      unit.cognitiveModelStatus === "expanded" &&
      unit.cognitiveModelBuildInputHash === params.inputHash
    ) {
      return {
        goalId: params.goalId,
        unitId: params.unitId,
        inputHash: params.inputHash,
        status: "already_expanded",
        published: false,
        version: goal.cognitiveModelVersion,
      };
    }
    if (unit.cognitiveModelStatus === "failed") {
      throw new Error("Cognitive-model expansion failed");
    }
    await new Promise((resolve) => setTimeout(resolve, JOIN_POLL_MS));
  }
  throw new Error("Cognitive-model expansion lease expired");
}

async function loadGoalWithUnits(persistence: PersistenceClient, goalId: string) {
  return persistence.learningGoal.findUnique({
    where: { id: goalId },
    include: { units: { where: { unitKind: { not: "overview" } } } },
  });
}

function fingerprint(goal: GoalWithUnits): string {
  validateUnitPrerequisiteGraph(goal.units);
  return computeCognitiveModelInputHash(goal, goal.units);
}

export type SkeletonResult = {
  goalId: string;
  inputHash: string;
  version: number;
  status: string;
  changed: boolean;
  candidateRevisionId: string | null;
};

async function nextRevisionVersion(
  tx: Persistence.TransactionClient,
  goalId: string,
  currentVersion: number,
): Promise<number> {
  const latest = await tx.cognitiveModelRevision.findFirst({
    where: { goalId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return Math.max(currentVersion, latest?.version ?? 0) + 1;
}

async function ensureCandidateRevision(
  tx: Persistence.TransactionClient,
  params: { goalId: string; inputHash: string; currentVersion: number },
) {
  const existing = await tx.cognitiveModelRevision.findFirst({
    where: {
      goalId: params.goalId,
      inputHash: params.inputHash,
      status: "candidate",
      snapshotSchemaVersion: COGNITIVE_MODEL_SCHEMA_VERSION,
    },
    orderBy: { version: "desc" },
  });
  if (existing) return existing;
  const version = await nextRevisionVersion(
    tx,
    params.goalId,
    params.currentVersion,
  );
  return tx.cognitiveModelRevision.create({
    data: {
      goalId: params.goalId,
      version,
      status: "candidate",
      scope: "full",
      inputHash: params.inputHash,
      snapshotSchemaVersion: COGNITIVE_MODEL_SCHEMA_VERSION,
      isFullSnapshot: true,
      snapshotJson: inputJson({}),
      auditJson: inputJson({ phase: "candidate_created" }),
    },
  });
}

/**
 * Establishes the immutable curriculum spine and a version-1 objective
 * snapshot. It never invokes the model and never writes learner state.
 */
export async function ensureGoalCognitiveSkeleton(
  persistence: PersistenceClient,
  goalId: string,
): Promise<SkeletonResult> {
  const prepared = await loadGoalWithUnits(persistence, goalId);
  if (!prepared) throw new Error("Goal not found");
  const inputHash = fingerprint(prepared);

  return persistence.$transaction(async (tx) => {
    await acquireCognitiveModelWriteLock(tx, goalId);
    const goal = await tx.learningGoal.findUnique({
      where: { id: goalId },
      include: {
        units: {
          where: { unitKind: { not: "overview" } },
          include: { learningTargets: true },
        },
      },
    });
    if (!goal) throw new Error("Goal not found");
    const lockedHash = computeCognitiveModelInputHash(goal, goal.units);
    if (lockedHash !== inputHash)
      throw new Error("Course map changed during skeleton preparation");
    const changed = goal.cognitiveModelInputHash !== inputHash;
    if (changed) {
      if (goal.curriculumVersion === 2) {
        await tx.learningUnit.updateMany({
          where: {
            goalId,
            unitKind: "lesson",
            cognitiveModelStatus: "expanded",
          },
          data: { cognitiveModelBuildInputHash: inputHash },
        });
        await tx.learningUnit.updateMany({
          where: {
            goalId,
            unitKind: "lesson",
            cognitiveModelStatus: { not: "expanded" },
          },
          data: {
            cognitiveModelStatus: "pending",
            cognitiveModelBuildStartedAt: null,
            cognitiveModelBuildToken: null,
            cognitiveModelBuildInputHash: null,
          },
        });
      } else {
        await tx.learningUnit.updateMany({
          where: { goalId, unitKind: "lesson" },
          data: {
            cognitiveModelStatus: "pending",
            cognitiveModelBuildStartedAt: null,
            cognitiveModelBuildToken: null,
            cognitiveModelBuildInputHash: null,
          },
        });
      }
    }

    const hasPublished = await tx.cognitiveModelRevision.findFirst({
      where: { goalId, status: "published", isFullSnapshot: true },
      orderBy: { version: "desc" },
      select: { id: true },
    });
    if (!hasPublished) {
      const version = await nextRevisionVersion(
        tx,
        goalId,
        goal.cognitiveModelVersion,
      );
      const snapshot = await buildObjectiveSnapshot(tx, goalId, inputHash, {
        phase: "skeleton",
        complete: false,
      });
      const revision = await tx.cognitiveModelRevision.create({
        data: {
          goalId,
          version,
          status: "published",
          scope: "full",
          inputHash,
          snapshotSchemaVersion: COGNITIVE_MODEL_SCHEMA_VERSION,
          isFullSnapshot: true,
          snapshotJson: inputJson(snapshot),
          auditJson: inputJson(snapshot.audit),
          publishedAt: new Date(),
        },
      });
      const hasLessons = goal.units.some((unit) => unit.unitKind === "lesson");
      await tx.learningGoal.update({
        where: { id: goalId },
        data: {
          cognitiveModelEnabled: true,
          cognitiveModelInputHash: inputHash,
          cognitiveModelPublishedHash: inputHash,
          cognitiveModelVersion: version,
          cognitiveModelStatus: hasLessons ? "building" : "ready",
        },
      });
      return {
        goalId,
        inputHash,
        version,
        status: hasLessons ? "building" : "ready",
        changed,
        candidateRevisionId: revision.id,
      };
    }

    const allExpanded = goal.units
      .filter((unit) => unit.unitKind === "lesson")
      .every(
        (unit) =>
          unit.cognitiveModelStatus === "expanded" &&
          unit.cognitiveModelBuildInputHash === inputHash &&
          unit.learningTargets.length > 0,
      );
    const goalComplete =
      allExpanded &&
      !(await hasUnmaterializedSequentialModules(
        tx,
        goalId,
        goal.curriculumVersion,
      ));
    const current =
      !changed &&
      goal.cognitiveModelPublishedHash === inputHash &&
      goalComplete;
    if (current) {
      if (
        goal.cognitiveModelStatus !== "ready" ||
        !goal.cognitiveModelEnabled
      ) {
        await tx.learningGoal.update({
          where: { id: goalId },
          data: { cognitiveModelEnabled: true, cognitiveModelStatus: "ready" },
        });
      }
      return {
        goalId,
        inputHash,
        version: goal.cognitiveModelVersion,
        status: "ready",
        changed: false,
        candidateRevisionId: null,
      };
    }
    const candidate = await ensureCandidateRevision(tx, {
      goalId,
      inputHash,
      currentVersion: goal.cognitiveModelVersion,
    });
    const status =
      goal.curriculumVersion === 2 ||
      goal.cognitiveModelPublishedHash === inputHash
        ? "building"
        : "needs_reconciliation";
    await tx.learningGoal.update({
      where: { id: goalId },
      data: {
        cognitiveModelEnabled: true,
        cognitiveModelInputHash: inputHash,
        cognitiveModelStatus: status,
      },
    });
    return {
      goalId,
      inputHash,
      version: goal.cognitiveModelVersion,
      status,
      changed,
      candidateRevisionId: candidate.id,
    };
  }, COGNITIVE_MODEL_TRANSACTION_OPTIONS);
}

export type ExpansionResult = {
  goalId: string;
  unitId: string;
  inputHash: string;
  status: "expanded" | "already_expanded";
  published: boolean;
  version: number;
};

export function decideCognitiveModelExpansionPublication(params: {
  allExpanded: boolean;
  inputHash: string;
  publishedHash: string;
}): {
  publish: boolean;
  snapshotPhase: "candidate" | "incremental" | "complete";
  goalStatus: "building" | "needs_reconciliation" | "ready";
} {
  if (params.allExpanded) {
    return {
      publish: true,
      snapshotPhase: "complete",
      goalStatus: "ready",
    };
  }
  if (params.publishedHash === params.inputHash) {
    return {
      publish: true,
      snapshotPhase: "incremental",
      goalStatus: "building",
    };
  }
  return {
    publish: false,
    snapshotPhase: "candidate",
    goalStatus: "needs_reconciliation",
  };
}

function publishedSnapshotIncludesUnit(
  value: Persistence.JsonValue,
  unitId: string,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const units = (value as { units?: unknown }).units;
  if (!Array.isArray(units)) return false;
  return units.some((candidate) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return false;
    }
    const unit = candidate as {
      unitId?: unknown;
      learningTargetIds?: unknown;
    };
    return (
      unit.unitId === unitId &&
      Array.isArray(unit.learningTargetIds) &&
      unit.learningTargetIds.length > 0
    );
  });
}

async function publishExistingExpandedColdBuild(
  persistence: PersistenceClient,
  params: { goalId: string; unitId: string; inputHash: string },
): Promise<ExpansionResult | null> {
  return persistence.$transaction(async (tx) => {
    await acquireCognitiveModelWriteLock(tx, params.goalId, params.unitId);
    const [goal, unit, latestPublished] = await Promise.all([
      tx.learningGoal.findUnique({ where: { id: params.goalId } }),
      tx.learningUnit.findUnique({
        where: { id: params.unitId },
        include: { learningTargets: true },
      }),
      tx.cognitiveModelRevision.findFirst({
        where: {
          goalId: params.goalId,
          inputHash: params.inputHash,
          status: "published",
          isFullSnapshot: true,
        },
        orderBy: { version: "desc" },
      }),
    ]);
    if (
      !goal ||
      !unit ||
      goal.cognitiveModelInputHash !== params.inputHash ||
      goal.cognitiveModelPublishedHash !== params.inputHash ||
      unit.cognitiveModelStatus !== "expanded" ||
      unit.cognitiveModelBuildInputHash !== params.inputHash ||
      unit.learningTargets.length === 0
    ) {
      return null;
    }
    if (
      latestPublished &&
      publishedSnapshotIncludesUnit(latestPublished.snapshotJson, params.unitId)
    ) {
      return {
        goalId: params.goalId,
        unitId: params.unitId,
        inputHash: params.inputHash,
        status: "already_expanded" as const,
        published: true,
        version: latestPublished.version,
      };
    }

    const units = await tx.learningUnit.findMany({
      where: { goalId: params.goalId, unitKind: "lesson" },
      include: { learningTargets: true },
    });
    const allExpanded = await isGoalCognitiveModelComplete(tx, {
      goalId: params.goalId,
      curriculumVersion: goal.curriculumVersion,
      inputHash: params.inputHash,
      units,
    });
    const publication = decideCognitiveModelExpansionPublication({
      allExpanded,
      inputHash: params.inputHash,
      publishedHash: goal.cognitiveModelPublishedHash,
    });
    if (!publication.publish) return null;

    const candidate = await ensureCandidateRevision(tx, {
      goalId: params.goalId,
      inputHash: params.inputHash,
      currentVersion: goal.cognitiveModelVersion,
    });
    const snapshot = await buildObjectiveSnapshot(
      tx,
      params.goalId,
      params.inputHash,
      {
        phase: publication.snapshotPhase,
        complete: allExpanded,
        generatedUnitId: params.unitId,
        promotedExistingUnit: true,
      },
    );
    const planningCoverage = allExpanded
      ? validateSnapshotPlanningCoverage(
          snapshot,
          goal.mapPlanStatus === "approved"
            ? parseMapPlan(goal.mapPlanJson)
            : null,
        )
      : {
          mode: "incremental" as const,
          coveredOutcomeRefs: [
            ...new Set(
              snapshot.learningTargets.flatMap(
                (target) => target.planningOutcomeRefs ?? [],
              ),
            ),
          ].sort(),
        };
    snapshot.audit = { ...snapshot.audit, planningCoverage };
    await tx.cognitiveModelRevision.update({
      where: { id: candidate.id },
      data: {
        status: "published",
        snapshotJson: inputJson(snapshot),
        auditJson: inputJson(snapshot.audit),
        publishedAt: new Date(),
      },
    });
    await tx.cognitiveModelRevision.updateMany({
      where: {
        goalId: params.goalId,
        status: "published",
        id: { not: candidate.id },
      },
      data: { status: "superseded" },
    });
    await pruneSupersededCognitiveModelRevisions(tx, params.goalId);
    await tx.learningGoal.update({
      where: { id: params.goalId },
      data: {
        cognitiveModelVersion: candidate.version,
        cognitiveModelPublishedHash: params.inputHash,
        cognitiveModelStatus: publication.goalStatus,
      },
    });
    return {
      goalId: params.goalId,
      unitId: params.unitId,
      inputHash: params.inputHash,
      status: "already_expanded" as const,
      published: true,
      version: candidate.version,
    };
  }, COGNITIVE_MODEL_TRANSACTION_OPTIONS);
}

/**
 * The already-expanded promotion has no proposal writes left to perform. Keep
 * its snapshot read in the application layer, then let the ORM boundary own
 * the complete revision/goal finalization CAS and retention transaction.
 */
async function publishExistingExpandedColdBuildThroughOrm(
  persistence: PersistenceClient,
  params: { goalId: string; unitId: string; inputHash: string },
  finalization: CognitiveModelPublicationFinalizationRepository,
): Promise<ExpansionResult | null> {
  const [goal, unit, latestPublished] = await Promise.all([
    persistence.learningGoal.findUnique({ where: { id: params.goalId } }),
    persistence.learningUnit.findUnique({
      where: { id: params.unitId },
      include: { learningTargets: true },
    }),
    persistence.cognitiveModelRevision.findFirst({
      where: {
        goalId: params.goalId,
        inputHash: params.inputHash,
        status: "published",
        isFullSnapshot: true,
      },
      orderBy: { version: "desc" },
      select: { version: true, snapshotJson: true },
    }),
  ]);
  if (
    !goal ||
    !unit ||
    goal.cognitiveModelInputHash !== params.inputHash ||
    goal.cognitiveModelPublishedHash !== params.inputHash ||
    unit.cognitiveModelStatus !== "expanded" ||
    unit.cognitiveModelBuildInputHash !== params.inputHash ||
    unit.learningTargets.length === 0
  ) {
    return null;
  }
  if (
    latestPublished &&
    publishedSnapshotIncludesUnit(latestPublished.snapshotJson, params.unitId)
  ) {
    return {
      goalId: params.goalId,
      unitId: params.unitId,
      inputHash: params.inputHash,
      status: "already_expanded",
      published: true,
      version: latestPublished.version,
    };
  }

  const units = await persistence.learningUnit.findMany({
    where: { goalId: params.goalId, unitKind: "lesson" },
    include: { learningTargets: true },
  });
  const allLessonsExpanded = lessonsFullyExpandedForHash(
    units,
    params.inputHash,
  );
  const pendingModules =
    goal.curriculumVersion === 2
      ? await persistence.learningModule.count({
          where: { goalId: params.goalId, generationStatus: "pending" },
        })
      : 0;
  const allExpanded = allLessonsExpanded && pendingModules === 0;
  const publication = decideCognitiveModelExpansionPublication({
    allExpanded,
    inputHash: params.inputHash,
    publishedHash: goal.cognitiveModelPublishedHash,
  });
  if (!publication.publish) return null;

  const snapshot = await buildObjectiveSnapshot(
    persistence,
    params.goalId,
    params.inputHash,
    {
      phase: publication.snapshotPhase,
      complete: allExpanded,
      generatedUnitId: params.unitId,
      promotedExistingUnit: true,
    },
  );
  const planningCoverage = allExpanded
    ? validateSnapshotPlanningCoverage(
        snapshot,
        goal.mapPlanStatus === "approved"
          ? parseMapPlan(goal.mapPlanJson)
          : null,
      )
    : {
        mode: "incremental" as const,
        coveredOutcomeRefs: [
          ...new Set(
            snapshot.learningTargets.flatMap(
              (target) => target.planningOutcomeRefs ?? [],
            ),
          ),
        ].sort(),
      };
  snapshot.audit = { ...snapshot.audit, planningCoverage };
  const result = await finalization.finalize({
    goalId: params.goalId,
    unitId: params.unitId,
    inputHash: params.inputHash,
    snapshotJson: JSON.stringify(snapshot),
    auditJson: JSON.stringify(snapshot.audit),
    allExpanded,
  });
  return result;
}

function provenanceSemanticKey(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const semanticKey = (value as Record<string, unknown>).semanticKey;
  return typeof semanticKey === "string" ? semanticKey : undefined;
}

function provenanceOwnerCurriculumKey(
  value: unknown,
): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const ownerCurriculumKey = (value as Record<string, unknown>)
    .ownerCurriculumKey;
  return typeof ownerCurriculumKey === "string"
    ? ownerCurriculumKey
    : undefined;
}

export async function expandUnitCognitiveModel(
  persistence: PersistenceClient | null,
  unitId: string,
  options: {
    signal?: AbortSignal;
    expansionLease?: CognitiveModelExpansionLeaseRepository;
    expansionContext?: CognitiveModelExpansionContextRepository;
    generationRun?: CognitiveModelGenerationRunRepository;
    publication?: CognitiveModelPublicationRepository;
    publicationFinalization?: CognitiveModelPublicationFinalizationRepository;
    learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository;
    projectBlueprint?: ProjectBlueprintRepository;
    onTargetsReady?: (
      value: UnitCognitiveModelTargetsReady,
    ) => void | Promise<void>;
    onKnowledgeActivity?: (activity: KnowledgeActivity) => void | Promise<void>;
  } = {},
): Promise<ExpansionResult> {
  const defaults = cognitiveModelPersistence();
  options = defaults ? { ...defaults, ...options } : options;
  const portable = options.expansionContext
    ? await options.expansionContext.load(unitId)
    : null;
  const initial: any = portable
    ? {
        ...portable.unit,
        learningTargets: portable.unit.hasLearningTargets ? [{ id: "present" }] : [],
        module: portable.module
          ? {
              ...portable.module,
              learningTargets: portable.module.learningTargets.map((mapping) => ({
                localRef: mapping.localRef,
                role: mapping.role,
                learningTarget: {
                  title: mapping.title,
                  learningObjective: mapping.learningObjective,
                },
              })),
            }
          : null,
        goal: portable.goal,
      }
    : persistence
      ? await persistence.learningUnit.findUnique({
          where: { id: unitId },
          include: {
            learningTargets: { select: { id: true }, take: 1 },
            module: {
              include: {
                learningTargets: {
                  orderBy: { orderIndex: "asc" },
                  include: { learningTarget: true },
                },
              },
            },
            goal: {
              include: { units: { where: { unitKind: { not: "overview" } } } },
            },
          },
        })
      : null;
  if (!initial) throw new Error("Unit not found");
  if (initial.unitKind !== "lesson")
    throw new Error("Only lesson units can be expanded");
  if (initial.goal.goalKind === "micro") {
    return {
      goalId: initial.goalId,
      unitId,
      inputHash: initial.goal.cognitiveModelInputHash,
      status: "already_expanded",
      published: false,
      version: initial.goal.cognitiveModelVersion,
    };
  }
  const inputHash = fingerprint(initial.goal);
  if (portable) {
    if (!options.publication) {
      throw new Error("Cognitive-model publication repository is required");
    }
    await options.publication.ensureSkeleton({
      goalId: initial.goalId,
      inputHash,
    });
  } else {
    if (!persistence) throw new Error("Cognitive-model expansion context is required");
    await ensureGoalCognitiveSkeleton(persistence, initial.goalId);
  }
  const token = randomUUID();
  const startedAt = new Date();
  const staleBefore = new Date(startedAt.getTime() - EXPANSION_LEASE_MS);
  const reservation =
    initial.goal.userId && options.expansionLease
      ? (
          await options.expansionLease.claim({
            userId: initial.goal.userId,
            goalId: initial.goalId,
            unitId,
            inputHash,
            token,
            startedAt,
            staleBefore,
            hasLearningTargets: initial.learningTargets.length > 0,
          })
        ).status
      : persistence
        ? await persistence.$transaction(async (tx) => {
          await acquireCognitiveModelWriteLock(tx, initial.goalId, unitId);
          const [goal, unit] = await Promise.all([
            tx.learningGoal.findUnique({ where: { id: initial.goalId } }),
            tx.learningUnit.findUnique({
              where: { id: unitId },
              include: { learningTargets: true },
            }),
          ]);
          if (!goal || !unit) throw new Error("Unit not found");
          if (goal.cognitiveModelInputHash !== inputHash) {
            throw new Error(
              "Course map changed during cognitive-model preparation",
            );
          }
          if (
            unit.cognitiveModelStatus === "expanded" &&
            unit.cognitiveModelBuildInputHash === inputHash &&
            unit.learningTargets.length > 0
          ) {
            return "complete" as const;
          }
          if (
            unit.cognitiveModelStatus === "building" &&
            unit.cognitiveModelBuildStartedAt &&
            Date.now() - unit.cognitiveModelBuildStartedAt.getTime() <
              EXPANSION_LEASE_MS
          ) {
            return "join" as const;
          }
          await tx.learningUnit.update({
            where: { id: unitId },
            data: {
              cognitiveModelStatus: "building",
              cognitiveModelBuildStartedAt: startedAt,
              cognitiveModelBuildToken: token,
              cognitiveModelBuildInputHash: inputHash,
            },
          });
          await tx.learningGoal.update({
            where: { id: initial.goalId },
            data: {
              cognitiveModelStatus:
                goal.cognitiveModelPublishedHash === inputHash
                  ? "building"
                  : "needs_reconciliation",
            },
          });
          return "claimed" as const;
          }, COGNITIVE_MODEL_TRANSACTION_OPTIONS)
        : (() => {
            throw new Error("Cognitive-model expansion lease is required");
          })();
  if (reservation === "complete") {
    // The goal publishes only after every lesson expands. A learner may open
    // an already-expanded lesson while the shared candidate is still being
    // built; replay its frozen target prefix so early teaching can render as a
    // draft instead of waiting for canonical goal-wide publication.
    if (options.onTargetsReady) {
      const ready = await getLatestUnitCognitiveModelTargetsReady(
        persistence,
        unitId,
        options.generationRun,
      );
      if (ready) await options.onTargetsReady(ready);
    }
    const promoted = options.publicationFinalization
      ? portable
        ? await options.publicationFinalization.promoteExisting({
            goalId: initial.goalId,
            unitId,
            inputHash,
          })
        : await publishExistingExpandedColdBuildThroughOrm(
            persistence!,
            { goalId: initial.goalId, unitId, inputHash },
            options.publicationFinalization,
          )
      : await publishExistingExpandedColdBuild(persistence!, {
          goalId: initial.goalId,
          unitId,
          inputHash,
        });
    const result =
      promoted ??
      ({
        goalId: initial.goalId,
        unitId,
        inputHash,
        status: "already_expanded",
        published: false,
        version: initial.goal.cognitiveModelVersion,
      } as const);
    if (persistence || options.projectBlueprint) {
      await ensureGoalCapstoneProject(
        persistence,
        initial.goalId,
        options.projectBlueprint,
      );
    }
    if (result.published && initial.goal.userId) {
      if (options.learnerStateMemoryInvalidation) {
        await options.learnerStateMemoryInvalidation.invalidate({
          userId: initial.goal.userId,
          reason: "cognitive_model_published",
        });
      } else if (persistence) {
        const { invalidateLearnerStateMemory } =
          await import("../learner-state-memory/index.js");
        await invalidateLearnerStateMemory(
          initial.goal.userId,
          "cognitive_model_published",
          persistence,
        );
      }
    }
    return result;
  }
  if (reservation === "join") {
    const run = options.generationRun
      ? await options.generationRun.findLatest({
          unitId,
          statuses: ["running"],
        })
      : persistence
        ? await persistence.aiGenerationRun.findFirst({
          where: {
            scope: "unit",
            scopeId: unitId,
            operation: "unit.cognitive_model",
            status: "running",
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
          })
        : null;
    return waitForJoinedExpansion(persistence, {
      goalId: initial.goalId,
      unitId,
      inputHash,
      runId: run?.id,
      signal: options.signal,
      onTargetsReady: options.onTargetsReady,
      generationRun: options.generationRun,
      expansionLease: options.expansionLease,
    });
  }

  const cognitiveRun = options.generationRun
    ? await options.generationRun.start({
        userId: initial.goal.userId,
        unitId,
        statusMessage: "Building learning targets",
      })
    : persistence
      ? await persistence.$transaction(async (tx) => {
        await tx.aiGenerationRun.updateMany({
          where: {
            scope: "unit",
            scopeId: unitId,
            operation: "unit.cognitive_model",
            status: "running",
          },
          data: {
            status: "error",
            errorMessage: "Superseded by a new cognitive-model build",
          },
        });
        const run = await tx.aiGenerationRun.create({
          data: {
            userId: initial.goal.userId,
            scope: "unit",
            scopeId: unitId,
            operation: "unit.cognitive_model",
            status: "running",
            statusMessage: "Building learning targets",
          },
        });
        return { id: run.id, status: "running" as const };
        })
      : (() => {
          throw new Error("Cognitive-model generation-run repository is required");
        })();

  let expansionResult: ExpansionResult;
  try {
    const [existingEntities, predecessorEntities] = portable
      ? [portable.existingEntities, portable.predecessorEntities]
      : await Promise.all([
      persistence!.cognitiveEntity.findMany({
        where: { goalId: initial.goalId, status: "active" },
        select: {
          id: true,
          stableKey: true,
          kind: true,
          title: true,
          description: true,
          provenance: true,
        },
      }),
      persistence!.cognitiveEntity.findMany({
        where: {
          goalId: initial.goalId,
          status: "active",
          learningTargetRequirements: {
            some: {
              learningTarget: {
                units: {
                  some: {
                    unitId: { in: parsePrereqs(initial.prerequisites) },
                    isExit: true,
                  },
                },
              },
            },
          },
        },
        select: {
          id: true,
          stableKey: true,
          kind: true,
          title: true,
          description: true,
        },
      }),
    ]);
    const curriculumUnits = initial.goal
      .units as CognitiveModelExpansionCurriculumUnit[];
    const ordered = orderCurriculumUnits(curriculumUnits);
    const moduleUnitKeys = new Set(
      initial.moduleId
        ? curriculumUnits
            .filter((unit) => unit.moduleId === initial.moduleId)
            .map((unit) => unit.curriculumKey)
        : [],
    );
    const existingModuleEntityCount = existingEntities.filter((entity) => {
      const owner = provenanceOwnerCurriculumKey(entity.provenance) ?? "";
      return (
        moduleUnitKeys.has(owner) || owner === initial.module?.curriculumKey
      );
    }).length;
    const approvedPlan =
      initial.goal.mapPlanStatus === "approved"
        ? parseMapPlan(initial.goal.mapPlanJson)
        : null;
    const onKnowledgeActivity = async (activity: KnowledgeActivity) => {
      await appendCognitiveRunEvent(
        persistence,
        cognitiveRun.id,
        "knowledge_activity",
        { type: "knowledge_activity", activity },
        "knowledge_activity",
        options.generationRun,
      );
      await options.onKnowledgeActivity?.(activity);
    };
    const pathContract = resolveBoundUnitPath(approvedPlan, initial.module?.title, initial.title);
    const generationParams = {
      userId: initial.goal.userId ?? undefined,
      goalId: initial.goalId,
      unitId,
      goalTitle: initial.goal.title,
      goalLevel: initial.goal.level,
      domainTag: initial.goal.domainTag,
      topicCategory: initial.goal.topicCategory,
      contentLanguage: initial.goal.contentLanguage,
      currentCurriculumKey: initial.curriculumKey,
      unitTitle: initial.title,
      contentSummary: initial.contentSummary,
      planningOutcomes: approvedPlan
        ? goalPlanOutcomes(approvedPlan)
        : undefined,
      pathContract,
      planningOutcomeRefs: pathContract?.planningOutcomeRefs ?? parsePlanningOutcomeRefs(
        initial.planningOutcomeRefs,
      ),
      moduleContext: initial.module
        ? {
            title: initial.module.title,
            objective: initial.module.objective,
            capabilityRefs: Array.isArray(initial.moduleCapabilityRefs)
              ? initial.moduleCapabilityRefs.flatMap((value: unknown) =>
                  typeof value === "string" ? [value] : [],
                )
              : [],
            capabilities: initial.module.learningTargets
              .filter((mapping: any) => mapping.role !== "entry")
              .map((mapping: any, index: number) => ({
                localRef: /^lt_\d+$/.test(mapping.localRef)
                  ? mapping.localRef.replace(/^lt_/, "mc_")
                  : /^mc_\d+$/.test(mapping.localRef)
                    ? mapping.localRef
                    : `mc_${index + 1}`,
                title: mapping.learningTarget.title,
                objective: mapping.learningTarget.learningObjective,
              })),
            remainingEntityBudget: Math.max(
              0,
              moduleCognitiveEntityBudget(moduleUnitKeys.size).maximumNew -
                existingModuleEntityCount,
            ),
          }
        : undefined,
      curriculumOutline: ordered.map((unit) => ({
        title: unit.title,
        unitKind: unit.unitKind,
        contentSummary: unit.contentSummary,
      })),
      siblingScopes: ordered
        .filter(
          (unit) =>
            unit.id !== unitId && unit.parentUnitId === initial.parentUnitId,
        )
        .map((unit) => ({
          title: unit.title,
          contentSummary: unit.contentSummary,
        })),
      predecessorExits: predecessorEntities,
      existingEntities: existingEntities.map((entity) => ({
        id: entity.id,
        stableKey: entity.stableKey,
        semanticKey: provenanceSemanticKey(entity.provenance),
        ownerCurriculumKey: provenanceOwnerCurriculumKey(entity.provenance),
        kind: entity.kind,
        title: entity.title,
        description: entity.description,
      })),
      onKnowledgeActivity,
      signal: options.signal,
    } as UnitCognitiveModelGenerationParams;
    const onTargetsReady = async (ready: UnitCognitiveModelTargetsReady) => {
      await appendCognitiveRunEvent(
        persistence,
        cognitiveRun.id,
        "learning_targets_ready",
        ready,
        "learning_targets_ready",
        options.generationRun,
      );
      await appendCognitiveRunEvent(
        persistence,
        cognitiveRun.id,
        "learning_access",
        {
          type: "learning_access",
          access: {
            modelPhase: "targets_ready",
            contentMode: "draft",
            assessmentMode: "locked",
            lockReason: "model_building",
            activeRunId: cognitiveRun.id,
            inputHash,
            prefixHash: ready.prefixHash,
          },
        },
        "learning_access",
        options.generationRun,
      );
      await options.onTargetsReady?.(ready);
    };
    const generated = await runWithLlmTraceAsync(
      {
        traceId: cognitiveRun.id,
        meta: {
          goalId: initial.goalId,
          unitId,
          aiGenerationRunId: cognitiveRun.id,
          operationFamily: TARGET_FIRST_KACOM_ENABLED
            ? "cognitive_model.unit_generate.target_first"
            : "unit.cognitive_model",
        },
      },
      () =>
        TARGET_FIRST_KACOM_ENABLED
          ? generateUnitCognitiveModelTargetFirst(generationParams, {
              onTargetsReady,
            })
          : generateUnitCognitiveModel(generationParams),
    );

    expansionResult = options.publication
      ? await options.publication.publishExpandedUnit({
          goalId: initial.goalId,
          unitId,
          inputHash,
          buildToken: token,
          curriculumKey: initial.curriculumKey,
          language: initial.goal.contentLanguage,
          moduleCapabilityRefsJson: JSON.stringify(
            initial.moduleCapabilityRefs ?? [],
          ),
          moduleRole:
            initial.moduleMilestoneRole === "verify"
              ? "exit"
              : initial.moduleMilestoneRole === "introduce"
                ? "introduce"
                : initial.moduleMilestoneRole || "support",
          proposalJson: JSON.stringify(generated.proposal),
          externalEntitiesJson: JSON.stringify(generated.externalEntities),
          generationAuditJson: JSON.stringify(generated.proposal.audit),
          pathEntityKeys: pathContract?.entities.map((entity) => entity.semanticKey),
        })
      : await persistence!.$transaction(async (tx) => {
          await acquireCognitiveModelWriteLock(tx, initial.goalId, unitId);
          const [goal, unit] = await Promise.all([
            tx.learningGoal.findUnique({ where: { id: initial.goalId } }),
            tx.learningUnit.findUnique({ where: { id: unitId } }),
          ]);
          if (!goal || !unit) throw new Error("Unit not found");
          if (
            goal.cognitiveModelInputHash !== inputHash ||
            unit.cognitiveModelStatus !== "building" ||
            unit.cognitiveModelBuildToken !== token ||
            unit.cognitiveModelBuildInputHash !== inputHash
          ) {
            throw new Error(
              "Cognitive-model expansion reservation became stale",
            );
          }
          const candidate = await ensureCandidateRevision(tx, {
            goalId: initial.goalId,
            inputHash,
            currentVersion: goal.cognitiveModelVersion,
          });
          await persistUnitCognitiveProposal({
            client: tx,
            goalId: initial.goalId,
            unit: { id: unitId, curriculumKey: initial.curriculumKey },
            language: initial.goal.contentLanguage,
            modelVersion: candidate.version,
            proposal: generated.proposal,
            externalEntities: generated.externalEntities,
            pathEntityKeys: pathContract?.entities.map((entity) => entity.semanticKey),
          });
          if (initial.module) {
            await tx.unitLearningTarget.updateMany({
              where: { unitId },
              data: {
                moduleCapabilityRefs: inputJson(initial.moduleCapabilityRefs),
                moduleRole:
                  initial.moduleMilestoneRole === "verify"
                    ? "exit"
                    : initial.moduleMilestoneRole === "introduce"
                      ? "introduce"
                      : initial.moduleMilestoneRole || "support",
              },
            });
          }
          await tx.learningUnit.update({
            where: { id: unitId },
            data: {
              cognitiveModelStatus: "expanded",
              cognitiveModelBuildStartedAt: null,
              cognitiveModelBuildToken: null,
              cognitiveModelBuildInputHash: inputHash,
            },
          });
          const units = await tx.learningUnit.findMany({
            where: { goalId: initial.goalId, unitKind: "lesson" },
            include: { learningTargets: true },
          });
          const allExpanded = await isGoalCognitiveModelComplete(tx, {
            goalId: initial.goalId,
            curriculumVersion: goal.curriculumVersion,
            inputHash,
            units,
          });
          // During a cold build, the current input hash already owns the published
          // skeleton. Publish each fully validated unit slice so canonical reads
          // and that unit's assessments can advance while later lessons continue
          // expanding. During reconciliation, keep the old last-good revision until
          // every unit for the new hash is complete; mixing hashes is never exposed.
          // Curriculum v2: pending later modules keep the goal in incremental
          // building — full planning-coverage is deferred until those modules exist.
          const publication = decideCognitiveModelExpansionPublication({
            allExpanded,
            inputHash,
            publishedHash: goal.cognitiveModelPublishedHash,
          });
          const publish = publication.publish;
          const snapshot = await buildObjectiveSnapshot(
            tx,
            initial.goalId,
            inputHash,
            {
              phase: publication.snapshotPhase,
              complete: allExpanded,
              generatedUnitId: unitId,
              generationAudit: generated.proposal.audit,
            },
          );
          const planningCoverage = allExpanded
            ? validateSnapshotPlanningCoverage(
                snapshot,
                goal.mapPlanStatus === "approved"
                  ? parseMapPlan(goal.mapPlanJson)
                  : null,
              )
            : {
                mode: "incremental" as const,
                coveredOutcomeRefs: generated.proposal.learningTargets.flatMap(
                  (target) => target.planningOutcomeRefs,
                ),
              };
          snapshot.audit = {
            ...snapshot.audit,
            planningCoverage,
          };
          await tx.cognitiveModelRevision.update({
            where: { id: candidate.id },
            data: {
              snapshotJson: inputJson(snapshot),
              auditJson: inputJson(snapshot.audit),
              ...(publish
                ? { status: "published", publishedAt: new Date() }
                : { status: "candidate" }),
            },
          });
          if (publish) {
            await tx.cognitiveModelRevision.updateMany({
              where: {
                goalId: initial.goalId,
                status: "published",
                id: { not: candidate.id },
              },
              data: { status: "superseded" },
            });
            await pruneSupersededCognitiveModelRevisions(tx, initial.goalId);
            await tx.learningGoal.update({
              where: { id: initial.goalId },
              data: {
                cognitiveModelVersion: candidate.version,
                cognitiveModelPublishedHash: inputHash,
                cognitiveModelStatus: publication.goalStatus,
              },
            });
          } else {
            await tx.learningGoal.update({
              where: { id: initial.goalId },
              data: { cognitiveModelStatus: publication.goalStatus },
            });
          }
          return {
            goalId: initial.goalId,
            unitId,
            inputHash,
            status: "expanded" as const,
            published: publish,
            version: publish ? candidate.version : goal.cognitiveModelVersion,
          };
        }, COGNITIVE_MODEL_TRANSACTION_OPTIONS);
    const sourceIds = (generated.sources ?? []).flatMap((source) =>
      source.sourceId ? [source.sourceId] : [],
    );
    if (sourceIds.length > 0) {
      const { bindWebKnowledgeSourcesToUnitTargets } =
        await import("../search/web-knowledge.js");
      await bindWebKnowledgeSourcesToUnitTargets({
        goalId: initial.goalId,
        unitId,
        sourceIds,
      });
    }
  } catch (error) {
    if (portable && options.expansionLease) {
      await options.expansionLease.fail({
        goalId: initial.goalId,
        unitId,
        inputHash,
        token,
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof PlanningCoverageError
          ? {
              planningCoverageGap: {
                affectedUnitIds: error.affectedUnitIds,
              },
            }
          : {}),
      });
    } else if (persistence) {
    await persistence.$transaction(async (tx) => {
      await acquireCognitiveModelWriteLock(tx, initial.goalId, unitId);
      const unit = await tx.learningUnit.findUnique({ where: { id: unitId } });
      if (
        unit?.cognitiveModelBuildToken === token &&
        !(error instanceof PlanningCoverageError)
      ) {
        await tx.learningUnit.update({
          where: { id: unitId },
          data: {
            cognitiveModelStatus: "failed",
            cognitiveModelBuildStartedAt: null,
            cognitiveModelBuildToken: null,
          },
        });
      }
      if (
        error instanceof PlanningCoverageError &&
        error.affectedUnitIds.length > 0
      ) {
        const currentGoal = await tx.learningGoal.findUnique({
          where: { id: initial.goalId },
          select: {
            cognitiveModelInputHash: true,
            cognitiveModelPublishedHash: true,
            cognitiveModelVersion: true,
          },
        });
        await tx.learningUnit.updateMany({
          where: {
            goalId: initial.goalId,
            id: { in: error.affectedUnitIds },
          },
          data: {
            cognitiveModelStatus: "pending",
            cognitiveModelBuildStartedAt: null,
            cognitiveModelBuildToken: null,
            cognitiveModelBuildInputHash: null,
          },
        });
        if (currentGoal) {
          await tx.learningGoal.update({
            where: { id: initial.goalId },
            data: {
              cognitiveModelStatus:
                currentGoal.cognitiveModelPublishedHash ===
                currentGoal.cognitiveModelInputHash
                  ? "building"
                  : "needs_reconciliation",
            },
          });
          await tx.eventOutbox.create({
            data: {
              type: "cognitive.model.expand_next",
              payload: JSON.stringify({
                goalId: initial.goalId,
                inputHash: currentGoal.cognitiveModelInputHash,
                baseModelVersion: currentGoal.cognitiveModelVersion,
                reason: "planning_coverage_gap",
                affectedUnitIds: error.affectedUnitIds,
              }),
            },
          });
        }
      }
      const candidate = await tx.cognitiveModelRevision.findFirst({
        where: { goalId: initial.goalId, inputHash, status: "candidate" },
        orderBy: { version: "desc" },
      });
      if (candidate) {
        const planningGap =
          error instanceof PlanningCoverageError
            ? {
                mode: "failed",
                message: error.message,
                affectedUnitIds: error.affectedUnitIds,
              }
            : undefined;
        await tx.cognitiveModelRevision.update({
          where: { id: candidate.id },
          data: {
            status: "failed",
            snapshotJson: inputJson({}),
            auditJson: inputJson(
              planningGap ? { planningCoverage: planningGap } : {},
            ),
            errorJson: inputJson({
              message: error instanceof Error ? error.message : String(error),
              unitId,
              ...(planningGap ? { planningCoverage: planningGap } : {}),
            }),
          },
        });
      }
    }, COGNITIVE_MODEL_TRANSACTION_OPTIONS);
    }
    await finishCognitiveRun(
      persistence,
      cognitiveRun.id,
      "error",
      error instanceof Error ? error.message : String(error),
      options.generationRun,
    );
    throw error;
  }
  await finishCognitiveRun(
    persistence,
    cognitiveRun.id,
    "completed",
    {
      ...expansionResult,
      finalized: true,
    },
    options.generationRun,
  );
  if (expansionResult.published) {
    // Project publication is deliberately outside the model transaction and
    // its failure cleanup. A retry can repair the idempotent capstone without
    // downgrading the already committed last-good cognitive-model revision.
    if (persistence || options.projectBlueprint) {
      await ensureGoalCapstoneProject(
        persistence,
        initial.goalId,
        options.projectBlueprint,
      );
    }
    if (initial.goal.userId) {
      if (options.learnerStateMemoryInvalidation) {
        await options.learnerStateMemoryInvalidation.invalidate({
          userId: initial.goal.userId,
          reason: "cognitive_model_published",
        });
      } else if (persistence) {
        const { invalidateLearnerStateMemory } =
          await import("../learner-state-memory/index.js");
        await invalidateLearnerStateMemory(
          initial.goal.userId,
          "cognitive_model_published",
          persistence,
        );
      }
    }
  }
  return expansionResult;
}
