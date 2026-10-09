export type ObjectiveQuestionType = "mcq" | "mcq_multi" | "true_false";

export type ObjectiveGradeOutcome = "correct" | "partial" | "incorrect";

export type ObjectiveGradeResult = {
  correct: boolean;
  outcome: ObjectiveGradeOutcome;
  score: number;
};

export function normalizeIndexList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter((item): item is number => typeof item === "number")),
  ).sort((a, b) => a - b);
}

export function indexListsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export function gradeMultiChoiceIndices(
  correct: number[],
  selected: number[],
): { status: ObjectiveGradeOutcome; points: number } {
  const normalizedCorrect = normalizeIndexList(correct);
  const normalizedSelected = normalizeIndexList(selected);
  if (indexListsEqual(normalizedSelected, normalizedCorrect)) {
    return { status: "correct", points: 1 };
  }
  const hits = normalizedSelected.filter((index) =>
    normalizedCorrect.includes(index),
  ).length;
  const extras = normalizedSelected.filter(
    (index) => !normalizedCorrect.includes(index),
  ).length;
  if (hits > 0 && extras === 0 && hits < normalizedCorrect.length) {
    return { status: "partial", points: 0.5 };
  }
  if (hits > 0) {
    return { status: "partial", points: 0.5 };
  }
  return { status: "incorrect", points: 0 };
}

export function gradeObjectiveAnswer(input: {
  questionType: ObjectiveQuestionType;
  selectedAnswer: number | number[] | boolean;
  correctIndex?: number;
  correctIndices?: number[];
  correctAnswer?: boolean;
}): ObjectiveGradeResult {
  if (input.questionType === "true_false") {
    const correct = input.selectedAnswer === input.correctAnswer;
    return {
      correct,
      outcome: correct ? "correct" : "incorrect",
      score: correct ? 1 : 0,
    };
  }
  if (input.questionType === "mcq_multi") {
    const graded = gradeMultiChoiceIndices(
      normalizeIndexList(input.correctIndices),
      normalizeIndexList(input.selectedAnswer),
    );
    return {
      correct: graded.status === "correct",
      outcome: graded.status,
      score: graded.points,
    };
  }
  const correct = input.selectedAnswer === input.correctIndex;
  return {
    correct,
    outcome: correct ? "correct" : "incorrect",
    score: correct ? 1 : 0,
  };
}
