import { recordLearningFeedback } from "../learning-trajectory/feedback.js";
// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import { createHash } from "node:crypto";
import type { Persistence, PersistenceClient } from "../persistence/persistence-compat.js";
import type {
  MaterialCheckCompletionRepository,
  MaterialCheckCompletionItem,
  MaterialCheckTaskDefinition,
  ModuleDiagnosticCompletionItem,
  ModuleDiagnosticTaskDefinition,
  UnitDiagnosticCompletionItem,
  UnitDiagnosticTaskRequirement,
  UnitDiagnosticTaskDefinition,
  LearnerStateProjectionReadRepository,
  QuizSubmissionItem,
} from "../../../domain/src/index.js";
import {
  CognitionPersistenceError,
  ensureLearningTask,
  getLearnerEntityState,
  isCognitiveDimension,
  isCognitiveEntityKind,
  recordTaskObservationCandidate,
  startTaskAttempt,
  type CognitiveDimension,
  type CognitiveEntityKind,
  type EvidenceSource,
} from "../cognition/index.js";
import {
  gradeObjectiveAnswer,
  normalizeIndexList,
} from "../graph/grade-objective.js";
import type { QuizGradeItem } from "../graph/grade-quiz.js";
import type { QuizQuestion } from "../llm/schemas.js";
import { assessmentFormatEvidenceStrength } from "../quiz/batch-planner.js";
import { learningTargetWorkload } from "../cognitive-model/workload.js";
import {
  assessmentDemandTier,
  requiredEvidenceCount,
} from "./adaptive-blueprint.js";

const QUIZ_EVIDENCE_DIMENSIONS = new Set<CognitiveDimension>([
  "memory",
  "understanding",
]);

export function isQuizEvidenceDimension(
  dimension: CognitiveDimension,
): dimension is "memory" | "understanding" {
  return QUIZ_EVIDENCE_DIMENSIONS.has(dimension);
}

export type AssessmentCriterion = { ref: string; text: string };

export type UnitAssessmentRequirement = {
  cognitiveEntityId: string;
  entityKind: CognitiveEntityKind;
  entityDefinitionVersion: number;
  dimension: CognitiveDimension;
  required: boolean;
  gate: boolean;
  weight: number;
  threshold: number;
};

export type UnitAssessmentTarget = {
  id: string;
  localRef: string;
  title: string;
  description: string;
  learningObjective: string;
  assessmentCriteria: readonly AssessmentCriterion[];
  required: boolean;
  weight: number;
  role: string;
  isEntry: boolean;
  isExit: boolean;
  importance: "core" | "supporting" | "enrichment";
  importanceWeight: number;
  difficulty: "easy" | "medium" | "hard";
  targetCognitiveLevel:
    "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
  estimatedMinutes: number;
  requirements: readonly UnitAssessmentRequirement[];
};

export type PerLearningTargetPerformance = {
  learningTargetId: string;
  localRef: string;
  title: string;
  score: number;
  correctCount: number;
  partialCount: number;
  incorrectCount: number;
  questionCount: number;
  required: boolean;
  passed: boolean;
};

export type LearningTargetCognitiveAssessment = {
  learningTargetId: string;
  localRef: string;
  title: string;
  estimate: number | null;
  evidenceSufficiency: number;
  status: "unobserved" | "forming" | "demonstrated" | "robust" | "revalidate";
  passed: boolean;
  failures: Array<{
    cognitiveEntityId: string;
    dimension: CognitiveDimension;
    reason:
      "unobserved" | "insufficient_evidence" | "below_threshold" | "revalidate";
  }>;
};

export type PublishedMaterialCheckDefinition = {
  checkId: string;
  blockIndex: number;
  itemIndex: number;
  question: string;
  questionType: "mcq" | "mcq_multi" | "true_false";
  correctIndex?: number;
  correctIndices?: number[];
  correctAnswer?: boolean;
  explanation: string;
  primaryLearningTargetId: string;
  targetCognitiveEntityId?: string;
  evidenceDimension: "memory" | "understanding";
  criterionRef: string;
  contextDistance: "same" | "near" | "far";
  assessmentFormat: "mcq" | "mcq_multi" | "true_false";
};

export type MaterialCheckResult = {
  checkId: string;
  blockIndex: number;
  itemIndex: number;
  selectedAnswer: number | number[] | boolean;
  correct: boolean;
  outcome?: "correct" | "partial" | "incorrect";
  score?: number;
  explanation: string;
  submittedAt: string;
  firstSubmission: boolean;
};

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

/**
 * Stable for every retry of one persisted unit-session quiz, but rotates when
 * the session row changes for a newly generated/selected attempt.
 */
