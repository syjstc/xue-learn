import type {
  LearnerStateProjectionReadRepository,
  QuizSessionRepository,
} from "../../../../../../domain/src/index.js";
import { parseSessionGraphState } from "../../../../graph/review-mode.js";
import { type QuizQuestion } from "../../../../llm/schemas.js";
import {
  assessLearningTargetsFromDirectState,
  type UnitAssessmentTarget,
} from "../../../../assessment/index.js";
import {
  buildRecallProgress,
  observationHintsFromAssessments,
  planQuizBatch,
  type QuizBatchPlan,
  type QuizBatchPlannerInput,
  type RecallProgress,
} from "../../../../quiz/batch-planner.js";
import { parseQuizExplanations } from "../../../../quiz/quiz-sets.js";
import { clearQuizOutcomeState } from "../../../../unit-session/quiz-session-state.js";

export function flattenQuizQuestions(quiz: {
  questions: QuizQuestion[];
  interleaved?: QuizQuestion[];
}) {
  return [...quiz.questions, ...(quiz.interleaved ?? [])];
}

export function buildActiveQuizResponse(
  graphState: ReturnType<typeof parseSessionGraphState>,
) {
  const quiz = graphState.quiz as
    { questions: QuizQuestion[]; interleaved?: QuizQuestion[] } | undefined;
  if (!quiz?.questions?.length) return null;

  const quizGrade =
    graphState.score !== undefined && graphState.quizResults
      ? {
          score: graphState.score,
          weakTags: graphState.weakTags ?? [],
          results: graphState.quizResults,
        }
      : null;

  return {
    quizSetId: graphState.quizSetId ?? null,
    quizAttemptId: graphState.quizAttemptId ?? null,
    questions: quiz.questions,
    interleaved: quiz.interleaved ?? [],
    quizGrade,
    quizExplanations: undefined as Record<number, string> | undefined,
  };
}

export async function loadQuizExplanations(
  repository: QuizSessionRepository,
  userId: string,
  unitId: string,
  attemptId?: string | null,
): Promise<Record<number, string> | undefined> {
  if (!attemptId) return undefined;
  const explanations = await repository.findAttemptExplanations({
    userId,
    unitId,
    attemptId,
  });
  if (!explanations) return undefined;
  const parsed = parseQuizExplanations(explanations);
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export async function persistGeneratedQuiz(
  repository: QuizSessionRepository,
  userId: string,
  unitId: string,
  sessionGraphState: string,
  quiz: { questions: QuizQuestion[]; interleaved?: QuizQuestion[] },
) {
  const graphState = parseSessionGraphState(sessionGraphState);
  const rest = clearQuizOutcomeState(graphState);
  const quizSetId = randomUUID();
  const published = await repository.publishGenerated({
    userId,
    unitId,
    quizSetId,
    questionsJson: JSON.stringify({
      questions: quiz.questions,
      interleaved: quiz.interleaved ?? [],
    }),
    graphState: JSON.stringify({ ...rest, quiz, quizSetId }),
  });

  return {
    quizSetId: published.quizSetId,
    questions: quiz.questions,
    interleaved: quiz.interleaved ?? [],
  };
}

export async function buildAdaptiveQuizBatch(
  userId: string,
  unitId: string,
  quizTargets: readonly UnitAssessmentTarget[],
  stateRead?: LearnerStateProjectionReadRepository,
  quizSession?: QuizSessionRepository,
): Promise<{
  batchPlan: QuizBatchPlan;
  assessments: Awaited<ReturnType<typeof assessLearningTargetsFromDirectState>>;
}> {
  if (!stateRead || !quizSession) {
    throw new Error("Quiz persistence is not configured");
  }
  const [storedSets, assessments] = await Promise.all([
    quizSession.listLearningSetQuestions({ userId, unitId }),
    assessLearningTargetsFromDirectState({
      persistence: undefined,
      userId,
      targets: quizTargets,
      stateRead,
    }),
  ]);
  const priorQuestions: Array<
    NonNullable<QuizBatchPlannerInput["priorQuestions"]>[number]
  > = [];
  for (const stored of storedSets) {
    try {
      const parsed = JSON.parse(stored) as {
        questions?: QuizQuestion[];
        interleaved?: QuizQuestion[];
      };
      for (const question of [
        ...(parsed.questions ?? []),
        ...(parsed.interleaved ?? []),
      ]) {
        priorQuestions.push({
          type: question.type,
          question: question.question,
          primaryLearningTargetId: question.primaryLearningTargetId,
          learningTargetIds: question.learningTargetIds,
          evidenceDimension: question.evidenceDimension,
          primaryCognitiveEntityId: question.primaryCognitiveEntityId,
          contextDistance: question.contextDistance,
        });
      }
    } catch {
      // Ignore corrupt legacy quiz snapshots.
    }
  }
  const batchPlan = planQuizBatch({
    targets: quizTargets,
    priorQuestions,
    observations: observationHintsFromAssessments(quizTargets, assessments),
  });
  return { batchPlan, assessments };
}

export async function buildUnitRecallProgress(
  userId: string,
  unitId: string,
  targets: readonly UnitAssessmentTarget[],
  stateRead?: LearnerStateProjectionReadRepository,
  quizSession?: QuizSessionRepository,
): Promise<RecallProgress> {
  if (!stateRead || !quizSession) {
    throw new Error("Quiz persistence is not configured");
  }
  const [assessments, stats] = await Promise.all([
    assessLearningTargetsFromDirectState({
      persistence: undefined,
      userId,
      targets,
      stateRead,
    }),
    quizSession.getRecallStats({ userId, unitId }),
  ]);
  return buildRecallProgress({
    targets,
    assessments,
    completedBatches: stats.completedBatches,
    totalAnswers: stats.totalAnswers,
  });
}
import { randomUUID } from "node:crypto";
