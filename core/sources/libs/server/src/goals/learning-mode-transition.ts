// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import { randomUUID } from "node:crypto";
import type { PersistenceClient } from "../persistence/persistence-compat.js";
import {
  FoundationMasteryTransitionPersistenceError,
  type LearnerStateMemoryInvalidationRepository,
  type FoundationMasteryTransitionRepository,
  type CognitiveModelInvalidationRepository,
} from "../../../domain/src/index.js";
import { invalidateAgendaForUser } from "../agenda/index.js";
import { invalidateLearnerStateMemory } from "../learner-state-memory/index.js";

export const LEARNING_MODE_EXPLORATION = "exploration";
export const LEARNING_MODE_MASTERY = "mastery";

function invalidateGoalCognitiveModel(
  persistence: PersistenceClient,
  goalId: string,
  options: { reason?: string; enqueue?: boolean; force?: boolean },
  repository?: CognitiveModelInvalidationRepository,
) {
  return repository
    ? import("../cognitive-model/events.js").then(
        ({ invalidateCognitiveModelForGoal }) =>
          invalidateCognitiveModelForGoal(persistence, goalId, options, repository),
      )
    : import("../cognitive-model/events.js").then(
        ({ invalidateCognitiveModelForGoal }) =>
          invalidateCognitiveModelForGoal(persistence, goalId, options),
      );
}

export type MasteryTransitionConflict =
  | "not_found"
  | "not_full_goal"
  | "not_exploration"
  | "curriculum_not_ready"
  | "share_active"
  | "transition_conflict";

export class MasteryTransitionError extends Error {
  constructor(
    message: string,
    readonly code: MasteryTransitionConflict,
  ) {
    super(message);
  }
}

export type KacomDetachConflict =
  "not_found" | "not_kacom_goal" | "share_active";

export class KacomDetachError extends Error {
  constructor(
    message: string,
    readonly code: KacomDetachConflict,
  ) {
    super(message);
  }
}

/**
 * Internal development escape hatch. It intentionally retains every KACOM
 * snapshot, entity, target, and evidence row; learningMode is the single
 * runtime authority that stops KACOM work and selects exploration behavior.
 */
export async function detachKacomForInternalTesting(
  goalId: string,
  repository: FoundationMasteryTransitionRepository,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
) {
  let result;
  try {
    result = await repository.detachKacom(goalId);
  } catch (error) {
    if (error instanceof FoundationMasteryTransitionPersistenceError) {
      throw new KacomDetachError(
        error.message,
        error.code === "not_found"
          ? "not_found"
          : error.code === "share_active"
            ? "share_active"
            : "not_kacom_goal",
      );
    }
    throw error;
  }
  if (result.userId && !result.alreadyDetached) {
    await invalidateAgendaForUser(result.userId);
    await invalidateLearnerStateMemory(
      result.userId,
      "kacom_detached_for_internal_testing",
      undefined,
      learnerStateMemoryInvalidation,
    );
  }
  return {
    goalId,
    learningMode: LEARNING_MODE_EXPLORATION,
    detached: true,
    alreadyDetached: result.alreadyDetached,
    preservedCognitiveModelVersion: result.cognitiveModelVersion,
  };
}