export function buildQuizEvidenceSubmissionId(input: {
  userId: string;
  unitId: string;
  quizSetId: string;
  sessionId: string;
  sessionUpdatedAt: string;
}): string {
  return `quiz-submit:${stableHash(
    JSON.stringify([
      input.userId,
      input.unitId,
      input.quizSetId,
      input.sessionId,
      input.sessionUpdatedAt,
    ]),
  )}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveMaterialCheckQuestionType(
  value: Record<string, unknown>,
): "mcq" | "mcq_multi" | "true_false" {
  const raw = value.questionType;
  if (raw === "true_false" || raw === "mcq_multi" || raw === "mcq") {
    // Prefer answer shape when an explicit "mcq" label contradicts multi keys.
    if (
      raw === "mcq" &&
      Array.isArray(value.correctIndices) &&
      value.correctIndices.filter(
        (item): item is number => typeof item === "number",
      ).length >= 2
    ) {
      return "mcq_multi";
    }
    return raw;
  }
  if (typeof value.correctAnswer === "boolean") return "true_false";
  if (
    Array.isArray(value.correctIndices) &&
    value.correctIndices.filter(
      (item): item is number => typeof item === "number",
    ).length >= 2
  ) {
    return "mcq_multi";
  }
  return "mcq";
}

function gradeMaterialCheckAnswer(
  definition: PublishedMaterialCheckDefinition,
  selectedAnswer: number | number[] | boolean,
): {
  correct: boolean;
  outcome: "correct" | "partial" | "incorrect";
  score: number;
} {
  return gradeObjectiveAnswer({
    questionType: definition.questionType,
    selectedAnswer,
    correctIndex: definition.correctIndex,
    correctIndices: definition.correctIndices,
    correctAnswer: definition.correctAnswer,
  });
}

/**
 * Extract only published, server-verifiable inline checks. Placeholders and
 * legacy checks without a stable checkId deliberately remain non-evidentiary.
 */
export function publishedMaterialCheckDefinitions(material: {
  blocks: readonly unknown[];
}): PublishedMaterialCheckDefinition[] {
  const definitions: PublishedMaterialCheckDefinition[] = [];
  const seen = new Set<string>();
  for (const [blockIndex, value] of material.blocks.entries()) {
    if (!isRecord(value) || value.type !== "check") continue;
    const checkId =
      typeof value.checkId === "string" ? value.checkId.trim() : "";
    if (!checkId) continue;
    if (seen.has(checkId)) {
      throw new Error(`Duplicate material checkId ${checkId}`);
    }
    const primaryLearningTargetId =
      typeof value.primaryLearningTargetId === "string"
        ? value.primaryLearningTargetId.trim().toLowerCase()
        : "";
    const targetCognitiveEntityId =
      typeof value.targetCognitiveEntityId === "string"
        ? value.targetCognitiveEntityId.trim()
        : undefined;
    const dimension = value.evidenceDimension;
    const contextDistance = value.contextDistance;
    const question =
      typeof value.question === "string" ? value.question.trim() : "";
    const explanation =
      typeof value.explanation === "string" ? value.explanation.trim() : "";
    const questionType = resolveMaterialCheckQuestionType(value);
    const criterionRef =
      typeof value.criterionRef === "string" ? value.criterionRef.trim() : "";
    const options = Array.isArray(value.options) ? value.options : [];
    const correctIndex = value.correctIndex;
    const correctIndices = Array.isArray(value.correctIndices)
      ? value.correctIndices
      : [];
    const correctAnswer = value.correctAnswer;
    const baseInvalid =
      !question ||
      !explanation ||
      !/^lt_\d+$/.test(primaryLearningTargetId) ||
      !criterionRef ||
      (dimension !== "memory" && dimension !== "understanding") ||
      (contextDistance !== "same" &&
        contextDistance !== "near" &&
        contextDistance !== "far");
    const typeInvalid =
      questionType === "mcq"
        ? !Number.isInteger(correctIndex) ||
          (correctIndex as number) < 0 ||
          (correctIndex as number) >= options.length ||
          options.length < 2
        : questionType === "mcq_multi"
          ? options.length < 2 ||
            correctIndices.length < 2 ||
            !correctIndices.every(
              (index) =>
                Number.isInteger(index) && index >= 0 && index < options.length,
            )
          : typeof correctAnswer !== "boolean";
    if (baseInvalid || typeInvalid) {
      throw new Error(`Material check ${checkId} has an invalid declaration`);
    }
    seen.add(checkId);
    definitions.push({
      checkId,
      blockIndex,
      itemIndex: 0,
      question,
      questionType,
      explanation,
      primaryLearningTargetId,
      assessmentFormat: questionType,
      ...(questionType === "mcq"
        ? { correctIndex: correctIndex as number }
        : questionType === "mcq_multi"
          ? {
              correctIndices: normalizeIndexList(correctIndices),
            }
          : { correctAnswer: correctAnswer as boolean }),
      ...(targetCognitiveEntityId ? { targetCognitiveEntityId } : {}),
      evidenceDimension: dimension,
      criterionRef,
      contextDistance,
    });
  }
  return definitions;
}

function parseAssessmentCriteria(value: unknown): AssessmentCriterion[] {
  if (!Array.isArray(value)) {
    throw new Error("LearningTarget assessment criteria must be an array");
  }
  const criteria = value.map((criterion) => {
    if (
      !isRecord(criterion) ||
      typeof criterion.ref !== "string" ||
      !criterion.ref.trim() ||
      typeof criterion.text !== "string" ||
      !criterion.text.trim()
    ) {
      throw new Error("LearningTarget has an invalid assessment criterion");
    }
    return { ref: criterion.ref.trim(), text: criterion.text.trim() };
  });
  if (criteria.length === 0) {
    throw new Error("LearningTarget must declare assessment criteria");
  }
  return criteria;
}

function controlledImportance(
  value: string,
): UnitAssessmentTarget["importance"] {
  if (value === "core" || value === "supporting" || value === "enrichment") {
    return value;
  }
  throw new Error(`Invalid LearningTarget importance: ${value}`);
}

function controlledDifficulty(
  value: string,
): UnitAssessmentTarget["difficulty"] {
  if (value === "easy" || value === "medium" || value === "hard") return value;
  throw new Error(`Invalid LearningTarget difficulty: ${value}`);
}

function controlledCognitiveLevel(
  value: string,
): UnitAssessmentTarget["targetCognitiveLevel"] {
  if (
    value === "remember" ||
    value === "understand" ||
    value === "apply" ||
    value === "analyze" ||
    value === "evaluate" ||
    value === "create"
  ) {
    return value;
  }
  throw new Error(`Invalid LearningTarget cognitive level: ${value}`);
}

function derivedTargetMinutes(target: {
  importance: string;
  difficulty: string;
  targetCognitiveLevel: string;
}): number {
  return learningTargetWorkload({
    importance: controlledImportance(target.importance),
    difficulty: controlledDifficulty(target.difficulty),
    targetCognitiveLevel: controlledCognitiveLevel(target.targetCognitiveLevel),
  }).teachingMinutes;
}

export async function loadUnitAssessmentTargets(
  persistence: PersistenceClient,
  unitId: string,
  userId?: string,
): Promise<UnitAssessmentTarget[]> {
  const unit = await persistence.learningUnit.findFirst({
    where: { id: unitId, ...(userId ? { goal: { userId } } : {}) },
    select: { id: true },
  });
  if (!unit) throw new Error("Unit not found");

  const mappings = await persistence.unitLearningTarget.findMany({
    where: { unitId, learningTarget: { status: "active" } },
    include: {
      learningTarget: {
        include: {
          requirements: {
            include: { cognitiveEntity: true },
            orderBy: { orderIndex: "asc" },
          },
        },
      },
    },
    orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
  });

  return mappings.map((mapping) => {
    const target = mapping.learningTarget;
    const requirements = target.requirements.map((requirement) => {
      if (
        !isCognitiveDimension(requirement.dimension) ||
        !isCognitiveEntityKind(requirement.cognitiveEntity.kind) ||
        requirement.cognitiveEntity.status !== "active"
      ) {
        throw new Error(
          `LearningTarget ${target.id} has an invalid cognitive requirement`,
        );
      }
      return {
        cognitiveEntityId: requirement.cognitiveEntityId,
        entityKind: requirement.cognitiveEntity.kind,
        entityDefinitionVersion: requirement.cognitiveEntity.definitionVersion,
        dimension: requirement.dimension,
        required: requirement.required,
        gate: requirement.gate,
        weight: requirement.weight,
        threshold: requirement.threshold,
      } satisfies UnitAssessmentRequirement;
    });
    if (requirements.length === 0) {
      throw new Error(
        `LearningTarget ${target.id} has no cognitive requirements`,
      );
    }
    return {
      id: target.id,
      localRef: mapping.localRef,
      title: target.title,
      description: target.explanation,
      learningObjective: target.learningObjective,
      assessmentCriteria: parseAssessmentCriteria(target.assessmentCriteria),
      required: mapping.required,
      weight: mapping.weight,
      role: mapping.role,
      isEntry: mapping.isEntry,
      isExit: mapping.isExit,
      importance: controlledImportance(target.importance),
      importanceWeight: target.importanceWeight,
      difficulty: controlledDifficulty(target.difficulty),
      targetCognitiveLevel: controlledCognitiveLevel(
        target.targetCognitiveLevel,
      ),
      estimatedMinutes: derivedTargetMinutes(target),
      requirements,
    } satisfies UnitAssessmentTarget;
  });
}

export async function loadModuleAssessmentTargets(
  persistence: PersistenceClient,
  moduleId: string,
  userId?: string,
  options: { role?: "entry" | "exit" } = {},
): Promise<UnitAssessmentTarget[]> {
  const module = await persistence.learningModule.findFirst({
    where: { id: moduleId, ...(userId ? { goal: { userId } } : {}) },
    select: { id: true },
  });
  if (!module) throw new Error("Module not found");
  const mappings = await persistence.moduleLearningTarget.findMany({
    where: {
      moduleId,
      role: options.role ?? "exit",
      learningTarget: { status: "active" },
    },
    include: {
      learningTarget: {
        include: {
          requirements: {
            include: { cognitiveEntity: true },
            orderBy: { orderIndex: "asc" },
          },
        },
      },
    },
    orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
  });
  return mappings.map((mapping) => {
    const target = mapping.learningTarget;
    const requirements = target.requirements.map((requirement) => {
      if (
        !isCognitiveDimension(requirement.dimension) ||
        !isCognitiveEntityKind(requirement.cognitiveEntity.kind) ||
        requirement.cognitiveEntity.status !== "active"
      ) {
        throw new Error(
          `LearningTarget ${target.id} has an invalid cognitive requirement`,
        );
      }
      return {
        cognitiveEntityId: requirement.cognitiveEntityId,
        entityKind: requirement.cognitiveEntity.kind,
        entityDefinitionVersion: requirement.cognitiveEntity.definitionVersion,
        dimension: requirement.dimension,
        required: requirement.required,
        gate: requirement.gate,
        weight: requirement.weight,
        threshold: requirement.threshold,
      } satisfies UnitAssessmentRequirement;
    });
    if (requirements.length === 0) {
      throw new Error(
        `LearningTarget ${target.id} has no cognitive requirements`,
      );
    }
    return {
      id: target.id,
      localRef: mapping.localRef,
      title: target.title,
      description: target.explanation,
      learningObjective: target.learningObjective,
      assessmentCriteria: parseAssessmentCriteria(target.assessmentCriteria),
      required: mapping.required,
      weight: mapping.weight,
      role: mapping.role,
      isEntry: mapping.role === "entry",
      isExit: mapping.role === "exit",
      importance: controlledImportance(target.importance),
      importanceWeight: target.importanceWeight,
      difficulty: controlledDifficulty(target.difficulty),
      targetCognitiveLevel: controlledCognitiveLevel(
        target.targetCognitiveLevel,
      ),
      estimatedMinutes: derivedTargetMinutes(target),
      requirements,
    } satisfies UnitAssessmentTarget;
  });
}

export async function loadGoalAssessmentTargets(
  persistence: PersistenceClient,
  goalId: string,
  userId?: string,
): Promise<UnitAssessmentTarget[]> {
  const goal = await persistence.learningGoal.findFirst({
    where: { id: goalId, ...(userId ? { userId } : {}) },
    select: { id: true },
  });
  if (!goal) throw new Error("Goal not found");
  const targets = await persistence.learningTarget.findMany({
    where: { goalId, status: "active" },
    include: {
      requirements: {
        include: { cognitiveEntity: true },
        orderBy: { orderIndex: "asc" },
      },
    },
    orderBy: [{ stableKey: "asc" }, { id: "asc" }],
  });
  return targets.map((target) => {
    const requirements = target.requirements.map((requirement) => {
      if (
        !isCognitiveDimension(requirement.dimension) ||
        !isCognitiveEntityKind(requirement.cognitiveEntity.kind) ||
        requirement.cognitiveEntity.status !== "active"
      ) {
        throw new Error(
          `LearningTarget ${target.id} has an invalid cognitive requirement`,
        );
      }
      return {
        cognitiveEntityId: requirement.cognitiveEntityId,
        entityKind: requirement.cognitiveEntity.kind,
        entityDefinitionVersion: requirement.cognitiveEntity.definitionVersion,
        dimension: requirement.dimension,
        required: requirement.required,
        gate: requirement.gate,
        weight: requirement.weight,
        threshold: requirement.threshold,
      } satisfies UnitAssessmentRequirement;
    });
    if (requirements.length === 0) {
      throw new Error(
        `LearningTarget ${target.id} has no cognitive requirements`,
      );
    }
    return {
      id: target.id,
      localRef: target.stableKey,
      title: target.title,
      description: target.explanation,
      learningObjective: target.learningObjective,
      assessmentCriteria: parseAssessmentCriteria(target.assessmentCriteria),
      required: target.importance === "core",
      weight: target.importanceWeight,
      role: "exit",
      isEntry: false,
      isExit: true,
      importance: controlledImportance(target.importance),
      importanceWeight: target.importanceWeight,
      difficulty: controlledDifficulty(target.difficulty),
      targetCognitiveLevel: controlledCognitiveLevel(
        target.targetCognitiveLevel,
      ),
      estimatedMinutes: derivedTargetMinutes(target),
      requirements,
    } satisfies UnitAssessmentTarget;
  });
}

export function isCriticalLearningTarget(
  target: UnitAssessmentTarget,
): boolean {
  return target.required && learningTargetWorkload(target).blocksCompletion;
}

export function isQuizAssessableLearningTarget(
  target: UnitAssessmentTarget,
): boolean {
  return target.requirements.some((requirement) =>
    isQuizEvidenceDimension(requirement.dimension),
  );
}

/**
 * Pick the still-unresolved targets that a closed-book diagnostic can assess.
 *
 * A LearningTarget may also require application, transfer, fluency, stability,
 * or independence evidence. Those requirements must remain authoritative, but
 * they must not prevent the diagnostic from collecting its valid
 * memory/understanding evidence. Full target completion is decided after the
 * attempt from the combined direct learner state.
 */
export function selectQuizAssessableDiagnosticTargets(
  targets: readonly UnitAssessmentTarget[],
  priorAssessments: readonly LearningTargetCognitiveAssessment[],
): UnitAssessmentTarget[] {
  const demonstratedTargetIds = new Set(
    priorAssessments
      .filter((assessment) => assessment.passed)
      .map((assessment) => assessment.learningTargetId),
  );
  const unresolved = targets.filter(
    (target) =>
      !demonstratedTargetIds.has(target.id) &&
      isQuizAssessableLearningTarget(target),
  );
  if (unresolved.length > 0) return unresolved;
  return targets.filter(isQuizAssessableLearningTarget);
}

async function repairMissingQuizEvidenceRequirements(
  persistence: PersistenceClient,
  targets: readonly UnitAssessmentTarget[],
): Promise<boolean> {
  if (targets.some(isQuizAssessableLearningTarget)) return false;

  const preferredTargets = targets.filter(
    (target) =>
      target.importance === "core" || target.importance === "supporting",
  );
  const toRepair = (
    preferredTargets.length > 0 ? preferredTargets : targets
  ).filter((target) => !isQuizAssessableLearningTarget(target));

  let wrote = false;
  for (const target of toRepair) {
    const seed = target.requirements[0];
    if (!seed) continue;
    const preferred: "memory" | "understanding" =
      seed.entityKind === "atom" ? "memory" : "understanding";
    const existing = new Set(
      target.requirements.map(
        (requirement) =>
          `${requirement.cognitiveEntityId}:${requirement.dimension}`,
      ),
    );
    const dimension = !existing.has(`${seed.cognitiveEntityId}:${preferred}`)
      ? preferred
      : preferred === "memory"
        ? "understanding"
        : "memory";
    if (existing.has(`${seed.cognitiveEntityId}:${dimension}`)) continue;

    try {
      await persistence.learningTargetRequirement.create({
        data: {
          learningTargetId: target.id,
          cognitiveEntityId: seed.cognitiveEntityId,
          dimension,
          required: true,
          threshold: seed.threshold,
          gate: false,
          weight: 1,
          orderIndex: target.requirements.length,
          rationale:
            "Server repair: selected-response evidence dimension for legacy performance-only LearningTarget",
        },
      });
      wrote = true;
    } catch (error) {
      // Concurrent quiz starts may race on the unique (target, entity, dimension).
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2002"
      )) {
        throw error;
      }
      wrote = true;
    }
  }
  return wrote;
}

/**
 * Legacy units may have published core/supporting targets with only
 * application/transfer requirements. Selected-response quizzes cannot write
 * those dimensions, so deterministically add a complementary memory or
 * understanding requirement on an existing entity before quiz generation.
 */
export async function ensureUnitQuizAssessableRequirements(
  persistence: PersistenceClient,
  unitId: string,
  userId?: string,
): Promise<UnitAssessmentTarget[]> {
  let targets = await loadUnitAssessmentTargets(persistence, unitId, userId);
  if (await repairMissingQuizEvidenceRequirements(persistence, targets)) {
    targets = await loadUnitAssessmentTargets(persistence, unitId, userId);
  }
  return targets;
}

export async function ensureModuleQuizAssessableRequirements(
  persistence: PersistenceClient,
  moduleId: string,
  userId?: string,
): Promise<UnitAssessmentTarget[]> {
  let targets = await loadModuleAssessmentTargets(persistence, moduleId, userId);
  if (await repairMissingQuizEvidenceRequirements(persistence, targets)) {
    targets = await loadModuleAssessmentTargets(persistence, moduleId, userId);
  }
  return targets;
}

/** Quiz-eligible dimensions declared on a LearningTarget (memory / understanding). */
export function quizEligibleEvidenceDimensions(
  target: UnitAssessmentTarget,
): Array<"memory" | "understanding"> {
  const dimensions: Array<"memory" | "understanding"> = [];
  for (const requirement of target.requirements) {
    if (!isQuizEvidenceDimension(requirement.dimension)) continue;
    if (!dimensions.includes(requirement.dimension)) {
      dimensions.push(requirement.dimension);
    }
  }
  return dimensions;
}

function preferredDeclaredQuizDimension(
  target: UnitAssessmentTarget,
  requested: "memory" | "understanding",
): "memory" | "understanding" | null {
  const eligible = quizEligibleEvidenceDimensions(target);
  if (eligible.length === 0) return null;
  if (eligible.includes(requested)) return requested;

  const ranked = target.requirements
    .filter((requirement) => isQuizEvidenceDimension(requirement.dimension))
    .sort((left, right) => {
      const rank = (requirement: UnitAssessmentRequirement) =>
        (requirement.required || requirement.gate ? 4 : 0) +
        (requirement.dimension === "understanding" ? 2 : 1);
      return rank(right) - rank(left);
    });
  const dimension = ranked[0]?.dimension;
  return dimension && isQuizEvidenceDimension(dimension)
    ? dimension
    : (eligible[0] ?? null);
}

/**
 * Deterministically clamp model-authored quiz evidence fields to the published
 * LearningTarget contract. Keeps a valid requested dimension; otherwise picks a
 * declared quiz-eligible dimension (and a declared criterion when needed).
 */
export function alignQuizQuestionsToDeclaredEvidence(
  questions: readonly QuizQuestion[],
  targets: readonly UnitAssessmentTarget[],
): QuizQuestion[] {
  const targetByRef = new Map(
    targets.map((target) => [target.localRef.toLowerCase(), target]),
  );

  return questions.map((question) => {
    const target = targetByRef.get(
      question.primaryLearningTargetId.toLowerCase(),
    );
    if (!target) return question;

    let next = question;
    const dimension = preferredDeclaredQuizDimension(
      target,
      question.evidenceDimension,
    );
    if (dimension && dimension !== question.evidenceDimension) {
      next = { ...next, evidenceDimension: dimension };
    }
    const eligibleRequirements = target.requirements.filter(
      (requirement) => requirement.dimension === next.evidenceDimension,
    );
    const declaredPrimary = eligibleRequirements.find(
      (requirement) =>
        requirement.cognitiveEntityId === next.primaryCognitiveEntityId,
    );
    if (!declaredPrimary && eligibleRequirements[0]) {
      next = {
        ...next,
        primaryCognitiveEntityId: eligibleRequirements[0].cognitiveEntityId,
      };
    }

    const criterionOk = target.assessmentCriteria.some(
      (criterion) => criterion.ref === next.criterionRef,
    );
    if (!criterionOk && target.assessmentCriteria[0]) {
      next = {
        ...next,
        criterionRef: target.assessmentCriteria[0].ref,
      };
    }
    return next;
  });
}

export function learningTargetSummativeQuestionCount(
  target: UnitAssessmentTarget,
): number {
  const assessableRequirements = target.requirements.filter(
    (requirement) =>
      (requirement.required || requirement.gate) &&
      isQuizEvidenceDimension(requirement.dimension),
  );
  if (assessableRequirements.length === 0) return 0;
  const evidenceMinimum = assessableRequirements.reduce(
    (total, requirement) =>
      total +
      requiredEvidenceCount(
        requirement.dimension,
        assessmentDemandTier(target, requirement),
      ),
    0,
  );
  return Math.max(
    learningTargetWorkload(target).summativeQuestions,
    evidenceMinimum,
  );
}

export function learningTargetCompetencyBlock(
  targets: readonly UnitAssessmentTarget[],
): string {
  return targets
    .map((target) => {
      const criteria = target.assessmentCriteria
        .map((criterion) => `- ${criterion.ref}: ${criterion.text}`)
        .join("\n");
      const requirements = target.requirements
        .map((requirement) => {
          const itemCount = isQuizEvidenceDimension(requirement.dimension)
            ? requiredEvidenceCount(
                requirement.dimension,
                assessmentDemandTier(target, requirement),
              )
            : 0;
          return `- ${requirement.dimension}: ${requirement.required ? "required" : "optional"}; threshold ${requirement.threshold.toFixed(2)}; ${requirement.gate ? "gate" : "weighted"}; entity ${requirement.cognitiveEntityId}; selected-response items ${itemCount}`;
        })
        .join("\n");
      const allowedQuizDimensions = quizEligibleEvidenceDimensions(target);
      const allowedLine =
        allowedQuizDimensions.length > 0
          ? `Allowed quiz evidenceDimension: ${allowedQuizDimensions.join(" | ")}`
          : "Allowed quiz evidenceDimension: (none — not quiz-assessable)";
      return `${target.localRef}: ${target.title}\nObjective: ${target.learningObjective}\nDefinition: ${target.description}\nAssessment criteria:\n${criteria}\nDeclared evidence requirements:\n${requirements}\n${allowedLine}\nSummative questions: ${learningTargetSummativeQuestionCount(target)}`;
    })
    .join("\n\n");
}

function resultScore(result: QuizGradeItem): number {
  if (result.status === "correct") return 1;
  if (result.status === "partial") return 0.5;
  return 0;
}

export function scoreQuizByLearningTarget(params: {
  questions: readonly QuizQuestion[];
  results: readonly QuizGradeItem[];
  targets: readonly UnitAssessmentTarget[];
}): { perLearningTarget: PerLearningTargetPerformance[] } {
  const resultByIndex = new Map(
    params.results.map((result) => [result.index, result]),
  );
  const targetByRef = new Map(
    params.targets.map((target) => [target.localRef.toLowerCase(), target]),
  );
  const stats = new Map<
    string,
    {
      correct: number;
      partial: number;
      incorrect: number;
      score: number;
      count: number;
    }
  >();

  params.questions.forEach((question, index) => {
    const ref = question.primaryLearningTargetId.toLowerCase();
    if (!targetByRef.has(ref)) {
      throw new Error(`Quiz question ${index + 1} targets undeclared ${ref}`);
    }
    if (
      !question.learningTargetIds.map((id) => id.toLowerCase()).includes(ref)
    ) {
      throw new Error(`Quiz question ${index + 1} primary target is not cited`);
    }
    const result = resultByIndex.get(index);
    if (!result)
      throw new Error(`Quiz question ${index + 1} has no grade result`);
    const current = stats.get(ref) ?? {
      correct: 0,
      partial: 0,
      incorrect: 0,
      score: 0,
      count: 0,
    };
    current[result.status] += 1;
    current.score += resultScore(result);
    current.count += 1;
    stats.set(ref, current);
  });

  return {
    perLearningTarget: params.targets.map((target) => {
      const row = stats.get(target.localRef.toLowerCase()) ?? {
        correct: 0,
        partial: 0,
        incorrect: 0,
        score: 0,
        count: 0,
      };
      const score = row.count > 0 ? row.score / row.count : 0;
      return {
        learningTargetId: target.id,
        localRef: target.localRef,
        title: target.title,
        score,
        correctCount: row.correct,
        partialCount: row.partial,
        incorrectCount: row.incorrect,
        questionCount: row.count,
        required: target.required,
        passed:
          row.count > 0 && score >= learningTargetWorkload(target).threshold,
      };
    }),
  };
}

function quizTaskKind(dimension: CognitiveDimension) {
  if (dimension === "memory") return "recall" as const;
  if (dimension === "understanding") return "explanation" as const;
  throw new Error(`${dimension} cannot be declared by a quiz question`);
}

function assertQuestionDeclaration(
  question: QuizQuestion,
  target: UnitAssessmentTarget,
  questionIndex: number,
) {
  if (!QUIZ_EVIDENCE_DIMENSIONS.has(question.evidenceDimension)) {
    throw new Error(
      `Quiz question ${questionIndex + 1} exceeds the quiz dimension ceiling`,
    );
  }
  if (
    !target.assessmentCriteria.some(
      (criterion) => criterion.ref === question.criterionRef,
    )
  ) {
    throw new Error(
      `Quiz question ${questionIndex + 1} cites undeclared criterion ${question.criterionRef}`,
    );
  }
  const requirements = target.requirements.filter(
    (requirement) => requirement.dimension === question.evidenceDimension,
  );
  if (requirements.length === 0) {
    throw new Error(
      `Quiz question ${questionIndex + 1} asserts undeclared ${question.evidenceDimension} evidence for ${target.localRef}`,
    );
  }
  const primary =
    requirements.find(
      (requirement) =>
        requirement.cognitiveEntityId === question.primaryCognitiveEntityId,
    ) ?? (!question.primaryCognitiveEntityId ? requirements[0] : undefined);
  if (!primary) {
    throw new Error(
      `Quiz question ${questionIndex + 1} cites an undeclared primary cognitive entity`,
    );
  }
  // One selected response can directly observe only one entity requirement.
  // Legacy questions without the v2 binding use the first published
  // requirement deterministically instead of fanning one answer out.
  return [primary];
}

type QuizTaskEvidenceDeclarationInput = {
  source: "quiz" | "diagnostic" | "review_quiz";
  questions: readonly QuizQuestion[];
  results: readonly QuizGradeItem[];
  targets: readonly UnitAssessmentTarget[];
};

type QuizQuestionEvidenceDeclarationInput = Omit<
  QuizTaskEvidenceDeclarationInput,
  "results"
>;

type PreparedQuizEvidenceDeclaration = {
  index: number;
  question: QuizQuestion;
  result: QuizGradeItem;
  target: UnitAssessmentTarget;
  requirements: UnitAssessmentRequirement[];
};

type InvalidQuestionPolicy = "reject" | "skip";

function prepareQuizQuestionEvidenceDeclarations(
  params: QuizQuestionEvidenceDeclarationInput,
  invalidQuestionPolicy: InvalidQuestionPolicy = "reject",
): Omit<PreparedQuizEvidenceDeclaration, "result">[] {
  const targetByRef = new Map(
    params.targets.map((target) => [target.localRef.toLowerCase(), target]),
  );
  const declarations: Omit<PreparedQuizEvidenceDeclaration, "result">[] = [];

  params.questions.forEach((question, index) => {
    try {
      const primaryRef = question.primaryLearningTargetId.toLowerCase();
      const target = targetByRef.get(primaryRef);
      if (!target) {
        throw new Error(
          `Quiz question ${index + 1} targets an unknown LearningTarget`,
        );
      }
      const citedRefs = question.learningTargetIds.map((id) =>
        id.toLowerCase(),
      );
      if (!citedRefs.includes(primaryRef)) {
        throw new Error(
          `Quiz question ${index + 1} primary target is not cited`,
        );
      }
      if (
        params.source === "diagnostic" &&
        (citedRefs.length !== 1 || citedRefs[0] !== primaryRef)
      ) {
        throw new Error(
          `Diagnostic question ${index + 1} must target exactly one LearningTarget`,
        );
      }
      const requirements = assertQuestionDeclaration(question, target, index);
      declarations.push({ index, question, target, requirements });
    } catch (error) {
      if (invalidQuestionPolicy === "reject") throw error;
    }
  });

  return declarations;
}

function prepareQuizTaskEvidenceDeclarations(
  params: QuizTaskEvidenceDeclarationInput,
  invalidQuestionPolicy: InvalidQuestionPolicy = "reject",
): PreparedQuizEvidenceDeclaration[] {
  const resultByIndex = new Map(
    params.results.map((result) => [result.index, result]),
  );

  return prepareQuizQuestionEvidenceDeclarations(
    params,
    invalidQuestionPolicy,
  ).map(({ index, question, target, requirements }) => {
    const result = resultByIndex.get(index);
    if (!result) {
      throw new Error(`Quiz question ${index + 1} has no grade result`);
    }
    return { index, question, result, target, requirements };
  });
}

/**
 * Compile a graded active-recall batch into the transaction-neutral items
 * consumed by the ORM quiz-submission boundary. The stable declarations and
 * evaluator facts intentionally match recordQuizTaskEvidence.
 */
export function buildQuizSubmissionItems(params: {
  unitId: string;
  activityAttemptId: string;
  source: "quiz" | "review_quiz";
  questions: readonly QuizQuestion[];
  results: readonly QuizGradeItem[];
  answers: Readonly<Record<string, string | number | boolean | number[]>>;
  targets: readonly UnitAssessmentTarget[];
  invalidQuestionPolicy?: InvalidQuestionPolicy;
}): { items: readonly QuizSubmissionItem[]; skippedQuestionCount: number } {
  const declarations = prepareQuizTaskEvidenceDeclarations(
    {
      source: params.source,
      questions: params.questions,
      results: params.results,
      targets: params.targets,
    },
    params.invalidQuestionPolicy,
  );
  const scopeKey = `unit:${params.unitId}`;
  const items = declarations.map(
    ({ index, question, target, requirements, result }) => {
      const contextKey = `${scopeKey}:quiz-context:${stableHash(
        JSON.stringify({
          target: target.id,
          dimension: question.evidenceDimension,
          distance: question.contextDistance,
          stem: question.question,
        }),
      )}`;
      const declarationHash = stableHash(
        JSON.stringify({
          source: params.source,
          target: target.id,
          criterion: question.criterionRef,
          dimension: question.evidenceDimension,
          contextKey,
          entities: requirements.map((requirement) => [
            requirement.cognitiveEntityId,
            requirement.entityDefinitionVersion,
          ]),
        }),
      );
      const taskType = params.source === "review_quiz" ? "review" : "quiz";
      const taskKind = quizTaskKind(question.evidenceDimension);
      return {
        index,
        task: {
          stableKey: `assessment:${params.source}:${declarationHash}`,
          taskType,
          title: question.question,
          instructions: "Answer the closed-book selection question.",
          context: {
            question: question.question,
            assessmentFormat: question.type,
          },
          rubric: {
            criterionRef: question.criterionRef,
            definitionVersion: 1,
          },
          difficulty: "medium",
          definitionVersion: 1,
          origin: "generated_quiz" as const,
          evidencePolicy: {
            source: params.source,
            taskKind,
            contextKey,
            contextDistance: question.contextDistance,
            rubricId: question.criterionRef,
            assessmentFormat: question.type,
          },
          requirements: requirements.map((requirement, orderIndex) => ({
            learningTargetId: target.id,
            cognitiveEntityId: requirement.cognitiveEntityId,
            dimension: question.evidenceDimension,
            criterionRef: question.criterionRef,
            definitionVersion: requirement.entityDefinitionVersion,
            required: requirement.required,
            weight: requirement.weight,
            orderIndex,
            rubricCriterion: {
              ref: question.criterionRef,
              definitionVersion: requirement.entityDefinitionVersion,
            },
          })),
        },
        idempotencyKey: `assessment:${params.source}:${params.activityAttemptId}:${index}`,
        response: { answer: params.answers[String(index)] ?? null },
        score: resultScore(result),
        outcome: result.status,
        evaluatorRunId: `grade:${params.activityAttemptId}:${index}`,
        rawResult: {
          status: result.status,
          userAnswerLabel: result.userAnswerLabel,
          correctAnswerLabel: result.correctAnswerLabel ?? null,
          assessmentFormat: question.type,
        },
        evidenceStrength: assessmentFormatEvidenceStrength(question.type),
      } satisfies QuizSubmissionItem;
    },
  );
  return {
    items,
    skippedQuestionCount: params.questions.length - declarations.length,
  };
}

export type UnitDiagnosticEvidenceBatch = Readonly<{
  tasks: readonly UnitDiagnosticTaskDefinition[];
  completions: readonly UnitDiagnosticCompletionItem[];
  entityIds: readonly string[];
}>;

/**
 * Compiles the already-graded diagnostic into the transaction-neutral task and
 * evidence declarations used by the ORM completion port. The same stable keys
 * and evaluator facts are retained by the Persistence fallback below.
 */
export function buildUnitDiagnosticEvidenceBatch(params: {
  goalId: string;
  unitId: string;
  activityAttemptId: string;
  questions: readonly QuizQuestion[];
  results: readonly QuizGradeItem[];
  answers: Readonly<Record<string, string | number | boolean | number[]>>;
  targets: readonly UnitAssessmentTarget[];
  submittedAt: Date;
}): UnitDiagnosticEvidenceBatch {
  const scopeKey = `unit:${params.unitId}`;
  const declarations = prepareQuizTaskEvidenceDeclarations({
    source: "diagnostic",
    questions: params.questions,
    results: params.results,
    targets: params.targets,
  });
  const tasks: UnitDiagnosticTaskDefinition[] = [];
  const completions: UnitDiagnosticCompletionItem[] = [];
  const entityIds = new Set<string>();

  for (const {
    index,
    question,
    target,
    requirements,
    result,
  } of declarations) {
    const contextKey = `${scopeKey}:quiz-context:${stableHash(
      JSON.stringify({
        target: target.id,
        dimension: question.evidenceDimension,
        distance: question.contextDistance,
        stem: question.question,
      }),
    )}`;
    const declarationHash = stableHash(
      JSON.stringify({
        source: "diagnostic",
        target: target.id,
        criterion: question.criterionRef,
        dimension: question.evidenceDimension,
        contextKey,
        entities: requirements.map((requirement) => [
          requirement.cognitiveEntityId,
          requirement.entityDefinitionVersion,
        ]),
      }),
    );
    const stableKey = `assessment:diagnostic:${declarationHash}`;
    const taskKind = quizTaskKind(question.evidenceDimension);
    const evidencePolicy = {
      source: "diagnostic" as const,
      taskKind,
      contextKey,
      contextDistance: question.contextDistance,
      rubricId: question.criterionRef,
      assessmentFormat: question.type,
    };
    tasks.push({
      goalId: params.goalId,
      unitId: params.unitId,
      stableKey,
      taskType: "diagnostic",
      title: question.question,
      instructions: "Answer the closed-book selection question.",
      context: {
        question: question.question,
        assessmentFormat: question.type,
      },
      rubric: {
        criterionRef: question.criterionRef,
        definitionVersion: 1,
      },
      difficulty: "medium",
      definitionVersion: 1,
      origin: "generated_quiz",
      evidencePolicy,
      requirements: requirements.map((requirement, orderIndex) => {
        entityIds.add(requirement.cognitiveEntityId);
        return {
          learningTargetId: target.id,
          cognitiveEntityId: requirement.cognitiveEntityId,
          dimension: question.evidenceDimension,
          criterionRef: question.criterionRef,
          definitionVersion: requirement.entityDefinitionVersion,
          required: requirement.required,
          weight: requirement.weight,
          orderIndex,
          rubricCriterion: { ref: question.criterionRef },
        };
      }),
    });
    completions.push({
      stableKey,
      idempotencyKey: `assessment:diagnostic:${params.activityAttemptId}:${index}`,
      response: { answer: params.answers[String(index)] ?? null },
      submittedAt: params.submittedAt,
      completedAt: params.submittedAt,
      candidates: requirements.map((requirement, requirementIndex) => ({
        requirementIndex,
        candidate: {
          score: resultScore(result),
          outcome: result.status,
          evaluatorRunId: `grade:${params.activityAttemptId}:${index}`,
          rawResult: {
            status: result.status,
            userAnswerLabel: result.userAnswerLabel,
            correctAnswerLabel: result.correctAnswerLabel ?? null,
            assessmentFormat: question.type,
          },
        },
        evaluator: {
          source: "diagnostic" as const,
          taskKind,
          contextKey,
          contextDistance: question.contextDistance,
          evaluatorType: "deterministic" as const,
          evaluatorReliability: 1,
          groundingReliability: 1,
          evidenceStrength: assessmentFormatEvidenceStrength(question.type),
        },
      })),
    });
  }

  return { tasks, completions, entityIds: [...entityIds] };
}

export type ModuleDiagnosticEvidenceBatch = Readonly<{
  tasks: readonly ModuleDiagnosticTaskDefinition[];
  completions: readonly ModuleDiagnosticCompletionItem[];
  entityIds: readonly string[];
}>;

/**
 * Compiles module diagnostic answers into question-level task declarations and
 * completion items. The completion port creates these evidence tasks and then
 * creates the separate evaluated attempt on the generated module task.
 */
export function buildModuleDiagnosticEvidenceBatch(params: {
  goalId: string;
  moduleId: string;
  activityAttemptId: string;
  questions: readonly QuizQuestion[];
  results: readonly QuizGradeItem[];
  answers: Readonly<Record<string, string | number | boolean | number[]>>;
  targets: readonly UnitAssessmentTarget[];
  submittedAt: Date;
}): ModuleDiagnosticEvidenceBatch {
  const declarations = prepareQuizTaskEvidenceDeclarations({
    source: "diagnostic",
    questions: params.questions,
    results: params.results,
    targets: params.targets,
  });
  const tasks: ModuleDiagnosticTaskDefinition[] = [];
  const completions: ModuleDiagnosticCompletionItem[] = [];
  const entityIds = new Set<string>();

  for (const {
    index,
    question,
    target,
    requirements,
    result,
  } of declarations) {
    const contextKey = `module:${params.moduleId}:quiz-context:${stableHash(
      JSON.stringify({
        target: target.id,
        dimension: question.evidenceDimension,
        distance: question.contextDistance,
        stem: question.question,
      }),
    )}`;
    const declarationHash = stableHash(
      JSON.stringify({
        source: "diagnostic",
        target: target.id,
        criterion: question.criterionRef,
        dimension: question.evidenceDimension,
        contextKey,
        entities: requirements.map((requirement) => [
          requirement.cognitiveEntityId,
          requirement.entityDefinitionVersion,
        ]),
      }),
    );
    const stableKey = `assessment:module-diagnostic:${params.moduleId}:${declarationHash}`;
    const taskKind = quizTaskKind(question.evidenceDimension);
    tasks.push({
      goalId: params.goalId,
      moduleId: params.moduleId,
      stableKey,
      taskType: "diagnostic",
      title: question.question,
      instructions: "Answer the closed-book selection question.",
      context: {
        question: question.question,
        assessmentFormat: question.type,
      },
      rubric: {
        criterionRef: question.criterionRef,
        definitionVersion: 1,
      },
      difficulty: "medium",
      definitionVersion: 1,
      origin: "generated_quiz",
      evidencePolicy: {
        source: "diagnostic",
        taskKind,
        contextKey,
        contextDistance: question.contextDistance,
        rubricId: question.criterionRef,
        assessmentFormat: question.type,
      },
      requirements: requirements.map((requirement, orderIndex) => {
        entityIds.add(requirement.cognitiveEntityId);
        return {
          learningTargetId: target.id,
          cognitiveEntityId: requirement.cognitiveEntityId,
          dimension: question.evidenceDimension,
          criterionRef: question.criterionRef,
          definitionVersion: requirement.entityDefinitionVersion,
          required: requirement.required,
          weight: requirement.weight,
          orderIndex,
          rubricCriterion: { ref: question.criterionRef },
        };
      }),
    });
    completions.push({
      stableKey,
      idempotencyKey: `assessment:diagnostic:${params.activityAttemptId}:${index}`,
      response: { answer: params.answers[String(index)] ?? null },
      submittedAt: params.submittedAt,
      completedAt: params.submittedAt,
      candidates: requirements.map((requirement, requirementIndex) => {
        void requirement;
        return {
          requirementIndex,
          candidate: {
            score: resultScore(result),
            outcome: result.status,
            evaluatorRunId: `grade:${params.activityAttemptId}:${index}`,
            rawResult: {
              status: result.status,
              userAnswerLabel: result.userAnswerLabel,
              correctAnswerLabel: result.correctAnswerLabel ?? null,
              assessmentFormat: question.type,
            },
          },
          evaluator: {
            source: "diagnostic" as const,
            taskKind,
            contextKey,
            contextDistance: question.contextDistance,
            evaluatorType: "deterministic" as const,
            evaluatorReliability: 1,
            groundingReliability: 1,
            evidenceStrength: assessmentFormatEvidenceStrength(question.type),
          },
        };
      }),
    });
  }
  return { tasks, completions, entityIds: [...entityIds] };
}

/** Validate generated questions against the published LearningTarget contract. */
export function validateQuizQuestionEvidenceDeclaration(
  params: QuizQuestionEvidenceDeclarationInput,
): void {
  prepareQuizQuestionEvidenceDeclarations(params);
}

/**
 * A target-level count is insufficient when the target binds several
 * cognitive entities. Require the adaptive quota for each exact
 * entity × dimension pair before publishing a generated diagnostic.
 */
export function validateAdaptiveQuizRequirementCoverage(params: {
  questions: readonly QuizQuestion[];
  targets: readonly UnitAssessmentTarget[];
}): void {
  const counts = new Map<string, number>();
  for (const question of params.questions) {
    const target = params.targets.find(
      (candidate) =>
        candidate.localRef.toLowerCase() ===
        question.primaryLearningTargetId.toLowerCase(),
    );
    if (!target) continue;
    const aligned = alignQuizQuestionsToDeclaredEvidence(
      [question],
      [target],
    )[0];
    if (!aligned?.primaryCognitiveEntityId) continue;
    const key = [
      target.id,
      aligned.primaryCognitiveEntityId,
      aligned.evidenceDimension,
    ].join(":");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const missing: string[] = [];
  for (const target of params.targets) {
    for (const requirement of target.requirements) {
      if (
        !(requirement.required || requirement.gate) ||
        !isQuizEvidenceDimension(requirement.dimension)
      ) {
        continue;
      }
      const required = requiredEvidenceCount(
        requirement.dimension,
        assessmentDemandTier(target, requirement),
      );
      const key = [
        target.id,
        requirement.cognitiveEntityId,
        requirement.dimension,
      ].join(":");
      const count = counts.get(key) ?? 0;
      if (count < required) {
        missing.push(
          `${target.localRef}/${requirement.cognitiveEntityId}/${requirement.dimension}=${required - count}`,
        );
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Diagnostic misses entity-bound evidence slots: ${missing.join(", ")}`,
    );
  }
}

