// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import type { Persistence, PersistenceClient } from "../../persistence/persistence-compat.js";
import { MAX_INDEPENDENCE_SCORE_BY_ASSISTANCE, assertEvidenceClaim } from "../evidence.js";
import {
  type CognitiveDimension,
  type EvidenceClaim as DomainEvidenceClaim,
  type EvidenceEvaluator,
  isCognitiveDimension,
  isCognitiveEntityKind,
  isEvidenceEvaluator,
  isEvidenceStrength,
} from "../types.js";
import { deriveDeterministicMisconceptionPattern } from "../misconceptions.js";
import { CognitionPersistenceError } from "./error.js";
import {
  STRENGTH_VALUE,
  TASK_TYPE_EVIDENCE,
  assistanceFromAttempt,
  candidateHash,
  criterionDeclaration,
  finiteInRange,
  firstArtifactId,
  isRecord,
  jsonInput,
  nonEmpty,
  ownsInteractiveTransaction,
  refreshGapProjection,
  sourceAllowsDimension,
  strengthForEvaluator,
  taskPolicyFromContext,
  transferDistanceValue,
  withinCognitionTransaction,
} from "./shared.js";
import { refreshLearnerEntityState } from "./state.js";
import type {
  AttemptDeclarationRecord,
  LearnerEntityStateDto,
  LearningTaskDeclaration,
  ObservationEvaluatorPolicy,
  RequirementRecord,
  TaskObservationCandidate,
  ValidatedObservationDeclaration,
} from "./types.js";

