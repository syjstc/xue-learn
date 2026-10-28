/// <reference types="jest" />

import { gradeObjectiveQuiz } from "./quiz-grading.js";

describe("gradeObjectiveQuiz", () => {
  it("grades every objective format and reports target-based weaknesses", () => {
    const result = gradeObjectiveQuiz(
      [
        {
          type: "mcq",
          options: ["A", "B", "C"],
          correctIndex: 1,
          learningTargetIds: ["lt_1"],
        },
        {
          type: "mcq_multi",
          options: ["A", "B", "C"],
          correctIndices: [2, 0],
          learningTargetIds: ["lt_2"],
        },
        {
          type: "true_false",
          correctAnswer: false,
          learningTargetIds: ["lt_3"],
        },
      ],
      { "0": 0, "1": [0], "2": false },
      [
        { id: "lt_1", label: "目标一" },
        { id: "lt_2", label: "目标二" },
        { id: "lt_3", label: "目标三" },
      ],
    );

    expect(result.score).toBe(0.5);
    expect(result.weakTags).toEqual(["目标一", "目标二"]);
    expect(result.weakLearningTargetIds).toEqual(["lt_1", "lt_2"]);
    expect(result.results).toEqual([
      {
        index: 0,
        status: "incorrect",
        userAnswerLabel: "A",
        correctAnswerLabel: "B",
      },
      {
        index: 1,
        status: "partial",
        userAnswerLabel: "A",
        correctAnswerLabel: "A、C",
      },
      {
        index: 2,
        status: "correct",
        userAnswerLabel: "错误",
        correctAnswerLabel: undefined,
      },
    ]);
  });

  it("deduplicates and normalizes weak target ids while preserving label order", () => {
    const result = gradeObjectiveQuiz(
      [
        {
          type: "mcq",
          options: ["A", "B"],
          correctIndex: 0,
          learningTargetIds: ["LT_1", "lt_2", "invalid"],
        },
        {
          type: "true_false",
          correctAnswer: true,
          learningTargetIds: ["lt_1"],
        },
      ],
      { "0": 1, "1": false },
      [
        { id: "lt_1", label: "目标一" },
        { id: "lt_2", label: "目标二" },
      ],
    );

    expect(result.weakLearningTargetIds).toEqual(["lt_1", "lt_2"]);
    expect(result.weakTags).toEqual(["目标一", "目标二"]);
  });

  it("handles empty quizzes and unanswered questions", () => {
    expect(gradeObjectiveQuiz([], {}).score).toBe(0);
    expect(
      gradeObjectiveQuiz([{ type: "true_false", correctAnswer: true }], {})
        .results,
    ).toEqual([
      {
        index: 0,
        status: "incorrect",
        userAnswerLabel: "未作答",
        correctAnswerLabel: "正确",
      },
    ]);
  });
});