/**
 * Validate the complete evaluator declaration before the first task, attempt,
 * observation, or claim is persisted. This makes an overreaching later item an
 * all-or-nothing rejection rather than a partially accepted quiz.
 */
export function validateQuizTaskEvidenceDeclaration(
  params: QuizTaskEvidenceDeclarationInput,
): void {
  prepareQuizTaskEvidenceDeclarations(params);
}

export async function recordQuizTaskEvidence(params: {
  persistence: PersistenceClient;
  userId: string;
  goalId: string;
  unitId?: string;
  moduleId?: string;
  activityAttemptId: string;
  source: "quiz" | "diagnostic" | "review_quiz";
  questions: readonly QuizQuestion[];
  results: readonly QuizGradeItem[];
  answers: Record<string, string | number | boolean | number[]>;
  targets: readonly UnitAssessmentTarget[];
  invalidQuestionPolicy?: InvalidQuestionPolicy;
}): Promise<{ observationCount: number; skippedQuestionCount: number }> {
  if (!params.unitId && !params.moduleId) {
    throw new Error("Quiz evidence requires a unit or module scope");
  }
  const scopeKey = params.moduleId
    ? `module:${params.moduleId}`
    : `unit:${params.unitId!}`;
  const declarations = prepareQuizTaskEvidenceDeclarations(
    params,
    params.invalidQuestionPolicy,
  );
  let observationCount = 0;

  for (const {
    index,
    question,
    target,
    requirements,
    result,
  } of declarations) {
    const contextKey = `${scopeKey}:quiz-context:${stableHash(
      JSON.stringify({
        target: target.id,
        dimension: question.evidenceDimension,
        distance: question.contextDistance,
        stem: question.question,
      }),
    )}`;
    const declarationHash = stableHash(
      JSON.stringify({
        source: params.source,
        target: target.id,
        criterion: question.criterionRef,
        dimension: question.evidenceDimension,
        contextKey,
        entities: requirements.map((requirement) => [
          requirement.cognitiveEntityId,
          requirement.entityDefinitionVersion,
        ]),
      }),
    );
    const task = await ensureLearningTask(params.persistence, {
      goalId: params.goalId,
      moduleId: params.moduleId,
      unitId: params.unitId,
      stableKey: `assessment:${params.source}:${declarationHash}`,
      taskType:
        params.source === "diagnostic"
          ? "diagnostic"
          : params.source === "review_quiz"
            ? "review"
            : "quiz",
      title: question.question,
      instructions: "Answer the closed-book selection question.",
      definitionVersion: 1,
      origin: "generated_quiz",
      evidencePolicy: {
        source: params.source,
        taskKind: quizTaskKind(question.evidenceDimension),
        contextKey,
        contextDistance: question.contextDistance,
        rubricId: question.criterionRef,
        assessmentFormat: question.type,
      },
      requirements: requirements.map((requirement, orderIndex) => ({
        cognitiveEntityId: requirement.cognitiveEntityId,
        learningTargetId: target.id,
        dimension: question.evidenceDimension,
        criterionRef: question.criterionRef,
        definitionVersion: requirement.entityDefinitionVersion,
        required: requirement.required,
        weight: requirement.weight,
        orderIndex,
      })),
    });
    const { attempt } = await startTaskAttempt(params.persistence, {
      taskId: task.id,
      userId: params.userId,
      unitId: params.unitId,
      idempotencyKey: `assessment:${params.source}:${params.activityAttemptId}:${index}`,
      response: { answer: params.answers[String(index)] ?? null },
      assistance: {
        level: "independent",
        hintCount: 0,
        answerRevealed: false,
      },
      status: "evaluated",
      submittedAt: new Date(),
      completedAt: new Date(),
    });
    for (const requirement of task.requirements) {
      await recordTaskObservationCandidate(params.persistence, {
        userId: params.userId,
        attemptId: attempt.id,
        candidate: {
          requirementId: requirement.id,
          score: resultScore(result),
          outcome: result.status,
          evaluatorRunId: `grade:${params.activityAttemptId}:${index}`,
          rawResult: {
            status: result.status,
            userAnswerLabel: result.userAnswerLabel,
            correctAnswerLabel: result.correctAnswerLabel ?? null,
            assessmentFormat: question.type,
          },
        },
        evaluator: {
          evaluatorType: "deterministic",
          evaluatorReliability: 1,
          groundingReliability: 1,
          evidenceStrength: assessmentFormatEvidenceStrength(question.type),
        },
      });
      observationCount += 1;
    }
  }
  return {
    observationCount,
    skippedQuestionCount: params.questions.length - declarations.length,
  };
}