export function validateObservationAgainstDeclaration(
  attempt: AttemptDeclarationRecord,
  requirement: RequirementRecord,
  candidate: TaskObservationCandidate,
  evaluator: ObservationEvaluatorPolicy,
): ValidatedObservationDeclaration {
  if (attempt.status === "abandoned") {
    throw new CognitionPersistenceError(
      "invalid_candidate",
      "abandoned attempts cannot produce evidence",
    );
  }
  if (
    attempt.task.status !== "active" ||
    requirement.taskId !== attempt.taskId
  ) {
    throw new CognitionPersistenceError(
      "invalid_candidate",
      "observation requirement is not declared by this active task",
    );
  }
  if (attempt.task.goal.userId !== attempt.userId) {
    throw new CognitionPersistenceError(
      "ownership_mismatch",
      "learning task belongs to a different learner",
    );
  }
  if (
    isRecord(attempt.context) &&
    attempt.context.positiveEvidenceEligible === false &&
    candidate.score > 0.5
  ) {
    throw new CognitionPersistenceError(
      "invalid_candidate",
      "this terminal guided attempt cannot produce positive evidence",
    );
  }
  const policy = taskPolicyFromContext(attempt.task.context);
  if (
    !finiteInRange(candidate.score, 0, 1) ||
    !nonEmpty(candidate.evaluatorRunId) ||
    !isEvidenceEvaluator(evaluator.evaluatorType) ||
    !finiteInRange(evaluator.evaluatorReliability, 0, 1) ||
    !finiteInRange(evaluator.groundingReliability, 0, 1) ||
    (evaluator.evaluatorRef !== undefined &&
      !nonEmpty(evaluator.evaluatorRef)) ||
    (evaluator.contextLineageKey !== undefined &&
      (!nonEmpty(evaluator.contextLineageKey) ||
        !evaluator.contextLineageKey.startsWith(
          `${policy.contextKey}#observed:`,
        ))) ||
    (evaluator.evidenceStrength !== undefined &&
      !isEvidenceStrength(evaluator.evidenceStrength))
  ) {
    throw new CognitionPersistenceError(
      "invalid_candidate",
      "observation score, evaluator, reliability, strength, or idempotency key is invalid",
    );
  }
  if (
    !requirement.cognitiveEntity ||
    !nonEmpty(requirement.cognitiveEntityId) ||
    requirement.cognitiveEntity.status !== "active" ||
    !isCognitiveEntityKind(requirement.cognitiveEntity.kind) ||
    !isCognitiveDimension(requirement.dimension)
  ) {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      "task requirement lacks an active entity and controlled dimension",
    );
  }
  if (requirement.cognitiveEntity.goalId !== attempt.task.goalId) {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      "task requirement entity belongs to a different goal",
    );
  }
  const criterion = criterionDeclaration(requirement.rubricCriterion);
  if (
    criterion.definitionVersion !==
    requirement.cognitiveEntity.definitionVersion
  ) {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      "task requirement targets a stale entity definition",
    );
  }
  if (
    requirement.learningTarget &&
    (requirement.learningTarget.status !== "active" ||
      requirement.learningTarget.goalId !== attempt.task.goalId)
  ) {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      "task requirement targets an inactive or foreign learning target",
    );
  }
  const assertions: Array<[unknown, unknown, string]> = [
    [
      candidate.assertedCognitiveEntityId,
      requirement.cognitiveEntityId,
      "entity",
    ],
    [
      candidate.assertedLearningTargetId,
      requirement.learningTargetId,
      "learning target",
    ],
    [candidate.assertedDimension, requirement.dimension, "dimension"],
    [candidate.assertedCriterionRef, criterion.ref, "criterion"],
    [
      candidate.assertedDefinitionVersion,
      criterion.definitionVersion,
      "definition version",
    ],
  ];
  for (const [asserted, declared, label] of assertions) {
    if (asserted !== undefined && asserted !== declared) {
      throw new CognitionPersistenceError(
        "invalid_candidate",
        `evaluator asserted an undeclared ${label}`,
      );
    }
  }
  const taskTypePolicy =
    TASK_TYPE_EVIDENCE[
      attempt.task.taskType as LearningTaskDeclaration["taskType"]
    ];
  if (
    !taskTypePolicy ||
    !taskTypePolicy.sources.includes(policy.source) ||
    !taskTypePolicy.taskKinds.includes(policy.taskKind)
  ) {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      "persisted task type does not permit its evidence source or task kind",
    );
  }
  if (!sourceAllowsDimension(policy.source, requirement.dimension)) {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      `${policy.source} cannot produce ${requirement.dimension} evidence`,
    );
  }
  const assistance = assistanceFromAttempt(attempt);
  const independence = MAX_INDEPENDENCE_SCORE_BY_ASSISTANCE[assistance.level];
  let score =
    requirement.dimension === "independence"
      ? Math.min(candidate.score, independence)
      : candidate.score;
  if (requirement.dimension === "fluency") {
    const fluency = policy.fluency;
    const elapsedMs = attempt.submittedAt
      ? attempt.submittedAt.getTime() - attempt.startedAt.getTime()
      : null;
    const timingToleranceMs = attempt.durationMs
      ? Math.max(250, attempt.durationMs * 0.02)
      : 0;
    if (
      !fluency ||
      !attempt.durationMs ||
      elapsedMs === null ||
      elapsedMs <= 0 ||
      Math.abs(elapsedMs - attempt.durationMs) > timingToleranceMs ||
      attempt.durationMs < fluency.minimumDurationMs ||
      candidate.score < fluency.qualityThreshold ||
      (attempt.status !== "submitted" && attempt.status !== "evaluated")
    ) {
      throw new CognitionPersistenceError(
        "invalid_candidate",
        "fluency requires a comparable task family, passing quality, and valid server timing",
      );
    }
    score = Math.min(
      candidate.score,
      Math.min(1, fluency.targetDurationMs / attempt.durationMs),
    );
  }
  const artifactId = firstArtifactId(attempt.artifactRefs);
  const contextLineageKey = evaluator.contextLineageKey ?? policy.contextKey;
  const domainClaim: DomainEvidenceClaim = {
    id: `candidate:${candidateHash([
      attempt.id,
      requirement.id,
      candidate.evaluatorRunId,
    ])}`,
    learnerId: attempt.userId,
    target: {
      id: requirement.cognitiveEntityId,
      kind: requirement.cognitiveEntity.kind,
      definitionVersion: criterion.definitionVersion,
    },
    task: {
      id: attempt.taskId,
      kind: policy.taskKind,
      contextId: contextLineageKey,
      contextDistance: policy.contextDistance,
      ...(attempt.durationMs ? { durationMs: attempt.durationMs } : {}),
      ...(policy.delayedDays !== undefined
        ? { delayedDays: policy.delayedDays }
        : {}),
      ...(artifactId ? { artifactId } : {}),
      ...(policy.rubricId ? { rubricId: policy.rubricId } : {}),
    },
    source: policy.source,
    dimension: requirement.dimension,
    score,
    evaluator: evaluator.evaluatorType,
    evaluatorReliability:
      evaluator.evaluatorReliability * evaluator.groundingReliability,
    strength: strengthForEvaluator(evaluator),
    assistance,
    observedAt: (candidate.observedAt ?? new Date()).toISOString(),
  };
  try {
    assertEvidenceClaim(domainClaim);
  } catch (error) {
    throw new CognitionPersistenceError(
      "invalid_candidate",
      error instanceof Error ? error.message : "invalid evidence candidate",
    );
  }
  return {
    requirement,
    policy,
    assistance,
    entityKind: requirement.cognitiveEntity.kind,
    definitionVersion: criterion.definitionVersion,
    criterionRef: criterion.ref,
    independence,
    domainClaim,
  };
}

