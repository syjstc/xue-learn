import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmLegacyMapReplacementRepository } from "./legacy-map-replacement.repository.ts";

function fakeManager(options?: { goal?: Record<string, unknown> }) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const connection = {
    execute: jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      if (sql.includes('FROM "LearningGoal"')) {
        return options?.goal ? [options.goal] : [];
      }
      if (sql.includes('FROM "LearningUnit"')) {
        return [
          {
            id: "unit-1",
            title: "Root",
            unitKind: "lesson",
            parentUnitId: null,
            orderIndex: 0,
            difficulty: "medium",
            contentSummary: "Summary",
            prerequisites: "[]",
          },
        ];
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

const unit = {
  ref: "Root",
  parentRef: null,
  prerequisiteRefs: [],
  unitKind: "lesson" as const,
  title: "Root",
  orderIndex: 0,
  difficulty: "medium",
  contentSummary: "Summary",
  planAreaRef: "a_1",
  planningOutcomeRefs: [],
  curriculumKey: null,
  cognitiveModelStatus: "pending" as const,
  learningTargets: [],
};

describe("legacy map replacement repository", () => {
  it("replaces the owned goal map and returns the new unit projection", async () => {
    const fake = fakeManager({ goal: { id: "goal-1", userId: "user-1" } });
    const repository = new MikroOrmLegacyMapReplacementRepository(fake.manager);

    await expect(
      repository.replaceOwned({
        userId: "user-1",
        goalId: "goal-1",
        title: "Updated goal",
        level: "basic",
        domainTag: "programming",
        pathSource: "search",
        contentLanguage: "en",
        goalKind: "full",
        mapPlanStatus: "pending",
        mapSummaryStatus: "skipped",
        detailedPlanStatus: "ready",
        units: [unit],
      }),
    ).resolves.toEqual({
      status: "replaced",
      goal: {
        id: "goal-1",
        userId: "user-1",
        title: "Updated goal",
        level: "basic",
        domainTag: "programming",
        pathSource: "search",
        contentLanguage: "en",
      },
      units: [
        {
          id: "unit-1",
          title: "Root",
          unitKind: "lesson",
          parentUnitId: null,
          orderIndex: 0,
          difficulty: "medium",
          contentSummary: "Summary",
          prerequisites: "[]",
        },
      ],
    });
    expect(fake.calls.some((call) => call.sql.startsWith("DELETE"))).toBe(true);
    expect(
      fake.calls.filter((call) => call.sql.startsWith("INSERT")),
    ).toHaveLength(1);
    const update = fake.calls.find((call) => call.sql.startsWith("UPDATE"));
    expect(update?.params).toEqual(
      expect.arrayContaining(["full", "pending", "skipped", "ready"]),
    );
  });

  it("rejects missing ownership and invalid references before mutation", async () => {
    const missing = new MikroOrmLegacyMapReplacementRepository(
      fakeManager().manager,
    );
    await expect(
      missing.replaceOwned({
        userId: "user-1",
        goalId: "goal-1",
        title: "Goal",
        level: "basic",
        domainTag: "general",
        pathSource: "generic",
        contentLanguage: "en",
        units: [unit],
      }),
    ).resolves.toEqual({ status: "not_found" });

    const invalid = new MikroOrmLegacyMapReplacementRepository(
      fakeManager({ goal: { id: "goal-1", userId: "user-1" } }).manager,
    );
    await expect(
      invalid.replaceOwned({
        userId: "user-1",
        goalId: "goal-1",
        title: "Goal",
        level: "basic",
        domainTag: "general",
        pathSource: "generic",
        contentLanguage: "en",
        units: [{ ...unit, parentRef: "missing" }],
      }),
    ).resolves.toEqual({
      status: "invalid_input",
      reason: "missing parent ref: missing",
    });
  });
});
