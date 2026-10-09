// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import type { Persistence, PersistenceClient } from "../persistence/persistence-compat.js";
import type {
  CognitiveModelExpansionLeaseRepository,
  CognitiveModelExpansionContextRepository,
  CognitiveModelEventRepository,
  CognitiveModelInvalidationRepository,
  CognitiveModelGenerationRunRepository,
  CognitiveModelPublicationRepository,
  CognitiveModelPublicationFinalizationRepository,
  FoundationMasteryTransitionRepository,
  LearnerStateMemoryInvalidationRepository,
  ProjectBlueprintRepository,
} from "../../../domain/src/index.js";
import { ensureGoalCapstoneProject } from "../cognition/goal-capstone.js";
import { parsePrereqs } from "../domain/unit-status.js";
import {
  expandUnitCognitiveModel,
  ensureGoalCognitiveSkeleton,
} from "./lifecycle.js";
import {
  COGNITIVE_MODEL_TRANSACTION_OPTIONS,
  acquireCognitiveModelWriteLock,
} from "./lock.js";
import { computeCognitiveModelInputHash, orderCurriculumUnits } from "./pure.js";
import { goalCreationWorkGate } from "../agents/goal-creation/work-gate.js";
import { finalizeGoalMasteryTransition } from "../goals/learning-mode-transition.js";
import {
  COGNITIVE_MODEL_EXPAND_NEXT_EVENT,
  COGNITIVE_MODEL_SKELETON_EVENT,
} from "./event-types.js";

export {
  COGNITIVE_MODEL_EXPAND_NEXT_EVENT,
  COGNITIVE_MODEL_SKELETON_EVENT,
} from "./event-types.js";

export type InvalidateCognitiveModelOptions = {
  reason?: string;
  enqueue?: boolean;
  force?: boolean;
};