type ObservationWithClaim = Persistence.TaskObservationGetPayload<{
  include: { evidenceClaims: true };
}>;

/**
 * Persists a rubric observation that is derived only from learner-authored
 * project structure. It is deliberately non-evidentiary: both reliability
 * values are zero and no EvidenceClaim or LearnerState projection is created.
 */
export async function recordUnverifiedTaskObservationCandidate(
  persistence: PersistenceClient,
  input: {
    userId: string;
    attemptId: string;
    candidate: TaskObservationCandidate;
    evaluator: {
      evaluatorType: EvidenceEvaluator;
      evaluatorRef: string;
    };
  },
): Promise<{ observation: ObservationWithClaim; replayed: boolean }> {
  if (!nonEmpty(input.evaluator.evaluatorRef)) {
    throw new CognitionPersistenceError(
      "invalid_candidate",
      "unverified observation requires an evaluator reference",
    );
  }
  const attempt = await persistence.taskAttempt.findUnique({
    where: { id: input.attemptId },
    include: { task: { include: { goal: { select: { userId: true } } } } },
  });
  if (!attempt) {
    throw new CognitionPersistenceError("not_found", "task attempt not found");
  }
  if (attempt.userId !== input.userId) {
    throw new CognitionPersistenceError(
      "ownership_mismatch",
      "task attempt belongs to a different learner",
    );
  }
  const requirement = await persistence.taskRequirement.findUnique({
    where: { id: input.candidate.requirementId },
    include: { cognitiveEntity: true, learningTarget: true },
  });
  if (!requirement) {
    throw new CognitionPersistenceError(
      "not_found",
      "declared task requirement not found",
    );
  }
  const validated = validateObservationAgainstDeclaration(
    attempt as AttemptDeclarationRecord,
    requirement as RequirementRecord,
    input.candidate,
    {
      evaluatorType: input.evaluator.evaluatorType,
      evaluatorReliability: 0,
      groundingReliability: 0,
      evidenceStrength: "weak",
    },
  );
  const observationId = `unverified_${candidateHash([
    attempt.id,
    requirement.id,
    input.candidate.evaluatorRunId,
  ])}`;
  const existing = await persistence.taskObservation.findUnique({
    where: { id: observationId },
    include: { evidenceClaims: true },
  });
  if (existing) {
    if (
      existing.attemptId !== attempt.id ||
      existing.requirementId !== requirement.id ||
      existing.evidenceClaims.length > 0
    ) {
      throw new CognitionPersistenceError(
        "idempotency_conflict",
        "unverified observation id belongs to different evidence",
      );
    }
    return { observation: existing, replayed: true };
  }

  const data = {
    id: observationId,
    attemptId: attempt.id,
    requirementId: requirement.id,
    learningTargetId: requirement.learningTargetId,
    cognitiveEntityId: requirement.cognitiveEntityId,
    dimension: requirement.dimension,
    outcome: input.candidate.outcome ?? "pending_verification",
    score: validated.domainClaim.score,
    evaluatorReliability: 0,
    groundingReliability: 0,
    independence: validated.independence,
    transferDistance: transferDistanceValue(validated.policy.contextDistance),
    subjectDefinitionVersion: validated.definitionVersion,
    evaluatorType: input.evaluator.evaluatorType,
    evaluatorRef: input.evaluator.evaluatorRef,
    rawResult: jsonInput(input.candidate.rawResult ?? {}),
    metadata: jsonInput({
      ...(input.candidate.metadata ?? {}),
      evaluatorRunId: input.candidate.evaluatorRunId,
      verificationStatus: "pending_authoritative_review",
      evidenceEligible: false,
      evidenceSource: validated.policy.source,
      evidenceTaskKind: validated.policy.taskKind,
      contextDistance: validated.policy.contextDistance,
      contextKey: validated.policy.contextKey,
      rubricId: validated.policy.rubricId,
      rubricCriterion: requirement.rubricCriterion,
      criterionRef: validated.criterionRef,
      criterionDefinitionVersion: validated.definitionVersion,
      assistance: validated.assistance,
    }),
    observedAt: input.candidate.observedAt,
  } satisfies Persistence.TaskObservationUncheckedCreateInput;

  try {
    return {
      observation: await persistence.taskObservation.create({
        data,
        include: { evidenceClaims: true },
      }),
      replayed: false,
    };
  } catch (error) {
    const replay = await persistence.taskObservation.findUnique({
      where: { id: observationId },
      include: { evidenceClaims: true },
    });
    if (
      replay?.attemptId === attempt.id &&
      replay.requirementId === requirement.id &&
      replay.evidenceClaims.length === 0
    ) {
      return { observation: replay, replayed: true };
    }
    throw error;
  }
}

