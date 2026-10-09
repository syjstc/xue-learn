// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import { createHash } from "node:crypto";
import type { Persistence, PersistenceClient } from "../../persistence/persistence-compat.js";
import { allowedDimensionsForSource } from "../evidence.js";
import {
  type AssistanceLevel,
  type CognitiveDimension,
  type ContextDistance,
  type EvidenceSource,
  type EvidenceStrength,
  type EvidenceTaskKind,
  isAssistanceLevel,
  isContextDistance,
  isEvidenceSource,
  isEvidenceTaskKind,
} from "../types.js";
import { CognitionPersistenceError } from "./error.js";
import type {
  AttemptDeclarationRecord,
  JsonObject,
  LearningTaskDeclaration,
  ObservationEvaluatorPolicy,
  TaskEvidencePolicy,
  TaskRequirementDeclaration,
} from "./types.js";

export async function refreshGapProjection(
  persistence: PersistenceClient,
  userId: string,
  cognitiveEntityId: string,
): Promise<void> {
  const { refreshLearnerGapHypotheses } = await import("../gap-persistence.js");
  await refreshLearnerGapHypotheses(persistence, userId, cognitiveEntityId);
  if (
    typeof (
      persistence as unknown as { moduleLearningTarget?: { findMany?: unknown } }
    ).moduleLearningTarget?.findMany === "function"
  ) {
    const { syncPrerequisiteBridgesForEntity } =
      await import("../../assessment/readiness.js");
    await syncPrerequisiteBridgesForEntity(persistence, {
      userId,
      cognitiveEntityId,
    });
  }
}

export type CognitionTransactionClient = Persistence.TransactionClient;

export function ownsInteractiveTransaction(client: PersistenceClient): boolean {
  return (
    typeof (client as unknown as { $transaction?: unknown }).$transaction ===
    "function"
  );
}

export async function withinCognitionTransaction<T>(
  client: PersistenceClient,
  operation: (tx: CognitionTransactionClient) => Promise<T>,
): Promise<T> {
  if (!ownsInteractiveTransaction(client)) {
    return operation(client as unknown as CognitionTransactionClient);
  }
  return client.$transaction((tx) => operation(tx));
}

export async function withLearnerEntityStateLock<T>(
  client: PersistenceClient,
  userId: string,
  cognitiveEntityId: string,
  operation: (tx: CognitionTransactionClient) => Promise<T>,
): Promise<T> {
  return withinCognitionTransaction(client, async (tx) => {
    const { acquireCognitionTransactionLock } =
      await import("../transaction-lock.js");
    await acquireCognitionTransactionLock(
      tx,
      "learner-entity",
      `${userId}:${cognitiveEntityId}`,
    );
    return operation(tx);
  });
}

export function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function canReadEntity(
  entity: {
    scope: string;
    ownerUserId: string | null;
    goal: { userId: string | null } | null;
  },
  userId: string,
): boolean {
  return (
    entity.scope === "system" ||
    entity.ownerUserId === userId ||
    entity.goal?.userId === userId
  );
}

export function finiteInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

export function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function jsonInput(value: unknown): Persistence.InputJsonValue {
  return value as Persistence.InputJsonValue;
}

export function taskPolicyFromContext(value: unknown): TaskEvidencePolicy {
  if (!isRecord(value) || !isRecord(value.evidencePolicy)) {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      "learning task is missing its server-owned evidence policy",
    );
  }
  const policy = value.evidencePolicy;
  if (
    !isEvidenceSource(policy.source) ||
    !isEvidenceTaskKind(policy.taskKind) ||
    !nonEmpty(policy.contextKey) ||
    !isContextDistance(policy.contextDistance) ||
    (policy.delayedDays !== undefined &&
      !finiteInRange(policy.delayedDays, 0, Number.MAX_SAFE_INTEGER)) ||
    (policy.rubricId !== undefined && !nonEmpty(policy.rubricId)) ||
    (policy.fluency !== undefined &&
      (!isRecord(policy.fluency) ||
        !nonEmpty(policy.fluency.taskFamily) ||
        !finiteInRange(policy.fluency.qualityThreshold, 0.5, 1) ||
        !positiveInteger(policy.fluency.targetDurationMs) ||
        !positiveInteger(policy.fluency.minimumDurationMs) ||
        policy.fluency.minimumDurationMs >= policy.fluency.targetDurationMs))
  ) {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      "learning task has an invalid evidence policy",
    );
  }
  return policy as TaskEvidencePolicy;
}

export function sameTaskEvidencePolicy(
  left: TaskEvidencePolicy,
  right: TaskEvidencePolicy,
): boolean {
  return (
    left.source === right.source &&
    left.taskKind === right.taskKind &&
    left.contextKey === right.contextKey &&
    left.contextDistance === right.contextDistance &&
    left.delayedDays === right.delayedDays &&
    left.rubricId === right.rubricId &&
    left.fluency?.taskFamily === right.fluency?.taskFamily &&
    left.fluency?.qualityThreshold === right.fluency?.qualityThreshold &&
    left.fluency?.targetDurationMs === right.fluency?.targetDurationMs &&
    left.fluency?.minimumDurationMs === right.fluency?.minimumDurationMs
  );
}