function weightedGeometric(
  values: readonly { value: number; weight: number }[],
): number | null {
  if (values.length === 0) return null;
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  return Math.exp(
    values.reduce(
      (sum, item) => sum + item.weight * Math.log(Math.max(item.value, 1e-12)),
      0,
    ) / totalWeight,
  );
}

export async function assessLearningTargetsFromDirectState(params: {
  persistence?: PersistenceClient;
  userId: string;
  targets: readonly UnitAssessmentTarget[];
  stateRead?: LearnerStateProjectionReadRepository;
}): Promise<LearningTargetCognitiveAssessment[]> {
  const stateCache = new Map<
    string,
    Awaited<ReturnType<typeof getLearnerEntityState>>
  >();
  const stateFor = async (entityId: string) => {
    const cached = stateCache.get(entityId);
    if (cached) return cached;
    const state = await getLearnerEntityState(
      params.persistence,
      params.userId,
      entityId,
      params.stateRead,
    );
    stateCache.set(entityId, state);
    return state;
  };

  return assessLearningTargetsFromState({
    targets: params.targets,
    stateFor,
  });
}

/** Persistence-independent target assessment over authoritative entity state. */
export type AssessmentLearnerEntityState = Readonly<{
  overallEstimate: number | null;
  evidenceSufficiency: number;
  status: "unobserved" | "forming" | "demonstrated" | "robust" | "revalidate";
  inferencePolicyVersion: number;
  stateRevision: number;
  evidenceCutoffAt: string | null;
  lifecycleCutoffAt: string | null;
  dimensions: readonly Readonly<{
    dimension: CognitiveDimension;
    estimate: number | null;
    evidenceSufficiency: number;
    evidenceSufficiencyReasons: readonly string[];
    status: "unobserved" | "forming" | "demonstrated" | "robust" | "revalidate";
    effectiveEvidenceWeight: number;
    lastObservedAt: string | null;
  }>[];
}>;

