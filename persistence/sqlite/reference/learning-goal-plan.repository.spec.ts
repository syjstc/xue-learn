import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmLearningGoalPlanRepository } from "./learning-goal-plan.repository.ts";

function fakeManager(options?: {
  goal?: Record<string, unknown>;
  unitCount?: number;
  moduleCount?: number;
}) {
  const calls: string[] = [];
  const connection = {
    execute: jest.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes('FROM "LearningUnit"')) {
        return [{ count: String(options?.unitCount ?? 0) }];
      }
      if (sql.includes('FROM "LearningModule"')) {
        return [{ count: String(options?.moduleCount ?? 0) }];
      }
      if (sql.startsWith("UPDATE")) return [];
      return options?.goal ? [options.goal] : [];
    }),
    getPlatform: () => ({ constructor: { name: "SqlitePlatform" } }),
  };
  return {
    manager: {
      getConnection: () => connection,
      getTransactionContext: () => "transaction-context",
    } as unknown as EntityManager,
    calls,
    execute: connection.execute,
  };
}

describe("learning goal plan repository", () => {
  it("updates an owned unlocked plan", async () => {
    const fake = fakeManager({
      goal: { id: "goal-1", mapPlanJson: "{}", mapPlanStatus: "pending" },
    });
    const repository = new MikroOrmLearningGoalPlanRepository(fake.manager);

    await expect(
      repository.updateOwnedPlan({
        userId: "user-1",
        goalId: "goal-1",
        topicOverview: "A bounded overview",
        mapPlanJson: '{"schemaVersion":1}',
      }),
    ).resolves.toEqual({
      status: "updated",
      plan: {
        goalId: "goal-1",
        topicOverview: "A bounded overview",
        mapPlanJson: '{"schemaVersion":1}',
        mapPlanStatus: "ready",
      },
    });
    expect(fake.calls.filter((sql) => sql.startsWith("UPDATE"))).toHaveLength(
      1,
    );
    expect(fake.execute).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      undefined,
      "transaction-context",
    );
  });

  it("locks plans once units or modules have been materialized", async () => {
    const fake = fakeManager({
      goal: { id: "goal-1" },
      moduleCount: 1,
    });
    const repository = new MikroOrmLearningGoalPlanRepository(fake.manager);

    await expect(
      repository.updateOwnedPlan({
        userId: "user-1",
        goalId: "goal-1",
        topicOverview: "Overview",
        mapPlanJson: "{}",
      }),
    ).resolves.toEqual({ status: "locked" });
    expect(fake.calls.filter((sql) => sql.startsWith("UPDATE"))).toHaveLength(
      0,
    );
  });

  it("publishes the generated plan fields atomically", async () => {
    const fake = fakeManager({ goal: { id: "goal-1" } });
    const repository = new MikroOrmLearningGoalPlanRepository(fake.manager);

    await expect(
      repository.publishOwnedPlan({
        userId: "user-1",
        goalId: "goal-1",
        title: "Refined goal",
        topicOverview: "Overview",
        mapPlanJson: '{"schemaVersion":1}',
        pathSource: "search",
        domainTag: "programming",
        topicCategory: "backend",
      }),
    ).resolves.toMatchObject({
      status: "updated",
      plan: { goalId: "goal-1", mapPlanStatus: "ready" },
    });
    expect(fake.calls.filter((sql) => sql.startsWith("UPDATE"))).toHaveLength(
      1,
    );
  });

  it("starts an owned plan and can reset its icon with the publication", async () => {
    const fake = fakeManager({ goal: { id: "goal-1" } });
    const repository = new MikroOrmLearningGoalPlanRepository(fake.manager);

    await expect(
      repository.beginOwnedPlan("user-1", "goal-1", "search"),
    ).resolves.toEqual({ status: "started" });
    await repository.publishOwnedPlan({
      userId: "user-1",
      goalId: "goal-1",
      title: "Refined goal",
      topicOverview: "Overview",
      mapPlanJson: "{}",
      pathSource: "search",
      domainTag: "general",
      topicCategory: "general",
      contentLanguage: "en",
      resetIcon: true,
    });

    expect(fake.calls.filter((sql) => sql.startsWith("UPDATE"))).toHaveLength(
      2,
    );
    expect(fake.calls.some((sql) => sql.includes('"iconSvg"'))).toBe(true);
  });

  it("starts an owned detailed-plan refresh", async () => {
    const fake = fakeManager({ goal: { id: "goal-1" } });
    const repository = new MikroOrmLearningGoalPlanRepository(fake.manager);

    await expect(
      repository.beginOwnedDetailedPlanRefresh("user-1", "goal-1"),
    ).resolves.toEqual({ status: "started" });
    expect(fake.calls.some((sql) => sql.includes('"detailedPlanStatus"'))).toBe(
      true,
    );
  });

  it("publishes a detailed plan while preserving omitted metadata", async () => {
    const fake = fakeManager({ goal: { id: "goal-1" } });
    const repository = new MikroOrmLearningGoalPlanRepository(fake.manager);

    await expect(
      repository.publishOwnedDetailedPlan({
        userId: "user-1",
        goalId: "goal-1",
        topicOverview: "Detailed overview",
        mapPlanJson: '{"schemaVersion":1}',
        pathSource: "search",
        domainTag: "programming",
        topicCategory: "backend",
      }),
    ).resolves.toEqual({
      status: "updated",
      plan: {
        goalId: "goal-1",
        topicOverview: "Detailed overview",
        mapPlanJson: '{"schemaVersion":1}',
        mapPlanStatus: "ready",
      },
    });
    expect(fake.calls.filter((sql) => sql.startsWith("UPDATE"))).toHaveLength(
      1,
    );
  });

  it("marks an owned detailed-plan refresh as failed", async () => {
    const fake = fakeManager({ goal: { id: "goal-1" } });
    const repository = new MikroOrmLearningGoalPlanRepository(fake.manager);

    await expect(
      repository.markOwnedDetailedPlanRefreshFailed("user-1", "goal-1"),
    ).resolves.toEqual({ status: "updated" });
    expect(fake.calls.some((sql) => sql.includes("'failed'"))).toBe(true);
  });

  it("approves an owned legacy plan", async () => {
    const fake = fakeManager({ goal: { id: "goal-1" } });
    const repository = new MikroOrmLearningGoalPlanRepository(fake.manager);

    await expect(
      repository.approveOwnedPlan("user-1", "goal-1"),
    ).resolves.toEqual({ status: "approved" });
    expect(fake.calls.filter((sql) => sql.startsWith("UPDATE"))).toHaveLength(
      1,
    );
  });

  it("updates planning mode only before plan approval", async () => {
    const fake = fakeManager({
      goal: { id: "goal-1", mapPlanStatus: "ready" },
    });
    const repository = new MikroOrmLearningGoalPlanRepository(fake.manager);

    await expect(
      repository.updateOwnedPlanningMode("user-1", "goal-1", "deep"),
    ).resolves.toEqual({ status: "updated" });
    expect(fake.calls.filter((sql) => sql.startsWith("UPDATE"))).toHaveLength(
      1,
    );
  });
});
