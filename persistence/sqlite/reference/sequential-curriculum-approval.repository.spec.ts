import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmSequentialCurriculumApprovalRepository } from "./sequential-curriculum-approval.repository.ts";

type ExecuteCall = { sql: string; params: unknown[] };

function fakeManager(options?: {
  goal?: Record<string, unknown>;
  modules?: Array<Record<string, unknown>>;
}) {
  const calls: ExecuteCall[] = [];
  const connection = {
    execute: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('FROM "LearningGoal"')) {
        return options?.goal ? [options.goal] : [];
      }
      if (sql.includes('FROM "LearningModule"')) {
        return options?.modules ?? [];
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

const modulePlan = {
  title: "Foundations",
  summary: "Build the first foundation.",
  objective: "Explain the core model.",
  plannedOutcomes: ["Explain the core model."],
  entryFoundationBriefs: [],
  exitCapabilityBriefs: ["Explain the core model."],
  estimatedUnitCount: 3,
  unitPlanningBrief: {
    scopeSize: "compact" as const,
    rationale: "A focused start.",
    progression: ["Define", "Explain"],
  },
};

describe("sequential curriculum approval repository", () => {
  it("locks and verifies goal ownership before creating module stubs", async () => {
    const fake = fakeManager({
      goal: { id: "goal-1", learningMode: "mastery" },
    });
    const repository = new MikroOrmSequentialCurriculumApprovalRepository(
      fake.manager,
    );

    await expect(
      repository.persistOwned({
        userId: "user-1",
        goalId: "goal-1",
        modules: [modulePlan],
        enqueueFirst: false,
      }),
    ).resolves.toMatchObject({ status: "created" });

    const goalSelect = fake.calls.find((call) =>
      call.sql.includes('FROM "LearningGoal"'),
    );
    expect(goalSelect?.sql).toContain('"userId" = ?');
    expect(goalSelect?.params).toEqual(["goal-1", "user-1"]);
    expect(
      fake.calls.filter((call) => call.sql.startsWith("INSERT")).length,
    ).toBe(1);
    expect(
      fake.calls.filter((call) => call.sql.startsWith("UPDATE")).length,
    ).toBe(1);
  });

  it("creates unlocked exploration stubs and the optional first-module event", async () => {
    const fake = fakeManager({
      goal: { id: "goal-1", learningMode: "exploration" },
    });
    const repository = new MikroOrmSequentialCurriculumApprovalRepository(
      fake.manager,
    );

    const result = await repository.persistOwned({
      userId: "user-1",
      goalId: "goal-1",
      modules: [modulePlan, { ...modulePlan, title: "Practice" }],
    });

    expect(result.status).toBe("created");
    expect(result.firstModuleId).toEqual(expect.any(String));
    const inserts = fake.calls.filter((call) => call.sql.startsWith("INSERT"));
    expect(inserts).toHaveLength(3);
    expect(inserts[0].params).toEqual(
      expect.arrayContaining(["m_1", "unlocked", expect.any(Date)]),
    );
    expect(inserts[2].params).toEqual(
      expect.arrayContaining([
        "course.module.generate",
        expect.stringContaining('"reason":"plan_approved"'),
      ]),
    );
  });

  it("is idempotent when module stubs already exist", async () => {
    const fake = fakeManager({
      goal: { id: "goal-1", learningMode: "mastery" },
      modules: [{ id: "module-1" }],
    });
    const repository = new MikroOrmSequentialCurriculumApprovalRepository(
      fake.manager,
    );

    await expect(
      repository.persistOwned({
        userId: "user-1",
        goalId: "goal-1",
        modules: [modulePlan],
      }),
    ).resolves.toEqual({ status: "existing", firstModuleId: "module-1" });
    expect(fake.calls.some((call) => call.sql.startsWith("UPDATE"))).toBe(
      false,
    );
  });
});
