import type { LearningTargetCognitiveAssessment } from "../assessment/activities.js";

export type QuizAssessmentFormat = "mcq" | "mcq_multi" | "true_false";

export type QuizBatchSlot = {
  slotIndex: number;
  questionType: QuizAssessmentFormat;
  primaryLearningTargetId: string;
  primaryCognitiveEntityId: string;
  evidenceDimension: "memory" | "understanding";
  criterionRef: string;
  contextDistance: "same" | "near" | "far";
  targetLabel?: string;
};

export type QuizBatchPlan = {
  batchSize: number;
  slots: QuizBatchSlot[];
};

export type QuizBatchPlannerInput = {
  targets: readonly {
    id: string;
    localRef: string;
    title?: string;
    label?: string;
    required: boolean;
    importance?: "core" | "supporting" | "enrichment";
    assessmentCriteria: readonly { ref: string; text: string }[];
    requirements: readonly {
      cognitiveEntityId: string;
      dimension: string;
      required?: boolean;
    }[];
  }[];
  priorQuestions?: readonly {
    type: string;
    question: string;
    primaryLearningTargetId?: string;
    learningTargetIds?: string[];
    evidenceDimension?: string;
    primaryCognitiveEntityId?: string;
    contextDistance?: string;
  }[];
  observations?: readonly {
    cognitiveEntityId: string;
    dimension: string;
    status?:
      | "unobserved"
      | "forming"
      | "demonstrated"
      | "robust"
      | "revalidate";
    evidenceSufficiency?: number;
    lastOutcome?: "correct" | "partial" | "incorrect";
  }[];
  desiredBatchSize?: number;
};

export type RecallProgress = {
  completedBatches: number;
  totalAnswers: number;
  recommendation: "continue_now" | "review_later";
  targets: Array<{
    learningTargetId: string;
    localRef: string;
    title: string;
    evidenceSufficiency: number;
    cognitiveStatus?: string;
  }>;
};

type PlannerTarget = QuizBatchPlannerInput["targets"][number];

type CandidateSlot = {
  target: PlannerTarget;
  localRef: string;
  cognitiveEntityId: string;
  dimension: "memory" | "understanding";
  criterionRef: string;
  priority: number;
  entityDimKey: string;
  targetEntityKey: string;
};

const BATCH_MIN = 3;
const BATCH_MAX = 5;
const BATCH_DEFAULT = 4;

function clampBatchSize(desired?: number): number {
  if (desired == null || !Number.isFinite(desired)) return BATCH_DEFAULT;
  return Math.min(BATCH_MAX, Math.max(BATCH_MIN, Math.round(desired)));
}

function normalizeLocalRef(localRef: string): string {
  return localRef.trim().toLowerCase();
}

function entityDimKey(entityId: string, dimension: string): string {
  return `${entityId}:${dimension}`;
}

function pickCriterionRef(target: PlannerTarget): string | null {
  const criterion = target.assessmentCriteria[0];
  if (!criterion?.ref?.trim()) return null;
  return criterion.ref.trim();
}

function observationMap(
  observations: QuizBatchPlannerInput["observations"],
): Map<string, NonNullable<QuizBatchPlannerInput["observations"]>[number]> {
  const map = new Map<
    string,
    NonNullable<QuizBatchPlannerInput["observations"]>[number]
  >();
  for (const observation of observations ?? []) {
    map.set(
      entityDimKey(observation.cognitiveEntityId, observation.dimension),
      observation,
    );
  }
  return map;
}

function candidatePriority(
  target: PlannerTarget,
  requirement: PlannerTarget["requirements"][number],
  observation: ReturnType<typeof observationMap> extends Map<string, infer V>
    ? V | undefined
    : never,
): number {
  const required = requirement.required === true || target.required === true;
  const importance = target.importance ?? "supporting";
  const status = observation?.status;
  const evidenceSufficiency = observation?.evidenceSufficiency;

  if (required && status === "unobserved") return 0;
  if (observation?.lastOutcome === "incorrect") return 1;
  if (status === "revalidate") return 2;
  if (
    importance === "core" &&
    evidenceSufficiency != null &&
    evidenceSufficiency < 1
  ) {
    return 3;
  }
  if (required) return 4;
  if (importance === "supporting") return 5;
  return 6;
}