export async function assessLearningTargetsFromState(params: {
  targets: readonly UnitAssessmentTarget[];
  stateFor: (entityId: string) => Promise<AssessmentLearnerEntityState>;
}): Promise<LearningTargetCognitiveAssessment[]> {
  const out: LearningTargetCognitiveAssessment[] = [];
  for (const target of params.targets) {
    const dimensions = await Promise.all(
      target.requirements.map(async (requirement) => {
        const entityState = await params.stateFor(
          requirement.cognitiveEntityId,
        );
        const dimensionState = entityState.dimensions.find(
          (candidate) => candidate.dimension === requirement.dimension,
        );
        const failures: LearningTargetCognitiveAssessment["failures"] = [];
        if (!dimensionState || dimensionState.estimate == null) {
          failures.push({
            cognitiveEntityId: requirement.cognitiveEntityId,
            dimension: requirement.dimension,
            reason: "unobserved",
          });
        } else {
          if (dimensionState.status === "revalidate") {
            failures.push({
              cognitiveEntityId: requirement.cognitiveEntityId,
              dimension: requirement.dimension,
              reason: "revalidate",
            });
          }
          if (dimensionState.evidenceSufficiency < 1) {
            failures.push({
              cognitiveEntityId: requirement.cognitiveEntityId,
              dimension: requirement.dimension,
              reason: "insufficient_evidence",
            });
          }
          if (dimensionState.estimate < requirement.threshold) {
            failures.push({
              cognitiveEntityId: requirement.cognitiveEntityId,
              dimension: requirement.dimension,
              reason: "below_threshold",
            });
          }
        }
        return { requirement, state: dimensionState, failures };
      }),
    );
    const applicable = dimensions.filter(
      ({ requirement }) => requirement.required || requirement.gate,
    );
    const estimate = weightedGeometric(
      applicable.flatMap(({ requirement, state }) =>
        state?.estimate == null
          ? []
          : [{ value: state.estimate, weight: requirement.weight }],
      ),
    );
    const targetThreshold = weightedGeometric(
      applicable.map(({ requirement }) => ({
        value: requirement.threshold,
        weight: requirement.weight,
      })),
    );
    const evidenceSufficiency =
      applicable.length === 0
        ? 0
        : Math.min(
            ...applicable.map(({ state }) => state?.evidenceSufficiency ?? 0),
          );
    const gateFailures = applicable.flatMap(({ requirement, failures }) =>
      requirement.gate ? failures : [],
    );
    const allFailures = applicable.flatMap(({ failures }) => failures);
    const hasUnobserved = applicable.some(
      ({ state }) => state?.estimate == null,
    );
    const hasRevalidate = applicable.some(
      ({ state }) => state?.status === "revalidate",
    );
    const passed =
      !hasUnobserved &&
      !hasRevalidate &&
      evidenceSufficiency >= 1 &&
      gateFailures.length === 0 &&
      estimate != null &&
      targetThreshold != null &&
      estimate >= targetThreshold;
    const status: LearningTargetCognitiveAssessment["status"] = hasUnobserved
      ? "unobserved"
      : hasRevalidate
        ? "revalidate"
        : passed && applicable.every(({ state }) => state?.status === "robust")
          ? "robust"
          : passed
            ? "demonstrated"
            : "forming";
    out.push({
      learningTargetId: target.id,
      localRef: target.localRef,
      title: target.title,
      estimate,
      evidenceSufficiency,
      status,
      passed,
      failures: allFailures,
    });
  }
  return out;
}

function observationForTarget(
  targets: readonly UnitAssessmentTarget[],
  localRef: string,
  criterionRef: string,
  dimension: CognitiveDimension,
) {
  const target = targets.find(
    (candidate) => candidate.localRef.toLowerCase() === localRef.toLowerCase(),
  );
  if (!target) throw new Error(`Unknown LearningTarget ${localRef}`);
  if (
    !target.assessmentCriteria.some(
      (criterion) => criterion.ref === criterionRef,
    )
  ) {
    throw new Error(`Undeclared criterion ${criterionRef} for ${localRef}`);
  }
  const requirements = target.requirements.filter(
    (requirement) => requirement.dimension === dimension,
  );
  if (requirements.length === 0) {
    throw new Error(`LearningTarget ${localRef} does not declare ${dimension}`);
  }
  return { target, requirements };
}

export type FeynmanCriterionScore = {
  learningTargetId: string;
  criterionRef: string;
  score: number;
  rationale: string;
};

