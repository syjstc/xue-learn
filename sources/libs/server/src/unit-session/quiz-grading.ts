/**
 * Framework- and persistence-independent objective quiz grading.
 *
 * The question contract is intentionally structural: hosted callers may pass
 * the validated LLM `QuizQuestion` shape while local runtimes may pass the
 * equivalent shape read from SQLite. Authoring and schema validation belong
 * outside this boundary.
 */

export type ObjectiveQuizAnswer = string | number | boolean | number[];

export type ObjectiveQuizQuestion =
  | {
      type: "mcq";
      options: readonly string[];
      correctIndex: number;
      learningTargetIds?: readonly string[];
    }
  | {
      type: "mcq_multi";
      options: readonly string[];
      correctIndices: readonly number[];
      learningTargetIds?: readonly string[];
    }
  | {
      type: "true_false";
      correctAnswer: boolean;
      learningTargetIds?: readonly string[];
    };

export type ObjectiveQuizLearningTarget = {
  id: string;
  label: string;
};

export type ObjectiveQuizGradeItem = {
  index: number;
  status: "correct" | "partial" | "incorrect";
  userAnswerLabel: string;
  correctAnswerLabel?: string;
  rubric?: string;
};

export type ObjectiveQuizGrade = {
  score: number;
  weakTags: string[];
  weakLearningTargetIds: string[];
  results: ObjectiveQuizGradeItem[];
};

function normalizeIndexList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter((item): item is number => typeof item === "number")),
  ).sort((a, b) => a - b);
}

function gradeMultiChoiceIndices(
  correct: readonly number[],
  selected: readonly number[],
): { status: ObjectiveQuizGradeItem["status"]; points: number } {
  const normalizedCorrect = normalizeIndexList(correct);
  const normalizedSelected = normalizeIndexList(selected);
  const equal =
    normalizedSelected.length === normalizedCorrect.length &&
    normalizedSelected.every(
      (value, index) => value === normalizedCorrect[index],
    );
  if (equal) return { status: "correct", points: 1 };

  const hits = normalizedSelected.filter((index) =>
    normalizedCorrect.includes(index),
  ).length;
  const extras = normalizedSelected.filter(
    (index) => !normalizedCorrect.includes(index),
  ).length;
  if (hits > 0 && extras === 0 && hits < normalizedCorrect.length) {
    return { status: "partial", points: 0.5 };
  }
  if (hits > 0) return { status: "partial", points: 0.5 };
  return { status: "incorrect", points: 0 };
}

function formatOptionLabels(
  options: readonly string[],
  indices: readonly number[],
): string {
  if (indices.length === 0) return "未作答";
  return indices
    .map((index) => options[index] ?? `选项 ${index + 1}`)
    .join("、");
}

function formatAnswerLabel(
  question: ObjectiveQuizQuestion,
  answer: ObjectiveQuizAnswer | undefined,
): string {
  if (answer === undefined) return "未作答";
  if (question.type === "true_false") {
    if (typeof answer !== "boolean") return "未作答";
    return answer ? "正确" : "错误";
  }
  if (question.type === "mcq") {
    const index = answer as number;
    return question.options[index] ?? `选项 ${index + 1}`;
  }
  return formatOptionLabels(question.options, normalizeIndexList(answer));
}

function formatCorrectAnswerLabel(
  question: ObjectiveQuizQuestion,
): string | undefined {
  if (question.type === "true_false") {
    return question.correctAnswer ? "正确" : "错误";
  }
  if (question.type === "mcq") return question.options[question.correctIndex];
  return formatOptionLabels(
    question.options,
    [...question.correctIndices].sort((a, b) => a - b),
  );
}

function learningTargetLabelMap(
  learningTargets: readonly ObjectiveQuizLearningTarget[] | null | undefined,
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const target of learningTargets ?? []) {
    if (target.id && target.label) labels.set(target.id, target.label);
  }
  return labels;
}

/** Grade one authored objective quiz without performing any I/O. */
export function gradeObjectiveQuiz(
  questions: readonly ObjectiveQuizQuestion[],
  answers: Readonly<Record<string, ObjectiveQuizAnswer>>,
  learningTargets?: readonly ObjectiveQuizLearningTarget[] | null,
): ObjectiveQuizGrade {
  let earnedPoints = 0;
  const weakTags = new Set<string>();
  const weakLearningTargetIds = new Set<string>();
  const results: ObjectiveQuizGradeItem[] = [];
  const targetLabels = learningTargetLabelMap(learningTargets);

  questions.forEach((question, index) => {
    const answer = answers[String(index)];
    let status: ObjectiveQuizGradeItem["status"] = "incorrect";
    let points = 0;

    if (question.type === "mcq" && answer === question.correctIndex) {
      status = "correct";
      points = 1;
    } else if (
      question.type === "true_false" &&
      typeof answer === "boolean" &&
      answer === question.correctAnswer
    ) {
      status = "correct";
      points = 1;
    } else if (question.type === "mcq_multi") {
      const graded = gradeMultiChoiceIndices(
        [...question.correctIndices].sort((a, b) => a - b),
        normalizeIndexList(answer),
      );
      status = graded.status;
      points = graded.points;
    }

    if (status !== "correct") {
      const targetIds = (question.learningTargetIds ?? []).filter((id) =>
        /^lt_\d+$/i.test(id),
      );
      for (const id of targetIds) {
        weakLearningTargetIds.add(id.toLowerCase());
      }
      const resolvedLabels = Array.from(
        new Set(
          targetIds
            .map(
              (id) =>
                targetLabels.get(id) ?? targetLabels.get(id.toLowerCase()),
            )
            .filter((label): label is string => Boolean(label)),
        ),
      );
      if (resolvedLabels.length > 0) {
        for (const label of resolvedLabels) weakTags.add(label);
      } else {
        for (const id of targetIds) weakTags.add(id);
      }
    }

    earnedPoints += points;
    results.push({
      index,
      status,
      userAnswerLabel: formatAnswerLabel(question, answer),
      correctAnswerLabel:
        status === "correct" ? undefined : formatCorrectAnswerLabel(question),
    });
  });

  return {
    score: questions.length > 0 ? earnedPoints / questions.length : 0,
    weakTags: [...weakTags],
    weakLearningTargetIds: [...weakLearningTargetIds],
    results,
  };
}
