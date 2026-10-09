import { isUnitLearningDone } from "../../../domain/src/index.js";
import type { QuizGradeItem } from "../graph/grade-quiz.js";
import type { QuizQuestion } from "../llm/schemas.js";
import type { ObjectiveQuizAnswer } from "../unit-session/quiz-grading.js";
import {
  isCriticalLearningTarget,
  learningTargetSummativeQuestionCount,
  scoreQuizByLearningTarget,
  selectQuizAssessableDiagnosticTargets,
  validateQuizTaskEvidenceDeclaration,
  type LearningTargetCognitiveAssessment,
  type PerLearningTargetPerformance,
  type UnitAssessmentTarget,
} from "./activities.js";

export type UnitDiagnosticIneligibilityReason =
  | "micro_goal"
  | "exploration_goal"
  | "module_unit"
  | "has_children"
  | "already_completed";

export type UnitDiagnosticEligibility =
  | { eligible: true; reason: null }
  | { eligible: false; reason: UnitDiagnosticIneligibilityReason };

/**
 * Persistence-independent test-out eligibility policy.
 *
 * Ownership, existence, and cognitive-model readiness remain adapter concerns;
 * this policy decides only whether the owned unit kind and lifecycle may be
 * tested out.
 */
export function evaluateUnitDiagnosticEligibility(input: {
  goalKind: string;
  learningMode: string;
  unitKind: string;
  childCount: number;
  unitStatus: string;
}): UnitDiagnosticEligibility {
  if (input.goalKind === "micro") {
    return { eligible: false, reason: "micro_goal" };
  }
  if (input.learningMode === "exploration") {
    return { eligible: false, reason: "exploration_goal" };
  }
  if (input.unitKind === "module") {
    return { eligible: false, reason: "module_unit" };
  }
  if (input.childCount > 0) {
    return { eligible: false, reason: "has_children" };
  }
  if (isUnitLearningDone(input.unitStatus)) {
    return { eligible: false, reason: "already_completed" };
  }
  return { eligible: true, reason: null };
}

export type UnitDiagnosticGenerationPlan =
  | {
      ready: true;
      criticalTargets: UnitAssessmentTarget[];
      selectedTargets: UnitAssessmentTarget[];
      questionCount: number;
    }
  | {
      ready: false;
      reason: "no_critical_targets" | "no_quiz_assessable_targets";
    };

/** Selects only unresolved, closed-book-assessable critical targets. */
export function planUnitDiagnosticGeneration(input: {
  targets: readonly UnitAssessmentTarget[];
  priorAssessments: readonly LearningTargetCognitiveAssessment[];
}): UnitDiagnosticGenerationPlan {
  const criticalTargets = input.targets.filter(isCriticalLearningTarget);
  if (criticalTargets.length === 0) {
    return { ready: false, reason: "no_critical_targets" };
  }
  const selectedTargets = selectQuizAssessableDiagnosticTargets(
    criticalTargets,
    input.priorAssessments,
  );
  if (selectedTargets.length === 0) {
    return { ready: false, reason: "no_quiz_assessable_targets" };
  }
  return {
    ready: true,
    criticalTargets,
    selectedTargets,
    questionCount: selectedTargets.reduce(
      (sum, target) => sum + learningTargetSummativeQuestionCount(target),
      0,
    ),
  };
}

export type UnitDiagnosticTargetResult = Readonly<{
  learningTargetId: string;
  localRef: string;
  title: string;
  score: number;
  correctCount: number;
  partialCount: number;
  incorrectCount: number;
  questionCount: number;
  required: true;
  passed: boolean;
  cognitiveStatus: LearningTargetCognitiveAssessment["status"];
  cognitiveEstimate: number | null;
  evidenceSufficiency: number;
  failures: LearningTargetCognitiveAssessment["failures"];
}>;

export type UnitDiagnosticDecision = Readonly<{
  overallScore: number;
  passed: boolean;
  perLearningTarget: readonly UnitDiagnosticTargetResult[];
}>;

