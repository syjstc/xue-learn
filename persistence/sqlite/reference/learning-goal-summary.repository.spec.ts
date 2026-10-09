import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmLearningGoalSummaryRepository } from "./learning-goal-summary.repository.ts";

function fakeManager(options?: {
  goal?: Record<string, unknown>;
  unitCount?: number;
}) {
  const calls: string[] = [];
  const connection = {
    execute: jest.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes("COUNT(*)")) {
        return [{ count: String(options?.unitCount ?? 0) }];
      }
      if (sql.startsWith("UPDATE")) return [];
      return options?.goal ? [options.goal] : [];
    }),
    getPlatform: () => ({ constructor: { name: "SqlitePlatform" } }),
  };
  return {
    manager: { getConnection: () => connection } as unknown as EntityManager,
    calls,
    execute: connection.execute,
  };
}

describe("learning goal summary repository", () => {
  it("updates an owned unlocked summary in the supplied transaction", async () => {
    const fake = fakeManager({
      goal: {
        id: "goal-1",
        title: "Old title",
        topicOverview: "Old overview",
        mapSummaryJson: "{}",
        mapSummaryStatus: "pending",
      },
    });
    const repository = new MikroOrmLearningGoalSummaryRepository(fake.manager);

    await expect(
      repository.updateOwnedSummary({
        userId: "user-1",
        goalId: "goal-1",
        title: "New title",
        topicOverview: "New overview",
        mapSummaryJson: '{"topicOverview":"New overview"}',
      }),
    ).resolves.toEqual({
      status: "updated",
      summary: {
        goalId: "goal-1",
        title: "New title",
        topicOverview: "New overview",
        mapSummaryJson: '{"topicOverview":"New overview"}',
        mapSummaryStatus: "ready",
      },
    });
    expect(fake.calls.filter((sql) => sql.startsWith("UPDATE"))).toHaveLength(
      1,
    );
  });

  it("locks summary writes after the first unit exists", async () => {
    const fake = fakeManager({
      goal: { id: "goal-1", mapSummaryJson: "{}" },
      unitCount: 1,
    });
    const repository = new MikroOrmLearningGoalSummaryRepository(fake.manager);

    await expect(
      repository.approveOwnedSummary("user-1", "goal-1"),
    ).resolves.toEqual({ status: "locked" });
    expect(fake.calls.filter((sql) => sql.startsWith("UPDATE"))).toHaveLength(
      0,
    );
  });

  it("owns generation start and publication fields", async () => {
    const fake = fakeManager({
      goal: { id: "goal-1", mapSummaryJson: "{}" },
    });
    const repository = new MikroOrmLearningGoalSummaryRepository(fake.manager);

    await expect(
      repository.beginOwnedSummary("user-1", "goal-1", "search"),
    ).resolves.toEqual({ status: "started" });
    await expect(
      repository.publishOwnedSummary({
        userId: "user-1",
        goalId: "goal-1",
        title: "New title",
        topicOverview: "Overview",
        mapSummaryJson: '{"topicOverview":"Overview"}',
        pathSource: "search",
        contentLanguage: "en",
        resetIcon: true,
      }),
    ).resolves.toMatchObject({
      status: "updated",
      summary: { title: "New title", mapSummaryStatus: "ready" },
    });
    expect(fake.calls.filter((sql) => sql.startsWith("UPDATE"))).toHaveLength(
      2,
    );
    expect(fake.calls.some((sql) => sql.includes('"iconTint"'))).toBe(true);
  });
});
