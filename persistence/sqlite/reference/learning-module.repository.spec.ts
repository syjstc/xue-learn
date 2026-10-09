import type { EntityManager } from "@mikro-orm/core";
import type { LearningModuleRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { MikroOrmLearningModuleRepository } from "./learning-module.repository.ts";

describe("learning module reference repository", () => {
  it("reads an owner-scoped, ordered projection and normalizes JSON", async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const manager = {
      schema: "tenant_a",
      getConnection: () => ({
        execute: async (sql: string, params: readonly unknown[]) => {
          calls.push({ sql, params });
          return [
            {
              id: "module-1",
              curriculumKey: "m-1",
              goalId: "goal-1",
              planRef: "area-1",
              orderIndex: 0,
              title: "基础",
              summary: "summary",
              objective: "objective",
              plannedOutcomes: '["o-1"]',
              unlockStatus: "unlocked",
              generationStatus: "ready",
              generationVersion: 2,
              createdAt: new Date("2026-08-09T00:00:00.000Z"),
              updatedAt: new Date("2026-08-09T00:00:00.000Z"),
            },
          ];
        },
      }),
    } as unknown as EntityManager;
    const repository: LearningModuleRepository =
      new MikroOrmLearningModuleRepository(manager);

    await expect(
      repository.listOwnedForGoal("user-1", "goal-1"),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "module-1",
        plannedOutcomes: ["o-1"],
        generationVersion: 2,
      }),
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      sql: expect.stringContaining('FROM "tenant_a"."LearningModule"'),
      params: ["goal-1", "user-1"],
    });
  });
});