export async function recordTaskObservationCandidate(
  persistence: PersistenceClient,
  input: {
    userId: string;
    attemptId: string;
    candidate: TaskObservationCandidate;
    evaluator: ObservationEvaluatorPolicy;
  },
): Promise<{
  observation: ObservationWithClaim;
  replayed: boolean;
  state: LearnerEntityStateDto;
}> {
  const claimIdempotencyKey = evidenceIdempotencyKey({
    attemptId: input.attemptId,
    requirementId: input.candidate.requirementId,
    evaluatorRunId: input.candidate.evaluatorRunId,
  });
  const existingClaim = await persistence.evidenceClaim.findUnique({
    where: { idempotencyKey: claimIdempotencyKey },
    include: { observation: { include: { evidenceClaims: true } } },
  });
  if (existingClaim) {
    if (
      existingClaim.userId !== input.userId ||
      existingClaim.observation.attemptId !== input.attemptId
    ) {
      throw new CognitionPersistenceError(
        "idempotency_conflict",
        "evidence idempotency key belongs to a different learner or attempt",
      );
    }
    const state = await refreshLearnerEntityState(
      persistence,
      input.userId,
      existingClaim.cognitiveEntityId,
      existingClaim.dimension as CognitiveDimension,
    );
    await refreshGapProjection(
      persistence,
      input.userId,
      existingClaim.cognitiveEntityId,
    );
    return {
      observation: existingClaim.observation,
      replayed: true,
      state,
    };
  }
  const attempt = await persistence.taskAttempt.findUnique({
    where: { id: input.attemptId },
    include: { task: { include: { goal: { select: { userId: true } } } } },
  });
  if (!attempt) {
    throw new CognitionPersistenceError("not_found", "task attempt not found");
  }
  if (attempt.userId !== input.userId) {
    throw new CognitionPersistenceError(
      "ownership_mismatch",
      "task attempt belongs to a different learner",
    );
  }
  const requirement = await persistence.taskRequirement.findUnique({
    where: { id: input.candidate.requirementId },
    include: { cognitiveEntity: true, learningTarget: true },
  });
  if (!requirement) {
    throw new CognitionPersistenceError(
      "not_found",
      "declared task requirement not found",
    );
  }
  const validated = validateObservationAgainstDeclaration(
    attempt as AttemptDeclarationRecord,
    requirement as RequirementRecord,
    input.candidate,
    input.evaluator,
  );
  const misconceptionCandidate = deriveDeterministicMisconceptionPattern({
    goalId: attempt.task.goalId,
    cognitiveEntityId: requirement.cognitiveEntityId!,
    cognitiveEntityTitle: requirement.cognitiveEntity.title,
    definitionVersion: validated.definitionVersion,
    criterionRef: validated.criterionRef,
    source: validated.policy.source,
    evaluator: input.evaluator.evaluatorType,
    score: validated.domainClaim.score,
    rawResult: input.candidate.rawResult,
  });
  let persisted: {
    observation: ObservationWithClaim;
    state: LearnerEntityStateDto;
  };
  const startsOwnTransaction = ownsInteractiveTransaction(persistence);
  try {
    persisted = await withinCognitionTransaction(persistence, async (tx) => {
      const misconception = misconceptionCandidate
        ? await tx.misconceptionPattern.upsert({
            where: { stableKey: misconceptionCandidate.stableKey },
            create: {
              stableKey: misconceptionCandidate.stableKey,
              scope: "goal",
              goalId: attempt.task.goalId,
              primaryEntityId: requirement.cognitiveEntityId,
              title: misconceptionCandidate.title,
              description: misconceptionCandidate.description,
              errorSignature: jsonInput(misconceptionCandidate.errorSignature),
              remediationGuidance: jsonInput(
                misconceptionCandidate.remediationGuidance,
              ),
              definitionVersion: validated.definitionVersion,
              status: "active",
            },
            update: { status: "active" },
          })
        : null;
      const observation = await tx.taskObservation.create({
        data: {
          attemptId: attempt.id,
          requirementId: requirement.id,
          learningTargetId: requirement.learningTargetId,
          cognitiveEntityId: requirement.cognitiveEntityId,
          dimension: requirement.dimension,
          outcome: input.candidate.outcome ?? "observed",
          score: validated.domainClaim.score,
          evaluatorReliability: input.evaluator.evaluatorReliability,
          groundingReliability: input.evaluator.groundingReliability,
          independence: validated.independence,
          transferDistance: transferDistanceValue(
            validated.policy.contextDistance,
          ),
          subjectDefinitionVersion: validated.definitionVersion,
          evaluatorType: input.evaluator.evaluatorType,
          evaluatorRef: input.evaluator.evaluatorRef,
          rawResult: jsonInput(input.candidate.rawResult ?? {}),
          metadata: jsonInput({
            ...(input.candidate.metadata ?? {}),
            evidenceSource: validated.policy.source,
            evidenceTaskKind: validated.policy.taskKind,
            contextDistance: validated.policy.contextDistance,
            contextKey: validated.domainClaim.task.contextId,
            delayedDays: validated.policy.delayedDays,
            rubricId: validated.policy.rubricId,
            rubricCriterion: requirement.rubricCriterion,
            criterionRef: validated.criterionRef,
            criterionDefinitionVersion: validated.definitionVersion,
            evidenceStrength: validated.domainClaim.strength,
            assistance: validated.assistance,
          }),
          observedAt: input.candidate.observedAt,
          evidenceClaims: {
            create: {
              userId: input.userId,
              cognitiveEntityId: requirement.cognitiveEntityId!,
              learningTargetId: requirement.learningTargetId,
              misconceptionPatternId: misconception?.id,
              dimension: requirement.dimension,
              criterionRef: validated.criterionRef,
              polarity:
                validated.domainClaim.score >= 0.5 ? "supports" : "refutes",
              score: validated.domainClaim.score,
              strength: STRENGTH_VALUE[validated.domainClaim.strength],
              evaluatorReliability: input.evaluator.evaluatorReliability,
              groundingReliability: input.evaluator.groundingReliability,
              definitionVersion: validated.definitionVersion,
              contextKey: validated.domainClaim.task.contextId,
              idempotencyKey: claimIdempotencyKey,
              lifecycleEvents: {
                create: {
                  eventType: "created",
                  reason: "validated_task_observation",
                  payload: jsonInput({ source: validated.policy.source }),
                },
              },
            },
          },
        },
        include: { evidenceClaims: true },
      });
      const state = await refreshLearnerEntityState(
        tx as unknown as PersistenceClient,
        input.userId,
        requirement.cognitiveEntityId!,
        validated.domainClaim.dimension,
      );
      return { observation, state };
    });
  } catch (error) {
    // A failed statement aborts an enclosing PostgreSQL transaction. Only a
    // caller that owned this transaction can safely recover a concurrent
    // unique-key replay through a fresh query.
    if (!startsOwnTransaction) throw error;
    const concurrentReplay = await persistence.evidenceClaim.findUnique({
      where: { idempotencyKey: claimIdempotencyKey },
      include: { observation: { include: { evidenceClaims: true } } },
    });
    if (
      concurrentReplay?.userId === input.userId &&
      concurrentReplay.observation.attemptId === input.attemptId
    ) {
      const state = await refreshLearnerEntityState(
        persistence,
        input.userId,
        concurrentReplay.cognitiveEntityId,
        concurrentReplay.dimension as CognitiveDimension,
      );
      await refreshGapProjection(
        persistence,
        input.userId,
        concurrentReplay.cognitiveEntityId,
      );
      return {
        observation: concurrentReplay.observation,
        replayed: true,
        state,
      };
    }
    throw error;
  }
  await refreshGapProjection(
    persistence,
    input.userId,
    requirement.cognitiveEntityId!,
  );
  return {
    observation: persisted.observation,
    replayed: false,
    state: persisted.state,
  };
}

/** Stable server-side key helper; callers never accept this value from clients. */
export function evidenceIdempotencyKey(parts: {
  attemptId: string;
  requirementId: string;
  evaluatorRunId: string;
}): string {
  if (
    ![parts.attemptId, parts.requirementId, parts.evaluatorRunId].every(
      nonEmpty,
    )
  ) {
    throw new CognitionPersistenceError(
      "invalid_candidate",
      "evidence idempotency key parts must be non-empty",
    );
  }
  return `evidence:${candidateHash([
    parts.attemptId,
    parts.requirementId,
    parts.evaluatorRunId,
  ])}`;
}