/** Rejects rubric-scoped LLM overreach before any workflow or evidence write. */
export function validateFeynmanRubricResult(params: {
  targets: readonly UnitAssessmentTarget[];
  observations: readonly FeynmanCriterionScore[];
  passed: boolean;
}): void {
  const seen = new Set<string>();
  for (const observation of params.observations) {
    if (
      !Number.isFinite(observation.score) ||
      observation.score < 0 ||
      observation.score > 1
    ) {
      throw new Error("Feynman rubric score must be between zero and one");
    }
    observationForTarget(
      params.targets,
      observation.learningTargetId,
      observation.criterionRef,
      "understanding",
    );
    const identity = `${observation.learningTargetId}:${observation.criterionRef}`;
    if (seen.has(identity)) {
      throw new Error(`Duplicate Feynman rubric observation ${identity}`);
    }
    seen.add(identity);
  }
  if (!params.passed) return;

  const requiredTargets = params.targets.filter(
    (target) =>
      target.required &&
      target.requirements.some(
        (requirement) =>
          requirement.dimension === "understanding" &&
          (requirement.required || requirement.gate),
      ),
  );
  for (const target of requiredTargets) {
    const threshold = Math.max(
      ...target.requirements
        .filter(
          (requirement) =>
            requirement.dimension === "understanding" &&
            (requirement.required || requirement.gate),
        )
        .map((requirement) => requirement.threshold),
    );
    const scores = params.observations.filter(
      (observation) =>
        observation.learningTargetId.toLowerCase() ===
        target.localRef.toLowerCase(),
    );
    if (
      scores.length === 0 ||
      scores.some((score) => score.score < threshold)
    ) {
      throw new Error(
        `Feynman pass overreaches the declared rubric for ${target.localRef}`,
      );
    }
  }
}

export async function recordFeynmanTaskEvidence(params: {
  persistence: PersistenceClient;
  userId: string;
  goalId: string;
  unitId: string;
  feynmanSessionId: string;
  userText: string;
  observations: readonly FeynmanCriterionScore[];
  targets: readonly UnitAssessmentTarget[];
}): Promise<{ observationCount: number }> {
  validateFeynmanRubricResult({
    targets: params.targets,
    observations: params.observations,
    passed: false,
  });
  let observationCount = 0;
  for (const observation of params.observations) {
    if (
      !Number.isFinite(observation.score) ||
      observation.score < 0 ||
      observation.score > 1
    ) {
      throw new Error("Feynman rubric score must be between zero and one");
    }
    const { target, requirements } = observationForTarget(
      params.targets,
      observation.learningTargetId,
      observation.criterionRef,
      "understanding",
    );
    const declarationHash = stableHash(
      JSON.stringify({
        unitId: params.unitId,
        targetId: target.id,
        criterionRef: observation.criterionRef,
        entities: requirements.map((requirement) => [
          requirement.cognitiveEntityId,
          requirement.entityDefinitionVersion,
        ]),
      }),
    );
    const task = await ensureLearningTask(params.persistence, {
      goalId: params.goalId,
      unitId: params.unitId,
      stableKey: `assessment:feynman:${declarationHash}`,
      taskType: "explanation",
      title: `Feynman explanation · ${target.title}`,
      instructions: target.learningObjective,
      definitionVersion: 1,
      origin: "feynman",
      evidencePolicy: {
        source: "feynman",
        taskKind: "explanation",
        contextKey: `unit:${params.unitId}:feynman:${target.id}`,
        contextDistance: "same",
        rubricId: observation.criterionRef,
      },
      requirements: requirements.map((requirement, orderIndex) => ({
        cognitiveEntityId: requirement.cognitiveEntityId,
        learningTargetId: target.id,
        dimension: "understanding",
        criterionRef: observation.criterionRef,
        definitionVersion: requirement.entityDefinitionVersion,
        required: requirement.required,
        weight: requirement.weight,
        orderIndex,
      })),
    });
    const { attempt } = await startTaskAttempt(params.persistence, {
      taskId: task.id,
      userId: params.userId,
      unitId: params.unitId,
      idempotencyKey: `assessment:feynman:${params.feynmanSessionId}:${target.id}:${observation.criterionRef}`,
      response: { explanation: params.userText },
      assistance: {
        level: "independent",
        hintCount: 0,
        answerRevealed: false,
      },
      status: "evaluated",
      submittedAt: new Date(),
      completedAt: new Date(),
    });
    for (const requirement of task.requirements) {
      await recordTaskObservationCandidate(params.persistence, {
        userId: params.userId,
        attemptId: attempt.id,
        candidate: {
          requirementId: requirement.id,
          score: observation.score,
          outcome: observation.score >= 0.7 ? "meets" : "does_not_meet",
          evaluatorRunId: `feynman:${params.feynmanSessionId}:${target.id}:${observation.criterionRef}`,
          rawResult: { rationale: observation.rationale },
        },
        evaluator: {
          evaluatorType: "llm",
          evaluatorReliability: 0.8,
          groundingReliability: 0.8,
          evidenceStrength: "moderate",
        },
      });
      observationCount += 1;
    }
  }
  return { observationCount };
}

export async function recordSocraticTaskEvidence(params: {
  persistence: PersistenceClient;
  userId: string;
  goalId: string;
  unitId: string;
  threadId: string;
  turn: number;
  localLearningTargetRef: string;
  criterionRef: string;
  answer: string;
  resolved: boolean;
  terminatedByLimit: boolean;
  targets: readonly UnitAssessmentTarget[];
}): Promise<{
  observationCount: number;
  skippedReason?:
    | "unknown_learning_target"
    | "undeclared_criterion"
    | "undeclared_understanding";
}> {
  const target = params.targets.find(
    (candidate) =>
      candidate.localRef.toLowerCase() ===
      params.localLearningTargetRef.toLowerCase(),
  );
  if (!target) {
    return { observationCount: 0, skippedReason: "unknown_learning_target" };
  }
  if (
    !target.assessmentCriteria.some(
      (criterion) => criterion.ref === params.criterionRef,
    )
  ) {
    return { observationCount: 0, skippedReason: "undeclared_criterion" };
  }
  const understandingRequirements = target.requirements.filter(
    (requirement) => requirement.dimension === "understanding",
  );
  if (understandingRequirements.length === 0) {
    return { observationCount: 0, skippedReason: "undeclared_understanding" };
  }

  /*
   * Socratic threads can outlive the quiz or target revision that created
   * them. Stale/legacy bindings must fail closed for evidence without
   * preventing the learner from continuing the correction conversation.
   */
  const independenceEntities = new Map(
    understandingRequirements.map((requirement) => [
      requirement.cognitiveEntityId,
      requirement,
    ]),
  );
  const declarationHash = stableHash(
    JSON.stringify({
      unitId: params.unitId,
      targetId: target.id,
      criterionRef: params.criterionRef,
      entities: [...independenceEntities.keys()],
    }),
  );
  const task = await ensureLearningTask(params.persistence, {
    goalId: params.goalId,
    unitId: params.unitId,
    stableKey: `assessment:socratic:${declarationHash}`,
    taskType: "explanation",
    title: `Guided correction · ${target.title}`,
    instructions: target.learningObjective,
    definitionVersion: 1,
    origin: "socratic",
    evidencePolicy: {
      source: "socratic",
      taskKind: "explanation",
      contextKey: `unit:${params.unitId}:socratic:${target.id}:${params.criterionRef}`,
      contextDistance: "same",
      rubricId: params.criterionRef,
    },
    requirements: [
      ...understandingRequirements.map((requirement, orderIndex) => ({
        cognitiveEntityId: requirement.cognitiveEntityId,
        learningTargetId: target.id,
        dimension: "understanding" as const,
        criterionRef: params.criterionRef,
        definitionVersion: requirement.entityDefinitionVersion,
        required: requirement.required,
        weight: requirement.weight,
        orderIndex,
      })),
      ...[...independenceEntities.values()].map((requirement, index) => ({
        cognitiveEntityId: requirement.cognitiveEntityId,
        dimension: "independence" as const,
        criterionRef: "system:assistance_independence:v1",
        definitionVersion: requirement.entityDefinitionVersion,
        required: false,
        weight: 1,
        orderIndex: understandingRequirements.length + index,
        rubricCriterion: {
          text: "Degree of independent performance without guided prompts",
        },
      })),
    ],
  });
  const { attempt } = await startTaskAttempt(params.persistence, {
    taskId: task.id,
    userId: params.userId,
    unitId: params.unitId,
    idempotencyKey: `assessment:socratic:${params.threadId}:${params.turn}`,
    response: { answer: params.answer },
    assistance: {
      level: "guided",
      hintCount: Math.max(1, params.turn),
      answerRevealed: false,
    },
    positiveEvidenceEligible: !params.terminatedByLimit,
    status: "evaluated",
    submittedAt: new Date(),
    completedAt: new Date(),
  });
  let observationCount = 0;
  for (const requirement of task.requirements) {
    const score =
      requirement.dimension === "independence"
        ? 0.3
        : params.resolved && !params.terminatedByLimit
          ? 0.8
          : 0.3;
    await recordTaskObservationCandidate(params.persistence, {
      userId: params.userId,
      attemptId: attempt.id,
      candidate: {
        requirementId: requirement.id,
        score,
        outcome: params.resolved ? "resolved" : "unresolved",
        evaluatorRunId: `socratic:${params.threadId}:${params.turn}`,
        rawResult: {
          resolved: params.resolved,
          terminatedByLimit: params.terminatedByLimit,
          turn: params.turn,
        },
      },
      evaluator: {
        evaluatorType: "llm",
        evaluatorReliability: 0.75,
        groundingReliability: 0.75,
        evidenceStrength: "weak",
      },
    });
    observationCount += 1;
  }
  return { observationCount };
}

export async function recordVerifiedMaterialCheckEvidence(params: {
  persistence?: PersistenceClient;
  userId: string;
  goalId: string;
  unitId: string;
  blockKey: string;
  localLearningTargetRef: string;
  criterionRef: string;
  dimension: "understanding" | "application";
  contextDistance: "same" | "near";
  correct: boolean;
  response: unknown;
  targets: readonly UnitAssessmentTarget[];
  materialCheckCompletion?: MaterialCheckCompletionRepository;
}): Promise<void> {
  const { target, requirements } = observationForTarget(
    params.targets,
    params.localLearningTargetRef,
    params.criterionRef,
    params.dimension,
  );
  const declarationHash = stableHash(
    JSON.stringify({
      unitId: params.unitId,
      blockKey: params.blockKey,
      targetId: target.id,
      criterionRef: params.criterionRef,
      dimension: params.dimension,
      entities: requirements.map(
        (requirement) => requirement.cognitiveEntityId,
      ),
    }),
  );
  if (params.materialCheckCompletion) {
    await params.materialCheckCompletion.completeInteraction({
      userId: params.userId,
      goalId: params.goalId,
      unitId: params.unitId,
      task: {
        goalId: params.goalId,
        unitId: params.unitId,
        stableKey: `assessment:interaction:${declarationHash}`,
        taskType: "interaction",
        title: `Verified lesson interaction · ${target.title}`,
        instructions: target.learningObjective,
        context: {},
        rubric: {},
        difficulty: target.difficulty,
        definitionVersion: 1,
        origin: "material_interaction",
        evidencePolicy: {
          source: "practice",
          taskKind:
            params.dimension === "understanding"
              ? "routine_application"
              : params.contextDistance === "near"
                ? "novel_application"
                : "routine_application",
          contextKey: `unit:${params.unitId}:interaction:${params.blockKey}`,
          contextDistance: params.contextDistance,
          rubricId: params.criterionRef,
        },
        requirements: requirements.map((requirement, orderIndex) => ({
          cognitiveEntityId: requirement.cognitiveEntityId,
          learningTargetId: target.id,
          dimension: params.dimension,
          criterionRef: params.criterionRef,
          definitionVersion: requirement.entityDefinitionVersion,
          required: requirement.required,
          weight: requirement.weight,
          orderIndex,
        })),
      },
      idempotencyKey: `assessment:interaction:${params.userId}:${params.unitId}:${params.blockKey}`,
      response: params.response,
      score: params.correct ? 1 : 0,
      outcome: params.correct ? "correct" : "incorrect",
      evaluatorRunId: `interaction:${params.blockKey}`,
    });
    return;
  }
  const task = await ensureLearningTask(params.persistence!, {
    goalId: params.goalId,
    unitId: params.unitId,
    stableKey: `assessment:interaction:${declarationHash}`,
    taskType: "interaction",
    title: `Verified lesson interaction · ${target.title}`,
    definitionVersion: 1,
    origin: "material_interaction",
    evidencePolicy: {
      source: "practice",
      taskKind:
        params.dimension === "understanding"
          ? "routine_application"
          : params.contextDistance === "near"
            ? "novel_application"
            : "routine_application",
      contextKey: `unit:${params.unitId}:interaction:${params.blockKey}`,
      contextDistance: params.contextDistance,
      rubricId: params.criterionRef,
    },
    requirements: requirements.map((requirement, orderIndex) => ({
      cognitiveEntityId: requirement.cognitiveEntityId,
      learningTargetId: target.id,
      dimension: params.dimension,
      criterionRef: params.criterionRef,
      definitionVersion: requirement.entityDefinitionVersion,
      required: requirement.required,
      weight: requirement.weight,
      orderIndex,
    })),
  });
  const { attempt } = await startTaskAttempt(params.persistence!, {
    taskId: task.id,
    userId: params.userId,
    unitId: params.unitId,
    // One published interaction is one attempt. Reopening the lesson after the
    // answer has been revealed must not let a learner submit another option and
    // accumulate a second claim for the same content revision.
    idempotencyKey: `assessment:interaction:${params.userId}:${params.unitId}:${params.blockKey}`,
    response: { value: params.response },
    assistance: { level: "independent", hintCount: 0, answerRevealed: false },
    status: "evaluated",
    submittedAt: new Date(),
    completedAt: new Date(),
  });
  for (const requirement of task.requirements) {
    await recordTaskObservationCandidate(params.persistence!, {
      userId: params.userId,
      attemptId: attempt.id,
      candidate: {
        requirementId: requirement.id,
        score: params.correct ? 1 : 0,
        outcome: params.correct ? "correct" : "incorrect",
        evaluatorRunId: `interaction:${params.blockKey}`,
      },
      evaluator: {
        evaluatorType: "deterministic",
        evaluatorReliability: 1,
        groundingReliability: 1,
        evidenceStrength: "moderate",
      },
    });
  }
}