/** Enables KACOM-backed mastery for any ready full exploration goal. */
export async function requestGoalMasteryTransition(
  persistence: PersistenceClient,
  userId: string,
  goalId: string,
  foundationMasteryTransition?: FoundationMasteryTransitionRepository,
  cognitiveModelInvalidation?: CognitiveModelInvalidationRepository,
) {
  if (foundationMasteryTransition) {
    return requestGoalMasteryTransitionWithRepository(
      userId,
      goalId,
      foundationMasteryTransition,
      cognitiveModelInvalidation!,
    );
  }
  const goal = await persistence.learningGoal.findFirst({
    where: { id: goalId, userId },
    include: {
      modules: { select: { generationStatus: true } },
      units: {
        where: { unitKind: "lesson" },
        orderBy: { curriculumKey: "asc" },
        select: { id: true, curriculumKey: true },
      },
    },
  });
  if (!goal) throw new MasteryTransitionError("目标不存在", "not_found");
  if (goal.goalKind === "micro") {
    throw new MasteryTransitionError(
      "微课程不支持系统掌握模式",
      "not_full_goal",
    );
  }
  if (goal.learningMode === LEARNING_MODE_MASTERY) {
    throw new MasteryTransitionError(
      "该目标已经是系统掌握模式",
      "not_exploration",
    );
  }
  if (
    goal.learningModeTransitionStatus === "queued" ||
    goal.learningModeTransitionStatus === "building"
  ) {
    const liveEvent = await persistence.eventOutbox.findFirst({
      where: {
        type: {
          in: ["cognitive.model.skeleton", "cognitive.model.expand_next"],
        },
        payload: { contains: goalId },
        publishedAt: null,
        deadLetteredAt: null,
      },
      select: { id: true },
    });
    if (!liveEvent) {
      await invalidateGoalCognitiveModel(
        persistence,
        goalId,
        {
          reason: "exploration_to_mastery_retry",
          force: true,
        },
        cognitiveModelInvalidation,
      );
    }
    return transitionSnapshot(goal);
  }
  if (
    goal.mapPlanStatus !== "approved" ||
    goal.detailedPlanStatus !== "ready" ||
    goal.units.length === 0 ||
    goal.modules.some((module) =>
      ["building", "failed"].includes(module.generationStatus),
    )
  ) {
    throw new MasteryTransitionError(
      "请等待课程准备完成后再转换",
      "curriculum_not_ready",
    );
  }
  if (goal.shareVisibility !== "off") {
    throw new MasteryTransitionError(
      "请先取消发布或发布申请，再转换学习模式",
      "share_active",
    );
  }

  const token = randomUUID();
  await persistence.learningGoal.update({
    where: { id: goalId },
    data: {
      learningModeTransitionStatus: "queued",
      learningModeTransitionToken: token,
      learningModeTransitionStartedAt: new Date(),
      learningModeTransitionError: "",
      learningModeTransitionArtifacts: {
        curriculumKeys: goal.units.map((unit) => unit.curriculumKey),
      },
    },
  });
  await persistence.learningUnit.updateMany({
    where: {
      goalId,
      unitKind: "lesson",
    },
    data: {
      cognitiveModelStatus: "pending",
      cognitiveModelBuildStartedAt: null,
      cognitiveModelBuildToken: null,
      cognitiveModelBuildInputHash: null,
    },
  });
  try {
    const queued = await invalidateGoalCognitiveModel(
      persistence,
      goalId,
      {
        reason: "exploration_to_mastery",
        force: true,
      },
      cognitiveModelInvalidation,
    );
    await persistence.learningGoal.updateMany({
      where: {
        id: goalId,
        learningMode: LEARNING_MODE_EXPLORATION,
        learningModeTransitionToken: token,
      },
      data: { learningModeTransitionStatus: "building" },
    });
    return {
      goalId,
      learningMode: LEARNING_MODE_EXPLORATION,
      transitionStatus: "building",
      retryable: false,
      inputHash: queued.inputHash,
    };
  } catch (error) {
    await markFoundationMasteryTransitionFailed(
      persistence,
      goalId,
      error instanceof Error ? error.message : "系统掌握准备失败",
    );
    throw error;
  }
}

export async function requestGoalMasteryTransitionWithRepository(
  userId: string,
  goalId: string,
  foundationMasteryTransition: FoundationMasteryTransitionRepository,
  cognitiveModelInvalidation: CognitiveModelInvalidationRepository,
) {
  let transition;
  try {
    transition = await foundationMasteryTransition.beginOwned({
      userId,
      goalId,
    });
  } catch (error) {
    if (error instanceof FoundationMasteryTransitionPersistenceError) {
      throw new MasteryTransitionError(error.message, error.code);
    }
    throw error;
  }

  if (!transition.started) {
    await cognitiveModelInvalidation.invalidate({
      goalId,
      reason: "exploration_to_mastery_retry",
      force: true,
    });
    return {
      goalId: transition.goalId,
      learningMode: transition.learningMode,
      transitionStatus: transition.transitionStatus,
      retryable: false,
      error: transition.transitionError || null,
    };
  }

  try {
    const queued = await cognitiveModelInvalidation.invalidate({
      goalId,
      reason: "exploration_to_mastery",
      force: true,
    });
    const markedBuilding = await foundationMasteryTransition.markBuilding({
      goalId,
      token: transition.token,
    });
    if (!markedBuilding) {
      throw new MasteryTransitionError(
        "系统掌握转换已被其他请求接管",
        "transition_conflict",
      );
    }
    return {
      goalId,
      learningMode: LEARNING_MODE_EXPLORATION,
      transitionStatus: "building",
      retryable: false,
      inputHash: queued.inputHash,
    };
  } catch (error) {
    await foundationMasteryTransition.markFailed({
      goalId,
      token: transition.token,
      message: error instanceof Error ? error.message : "系统掌握准备失败",
    });
    throw error;
  }
}

