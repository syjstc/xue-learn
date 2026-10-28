// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import type { Persistence, PersistenceClient } from "../../persistence/persistence-compat.js";
import { allowedDimensionsForTask } from "../evidence.js";
import { isAssistanceLevel, isCognitiveDimension } from "../types.js";
import { CognitionPersistenceError } from "./error.js";
import {
  ASSISTANCE_LEVEL_VALUE,
  TASK_TYPE_EVIDENCE,
  declarationSignature,
  jsonInput,
  nonEmpty,
  ownsInteractiveTransaction,
  persistedRequirementSignature,
  positiveInteger,
  sameTaskEvidencePolicy,
  sourceAllowsDimension,
  taskPolicyFromContext,
} from "./shared.js";
import type { LearningTaskDeclaration, TaskAttemptInput } from "./types.js";
import type { TaskAttemptRepository } from "../../../../domain/src/index.js";

function validateTaskDeclaration(input: LearningTaskDeclaration): void {
  if (
    !nonEmpty(input.goalId) ||
    !nonEmpty(input.stableKey) ||
    !nonEmpty(input.title) ||
    !positiveInteger(input.definitionVersion) ||
    input.requirements.length === 0
  ) {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      "task declaration requires identity, version, title, and requirements",
    );
  }
  taskPolicyFromContext({ evidencePolicy: input.evidencePolicy });
  const taskTypePolicy = TASK_TYPE_EVIDENCE[input.taskType];
  if (
    !taskTypePolicy.sources.includes(input.evidencePolicy.source) ||
    !taskTypePolicy.taskKinds.includes(input.evidencePolicy.taskKind)
  ) {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      `${input.taskType} cannot declare ${input.evidencePolicy.source}/${input.evidencePolicy.taskKind} evidence`,
    );
  }
  const signatures = new Set<string>();
  for (const requirement of input.requirements) {
    if (
      !nonEmpty(requirement.cognitiveEntityId) ||
      !isCognitiveDimension(requirement.dimension) ||
      !nonEmpty(requirement.criterionRef) ||
      !positiveInteger(requirement.definitionVersion) ||
      (requirement.weight !== undefined &&
        (!Number.isFinite(requirement.weight) || requirement.weight <= 0))
    ) {
      throw new CognitionPersistenceError(
        "invalid_declaration",
        "each task requirement needs an entity, dimension, criterion, and definition version",
      );
    }
    const signature = declarationSignature(requirement);
    if (signatures.has(signature)) {
      throw new CognitionPersistenceError(
        "invalid_declaration",
        "task requirements cannot contain duplicate evidence declarations",
      );
    }
    if (
      !allowedDimensionsForTask(input.evidencePolicy.taskKind).includes(
        requirement.dimension,
      ) ||
      !sourceAllowsDimension(
        input.evidencePolicy.source,
        requirement.dimension,
      ) ||
      (requirement.dimension === "transfer" &&
        input.evidencePolicy.contextDistance === "same") ||
      (requirement.dimension === "stability" &&
        (!input.evidencePolicy.delayedDays ||
          input.evidencePolicy.delayedDays < 1))
    ) {
      throw new CognitionPersistenceError(
        "invalid_declaration",
        `${requirement.dimension} is not supported by this task evidence policy`,
      );
    }
    signatures.add(signature);
  }
  const hasFluencyRequirement = input.requirements.some(
    (requirement) => requirement.dimension === "fluency",
  );
  if (
    hasFluencyRequirement &&
    (!input.evidencePolicy.fluency || !input.evidencePolicy.rubricId)
  ) {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      "fluency requires a comparable task family, quality threshold, normalized duration, and rubric",
    );
  }
}

type TaskWithRequirements = Persistence.LearningTaskGetPayload<{
  include: { requirements: true };
}>;

/**
 * Creates a task blueprint once and only reuses it when its evidence contract is
 * equivalent after persisted JSON normalization. A changed contract needs a new
 * definition version (and stable key), preventing rubric drift from rewriting old
 * attempts.
 */
