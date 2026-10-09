import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmQuizSubmissionRepository } from "./quiz-submission.repository.ts";

describe("MikroOrmQuizSubmissionRepository", () => {
  class SqlitePlatform {}

  function repositoryWithResults(...results: unknown[]) {
    const execute = jest.fn();
    for (const result of results) execute.mockResolvedValueOnce(result);
    const em = {
      getConnection: () => ({
        execute,
        getPlatform: () => new SqlitePlatform(),
      }),
      getTransactionContext: () => undefined,
      config: { getSchema: () => undefined },
      schema: undefined,
    } as unknown as EntityManager;
    return {
      repository: new MikroOrmQuizSubmissionRepository(em),
      execute,
    };
  }

  const input = {
    userId: "user-1",
    goalId: "goal-1",
    unitId: "unit-1",
    quizSetId: "quiz-set-1",
    activityAttemptId: "quiz-activity-1",
    questionsJson: JSON.stringify([{ question: "Recall" }]),
    answersJson: JSON.stringify({ 0: 0 }),
    resultsJson: JSON.stringify([{ index: 0, status: "correct" }]),
    weakTagsJson: "[]",
    perLearningTargetResultsJson: "[]",
    score: 1,
    purpose: "learning" as const,
    nextGraphStateJson: JSON.stringify({ quizSetId: "quiz-set-1" }),
    nextStep: "complete",
    items: [
      {
        index: 0,
        task: {
          stableKey: "assessment:quiz:declaration",
          taskType: "quiz" as const,
          title: "Recall",
          instructions: "Answer the closed-book selection question.",
          context: { question: "Recall", assessmentFormat: "mcq" },
          rubric: { criterionRef: "target-1:c1", definitionVersion: 1 },
          difficulty: "medium",
          definitionVersion: 1,
          origin: "generated_quiz" as const,
          evidencePolicy: {
            source: "quiz" as const,
            taskKind: "recall" as const,
            contextKey: "unit:unit-1:quiz-context:1",
            contextDistance: "same" as const,
            rubricId: "target-1:c1",
            assessmentFormat: "mcq" as const,
          },
          requirements: [
            {
              learningTargetId: "target-1",
              cognitiveEntityId: "entity-1",
              dimension: "memory" as const,
              criterionRef: "target-1:c1",
              definitionVersion: 1,
              required: true,
              weight: 1,
              orderIndex: 0,
              rubricCriterion: { ref: "target-1:c1", definitionVersion: 1 },
            },
          ],
        },
        idempotencyKey: "assessment:quiz:quiz-activity-1:0",
        response: { answer: 0 },
        score: 1,
        outcome: "correct",
        evaluatorRunId: "grade:quiz-activity-1:0",
        rawResult: { status: "correct" },
        evidenceStrength: "moderate" as const,
      },
    ],
  };

  it("rejects a submission outside the learner-owned unit scope", async () => {
    const { repository, execute } = repositoryWithResults([]);

    await expect(repository.record(input)).rejects.toMatchObject({
      code: "ownership_mismatch",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid task evidence declarations before touching persistence", async () => {
    const { repository, execute } = repositoryWithResults();

    await expect(
      repository.record({
        ...input,
        items: [
          {
            ...input.items[0]!,
            task: {
              ...input.items[0]!.task,
              evidencePolicy: {
                ...input.items[0]!.task.evidencePolicy,
                assessmentFormat: "free_text" as never,
              },
            },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_declaration" });
    expect(execute).not.toHaveBeenCalled();
  });
});