function buildCandidates(input: QuizBatchPlannerInput): CandidateSlot[] {
  const observations = observationMap(input.observations);
  const candidates: CandidateSlot[] = [];

  for (const target of input.targets) {
    const criterionRef = pickCriterionRef(target);
    if (!criterionRef) continue;
    const localRef = normalizeLocalRef(target.localRef);

    for (const requirement of target.requirements) {
      if (
        requirement.dimension !== "memory" &&
        requirement.dimension !== "understanding"
      ) {
        continue;
      }
      const key = entityDimKey(
        requirement.cognitiveEntityId,
        requirement.dimension,
      );
      candidates.push({
        target,
        localRef,
        cognitiveEntityId: requirement.cognitiveEntityId,
        dimension: requirement.dimension,
        criterionRef,
        priority: candidatePriority(target, requirement, observations.get(key)),
        entityDimKey: key,
        targetEntityKey: `${localRef}:${requirement.cognitiveEntityId}`,
      });
    }
  }

  return candidates.sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    if (left.localRef !== right.localRef) {
      return left.localRef.localeCompare(right.localRef);
    }
    return left.entityDimKey.localeCompare(right.entityDimKey);
  });
}

function allocateQuestionTypes(batchSize: number): QuizAssessmentFormat[] {
  const mcqCount = Math.round(batchSize * 0.5);
  const trueFalseCount = Math.min(1, Math.round(batchSize * 0.25));
  const multiCount = Math.max(0, batchSize - mcqCount - trueFalseCount);
  const types: QuizAssessmentFormat[] = [
    ...Array.from({ length: mcqCount }, () => "mcq" as const),
    ...Array.from({ length: multiCount }, () => "mcq_multi" as const),
    ...Array.from({ length: trueFalseCount }, () => "true_false" as const),
  ];
  while (types.length < batchSize) types.push("mcq");
  while (types.length > batchSize) types.pop();
  return types;
}

function lastPriorTrueFalseEntityDim(
  priorQuestions: QuizBatchPlannerInput["priorQuestions"],
): string | null {
  const prior = priorQuestions ?? [];
  for (let index = prior.length - 1; index >= 0; index -= 1) {
    const question = prior[index];
    if (question?.type !== "true_false") continue;
    if (question.primaryCognitiveEntityId && question.evidenceDimension) {
      return entityDimKey(
        question.primaryCognitiveEntityId,
        question.evidenceDimension,
      );
    }
  }
  return null;
}

function canAssignTrueFalse(
  candidate: CandidateSlot,
  lastTrueFalseEntityDim: string | null,
): boolean {
  if (!lastTrueFalseEntityDim) return true;
  return candidate.entityDimKey !== lastTrueFalseEntityDim;
}

function assignContextDistances(
  batchSize: number,
): Array<"same" | "near" | "far"> {
  const distances: Array<"same" | "near" | "far"> = [];
  const cycle: Array<"near" | "far"> = ["near", "far"];
  for (let index = 0; index < batchSize; index += 1) {
    if (index === 0) {
      distances.push("same");
      continue;
    }
    distances.push(cycle[(index - 1) % cycle.length]!);
  }
  return distances;
}