export function criterionDeclaration(value: unknown): {
  ref: string;
  definitionVersion: number;
} {
  if (
    !isRecord(value) ||
    !nonEmpty(value.ref) ||
    !positiveInteger(value.definitionVersion)
  ) {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      "task requirement must declare criterion ref and subject definition version",
    );
  }
  return { ref: value.ref, definitionVersion: value.definitionVersion };
}

export function assistanceFromAttempt(
  attempt: Pick<
    AttemptDeclarationRecord,
    "context" | "assistanceLevel" | "hintCount"
  >,
): {
  level: AssistanceLevel;
  hintCount: number;
  answerRevealed: boolean;
} {
  const candidate = isRecord(attempt.context)
    ? attempt.context.evidenceAssistance
    : undefined;
  if (
    isRecord(candidate) &&
    isAssistanceLevel(candidate.level) &&
    typeof candidate.hintCount === "number" &&
    Number.isInteger(candidate.hintCount) &&
    candidate.hintCount >= 0 &&
    typeof candidate.answerRevealed === "boolean"
  ) {
    return {
      level: candidate.level,
      hintCount: candidate.hintCount,
      answerRevealed: candidate.answerRevealed,
    };
  }
  const level: AssistanceLevel =
    attempt.assistanceLevel <= 0
      ? "independent"
      : attempt.assistanceLevel <= 0.25
        ? "light_hint"
        : attempt.assistanceLevel <= 0.55
          ? "guided"
          : attempt.assistanceLevel < 1
            ? "worked_example"
            : "answer_revealed";
  return {
    level,
    hintCount: attempt.hintCount,
    answerRevealed: level === "answer_revealed",
  };
}

export const ASSISTANCE_LEVEL_VALUE: Record<AssistanceLevel, number> = {
  independent: 0,
  light_hint: 0.25,
  guided: 0.55,
  worked_example: 0.8,
  answer_revealed: 1,
};

export const STRENGTH_VALUE: Record<EvidenceStrength, number> = {
  weak: 0.5,
  moderate: 1,
  strong: 1.5,
  decisive: 2,
};

export const TASK_TYPE_EVIDENCE: Record<
  LearningTaskDeclaration["taskType"],
  { sources: readonly EvidenceSource[]; taskKinds: readonly EvidenceTaskKind[] }
> = {
  quiz: {
    sources: ["quiz"],
    taskKinds: [
      "recall",
      "explanation",
      "routine_application",
      "novel_application",
      "integration",
    ],
  },
  diagnostic: {
    sources: ["diagnostic"],
    taskKinds: [
      "recall",
      "explanation",
      "routine_application",
      "novel_application",
      "integration",
      "retention",
    ],
  },
  explanation: {
    sources: ["feynman", "socratic", "teaching", "human_observation"],
    taskKinds: ["explanation", "teaching"],
  },
  interaction: {
    sources: ["practice", "human_observation"],
    taskKinds: [
      "routine_application",
      "novel_application",
      "integration",
      "retention",
    ],
  },
  project: {
    sources: ["project", "practice", "human_observation"],
    taskKinds: ["novel_application", "integration", "project"],
  },
  review: {
    sources: ["review_quiz", "flashcard", "practice", "human_observation"],
    taskKinds: [
      "recall",
      "explanation",
      "routine_application",
      "novel_application",
      "integration",
      "retention",
    ],
  },
};

export const SOURCE_DIMENSION_CAPS: Partial<
  Record<EvidenceSource, readonly CognitiveDimension[]>
> = {
  flashcard: ["memory", "stability"],
  feynman: ["understanding"],
  socratic: ["understanding", "independence"],
};

export function sourceAllowsDimension(
  source: EvidenceSource,
  dimension: CognitiveDimension,
): boolean {
  const productCap = SOURCE_DIMENSION_CAPS[source];
  return (
    allowedDimensionsForSource(source).includes(dimension) &&
    (!productCap || productCap.includes(dimension))
  );
}

export function transferDistanceValue(distance: ContextDistance): number {
  if (distance === "far") return 1;
  if (distance === "near") return 0.5;
  return 0;
}

export function firstArtifactId(value: unknown): string | undefined {
  return Array.isArray(value)
    ? value.find((item): item is string => nonEmpty(item))
    : undefined;
}

export function candidateHash(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

export function declarationSignature(
  requirement: Pick<
    TaskRequirementDeclaration,
    | "cognitiveEntityId"
    | "learningTargetId"
    | "dimension"
    | "criterionRef"
    | "definitionVersion"
  >,
): string {
  return [
    requirement.cognitiveEntityId,
    requirement.learningTargetId ?? "",
    requirement.dimension,
    requirement.criterionRef,
    String(requirement.definitionVersion),
  ].join("\u001f");
}

export function persistedRequirementSignature(requirement: {
  cognitiveEntityId: string | null;
  learningTargetId: string | null;
  dimension: string;
  rubricCriterion: unknown;
}): string {
  const criterion = criterionDeclaration(requirement.rubricCriterion);
  return [
    requirement.cognitiveEntityId ?? "",
    requirement.learningTargetId ?? "",
    requirement.dimension,
    criterion.ref,
    String(criterion.definitionVersion),
  ].join("\u001f");
}

export function strengthForEvaluator(
  evaluator: ObservationEvaluatorPolicy,
): EvidenceStrength {
  return evaluator.evidenceStrength ?? "moderate";
}