function materialCheckStableKey(checkId: string): string {
  return `assessment:material-check:${checkId}`;
}

function materialCheckVersionStableKey(
  checkId: string,
  definitionVersion: number,
): string {
  const base = materialCheckStableKey(checkId);
  return definitionVersion === 1 ? base : `${base}:v${definitionVersion}`;
}

function materialCheckStableKeyWhere(
  checkId: string,
): Persistence.LearningTaskWhereInput {
  const base = materialCheckStableKey(checkId);
  return {
    OR: [{ stableKey: base }, { stableKey: { startsWith: `${base}:v` } }],
  };
}

function materialCheckAttemptKey(params: {
  userId: string;
  unitId: string;
  checkId: string;
  definitionVersion: number;
}): string {
  const base = `assessment:material-check:${params.userId}:${params.unitId}:${params.checkId}`;
  return params.definitionVersion === 1
    ? base
    : `${base}:v${params.definitionVersion}`;
}

function materialCheckCompletionItem(params: {
  definition: PublishedMaterialCheckDefinition;
  selectedAnswer: number | number[] | boolean;
  stableKey: string;
  userId: string;
  unitId: string;
  definitionVersion: number;
}): Omit<MaterialCheckCompletionItem, "submittedAt" | "completedAt"> {
  const graded = gradeMaterialCheckAnswer(
    params.definition,
    params.selectedAnswer,
  );
  const response = {
    checkId: params.definition.checkId,
    blockIndex: params.definition.blockIndex,
    itemIndex: params.definition.itemIndex,
    selectedAnswer: params.selectedAnswer,
    correct: graded.correct,
    outcome: graded.outcome,
    score: graded.score,
    explanation: params.definition.explanation,
    assessmentFormat: params.definition.assessmentFormat,
  };
  return {
    stableKey: params.stableKey,
    requirementIndex: 0,
    idempotencyKey: materialCheckAttemptKey({
      userId: params.userId,
      unitId: params.unitId,
      checkId: params.definition.checkId,
      definitionVersion: params.definitionVersion,
    }),
    response,
    candidate: {
      score: graded.score,
      outcome: graded.outcome,
      evaluatorRunId: `material-check:${params.definition.checkId}:v${params.definitionVersion}`,
      rawResult: response,
    },
    evaluator: {
      source: "quiz",
      taskKind: quizTaskKind(params.definition.evidenceDimension),
      contextKey: `unit:${params.unitId}:material-check:${params.definition.checkId}`,
      contextDistance: params.definition.contextDistance,
      evaluatorType: "deterministic",
      evaluatorReliability: 1,
      groundingReliability: 1,
      evidenceStrength:
        params.definition.questionType === "true_false" ? "weak" : "moderate",
    },
  };
}

function selectMaterialCheckRequirement(
  definition: PublishedMaterialCheckDefinition,
  targets: readonly UnitAssessmentTarget[],
): { target: UnitAssessmentTarget; requirement: UnitAssessmentRequirement } {
  const target = targets.find(
    (candidate) =>
      candidate.localRef.toLowerCase() ===
      definition.primaryLearningTargetId.toLowerCase(),
  );
  if (!target) {
    throw new Error(
      `Material check ${definition.checkId} cites unknown LearningTarget ${definition.primaryLearningTargetId}`,
    );
  }
  if (
    !target.assessmentCriteria.some(
      (criterion) => criterion.ref === definition.criterionRef,
    )
  ) {
    throw new Error(
      `Material check ${definition.checkId} cites undeclared criterion ${definition.criterionRef}`,
    );
  }
  const candidates = target.requirements.filter(
    (requirement) =>
      requirement.dimension === definition.evidenceDimension &&
      (!definition.targetCognitiveEntityId ||
        requirement.cognitiveEntityId === definition.targetCognitiveEntityId),
  );
  if (candidates.length === 0) {
    throw new Error(
      `Material check ${definition.checkId} does not target a published ${definition.evidenceDimension} entity`,
    );
  }
  // targetCognitiveEntityId is mandatory for newly generated checks. The first
  // published requirement is a deterministic bridge for already persisted beta
  // checks that gained checkId before the entity field was introduced.
  return { target, requirement: candidates[0]! };
}

function materialCheckTaskDeclaration(
  goalId: string,
  unitId: string,
  definition: PublishedMaterialCheckDefinition,
  target: UnitAssessmentTarget,
  requirement: UnitAssessmentRequirement,
): MaterialCheckTaskDefinition {
  return {
    goalId,
    unitId,
    stableKey: materialCheckStableKey(definition.checkId),
    taskType: "quiz",
    title: definition.question,
    instructions: "Answer this inline closed-book selection question.",
    context: {
      checkId: definition.checkId,
      blockIndex: definition.blockIndex,
      itemIndex: definition.itemIndex,
      primaryLearningTargetId: definition.primaryLearningTargetId,
      targetCognitiveEntityId: requirement.cognitiveEntityId,
    },
    rubric: {
      assessmentFormat: definition.assessmentFormat,
      ...(definition.questionType === "mcq"
        ? { correctIndex: definition.correctIndex }
        : definition.questionType === "mcq_multi"
          ? { correctIndices: definition.correctIndices }
          : { correctAnswer: definition.correctAnswer }),
      explanation: definition.explanation,
    },
    difficulty: "medium",
    definitionVersion: 1,
    origin: "material_check",
    evidencePolicy: {
      source: "quiz",
      taskKind: quizTaskKind(definition.evidenceDimension),
      contextKey: `unit:${unitId}:material-check:${definition.checkId}`,
      contextDistance: definition.contextDistance,
      rubricId: definition.criterionRef,
    },
    requirements: [
      {
        cognitiveEntityId: requirement.cognitiveEntityId,
        learningTargetId: target.id,
        dimension: definition.evidenceDimension,
        criterionRef: definition.criterionRef,
        definitionVersion: requirement.entityDefinitionVersion,
        required: requirement.required,
        weight: 1,
        orderIndex: 0,
      },
    ],
  };
}

export async function buildMaterialCheckTaskDeclarations(params: {
  persistence?: PersistenceClient;
  userId: string;
  goalId: string;
  unitId: string;
  material: { blocks: readonly unknown[] };
  targets?: readonly UnitAssessmentTarget[];
}): Promise<MaterialCheckTaskDefinition[]> {
  const definitions = publishedMaterialCheckDefinitions(params.material);
  const targets =
    params.targets ??
    (await loadUnitAssessmentTargets(
      params.persistence!,
      params.unitId,
      params.userId,
    ));
  return definitions.map((definition) => {
    const { target, requirement } = selectMaterialCheckRequirement(
      definition,
      targets,
    );
    return materialCheckTaskDeclaration(
      params.goalId,
      params.unitId,
      definition,
      target,
      requirement,
    );
  });
}

/**
 * Publish immutable inline-check task definitions alongside learning material.
 * Call this inside the same transaction as the LearningMaterial write.
 */
export async function publishMaterialCheckTasks(params: {
  persistence: PersistenceClient;
  userId: string;
  goalId: string;
  unitId: string;
  material: { blocks: readonly unknown[] };
  targets?: readonly UnitAssessmentTarget[];
}): Promise<{ publishedCheckIds: string[]; deprecatedCount: number }> {
  const definitions = publishedMaterialCheckDefinitions(params.material);
  const declarations = await buildMaterialCheckTaskDeclarations(params);
  const stableKeys: string[] = [];
  for (const [index, definition] of definitions.entries()) {
    const declaration = declarations[index]!;
    let task: Awaited<ReturnType<typeof ensureLearningTask>>;
    try {
      task = await ensureLearningTask(
        params.persistence,
        declaration as unknown as Parameters<typeof ensureLearningTask>[1],
      );
    } catch (error) {
      if (
        !(error instanceof CognitionPersistenceError) ||
        error.code !== "immutable_declaration"
      ) {
        throw error;
      }
      const latest = await params.persistence.learningTask.findFirst({
        where: {
          goalId: params.goalId,
          unitId: params.unitId,
          origin: "material_check",
          ...materialCheckStableKeyWhere(definition.checkId),
        },
        orderBy: [{ definitionVersion: "desc" }, { createdAt: "desc" }],
        select: { stableKey: true, definitionVersion: true },
      });
      if (!latest) throw error;

      const latestDeclaration = {
        ...declaration,
        stableKey: latest.stableKey,
        definitionVersion: latest.definitionVersion,
      };
      try {
        task = await ensureLearningTask(
          params.persistence,
          latestDeclaration as unknown as Parameters<
            typeof ensureLearningTask
          >[1],
        );
      } catch (latestError) {
        if (
          !(latestError instanceof CognitionPersistenceError) ||
          latestError.code !== "immutable_declaration"
        ) {
          throw latestError;
        }
        const definitionVersion = latest.definitionVersion + 1;
        task = await ensureLearningTask(params.persistence, {
          ...declaration,
          stableKey: materialCheckVersionStableKey(
            definition.checkId,
            definitionVersion,
          ),
          definitionVersion,
        } as unknown as Parameters<typeof ensureLearningTask>[1]);
      }
    }
    if (task.status === "deprecated") {
      await params.persistence.learningTask.update({
        where: { id: task.id },
        data: { status: "active" },
      });
    }
    stableKeys.push(task.stableKey);
  }
  const deprecated = await params.persistence.learningTask.updateMany({
    where: {
      unitId: params.unitId,
      origin: "material_check",
      status: "active",
      ...(stableKeys.length > 0 ? { stableKey: { notIn: stableKeys } } : {}),
    },
    data: { status: "deprecated" },
  });
  return {
    publishedCheckIds: definitions.map((definition) => definition.checkId),
    deprecatedCount: deprecated.count,
  };
}

function materialCheckResultFromAttempt(attempt: {
  response: unknown;
  submittedAt: Date | null;
}): MaterialCheckResult | null {
  if (!isRecord(attempt.response)) return null;
  const response = attempt.response;
  const selectedAnswer = response.selectedAnswer;
  const selectedValid =
    typeof selectedAnswer === "number" ||
    typeof selectedAnswer === "boolean" ||
    (Array.isArray(selectedAnswer) &&
      selectedAnswer.every((item) => typeof item === "number"));
  if (
    typeof response.checkId !== "string" ||
    typeof response.blockIndex !== "number" ||
    typeof response.itemIndex !== "number" ||
    !selectedValid ||
    typeof response.correct !== "boolean" ||
    typeof response.explanation !== "string" ||
    !attempt.submittedAt
  ) {
    return null;
  }
  return {
    checkId: response.checkId,
    blockIndex: response.blockIndex,
    itemIndex: response.itemIndex,
    selectedAnswer: selectedAnswer as number | number[] | boolean,
    correct: response.correct,
    ...(typeof response.outcome === "string"
      ? { outcome: response.outcome as MaterialCheckResult["outcome"] }
      : {}),
    ...(typeof response.score === "number" ? { score: response.score } : {}),
    explanation: response.explanation,
    submittedAt: attempt.submittedAt.toISOString(),
    firstSubmission: false,
  };
}