function parsePayload(value: string): {
  goalId?: string;
  inputHash?: string;
  baseModelVersion?: number;
  force?: boolean;
} {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Fingerprinted append-only invalidation; published revisions remain untouched. */
export async function invalidateCognitiveModelForGoalInTransaction(
  tx: Persistence.TransactionClient,
  goalId: string,
  options: InvalidateCognitiveModelOptions = {},
) {
  await acquireCognitiveModelWriteLock(tx, goalId);
  const goal = await tx.learningGoal.findUnique({
    where: { id: goalId },
    include: { units: { where: { unitKind: { not: "overview" } } } },
  });
  if (!goal) throw new Error("Goal not found");
  if (
    goal.goalKind === "micro" ||
    (goal.learningMode === "exploration" &&
      goal.learningModeTransitionStatus !== "queued" &&
      goal.learningModeTransitionStatus !== "building")
  ) {
    return {
      goalId,
      inputHash: goal.cognitiveModelInputHash,
      changed: false,
      eventId: null,
    };
  }
  const inputHash = computeCognitiveModelInputHash(goal, goal.units);
  const changed =
    options.force === true || inputHash !== goal.cognitiveModelInputHash;
  if (changed) {
    if (goal.curriculumVersion === 2) {
      // Appending a later module must preserve the already published prefix.
      // Promote its immutable unit fingerprints to the new append hash
      // without regenerating entities or touching learner evidence.
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
    await tx.learningGoal.update({
      where: { id: goalId },
      data: {
        cognitiveModelEnabled: true,
        cognitiveModelInputHash: inputHash,
        cognitiveModelStatus:
          goal.curriculumVersion === 2 && goal.cognitiveModelVersion > 0
            ? "building"
            : goal.cognitiveModelVersion > 0
              ? "needs_reconciliation"
              : "pending",
      },
    });
  }
  let eventId: string | null = null;
  if (changed && (options.enqueue ?? true)) {
    const event = await tx.eventOutbox.create({
      data: {
        type: COGNITIVE_MODEL_SKELETON_EVENT,
        payload: JSON.stringify({
          goalId,
          inputHash,
          baseModelVersion: goal.cognitiveModelVersion,
          reason: options.reason ?? "curriculum_changed",
          force: options.force === true,
        }),
      },
      select: { id: true },
    });
    eventId = event.id;
  }
  return { goalId, inputHash, changed, eventId };
}

export async function invalidateCognitiveModelForGoal(
  persistence: PersistenceClient,
  goalId: string,
  options: InvalidateCognitiveModelOptions = {},
  repository?: CognitiveModelInvalidationRepository,
) {
  if (repository) {
    return repository.invalidate({ goalId, ...options });
  }
  return persistence.$transaction(
    (tx) => invalidateCognitiveModelForGoalInTransaction(tx, goalId, options),
    COGNITIVE_MODEL_TRANSACTION_OPTIONS,
  );
}

export async function enqueueCognitiveModelSkeleton(
  persistence: PersistenceClient,
  goalId: string,
) {
  return invalidateCognitiveModelForGoal(persistence, goalId, {
    reason: "skeleton_requested",
    force: true,
  });
}

export async function enqueueNextCognitiveExpansion(
  persistence: PersistenceClient,
  goalId: string,
) {
  return persistence.$transaction(async (tx) => {
    await acquireCognitiveModelWriteLock(tx, goalId);
    const goal = await tx.learningGoal.findUnique({
      where: { id: goalId },
      select: { cognitiveModelInputHash: true, cognitiveModelVersion: true },
    });
    if (!goal) return null;
    return tx.eventOutbox.create({
      data: {
        type: COGNITIVE_MODEL_EXPAND_NEXT_EVENT,
        payload: JSON.stringify({
          goalId,
          inputHash: goal.cognitiveModelInputHash,
          baseModelVersion: goal.cognitiveModelVersion,
        }),
      },
    });
  }, COGNITIVE_MODEL_TRANSACTION_OPTIONS);
}

/**
 * Re-arm a failed unit when a learner returns to it. Failed outbox work may
 * already be dead-lettered, so merely leaving the unit in `failed` makes
 * assessment permanently inaccessible. The goal lock makes this a one-shot
 * transition: concurrent session reads observe `pending` and do not enqueue
 * duplicate recovery events.
 */
export async function enqueueFailedCognitiveModelRecovery(
  persistence: PersistenceClient,
  goalId: string,
  unitId: string,
) {
  return persistence.$transaction(async (tx) => {
    await acquireCognitiveModelWriteLock(tx, goalId, unitId);
    const [goal, unit] = await Promise.all([
      tx.learningGoal.findUnique({
        where: { id: goalId },
        select: {
          cognitiveModelInputHash: true,
          cognitiveModelPublishedHash: true,
          cognitiveModelVersion: true,
        },
      }),
      tx.learningUnit.findUnique({
        where: { id: unitId },
        select: { goalId: true, cognitiveModelStatus: true },
      }),
    ]);
    if (
      !goal ||
      !unit ||
      unit.goalId !== goalId ||
      unit.cognitiveModelStatus !== "failed"
    ) {
      return { triggered: false as const, goalStatus: null, eventId: null };
    }

    const goalStatus =
      goal.cognitiveModelPublishedHash === goal.cognitiveModelInputHash
        ? "building"
        : "needs_reconciliation";
    await tx.learningUnit.update({
      where: { id: unitId },
      data: {
        cognitiveModelStatus: "pending",
        cognitiveModelBuildStartedAt: null,
        cognitiveModelBuildToken: null,
        cognitiveModelBuildInputHash: null,
      },
    });
    await tx.learningGoal.update({
      where: { id: goalId },
      data: { cognitiveModelStatus: goalStatus },
    });
    const event = await tx.eventOutbox.create({
      data: {
        type: COGNITIVE_MODEL_EXPAND_NEXT_EVENT,
        payload: JSON.stringify({
          goalId,
          inputHash: goal.cognitiveModelInputHash,
          baseModelVersion: goal.cognitiveModelVersion,
          reason: "learner_returned_to_failed_unit",
        }),
      },
      select: { id: true },
    });
    return {
      triggered: true as const,
      goalStatus,
      eventId: event.id,
    };
  }, COGNITIVE_MODEL_TRANSACTION_OPTIONS);
}

export async function findNextExpandableUnit(
  persistence: PersistenceClient,
  goalId: string,
) {
  const [goal, units] = await Promise.all([
    persistence.learningGoal.findUnique({
      where: { id: goalId },
      select: { cognitiveModelInputHash: true },
    }),
    persistence.learningUnit.findMany({
      where: { goalId, unitKind: { not: "overview" } },
      include: {
        learningTargets: true,
        module: { select: { unlockStatus: true } },
      },
    }),
  ]);
  if (!goal) return undefined;
  const expanded = new Set(
    units
      .filter(
        (unit) =>
          unit.unitKind !== "lesson" ||
          (unit.cognitiveModelStatus === "expanded" &&
            unit.cognitiveModelBuildInputHash ===
              goal.cognitiveModelInputHash &&
            unit.learningTargets.length > 0),
      )
      .map((unit) => unit.id),
  );
  return orderCurriculumUnits(units).find(
    (unit) =>
      unit.unitKind === "lesson" &&
      // Deep planning materializes every module's unit structure before the
      // goal page opens. A locked module is a curriculum preview, not KACOM
      // work authorization; expansion begins only after the module unlocks.
      unit.module?.unlockStatus !== "locked" &&
      !expanded.has(unit.id) &&
      parsePrereqs(unit.prerequisites).every((id) => expanded.has(id)),
  );
}

export type CognitiveModelEventResult = {
  goalId: string;
  expandedUnitId: string | null;
  status:
    | "skeleton_ready"
    | "expanded"
    | "complete"
    | "stale_ignored"
    | "duplicate_ignored"
    | "deferred";
};

/** CAS-fenced outbox handler suitable for the bounded analytics-worker lane. */
export async function processCognitiveModelEvent(params: {
  type: string;
  payloadJson: string;
  allowExpensiveWork?: boolean;
  foundationMasteryTransition: FoundationMasteryTransitionRepository;
  cognitiveModelExpansionLease: CognitiveModelExpansionLeaseRepository;
  cognitiveModelExpansionContext: CognitiveModelExpansionContextRepository;
  cognitiveModelEvent: CognitiveModelEventRepository;
  cognitiveModelGenerationRun: CognitiveModelGenerationRunRepository;
  cognitiveModelPublication: CognitiveModelPublicationRepository;
  cognitiveModelPublicationFinalization: CognitiveModelPublicationFinalizationRepository;
  projectBlueprint: ProjectBlueprintRepository;
  learnerStateMemoryInvalidation: LearnerStateMemoryInvalidationRepository;
}): Promise<CognitiveModelEventResult> {
  const enqueueNext = (goalId: string) => params.cognitiveModelEvent.enqueueNext({ goalId });
  if (
    params.type !== COGNITIVE_MODEL_SKELETON_EVENT &&
    params.type !== COGNITIVE_MODEL_EXPAND_NEXT_EVENT
  ) {
    throw new Error(`Unsupported cognitive-model event ${params.type}`);
  }
  const payload = parsePayload(params.payloadJson);
  if (!payload.goalId)
    throw new Error("Cognitive-model event is missing goalId");
  const creationGate = await goalCreationWorkGate(payload.goalId);
  if (creationGate === "stopped") {
    return {
      goalId: payload.goalId,
      expandedUnitId: null,
      status: "duplicate_ignored",
    };
  }
  let current = await params.cognitiveModelEvent.inspectGoal(payload.goalId);
  if (!current) throw new Error("Goal not found");
  if (
    current.goalKind === "micro" ||
    (current.learningMode === "exploration" &&
      current.learningModeTransitionStatus !== "queued" &&
      current.learningModeTransitionStatus !== "building")
  ) {
    return {
      goalId: payload.goalId,
      expandedUnitId: null,
      status: "complete",
    };
  }
  if (
    payload.inputHash &&
    payload.inputHash !== current.cognitiveModelInputHash
  ) {
    return {
      goalId: payload.goalId,
      expandedUnitId: null,
      status: "stale_ignored",
    };
  }
  if (
    payload.baseModelVersion != null &&
    payload.baseModelVersion !== current.cognitiveModelVersion
  ) {
    if (
      current.cognitiveModelStatus === "ready" &&
      current.cognitiveModelPublishedHash === current.cognitiveModelInputHash
    ) {
      // The full model may have committed before a capstone write failed. The
      // original outbox event remains retryable, and this idempotent ensure
      // repairs the project without mutating the last-good model revision.
      await ensureGoalCapstoneProject(
        null,
        payload.goalId,
        params.projectBlueprint,
      );
    }
    if (
      current.cognitiveModelStatus === "building" &&
      current.cognitiveModelPublishedHash === current.cognitiveModelInputHash
    ) {
      // A foreground Survey build may publish one validated unit and advance
      // the revision before the queued worker event starts. Re-arm the worker
      // with the new revision fence so the remaining course keeps expanding.
      if (current.nextExpandableUnitId) {
        await enqueueNext(payload.goalId);
      }
    }
    return {
      goalId: payload.goalId,
      expandedUnitId: null,
      status: "duplicate_ignored",
    };
  }
  if (params.allowExpensiveWork === false) {
    return { goalId: payload.goalId, expandedUnitId: null, status: "deferred" };
  }
  if (params.type === COGNITIVE_MODEL_SKELETON_EVENT) {
    await params.cognitiveModelPublication.ensureSkeleton({
      goalId: payload.goalId,
      inputHash: current.cognitiveModelInputHash,
    });
    current = await params.cognitiveModelEvent.inspectGoal(payload.goalId);
    if (!current) throw new Error("Goal not found");
    if (current.nextExpandableUnitId) await enqueueNext(payload.goalId);
    else
      await ensureGoalCapstoneProject(
        null,
        payload.goalId,
        params.projectBlueprint,
      );
    return {
      goalId: payload.goalId,
      expandedUnitId: null,
      status: "skeleton_ready",
    };
  }
  const nextUnitId = current.nextExpandableUnitId;
  if (!nextUnitId) {
    await ensureGoalCapstoneProject(
      null,
      payload.goalId,
      params.projectBlueprint,
    );
    if (current.transitionReady && current.userId && current.learningModeTransitionToken) {
      const finalized=await params.foundationMasteryTransition.finalizeOwned({userId:current.userId,goalId:payload.goalId,token:current.learningModeTransitionToken,inputHash:current.cognitiveModelInputHash});
      if(finalized) await params.learnerStateMemoryInvalidation.invalidate({userId:current.userId,reason:"goal_mastery_enabled"});
    }
    return { goalId: payload.goalId, expandedUnitId: null, status: "complete" };
  }
  await expandUnitCognitiveModel(
    null,
    nextUnitId,
    {
    expansionLease: params.cognitiveModelExpansionLease,
    expansionContext: params.cognitiveModelExpansionContext,
    generationRun: params.cognitiveModelGenerationRun,
    publication: params.cognitiveModelPublication,
    publicationFinalization: params.cognitiveModelPublicationFinalization,
    projectBlueprint: params.projectBlueprint,
    learnerStateMemoryInvalidation: params.learnerStateMemoryInvalidation,
    },
  );
  const after = await params.cognitiveModelEvent.inspectGoal(payload.goalId);
  if (!after) throw new Error("Goal not found");
  const remaining = after.nextExpandableUnitId;
  const afterExpansionGate = await goalCreationWorkGate(payload.goalId);
  if (remaining && afterExpansionGate === "run")
    await enqueueNext(payload.goalId);
  else {
    await ensureGoalCapstoneProject(
      null,
      payload.goalId,
      params.projectBlueprint,
    );
    if (after.transitionReady && after.userId && after.learningModeTransitionToken) {
      const finalized=await params.foundationMasteryTransition.finalizeOwned({userId:after.userId,goalId:payload.goalId,token:after.learningModeTransitionToken,inputHash:after.cognitiveModelInputHash});
      if(finalized) await params.learnerStateMemoryInvalidation.invalidate({userId:after.userId,reason:"goal_mastery_enabled"});
    }
  }
  return {
    goalId: payload.goalId,
    expandedUnitId: nextUnitId,
    status: "expanded",
  };
}