export async function ensureLearningTask(
  persistence: PersistenceClient,
  input: LearningTaskDeclaration,
): Promise<TaskWithRequirements> {
  validateTaskDeclaration(input);
  const existing = await persistence.learningTask.findUnique({
    where: {
      goalId_stableKey: { goalId: input.goalId, stableKey: input.stableKey },
    },
    include: { requirements: true },
  });
  if (existing) {
    const requested = new Set(input.requirements.map(declarationSignature));
    const stored = new Set(
      existing.requirements.map(persistedRequirementSignature),
    );
    const sameRequirements =
      requested.size === stored.size &&
      [...requested].every((item) => stored.has(item));
    const samePolicy = sameTaskEvidencePolicy(
      taskPolicyFromContext(existing.context),
      taskPolicyFromContext({ evidencePolicy: input.evidencePolicy }),
    );
    if (
      existing.definitionVersion !== input.definitionVersion ||
      existing.taskType !== input.taskType ||
      !sameRequirements ||
      !samePolicy
    ) {
      throw new CognitionPersistenceError(
        "immutable_declaration",
        "an existing task evidence declaration cannot be mutated; publish a new version",
      );
    }
    return existing;
  }

  const entityIds = [
    ...new Set(input.requirements.map((item) => item.cognitiveEntityId)),
  ];
  const entities = await persistence.cognitiveEntity.findMany({
    where: { id: { in: entityIds } },
    select: { id: true, goalId: true, definitionVersion: true, status: true },
  });
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  for (const requirement of input.requirements) {
    const entity = entityById.get(requirement.cognitiveEntityId);
    if (
      !entity ||
      entity.goalId !== input.goalId ||
      entity.status !== "active" ||
      entity.definitionVersion !== requirement.definitionVersion
    ) {
      throw new CognitionPersistenceError(
        "invalid_declaration",
        `entity ${requirement.cognitiveEntityId} is not an active matching definition in this goal`,
      );
    }
  }
  const targetIds = input.requirements.flatMap((item) =>
    item.learningTargetId ? [item.learningTargetId] : [],
  );
  if (targetIds.length > 0) {
    const targets = await persistence.learningTarget.findMany({
      where: { id: { in: [...new Set(targetIds)] } },
      select: {
        id: true,
        goalId: true,
        status: true,
        requirements: {
          select: { cognitiveEntityId: true, dimension: true },
        },
      },
    });
    if (
      targets.length !== new Set(targetIds).size ||
      targets.some(
        (target) =>
          target.goalId !== input.goalId || target.status !== "active",
      )
    ) {
      throw new CognitionPersistenceError(
        "invalid_declaration",
        "learning target declarations must reference active targets in the task goal",
      );
    }
    const targetById = new Map(targets.map((target) => [target.id, target]));
    for (const requirement of input.requirements) {
      if (!requirement.learningTargetId) continue;
      const target = targetById.get(requirement.learningTargetId)!;
      if (
        !target.requirements.some(
          (declared) =>
            declared.cognitiveEntityId === requirement.cognitiveEntityId &&
            declared.dimension === requirement.dimension,
        )
      ) {
        throw new CognitionPersistenceError(
          "invalid_declaration",
          `learning target ${target.id} does not declare this entity and dimension`,
        );
      }
    }
  }

  const context = {
    ...(input.context ?? {}),
    evidencePolicy: input.evidencePolicy,
  };
  return persistence.learningTask.create({
    data: {
      goalId: input.goalId,
      moduleId: input.moduleId,
      unitId: input.unitId,
      stableKey: input.stableKey,
      taskType: input.taskType,
      title: input.title,
      instructions: input.instructions ?? "",
      context: jsonInput(context),
      rubric: jsonInput(input.rubric ?? {}),
      difficulty: input.difficulty ?? "medium",
      definitionVersion: input.definitionVersion,
      origin: input.origin ?? "generated",
      requirements: {
        create: input.requirements.map((requirement, index) => ({
          learningTargetId: requirement.learningTargetId,
          cognitiveEntityId: requirement.cognitiveEntityId,
          dimension: requirement.dimension,
          role: requirement.role ?? "primary",
          required: requirement.required ?? true,
          weight: requirement.weight ?? 1,
          orderIndex: requirement.orderIndex ?? index,
          rubricCriterion: jsonInput({
            ...(requirement.rubricCriterion ?? {}),
            ref: requirement.criterionRef,
            definitionVersion: requirement.definitionVersion,
          }),
        })),
      },
    },
    include: { requirements: true },
  });
}

function validateAttemptInput(input: TaskAttemptInput): void {
  if (
    !nonEmpty(input.taskId) ||
    !nonEmpty(input.userId) ||
    !nonEmpty(input.idempotencyKey) ||
    !isAssistanceLevel(input.assistance.level) ||
    !Number.isInteger(input.assistance.hintCount) ||
    input.assistance.hintCount < 0 ||
    typeof input.assistance.answerRevealed !== "boolean" ||
    (input.assistance.level === "independent" &&
      (input.assistance.hintCount !== 0 || input.assistance.answerRevealed)) ||
    ((input.assistance.level === "light_hint" ||
      input.assistance.level === "guided") &&
      input.assistance.hintCount < 1) ||
    (input.assistance.level === "answer_revealed" &&
      !input.assistance.answerRevealed) ||
    (input.durationMs !== undefined &&
      (!Number.isInteger(input.durationMs) || input.durationMs <= 0))
  ) {
    throw new CognitionPersistenceError(
      "invalid_candidate",
      "task attempt has invalid identity, assistance trace, or duration",
    );
  }
}

