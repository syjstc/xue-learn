import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmQuizSessionRepository } from "./quiz-session.repository.ts";

describe("quiz session reference repository", () => {
  it("normalizes SQLite epoch timestamps in quiz set summaries and details", async () => {
    const setCreatedAt = 1_786_687_500_000;
    const attemptCreatedAt = 1_786_687_562_017;
    const quizRow = {
      id: "set-1",
      questions: JSON.stringify({
        questions: [{ type: "mcq", question: "What is one?" }],
        interleaved: [],
      }),
      createdAt: setCreatedAt,
      attemptId: "attempt-1",
      quizSetId: "set-1",
      score: 1,
      weakTags: "[]",
      answers: "{}",
      results: "[]",
      explanations: "{}",
      attemptCreatedAt,
    };
    const manager = {
      getTransactionContext: () => undefined,
      getConnection: () => ({
        execute: async (sql: string) => {
          if (sql.includes('SELECT u."id"')) return [{ id: "unit-1" }];
          if (sql.includes('WHERE s."id" = ?')) return [quizRow];
          if (sql.includes("LEFT JOIN") && sql.includes("QuizAttempt")) {
            return [quizRow];
          }
          return [];
        },
      }),
    } as unknown as EntityManager;
    const repository = new MikroOrmQuizSessionRepository(manager);

    await expect(
      repository.listQuizSets({ userId: "user-1", unitId: "unit-1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "set-1",
        createdAt: "2026-08-14T06:05:00.000Z",
        latestAttemptAt: "2026-08-14T06:06:02.017Z",
      }),
    ]);

    const detail = await repository.findQuizSetDetail({
      userId: "user-1",
      unitId: "unit-1",
      quizSetId: "set-1",
    });
    expect(detail?.createdAt.toISOString()).toBe("2026-08-14T06:05:00.000Z");
    expect(detail?.attempts[0]?.createdAt.toISOString()).toBe(
      "2026-08-14T06:06:02.017Z",
    );
  });
});
