import { z } from "zod";
import {
  buildDiagnosticQuizPrompt,
  DIAGNOSTIC_STABLE_INSTRUCTION,
} from "../learning-systems/capabilities/assessment-runtime/quiz-prompt.js";
import {
  portableQuizQuestionSchema,
  type QuizQuestion,
} from "../quiz/authoring.js";
import {
  alignQuizQuestionsToDeclaredEvidence,
  learningTargetCompetencyBlock,
  validateAdaptiveQuizRequirementCoverage,
  type UnitAssessmentTarget,
} from "./activities.js";
import { planUnitDiagnosticGeneration } from "./unit-diagnostic-application.js";

export type PreparedUnitDiagnosticAuthoring = Readonly<{
  operation: "unit.diagnostic";
  questionCount: number;
  selectedTargets: readonly UnitAssessmentTarget[];
  prompt: string;
  alignQuestions(questions: readonly QuizQuestion[]): QuizQuestion[];
  validateQuestions(questions: readonly QuizQuestion[]): void;
  parseProviderOutput(content: string): { questions: QuizQuestion[] };
}>;

function unwrapJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

/** Provider-independent hosted/local diagnostic authoring contract. */
export function prepareUnitDiagnosticAuthoring(input: {
  unitTitle: string;
  languageBlock: string;
  styleBlock?: string;
  targets: readonly UnitAssessmentTarget[];
  priorAssessments?: readonly import("./activities.js").LearningTargetCognitiveAssessment[];
}): PreparedUnitDiagnosticAuthoring {
  const plan = planUnitDiagnosticGeneration({
    targets: input.targets,
    priorAssessments: input.priorAssessments ?? [],
  });
  if (!plan.ready) {
    throw new Error(`Unit diagnostic is not authorable: ${plan.reason}`);
  }
  const competencyBlock = learningTargetCompetencyBlock(plan.selectedTargets);
  const prompt = `${DIAGNOSTIC_STABLE_INSTRUCTION}\n\n${buildDiagnosticQuizPrompt(
    {
      unitTitle: input.unitTitle,
      scopeKind: "unit",
      competencyBlock,
      questionCount: plan.questionCount,
      languageBlock: input.languageBlock,
      styleBlock: input.styleBlock,
    },
  )}`;
  // Keep the required minimum; surplus items are truncated locally (no max
  // cardinality on the authoritative schema — models often overshoot).
  const schema = z.array(portableQuizQuestionSchema).min(plan.questionCount);
  const alignQuestions = (questions: readonly QuizQuestion[]) =>
    alignQuizQuestionsToDeclaredEvidence(questions, plan.selectedTargets);
  const validateQuestions = (questions: readonly QuizQuestion[]) =>
    validateAdaptiveQuizRequirementCoverage({
      questions,
      targets: plan.selectedTargets,
    });
  return {
    operation: "unit.diagnostic",
    questionCount: plan.questionCount,
    selectedTargets: plan.selectedTargets,
    prompt,
    alignQuestions,
    validateQuestions,
    parseProviderOutput(content) {
      const authored = schema
        .parse(unwrapJson(content))
        .slice(0, plan.questionCount);
      const questions = alignQuestions(authored);
      validateQuestions(questions);
      return { questions };
    },
  };
}
