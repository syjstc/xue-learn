import type { UnitLearningTarget } from "../domain/learning-targets.js";
import type { QuizQuestion } from "../llm/schemas.js";
import {
  gradeObjectiveQuiz,
  type ObjectiveQuizAnswer,
  type ObjectiveQuizGradeItem,
} from "../unit-session/quiz-grading.js";

export type QuizGradeItem = ObjectiveQuizGradeItem;

export async function gradeQuiz(
  questions: QuizQuestion[],
  answers: Record<string, ObjectiveQuizAnswer>,
  learningTargets?: UnitLearningTarget[] | null,
): Promise<{
  score: number;
  weakTags: string[];
  weakLearningTargetIds: string[];
  results: QuizGradeItem[];
}> {
  return gradeObjectiveQuiz(questions, answers, learningTargets);
}
