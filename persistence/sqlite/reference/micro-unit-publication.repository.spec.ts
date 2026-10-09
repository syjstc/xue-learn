import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmMicroUnitPublicationRepository } from "./micro-unit-publication.repository.ts";

function fakeManager(options?: {
  goal?: Record<string, unknown>;
  overviewUnit?: Record<string, unknown>;
}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const connection = {
    execute: jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      if (sql.includes('FROM "LearningGoal"')) {
        return options?.goal ? [options.goal] : [];
      }
      if (
        sql.includes('FROM "LearningUnit"') &&
        sql.includes("\"unitKind\" = 'overview'")
      ) {
        return options?.overviewUnit ? [options.overviewUnit] : [];
      }
      return [];
    }),
    getPlatform: () => ({ constructor: { name: "SqlitePlatform" } }),
  };
  return {
    manager: {
      getConnection: () => connection,
      getTransactionContext: () => undefined,
    } as unknown as EntityManager,
    calls,
  };
}

const publishInput = {
  userId: "user-1",
  goalId: "goal-1",
  goalTitle: "Python fundamentals",
  contentLanguage: "en",
  topicOverview: "A practical introduction.",
  pathSource: "generic",
  unitTitle: "Start with Python",
  difficulty: "beginner",
  contentSummary: "Variables, expressions, and a first script.",
} as const;