function selectCandidates(
  candidates: CandidateSlot[],
  batchSize: number,
  priorQuestions: QuizBatchPlannerInput["priorQuestions"],
): CandidateSlot[] {
  const selected: CandidateSlot[] = [];
  const usedEntityDims = new Set<string>();
  const usedTargetEntities = new Set<string>();
  let lastTrueFalseEntityDim = lastPriorTrueFalseEntityDim(priorQuestions);

  const pickNext = (
    questionType: QuizAssessmentFormat,
    allowRepeat: boolean,
  ): CandidateSlot | null => {
    for (const candidate of candidates) {
      if (
        selected.some((slot) => slot.entityDimKey === candidate.entityDimKey)
      ) {
        continue;
      }
      if (
        questionType === "true_false" &&
        !canAssignTrueFalse(candidate, lastTrueFalseEntityDim)
      ) {
        continue;
      }
      if (
        !allowRepeat &&
        (usedEntityDims.has(candidate.entityDimKey) ||
          usedTargetEntities.has(candidate.targetEntityKey))
      ) {
        continue;
      }
      return candidate;
    }
    return null;
  };

  const questionTypes = allocateQuestionTypes(batchSize);
  for (const questionType of questionTypes) {
    let candidate =
      pickNext(questionType, false) ?? pickNext(questionType, true);
    if (!candidate) {
      candidate =
        candidates.find(
          (entry) =>
            !selected.some((slot) => slot.entityDimKey === entry.entityDimKey),
        ) ?? null;
    }
    if (!candidate) break;
    selected.push(candidate);
    usedEntityDims.add(candidate.entityDimKey);
    usedTargetEntities.add(candidate.targetEntityKey);
    if (questionType === "true_false") {
      lastTrueFalseEntityDim = candidate.entityDimKey;
    }
  }

  return selected;
}

export function assessmentFormatEvidenceStrength(
  format: QuizAssessmentFormat,
): "weak" | "moderate" {
  return format === "true_false" ? "weak" : "moderate";
}

export function planQuizBatch(input: QuizBatchPlannerInput): QuizBatchPlan {
  const candidates = buildCandidates(input);
  const requestedSize = clampBatchSize(input.desiredBatchSize);
  const batchSize =
    candidates.length === 0
      ? 0
      : Math.max(1, Math.min(requestedSize, candidates.length));
  const selected = selectCandidates(
    candidates,
    batchSize,
    input.priorQuestions,
  );
  const contextDistances = assignContextDistances(selected.length);
  const questionTypes = allocateQuestionTypes(selected.length);

  const slots: QuizBatchSlot[] = selected.map((candidate, index) => ({
    slotIndex: index,
    questionType: questionTypes[index] ?? "mcq",
    primaryLearningTargetId: candidate.localRef,
    primaryCognitiveEntityId: candidate.cognitiveEntityId,
    evidenceDimension: candidate.dimension,
    criterionRef: candidate.criterionRef,
    contextDistance: contextDistances[index] ?? "same",
    targetLabel: candidate.target.title ?? candidate.target.label,
  }));

  return { batchSize: slots.length, slots };
}

export function buildRecallProgress(params: {
  targets: readonly {
    id: string;
    localRef: string;
    title: string;
    required: boolean;
  }[];
  assessments: readonly LearningTargetCognitiveAssessment[];
  completedBatches: number;
  totalAnswers: number;
}): RecallProgress {
  const assessmentByTargetId = new Map(
    params.assessments.map((assessment) => [
      assessment.learningTargetId,
      assessment,
    ]),
  );

  const targets = params.targets.map((target) => {
    const assessment = assessmentByTargetId.get(target.id);
    return {
      learningTargetId: target.id,
      localRef: target.localRef,
      title: target.title,
      evidenceSufficiency: assessment?.evidenceSufficiency ?? 0,
      cognitiveStatus: assessment?.status,
    };
  });

  const requiredTargets = params.targets.filter((target) => target.required);
  const recommendation = requiredTargets.some((target) => {
    const assessment = assessmentByTargetId.get(target.id);
    if (!assessment) return true;
    if (
      assessment.status === "unobserved" ||
      assessment.status === "revalidate"
    ) {
      return true;
    }
    if (assessment.evidenceSufficiency < 1) return true;
    return assessment.failures.some(
      (failure) =>
        failure.reason === "unobserved" ||
        failure.reason === "revalidate" ||
        failure.reason === "insufficient_evidence",
    );
  })
    ? "continue_now"
    : "review_later";

  return {
    completedBatches: params.completedBatches,
    totalAnswers: params.totalAnswers,
    recommendation,
    targets,
  };
}

/**
 * Force server-owned batch bindings onto LLM-authored question content.
 * Stems/options/answers come from the model; type/target/entity/dim/criterion/distance do not.
 */
