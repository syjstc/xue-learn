import type { QuizGradeItem } from "../graph/grade-quiz.js";
import type { QuizQuestion } from "../llm/schemas.js";
import type { ObjectiveQuizAnswer } from "../unit-session/quiz-grading.js";
import {
  isCriticalLearningTarget,
  isQuizAssessableLearningTarget,
  learningTargetSummativeQuestionCount,
  scoreQuizByLearningTarget,
  validateQuizTaskEvidenceDeclaration,
  type LearningTargetCognitiveAssessment,
  type PerLearningTargetPerformance,
  type UnitAssessmentTarget,
} from "./activities.js";

export const MODULE_DIAGNOSTIC_OVERALL_THRESHOLD = 0.85;
export const MODULE_DIAGNOSTIC_PER_CAPABILITY_THRESHOLD = 0.7;

export type ModuleDiagnosticGenerationPlan =
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

/** Exact persistence-independent target selection used by module exit diagnostics. */
export function planModuleDiagnosticGeneration(input: {
  targets: readonly UnitAssessmentTarget[];
}): ModuleDiagnosticGenerationPlan {
  const criticalTargets = input.targets.filter(isCriticalLearningTarget);
  if (criticalTargets.length === 0) {
    return { ready: false, reason: "no_critical_targets" };
  }
  const selectedTargets = input.targets.filter(isQuizAssessableLearningTarget);
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

export type ModuleDiagnosticCapabilityResult = Readonly<{
  learningTargetId: string;
  localRef: string;
  title: string;
  criticalCompletionGate: boolean;
  score: number;
  questionCount: number;
  passed: boolean;
  cognitiveStatus: LearningTargetCognitiveAssessment["status"];
  estimate: number | null;
  evidenceSufficiency: number;
  failures: LearningTargetCognitiveAssessment["failures"];
}>;

export type ModuleDiagnosticDecision = Readonly<{
  overallScore: number;
  passed: boolean;
  perCapability: readonly ModuleDiagnosticCapabilityResult[];
}>;

/** Deterministic module test-out gate: overall threshold plus every critical target. */
export function decideModuleDiagnosticPass(input: {
  overallScore: number;
  capabilities: ReadonlyArray<{
    criticalCompletionGate: boolean;
    passed: boolean;
  }>;
}): boolean {
  const critical = input.capabilities.filter(
    (capability) => capability.criticalCompletionGate,
  );
  return (
    input.overallScore >= MODULE_DIAGNOSTIC_OVERALL_THRESHOLD &&
    critical.length > 0 &&
    critical.every((capability) => capability.passed)
  );
}

export function decideModuleDiagnosticSubmission(input: {
  overallScore: number;
  targets: readonly UnitAssessmentTarget[];
  performance: readonly PerLearningTargetPerformance[];
  cognitiveAssessments: readonly LearningTargetCognitiveAssessment[];
}): ModuleDiagnosticDecision {
  const performanceByTarget = new Map(
    input.performance.map((row) => [row.learningTargetId, row]),
  );
  const cognitiveByTarget = new Map(
    input.cognitiveAssessments.map((row) => [row.learningTargetId, row]),
  );
  const perCapability = input.targets.map((target) => {
    const taskPerformance = performanceByTarget.get(target.id);
    const cognitive = cognitiveByTarget.get(target.id);
    return {
      learningTargetId: target.id,
      localRef: target.localRef,
      title: target.title,
      criticalCompletionGate: isCriticalLearningTarget(target),
      score: taskPerformance?.score ?? 0,
      questionCount: taskPerformance?.questionCount ?? 0,
      passed: cognitive?.passed ?? false,
      cognitiveStatus: cognitive?.status ?? ("unobserved" as const),
      estimate: cognitive?.estimate ?? null,
      evidenceSufficiency: cognitive?.evidenceSufficiency ?? 0,
      failures: cognitive?.failures ?? [],
    } satisfies ModuleDiagnosticCapabilityResult;
  });
  return {
    overallScore: input.overallScore,
    passed: decideModuleDiagnosticPass({
      overallScore: input.overallScore,
      capabilities: perCapability,
    }),
    perCapability,
  };
}

export type ModuleDiagnosticEvidenceWrite = Readonly<{
  questions: readonly QuizQuestion[];
  results: readonly QuizGradeItem[];
  answers: Readonly<Record<string, ObjectiveQuizAnswer>>;
  targets: readonly UnitAssessmentTarget[];
}>;

export type ModuleDiagnosticEvidencePort = Readonly<{
  recordEvidence(input: ModuleDiagnosticEvidenceWrite): Promise<void>;
  assessTargets(
    targets: readonly UnitAssessmentTarget[],
  ): Promise<readonly LearningTargetCognitiveAssessment[]>;
}>;

/**
 * Portable deterministic submission seam. Evidence is recorded before the
 * authoritative post-attempt cognitive state is read and used for progression.
 */
export async function evaluateModuleDiagnosticSubmission(
  input: Readonly<{
    overallScore: number;
    questions: readonly QuizQuestion[];
    results: readonly QuizGradeItem[];
    answers: Readonly<Record<string, ObjectiveQuizAnswer>>;
    targets: readonly UnitAssessmentTarget[];
  }>,
  evidence: ModuleDiagnosticEvidencePort,
): Promise<ModuleDiagnosticDecision> {
  if (!input.targets.some(isCriticalLearningTarget)) {
    throw new Error("Module diagnostic requires at least one critical target");
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
  await evidence.recordEvidence({ ...declaration, answers: input.answers });
  const cognitiveAssessments = await evidence.assessTargets(input.targets);
  return decideModuleDiagnosticSubmission({
    overallScore: input.overallScore,
    targets: input.targets,
    performance,
    cognitiveAssessments,
  });
}