describe("micro-unit publication repository", () => {
  it("publishes one owned lesson and skips legacy planning", async () => {
    const fake = fakeManager({ goal: { id: "goal-1" } });
    const repository = new MikroOrmMicroUnitPublicationRepository(fake.manager);

    const result = await repository.publishOwnedMicroUnit(publishInput);

    expect(result).toEqual({
      status: "published",
      unitId: expect.any(String),
      title: "Start with Python",
      contentSummary: "Variables, expressions, and a first script.",
    });
    if (result.status !== "published") return;

    const goalUpdate = fake.calls.find(
      ({ sql }) => sql.startsWith("UPDATE") && sql.includes('"LearningGoal"'),
    );
    expect(goalUpdate?.sql).toContain('"title" = ?');
    expect(goalUpdate?.sql).toContain('"contentLanguage" = ?');
    expect(goalUpdate?.sql).toContain('"topicOverview" = ?');
    expect(goalUpdate?.sql).toContain('"pathSource" = ?');
    expect(goalUpdate?.sql).toContain("\"mapSummaryStatus\" = 'skipped'");
    expect(goalUpdate?.sql).toContain("\"mapPlanStatus\" = 'skipped'");
    expect(goalUpdate?.sql).toContain("\"detailedPlanStatus\" = 'skipped'");
    expect(goalUpdate?.params).toEqual(
      expect.arrayContaining([
        "Python fundamentals",
        "en",
        "A practical introduction.",
        "generic",
        "goal-1",
        "user-1",
      ]),
    );

    const unitInsert = fake.calls.find(
      ({ sql }) => sql.startsWith("INSERT") && sql.includes('"LearningUnit"'),
    );
    expect(unitInsert?.sql).toContain("'lesson'");
    expect(unitInsert?.sql).toContain("'[]'");
    expect(unitInsert?.sql).toContain("'available'");
    expect(unitInsert?.params).toEqual(
      expect.arrayContaining([
        result.unitId,
        "goal-1",
        "Start with Python",
        "beginner",
        "Variables, expressions, and a first script.",
      ]),
    );
    expect(
      fake.calls.some(({ sql }) => sql.includes('"LearningMaterial"')),
    ).toBe(false);
    expect(
      fake.calls.some(({ sql }) => sql.includes('"UnitSessionState"')),
    ).toBe(false);
  });

  it("does not publish a goal outside the owner scope", async () => {
    const fake = fakeManager();
    const repository = new MikroOrmMicroUnitPublicationRepository(fake.manager);

    await expect(
      repository.publishOwnedMicroUnit(publishInput),
    ).resolves.toEqual({ status: "not_found" });
    expect(fake.calls).toHaveLength(1);
  });

  it("upgrades an owned overview by clearing material and completion", async () => {
    const fake = fakeManager({
      goal: { id: "goal-1" },
      overviewUnit: { id: "unit-1" },
    });
    const repository = new MikroOrmMicroUnitPublicationRepository(fake.manager);

    const result = await repository.upgradeOwnedOverviewToLesson({
      userId: "user-1",
      goalId: "goal-1",
      unitId: "unit-1",
      title: "Python fundamentals",
    });

    expect(result).toEqual({ status: "upgraded", unitId: "unit-1" });
    const materialDelete = fake.calls.find(
      ({ sql }) =>
        sql.startsWith("DELETE") && sql.includes('"LearningMaterial"'),
    );
    expect(materialDelete?.params).toEqual(["unit-1"]);

    const unitUpdate = fake.calls.find(
      ({ sql }) => sql.startsWith("UPDATE") && sql.includes('"LearningUnit"'),
    );
    expect(unitUpdate?.sql).toContain("\"unitKind\" = 'lesson'");
    expect(unitUpdate?.sql).toContain('"orderIndex" = 0');
    expect(unitUpdate?.sql).toContain("\"status\" = 'available'");
    expect(unitUpdate?.sql).toContain('"completionMethod" = NULL');
    expect(unitUpdate?.sql).toContain('"completionAttemptId" = NULL');
    expect(unitUpdate?.sql).toContain('"completedAt" = NULL');
    expect(unitUpdate?.sql).toContain(
      '"contentRevision" = "contentRevision" + 1',
    );

    const goalUpdate = fake.calls.find(
      ({ sql }) => sql.startsWith("UPDATE") && sql.includes('"LearningGoal"'),
    );
    expect(goalUpdate?.sql).toContain("\"overviewCourseStatus\" = 'skipped'");
  });

  it("does not mutate a non-overview or unowned unit", async () => {
    const fake = fakeManager({ goal: { id: "goal-1" } });
    const repository = new MikroOrmMicroUnitPublicationRepository(fake.manager);

    await expect(
      repository.upgradeOwnedOverviewToLesson({
        userId: "user-1",
        goalId: "goal-1",
        unitId: "unit-1",
        title: "Python fundamentals",
      }),
    ).resolves.toEqual({ status: "not_found" });
    expect(fake.calls).toHaveLength(2);
  });

  it("starts an owned micro conversion with the full-goal fence", async () => {
    const fake = fakeManager({ goal: { id: "goal-1" } });
    const repository = new MikroOrmMicroUnitPublicationRepository(fake.manager);

    await expect(
      repository.beginOwnedMicroGoalConversion({
        userId: "user-1",
        goalId: "goal-1",
        title: "Python programming",
        contentLanguage: "en",
      }),
    ).resolves.toEqual({ status: "started" });

    const update = fake.calls.find(
      ({ sql }) => sql.startsWith("UPDATE") && sql.includes('"LearningGoal"'),
    );
    expect(update?.sql).toContain("\"goalKind\" = 'full'");
    expect(update?.sql).toContain("\"mapPlanStatus\" = 'pending'");
    expect(update?.sql).toContain("\"detailedPlanStatus\" = 'stale'");
    expect(update?.params).toEqual(
      expect.arrayContaining(["Python programming", "en", "goal-1", "user-1"]),
    );
  });

  it("restores the owned micro goal and lesson after conversion failure", async () => {
    const fake = fakeManager({ goal: { id: "goal-1" } });
    const repository = new MikroOrmMicroUnitPublicationRepository(fake.manager);

    await expect(
      repository.restoreOwnedMicroGoal({
        userId: "user-1",
        goalId: "goal-1",
        unitId: "unit-1",
        originalUnit: {
          title: "Start with Python",
          contentSummary: "Variables and expressions.",
          unitKind: "lesson",
          difficulty: "beginner",
          prerequisites: "[]",
          status: "available",
        },
        title: "Python basics",
        mapPlanStatus: "skipped",
        detailedPlanStatus: "skipped",
        contentLanguage: "en",
        restoreContentLanguage: true,
      }),
    ).resolves.toEqual({ status: "restored", unitId: "unit-1" });

    expect(
      fake.calls.some(
        ({ sql }) => sql.startsWith("DELETE") && sql.includes('"LearningUnit"'),
      ),
    ).toBe(true);
    const insert = fake.calls.find(
      ({ sql }) => sql.startsWith("INSERT") && sql.includes('"LearningUnit"'),
    );
    expect(insert?.params).toEqual(
      expect.arrayContaining([
        "unit-1",
        "goal-1",
        "Start with Python",
        "Variables and expressions.",
      ]),
    );
    const update = fake.calls.find(
      ({ sql }) => sql.startsWith("UPDATE") && sql.includes('"LearningGoal"'),
    );
    expect(update?.sql).toContain("\"goalKind\" = 'micro'");
    expect(update?.params).toEqual(
      expect.arrayContaining(["skipped", "Python basics", "en"]),
    );
  });
});