export function applyQuizBatchSlots<
  T extends {
    type: QuizAssessmentFormat;
    question: string;
    options?: string[];
    correctIndex?: number;
    correctIndices?: number[];
    correctAnswer?: boolean;
    primaryLearningTargetId?: string;
    learningTargetIds?: string[];
    primaryCognitiveEntityId?: string;
    evidenceDimension?: "memory" | "understanding";
    criterionRef?: string;
    contextDistance?: "same" | "near" | "far";
  },
>(questions: readonly T[], plan: QuizBatchPlan): T[] {
  if (plan.slots.length === 0) return [...questions];
  // Streaming publishes valid prefixes before the complete question array is
  // available. Bind only authored questions here; the final schema separately
  // enforces the authoritative question count.
  return questions.map((generated, index) => {
    const slot = plan.slots[index];
    if (!slot) return generated;
    const base = {
      question: generated.question,
      primaryLearningTargetId: slot.primaryLearningTargetId,
      learningTargetIds: [slot.primaryLearningTargetId],
      primaryCognitiveEntityId: slot.primaryCognitiveEntityId,
      evidenceDimension: slot.evidenceDimension,
      criterionRef: slot.criterionRef,
      contextDistance: slot.contextDistance,
    };
    if (slot.questionType === "true_false") {
      const correctAnswer =
        generated.type === "true_false" &&
        typeof generated.correctAnswer === "boolean"
          ? generated.correctAnswer
          : Boolean(generated.correctAnswer);
      return {
        ...generated,
        ...base,
        type: "true_false",
        correctAnswer,
      } as T;
    }
    if (slot.questionType === "mcq_multi") {
      const options =
        Array.isArray(generated.options) && generated.options.length >= 3
          ? generated.options
          : ["选项 A", "选项 B", "选项 C"];
      const correctIndices =
        generated.type === "mcq_multi" &&
        Array.isArray(generated.correctIndices) &&
        generated.correctIndices.length >= 2
          ? generated.correctIndices
          : [0, 1];
      return {
        ...generated,
        ...base,
        type: "mcq_multi",
        options,
        correctIndices,
      } as T;
    }
    const options =
      Array.isArray(generated.options) && generated.options.length >= 2
        ? generated.options
        : ["选项 A", "选项 B"];
    const correctIndex =
      generated.type === "mcq" && typeof generated.correctIndex === "number"
        ? generated.correctIndex
        : 0;
    return {
      ...generated,
      ...base,
      type: "mcq",
      options,
      correctIndex,
    } as T;
  });
}

export function observationHintsFromAssessments(
  targets: QuizBatchPlannerInput["targets"],
  assessments: readonly LearningTargetCognitiveAssessment[],
): NonNullable<QuizBatchPlannerInput["observations"]> {
  const assessmentByTargetId = new Map(
    assessments.map((assessment) => [assessment.learningTargetId, assessment]),
  );
  const hints: Array<
    NonNullable<QuizBatchPlannerInput["observations"]>[number]
  > = [];
  const seen = new Set<string>();

  for (const target of targets) {
    const assessment = assessmentByTargetId.get(target.id);
    for (const requirement of target.requirements) {
      if (
        requirement.dimension !== "memory" &&
        requirement.dimension !== "understanding"
      ) {
        continue;
      }
      const key = entityDimKey(
        requirement.cognitiveEntityId,
        requirement.dimension,
      );
      if (seen.has(key)) continue;
      seen.add(key);

      const failure = assessment?.failures.find(
        (entry) =>
          entry.cognitiveEntityId === requirement.cognitiveEntityId &&
          entry.dimension === requirement.dimension,
      );
      hints.push({
        cognitiveEntityId: requirement.cognitiveEntityId,
        dimension: requirement.dimension,
        status:
          failure?.reason === "unobserved"
            ? "unobserved"
            : failure?.reason === "revalidate"
              ? "revalidate"
              : assessment?.status,
        evidenceSufficiency: assessment?.evidenceSufficiency,
      });
    }
  }

  return hints;
}