export async function startTaskAttempt(
  persistence: PersistenceClient,
  input: TaskAttemptInput,
  taskAttemptRepository?: TaskAttemptRepository,
) {
  validateAttemptInput(input);
  if (taskAttemptRepository) {
    const context = {
      ...(input.context ?? {}),
      evidenceAssistance: input.assistance,
      positiveEvidenceEligible: input.positiveEvidenceEligible ?? true,
    };
    const startedAt =
      input.startedAt ?? input.submittedAt ?? input.completedAt ?? undefined;
    return taskAttemptRepository.start({
      taskId: input.taskId,
      userId: input.userId,
      unitId: input.unitId,
      idempotencyKey: input.idempotencyKey,
      context,
      response: input.response ?? {},
      artifactRefs: [...(input.artifactRefs ?? [])],
      artifactVersionRefs: [...(input.artifactVersionRefs ?? [])],
      processLog: [...(input.processLog ?? [])],
      assistanceTrace: [...(input.assistanceTrace ?? [])],
      assistanceLevel: ASSISTANCE_LEVEL_VALUE[input.assistance.level],
      hintCount: input.assistance.hintCount,
      durationMs: input.durationMs,
      status: input.status ?? "started",
      startedAt,
      submittedAt: input.submittedAt,
      completedAt: input.completedAt,
    });
  }
  const replay = await persistence.taskAttempt.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (replay) {
    if (replay.taskId !== input.taskId || replay.userId !== input.userId) {
      throw new CognitionPersistenceError(
        "idempotency_conflict",
        "attempt idempotency key belongs to a different learner or task",
      );
    }
    return { attempt: replay, replayed: true as const };
  }
  const task = await persistence.learningTask.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      unitId: true,
      status: true,
      goal: { select: { userId: true } },
    },
  });
  if (!task || task.status !== "active" || task.goal.userId !== input.userId) {
    throw new CognitionPersistenceError(
      "not_found",
      "active learning task not found",
    );
  }
  if (input.unitId && task.unitId && input.unitId !== task.unitId) {
    throw new CognitionPersistenceError(
      "invalid_candidate",
      "attempt unit does not match the task unit",
    );
  }
  const latest = await persistence.taskAttempt.findFirst({
    where: { taskId: input.taskId, userId: input.userId },
    orderBy: { attemptNumber: "desc" },
    select: { attemptNumber: true },
  });
  const context = {
    ...(input.context ?? {}),
    evidenceAssistance: input.assistance,
    positiveEvidenceEligible: input.positiveEvidenceEligible ?? true,
  };
  // Persistence materializes @default(now()) when the create query is executed.
  // Terminal callers commonly capture submittedAt/completedAt before the
  // validation reads above, so leaving startedAt to that later default would
  // make the persisted lifecycle run backwards.
  const startedAt =
    input.startedAt ?? input.submittedAt ?? input.completedAt ?? undefined;
  let attempt;
  try {
    attempt = await persistence.taskAttempt.create({
      data: {
        taskId: input.taskId,
        userId: input.userId,
        unitId: input.unitId ?? task.unitId,
        attemptNumber: (latest?.attemptNumber ?? 0) + 1,
        status: input.status ?? "started",
        context: jsonInput(context),
        response: jsonInput(input.response ?? {}),
        artifactRefs: jsonInput([...(input.artifactRefs ?? [])]),
        artifactVersionRefs: jsonInput([...(input.artifactVersionRefs ?? [])]),
        processLog: jsonInput([...(input.processLog ?? [])]),
        assistanceTrace: jsonInput([...(input.assistanceTrace ?? [])]),
        assistanceLevel: ASSISTANCE_LEVEL_VALUE[input.assistance.level],
        hintCount: input.assistance.hintCount,
        durationMs: input.durationMs,
        idempotencyKey: input.idempotencyKey,
        startedAt,
        submittedAt: input.submittedAt,
        completedAt: input.completedAt,
      },
    });
  } catch (error) {
    // An interactive PostgreSQL transaction is aborted after a failed
    // statement. Its owner must roll it back before attempting replay lookup.
    if (!ownsInteractiveTransaction(persistence)) throw error;
    const concurrentReplay = await persistence.taskAttempt.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (
      concurrentReplay?.taskId === input.taskId &&
      concurrentReplay.userId === input.userId
    ) {
      return { attempt: concurrentReplay, replayed: true as const };
    }
    throw error;
  }
  return { attempt, replayed: false as const };
}