export async function finalizeGoalMasteryTransition(
  persistence: PersistenceClient,
  goalId: string,
  foundationMasteryTransition?: FoundationMasteryTransitionRepository,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
) {
  const goal = await persistence.learningGoal.findUnique({
    where: { id: goalId },
    include: {
      units: {
        where: { unitKind: "lesson" },
        orderBy: { curriculumKey: "asc" },
        select: {
          curriculumKey: true,
          cognitiveModelStatus: true,
          cognitiveModelBuildInputHash: true,
          learningTargets: { select: { learningTargetId: true }, take: 1 },
        },
      },
    },
  });
  if (
    !goal ||
    goal.learningMode !== LEARNING_MODE_EXPLORATION ||
    goal.learningModeTransitionStatus !== "building"
  ) {
    return false;
  }
  const artifacts = goal.learningModeTransitionArtifacts as {
    curriculumKeys?: unknown;
  };
  const frozenKeys = Array.isArray(artifacts?.curriculumKeys)
    ? artifacts.curriculumKeys.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const currentKeys = goal.units.map((unit) => unit.curriculumKey);
  const materializedPrefixReady =
    ["building", "ready"].includes(goal.cognitiveModelStatus) &&
    goal.cognitiveModelInputHash.length > 0 &&
    goal.cognitiveModelPublishedHash === goal.cognitiveModelInputHash &&
    frozenKeys.length === currentKeys.length &&
    frozenKeys.every((key, index) => key === currentKeys[index]) &&
    goal.units.every(
      (unit) =>
        unit.cognitiveModelStatus === "expanded" &&
        unit.cognitiveModelBuildInputHash === goal.cognitiveModelInputHash &&
        unit.learningTargets.length > 0,
    );
  if (!materializedPrefixReady) return false;
  const transitionToken = goal.learningModeTransitionToken;
  if (!transitionToken) return false;

  let finalized = false;
  if (foundationMasteryTransition && goal.userId) {
    finalized = await foundationMasteryTransition.finalizeOwned({
      userId: goal.userId,
      goalId,
      token: transitionToken,
      inputHash: goal.cognitiveModelInputHash,
    });
  } else {
    const updated = await persistence.learningGoal.updateMany({
      where: {
        id: goalId,
        learningMode: LEARNING_MODE_EXPLORATION,
        learningModeTransitionStatus: "building",
        learningModeTransitionToken: transitionToken,
        cognitiveModelInputHash: goal.cognitiveModelInputHash,
        cognitiveModelPublishedHash: goal.cognitiveModelInputHash,
      },
      data: {
        learningMode: LEARNING_MODE_MASTERY,
        learningModeTransitionStatus: "idle",
        learningModeTransitionToken: null,
        learningModeTransitionStartedAt: null,
        learningModeTransitionError: "",
        learningModeTransitionArtifacts: {},
      },
    });
    finalized = updated.count > 0;
  }
  if (!finalized) return false;
  if (goal.userId) {
    await invalidateAgendaForUser(goal.userId, persistence);
    await invalidateLearnerStateMemory(
      goal.userId,
      "goal_mastery_enabled",
      persistence,
      learnerStateMemoryInvalidation,
    );
  }
  return true;
}

/** @deprecated Compatibility alias for foundation-goal callers. */
export const requestFoundationMasteryTransition = requestGoalMasteryTransition;

/** @deprecated Compatibility alias for existing event consumers. */
export const finalizeFoundationMasteryTransition =
  finalizeGoalMasteryTransition;

export async function markFoundationMasteryTransitionFailed(
  persistence: PersistenceClient,
  goalId: string,
  message: string,
  foundationMasteryTransition?: FoundationMasteryTransitionRepository,
) {
  if (foundationMasteryTransition) {
    const goal = await persistence.learningGoal.findUnique({
      where: { id: goalId },
      select: { learningModeTransitionToken: true },
    });
    if (goal?.learningModeTransitionToken) {
      await foundationMasteryTransition.markFailed({
        goalId,
        token: goal.learningModeTransitionToken,
        message,
      });
      return;
    }
  }
  await persistence.learningGoal.updateMany({
    where: {
      id: goalId,
      learningMode: LEARNING_MODE_EXPLORATION,
      learningModeTransitionStatus: { in: ["queued", "building"] },
    },
    data: {
      learningModeTransitionStatus: "failed",
      learningModeTransitionToken: null,
      learningModeTransitionError: message.slice(0, 1000),
    },
  });
}

function transitionSnapshot(goal: {
  id: string;
  learningMode: string;
  learningModeTransitionStatus: string;
  learningModeTransitionError: string;
}) {
  return {
    goalId: goal.id,
    learningMode: goal.learningMode,
    transitionStatus: goal.learningModeTransitionStatus,
    retryable: goal.learningModeTransitionStatus === "failed",
    error: goal.learningModeTransitionError || null,
  };
}