export function decideUnitDiagnosticSubmission(input: {
  overallScore: number;
  criticalTargets: readonly UnitAssessmentTarget[];
  performance: readonly PerLearningTargetPerformance[];
  cognitiveAssessments: readonly LearningTargetCognitiveAssessment[];
}): UnitDiagnosticDecision {
  const performanceByTarget = new Map(
    input.performance.map((row) => [row.learningTargetId, row]),
  );
  const cognitiveByTarget = new Map(
    input.cognitiveAssessments.map((row) => [row.learningTargetId, row]),
  );
  const perLearningTarget = input.criticalTargets.map((target) => {
    const taskPerformance = performanceByTarget.get(target.id);
    const cognitive = cognitiveByTarget.get(target.id);
    return {
      learningTargetId: target.id,
      localRef: target.localRef,
      title: target.title,
      score: taskPerformance?.score ?? 0,
      correctCount: taskPerformance?.correctCount ?? 0,
      partialCount: taskPerformance?.partialCount ?? 0,
      incorrectCount: taskPerformance?.incorrectCount ?? 0,
      questionCount: taskPerformance?.questionCount ?? 0,
      required: true as const,
      passed: cognitive?.passed ?? false,
      cognitiveStatus: cognitive?.status ?? ("unobserved" as const),
      cognitiveEstimate: cognitive?.estimate ?? null,
      evidenceSufficiency: cognitive?.evidenceSufficiency ?? 0,
      failures:
        cognitive?.failures ??
        target.requirements
          .filter((requirement) => requirement.required || requirement.gate)
          .map((requirement) => ({
            cognitiveEntityId: requirement.cognitiveEntityId,
            dimension: requirement.dimension,
            reason: "unobserved" as const,
          })),
    } satisfies UnitDiagnosticTargetResult;
  });
  return {
    overallScore: input.overallScore,
    passed:
      input.overallScore >= 0.85 &&
      perLearningTarget.every((row) => row.passed),
    perLearningTarget,
  };
}

export type UnitDiagnosticEvidenceWrite = Readonly<{
  questions: readonly QuizQuestion[];
  results: readonly QuizGradeItem[];
  answers: Readonly<Record<string, ObjectiveQuizAnswer>>;
  targets: readonly UnitAssessmentTarget[];
}>;

/**
 * The adapter must stage evidence immutably and atomically in
 * `recordEvidence`, then return state derived from that same transaction.
 * Learner input never supplies scores, bindings, strength, or evaluator facts.
 */
export type UnitDiagnosticEvidencePort = Readonly<{
  recordEvidence(input: UnitDiagnosticEvidenceWrite): Promise<void>;
  assessTargets(
    targets: readonly UnitAssessmentTarget[],
  ): Promise<readonly LearningTargetCognitiveAssessment[]>;
}>;

/**
 * Portable deterministic submit seam. The caller supplies grades produced by
 * the server-owned objective grader; this function validates all immutable
 * question bindings before invoking the evidence port.
 */
export async function evaluateUnitDiagnosticSubmission(
  input: Readonly<{
    overallScore: number;
    questions: readonly QuizQuestion[];
    results: readonly QuizGradeItem[];
    answers: Readonly<Record<string, ObjectiveQuizAnswer>>;
    targets: readonly UnitAssessmentTarget[];
  }>,
  evidence: UnitDiagnosticEvidencePort,
): Promise<UnitDiagnosticDecision> {
  const criticalTargets = input.targets.filter(isCriticalLearningTarget);
  if (criticalTargets.length === 0) {
    throw new Error("Unit diagnostic requires at least one critical target");
  }
  const performance = scoreQuizByLearningTarget({
    questions: input.questions,
    results: input.results,
    targets: input.targets,
  }).perLearningTarget;
  const declaration = {
    source: "diagnostic" as const,
    questions: input.questions,
    results: input.results,
    targets: input.targets,
  };
  validateQuizTaskEvidenceDeclaration(declaration);
  await evidence.recordEvidence({
    ...declaration,
    answers: input.answers,
  });
  const cognitiveAssessments = await evidence.assessTargets(criticalTargets);
  return decideUnitDiagnosticSubmission({
    overallScore: input.overallScore,
    criticalTargets,
    performance,
    cognitiveAssessments,
  });
}
