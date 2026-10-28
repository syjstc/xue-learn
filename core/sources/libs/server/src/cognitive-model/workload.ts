export type LearningTargetImportance = "core" | "supporting" | "enrichment";
export type LearningTargetDifficulty = "easy" | "medium" | "hard";
export type LearningTargetCognitiveLevel =
  | "remember"
  | "understand"
  | "apply"
  | "analyze"
  | "evaluate"
  | "create";

export type LearningTargetWorkloadInput = {
  importance?: LearningTargetImportance;
  importanceWeight?: number;
  difficulty?: LearningTargetDifficulty;
  targetCognitiveLevel?: LearningTargetCognitiveLevel;
};

export type LearningTargetWorkload = {
  teachingMinutes: number;
  summativeQuestions: number;
  flashcards: { min: number; max: number };
  threshold: number;
  blocksCompletion: boolean;
};

const HIGH_COGNITIVE_LEVELS = new Set<LearningTargetCognitiveLevel>([
  "analyze",
  "evaluate",
  "create",
]);

/** One deterministic KACOM policy used by content, assessment, and review generation. */
export function learningTargetWorkload(
  target: LearningTargetWorkloadInput,
): LearningTargetWorkload {
  const importance = target.importance ?? "core";
  const difficulty = target.difficulty ?? "medium";
  const targetCognitiveLevel = target.targetCognitiveLevel ?? "understand";
  const intensive =
    importance === "core" &&
    (difficulty === "hard" || HIGH_COGNITIVE_LEVELS.has(targetCognitiveLevel));

  if (importance === "enrichment") {
    return {
      teachingMinutes: 1,
      summativeQuestions: 0,
      flashcards: { min: 0, max: 1 },
      threshold: 0.7,
      blocksCompletion: false,
    };
  }
  if (importance === "supporting") {
    return {
      teachingMinutes: 2,
      summativeQuestions: 1,
      flashcards: { min: 1, max: 1 },
      threshold: 0.7,
      blocksCompletion: false,
    };
  }
  return intensive
    ? {
        teachingMinutes: 6,
        summativeQuestions: 3,
        flashcards: { min: 2, max: 3 },
        threshold: 0.8,
        blocksCompletion: true,
      }
    : {
        teachingMinutes: 4,
        summativeQuestions: 2,
        flashcards: { min: 2, max: 2 },
        threshold: 0.75,
        blocksCompletion: true,
      };
}

export type UnitWorkloadPlan = {
  teachingMinutes: number;
  summativeQuestions: number;
  flashcards: { min: number; max: number };
  overloaded: boolean;
  overloadReasons: Array<"teaching_time" | "assessment_volume">;
  perTarget: LearningTargetWorkload[];
};

export function planUnitTargetWorkload(
  points: LearningTargetWorkloadInput[],
): UnitWorkloadPlan {
  const workloads = points.map(learningTargetWorkload);
  const teachingMinutes = workloads.reduce(
    (sum, item) => sum + item.teachingMinutes,
    0,
  );
  const summativeQuestions = workloads.reduce(
    (sum, item) => sum + item.summativeQuestions,
    0,
  );
  const flashcards = workloads.reduce(
    (total, item) => ({
      min: total.min + item.flashcards.min,
      max: total.max + item.flashcards.max,
    }),
    { min: 0, max: 0 },
  );
  const overloadReasons: UnitWorkloadPlan["overloadReasons"] = [];
  if (summativeQuestions > 18) overloadReasons.push("assessment_volume");
  return {
    teachingMinutes,
    summativeQuestions,
    flashcards,
    overloaded: overloadReasons.length > 0,
    overloadReasons,
    perTarget: workloads,
  };
}

/** Semantic alias used by graph/content orchestration. */
export const calculateLearningTargetCoverage = planUnitTargetWorkload;

export function isLearningTargetReady(
  target: LearningTargetWorkloadInput & {
    estimate?: number | null;
    evidenceSufficiency?: number | null;
    status?:
      | "unobserved"
      | "forming"
      | "demonstrated"
      | "robust"
      | "revalidate";
  },
): boolean {
  const workload = learningTargetWorkload(target);
  return (
    (target.status === "demonstrated" || target.status === "robust") &&
    target.estimate != null &&
    target.estimate >= workload.threshold &&
    (target.evidenceSufficiency ?? 0) >= 0.5
  );
}