export async function listMaterialCheckResults(params: {
  persistence?: PersistenceClient;
  userId: string;
  unitId: string;
  checkIds?: readonly string[];
  attempts?: readonly Readonly<{ response: unknown; submittedAt: Date | null }>[];
  materialCheckCompletion?: MaterialCheckCompletionRepository;
}): Promise<MaterialCheckResult[]> {
  if (params.checkIds?.length === 0) return [];
  const rows = params.attempts ?? (params.materialCheckCompletion
    ? await params.materialCheckCompletion.listAttempts({
        userId: params.userId,
        unitId: params.unitId,
        checkIds: params.checkIds,
      })
    : await params.persistence!.taskAttempt.findMany({
    where: {
      userId: params.userId,
      unitId: params.unitId,
      status: "evaluated",
      task: {
        origin: "material_check",
        status: "active",
        ...(params.checkIds
          ? {
              OR: params.checkIds.flatMap((checkId) => {
                const base = materialCheckStableKey(checkId);
                return [
                  { stableKey: base },
                  { stableKey: { startsWith: `${base}:v` } },
                ];
              }),
            }
          : {}),
      },
    },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    select: { response: true, submittedAt: true },
      }));
  return rows.flatMap((row) => {
    const result = materialCheckResultFromAttempt(row);
    return result ? [result] : [];
  });
}

export async function submitSectionMiniTestAnswers(params: {
  persistence?: PersistenceClient;
  userId: string;
  goalId: string;
  unitId: string;
  sectionId?: string;
  expectedUnitRevision?:number;
  expectedSectionRevision?:number;
  definitions: PublishedMaterialCheckDefinition[];
  answers: Record<string, number | number[] | boolean>;
  material: { blocks: readonly unknown[] };
  targets?: readonly UnitAssessmentTarget[];
  materialCheckCompletion?: MaterialCheckCompletionRepository;
}): Promise<{ score: number; results: MaterialCheckResult[] }> {
  const definitions = params.definitions;
  if (definitions.length === 0) {
    throw new Error("本节测验尚无题目");
  }
  for (const definition of definitions) {
    if (!(definition.checkId in params.answers)) {
      throw new Error("请先答完本节全部题目");
    }
  }
  if (params.materialCheckCompletion) {
    const declarations = await buildMaterialCheckTaskDeclarations({
      persistence: params.persistence,
      userId: params.userId,
      goalId: params.goalId,
      unitId: params.unitId,
      material: params.material,
      targets: params.targets,
    });
    const declarationByKey = new Map(
      declarations.map((declaration) => [declaration.stableKey, declaration]),
    );
    const completions = definitions.map((definition) => {
      const declaration = declarationByKey.get(
        materialCheckStableKey(definition.checkId),
      );
      if (!declaration) {
        throw new Error(
          `Published task for material check ${definition.checkId} is unavailable`,
        );
      }
      return materialCheckCompletionItem({
        definition,
        selectedAnswer: params.answers[definition.checkId]!,
        stableKey: declaration.stableKey,
        userId: params.userId,
        unitId: params.unitId,
        definitionVersion: declaration.definitionVersion,
      });
    });
    const completedAt = new Date();
    const completion = await params.materialCheckCompletion.complete({
      expectedUnitRevision:params.expectedUnitRevision,
      expectedSection:params.expectedSectionRevision!==undefined&&params.sectionId?{id:params.sectionId.replace(/^mini-test:/,""),revision:params.expectedSectionRevision}:undefined,
      userId: params.userId,
      goalId: params.goalId,
      unitId: params.unitId,
      tasks: declarations,
      completions: completions.map((item) => ({
        ...item,
        submittedAt: completedAt,
        completedAt,
      })),
      domainEvent: {
        type: "assessment.section_mini_test_completed",
        idempotencyKey: `assessment:section-mini-test:${params.userId}:${params.unitId}:${params.sectionId ?? definitions.map((definition) => definition.checkId).join(",")}`,
        payload: {
          unitId: params.unitId,
          sectionId: params.sectionId ?? null,
          checkIds: definitions.map((definition) => definition.checkId),
        },
      },
    });
    const results = completion.items.map((item) => {
      const result = materialCheckResultFromAttempt(item.attempt);
      if (!result)
        throw new Error("Material check attempt response is invalid");
      return { ...result, firstSubmission: !item.replayed };
    });
    const points = results.reduce(
      (sum, result) =>
        sum +
        (typeof result.score === "number"
          ? result.score
          : result.correct
            ? 1
            : 0),
      0,
    );
    if(results.some(r=>r.firstSubmission)) await recordLearningFeedback({
      userId:params.userId,unitId:params.unitId,eventId:`mini-test:${params.sectionId??params.unitId}:${results.map(r=>r.checkId+":"+r.submittedAt).join("|")}`,kind:'check',
      position:{version:1,unitId:params.unitId,sectionId:params.sectionId,mode:'reading'},
      evidence:{correct:results.every(r=>r.correct),question:definitions.map(d=>d.question).join("\n"),answer:JSON.stringify(results.map(r=>({checkId:r.checkId,answer:r.selectedAnswer,correct:r.correct}))),sourceId:params.sectionId??params.unitId}
    }).catch(()=>undefined);
    return {
      score: results.length > 0 ? points / results.length : 0,
      results,
    };
  }
  return params.persistence!.$transaction(async (tx) => {
    const client = tx as unknown as PersistenceClient;
    await publishMaterialCheckTasks({
      persistence: client,
      userId: params.userId,
      goalId: params.goalId,
      unitId: params.unitId,
      material: params.material,
    });
    const results: MaterialCheckResult[] = [];
    let points = 0;
    for (const definition of definitions) {
      const selectedAnswer = params.answers[definition.checkId]!;
      const result = await submitPublishedMaterialCheck({
        persistence: client,
        userId: params.userId,
        goalId: params.goalId,
        unitId: params.unitId,
        definition,
        selectedAnswer,
      });
      results.push(result);
      points +=
        typeof result.score === "number"
          ? result.score
          : result.correct
            ? 1
            : 0;
    }
    return {
      score: definitions.length > 0 ? points / definitions.length : 0,
      results,
    };
  });
}

export async function submitPublishedMaterialCheck(params: {
  persistence?: PersistenceClient;
  userId: string;
  goalId: string;
  unitId: string;
  definition: PublishedMaterialCheckDefinition;
  selectedAnswer: number | number[] | boolean;
  material?: { blocks: readonly unknown[] };
  targets?: readonly UnitAssessmentTarget[];
  materialCheckCompletion?: MaterialCheckCompletionRepository;
}): Promise<MaterialCheckResult> {
  if (params.materialCheckCompletion && params.material) {
    const declarations = await buildMaterialCheckTaskDeclarations({
      persistence: params.persistence,
      userId: params.userId,
      goalId: params.goalId,
      unitId: params.unitId,
      material: params.material,
      targets: params.targets,
    });
    const declaration = declarations.find(
      (candidate) =>
        candidate.stableKey ===
        materialCheckStableKey(params.definition.checkId),
    );
    if (!declaration) {
      throw new Error(
        `Published task for material check ${params.definition.checkId} is unavailable`,
      );
    }
    const completedAt = new Date();
    const completion = await params.materialCheckCompletion.complete({
      userId: params.userId,
      goalId: params.goalId,
      unitId: params.unitId,
      tasks: declarations,
      completions: [
        {
          ...materialCheckCompletionItem({
            definition: params.definition,
            selectedAnswer: params.selectedAnswer,
            stableKey: declaration.stableKey,
            userId: params.userId,
            unitId: params.unitId,
            definitionVersion: declaration.definitionVersion,
          }),
          submittedAt: completedAt,
          completedAt,
        },
      ],
      domainEvent: {
        type: "assessment.material_check_completed",
        idempotencyKey: `assessment:material-check:${params.userId}:${params.unitId}:${params.definition.checkId}:completed`,
        payload: {
          unitId: params.unitId,
          checkId: params.definition.checkId,
        },
      },
    });
    const item = completion.items[0]!;
    const result = materialCheckResultFromAttempt(item.attempt);
    if (!result) throw new Error("Material check attempt response is invalid");
    if(!item.replayed) await recordLearningFeedback({userId:params.userId,unitId:params.unitId,eventId:`material-check:${params.definition.checkId}:${result.submittedAt}`,kind:'check',evidence:{correct:result.correct,question:params.definition.question,answer:JSON.stringify(result.selectedAnswer),sourceId:params.definition.checkId}}).catch(()=>undefined);
    return { ...result, firstSubmission: !item.replayed };
  }
  const task = await params.persistence!.learningTask.findFirst({
    where: {
      goalId: params.goalId,
      unitId: params.unitId,
      origin: "material_check",
      status: "active",
      ...materialCheckStableKeyWhere(params.definition.checkId),
    },
    orderBy: [{ definitionVersion: "desc" }, { createdAt: "desc" }],
    include: { requirements: true },
  });
  if (
    !task ||
    task.unitId !== params.unitId ||
    task.origin !== "material_check" ||
    task.status !== "active" ||
    task.requirements.length !== 1
  ) {
    throw new Error(
      `Published task for material check ${params.definition.checkId} is unavailable`,
    );
  }
  const taskContext = isRecord(task.context) ? task.context : {};
  if (
    taskContext.checkId !== params.definition.checkId ||
    taskContext.primaryLearningTargetId !==
      params.definition.primaryLearningTargetId ||
    taskContext.targetCognitiveEntityId !==
      task.requirements[0]!.cognitiveEntityId
  ) {
    throw new Error(
      `Published task for material check ${params.definition.checkId} does not match current material`,
    );
  }
  const graded = gradeMaterialCheckAnswer(
    params.definition,
    params.selectedAnswer,
  );
  const response = {
    checkId: params.definition.checkId,
    blockIndex: params.definition.blockIndex,
    itemIndex: params.definition.itemIndex,
    selectedAnswer: params.selectedAnswer,
    correct: graded.correct,
    outcome: graded.outcome,
    score: graded.score,
    explanation: params.definition.explanation,
    assessmentFormat: params.definition.assessmentFormat,
  };
  const now = new Date();
  const { attempt, replayed } = await startTaskAttempt(params.persistence!, {
    taskId: task.id,
    userId: params.userId,
    unitId: params.unitId,
    idempotencyKey: materialCheckAttemptKey({
      userId: params.userId,
      unitId: params.unitId,
      checkId: params.definition.checkId,
      definitionVersion: task.definitionVersion,
    }),
    response,
    assistance: { level: "independent", hintCount: 0, answerRevealed: false },
    status: "evaluated",
    submittedAt: now,
    completedAt: now,
  });
  if (!replayed) {
    await recordTaskObservationCandidate(params.persistence!, {
      userId: params.userId,
      attemptId: attempt.id,
      candidate: {
        requirementId: task.requirements[0]!.id,
        score: graded.score,
        outcome: graded.outcome,
        evaluatorRunId: `material-check:${params.definition.checkId}:v${task.definitionVersion}`,
      },
      evaluator: {
        evaluatorType: "deterministic",
        evaluatorReliability: 1,
        groundingReliability: 1,
        evidenceStrength:
          params.definition.questionType === "true_false" ? "weak" : "moderate",
      },
    });
  }
  const result = materialCheckResultFromAttempt(attempt);
  if (!result) throw new Error("Material check attempt response is invalid");
  return { ...result, firstSubmission: !replayed };
}

export function evidenceSourceForQuizPurpose(
  purpose: "learning" | "review",
): Extract<EvidenceSource, "quiz" | "review_quiz"> {
  return purpose === "review" ? "review_quiz" : "quiz";
}
