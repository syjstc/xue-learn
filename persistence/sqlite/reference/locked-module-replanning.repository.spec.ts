import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmLockedModuleReplanningRepository } from "./locked-module-replanning.repository.ts";

function fakeManager(options?: {
  goal?: boolean;
  modules?: Array<Record<string, unknown>>;
}) {
  const calls: string[] = [];
  const connection = {
    execute: jest.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes('FROM "LearningGoal"')) {
        return options?.goal === false ? [] : [{ id: "goal-1" }];
      }
      if (sql.includes('FROM "LearningModule"')) {
        return options?.modules ?? [{ id: "module-1", unlockStatus: "locked" }];
      }
      return [];
    }),
    getPlatform: () => ({ constructor: { name: "SqlitePlatform" } }),
    getTransactionContext: () => undefined,
  };
  return {
    manager: {
      getConnection: () => connection,
      getTransactionContext: () => undefined,
    } as unknown as EntityManager,
    calls,
  };
}

const replacement = {
  title: "Replanned module",
  summary: "A focused summary",
  objective: "Reach the next milestone",
  plannedOutcomes: ["Outcome"],
  entryFoundationBriefs: [],
  exitCapabilityBriefs: ["Capability"],
  unitPlanningBrief: {
    scopeSize: "compact" as const,
    rationale: "Keep it focused",
    progression: ["Step one"],
  },
  estimatedUnitCount: 2,
};

describe("locked module replanning repository", () => {
  it("updates locked modules and the goal plan atomically", async () => {
    const fake = fakeManager();
    const repository = new MikroOrmLockedModuleReplanningRepository(
      fake.manager,
    );

    await expect(
      repository.replanOwned({
        userId: "user-1",
        goalId: "goal-1",
        replacements: { "module-1": replacement },
        mapPlanJson: '{"schemaVersion":2}',
      }),
    ).resolves.toEqual({ status: "updated", moduleIds: ["module-1"] });
    expect(fake.calls.filter((sql) => sql.startsWith("UPDATE"))).toHaveLength(
      2,
    );
  });

  it("refuses missing goals, empty replacements, and unlocked modules", async () => {
    const missingGoal = new MikroOrmLockedModuleReplanningRepository(
      fakeManager({ goal: false }).manager,
    );
    await expect(
      missingGoal.replanOwned({
        userId: "user-1",
        goalId: "goal-1",
        replacements: { "module-1": replacement },
        mapPlanJson: "{}",
      }),
    ).resolves.toEqual({ status: "goal_not_found" });

    const empty = new MikroOrmLockedModuleReplanningRepository(
      fakeManager().manager,
    );
    await expect(
      empty.replanOwned({
        userId: "user-1",
        goalId: "goal-1",
        replacements: {},
        mapPlanJson: "{}",
      }),
    ).resolves.toEqual({ status: "replacement_required" });

    const unlocked = new MikroOrmLockedModuleReplanningRepository(
      fakeManager({
        modules: [{ id: "module-1", unlockStatus: "unlocked" }],
      }).manager,
    );
    await expect(
      unlocked.replanOwned({
        userId: "user-1",
        goalId: "goal-1",
        replacements: { "module-1": replacement },
        mapPlanJson: "{}",
      }),
    ).resolves.toEqual({
      status: "module_not_locked",
      moduleId: "module-1",
    });
  });
});
