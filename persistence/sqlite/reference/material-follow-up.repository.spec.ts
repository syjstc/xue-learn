import type { EntityManager } from "@mikro-orm/core";
import type { MaterialFollowUpRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { MikroOrmMaterialFollowUpRepository } from "./material-follow-up.repository.ts";

describe("material follow-up reference repository", () => {
  it("persists the learner question before its assistant reply", async () => {
    const writes: Array<{ sql: string; params: unknown[] }> = [];
    const execute = jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM "LearningUnit"')) {
        return [
          {
            unitId: "unit-1",
            unitTitle: "Unit",
            status: "available",
            goalId: "goal-1",
            goalTitle: "Goal",
            userId: "user-1",
            contentLanguage: "zh-Hans",
            topicCategory: "general",
            contentRevision: 1,
          },
        ];
      }
      if (sql.startsWith('SELECT "id" FROM "AgentThread"')) {
        return [{ id: "thread-1" }];
      }
      writes.push({ sql, params });
      return [];
    });
    const em = {
      getConnection: () => ({ execute }),
      getTransactionContext: () => undefined,
    } as unknown as EntityManager;
    const repository: MaterialFollowUpRepository =
      new MikroOrmMaterialFollowUpRepository(em);

    await repository.saveConversation({
      userId: "user-1",
      unitId: "unit-1",
      threadId: "thread-1",
      threadStateJson: "{}",
      anchor: "{}",
      messages: "[]",
      userMessage: "question",
      userMessageCreatedAt: "2026-08-12T08:00:00.000Z",
      assistantMessage: "answer",
      // Even a clock/timestamp tie must retain conversational order.
      assistantMessageCreatedAt: "2026-08-12T08:00:00.000Z",
      assistantToolCalls: "[]",
      assistantUiPayload: "{}",
      assistantMetadata: "{}",
    });

    const messageWrites = writes.filter((write) =>
      write.sql.startsWith('INSERT INTO "AgentMessage"'),
    );
    expect(messageWrites).toHaveLength(2);
    expect(messageWrites[0]?.params[2]).toBe("question");
    expect(messageWrites[1]?.params[2]).toBe("answer");
    expect((messageWrites[0]?.params.at(-1) as Date).toISOString()).toBe(
      "2026-08-12T08:00:00.000Z",
    );
    expect((messageWrites[1]?.params.at(-1) as Date).toISOString()).toBe(
      "2026-08-12T08:00:00.001Z",
    );
  });
});
