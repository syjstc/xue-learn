import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmGoalModuleReadRepository } from "./goal-module-read.repository.ts";

describe("goal module read repository", () => {
  it("normalizes raw SQL timestamp strings for the journey projection", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: "module-1",
          plannedOutcomes: "[]",
          entryFoundationBriefs: "[]",
          exitCapabilityBriefs: "[]",
          unitPlanningBrief: "{}",
          unlockedAt: "2026-08-10T09:00:00.000Z",
          generatedAt: "2026-08-10T09:05:00.000Z",
          completedAt: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "unit-1",
          completedAt: "2026-08-10T09:10:00.000Z",
          nextReviewAt: "2026-08-11T09:10:00.000Z",
          intervalDays: 1,
          moduleCapabilityRefs: "[]",
          planningOutcomeRefs: "[]",
        },
      ]);
    const manager = {
      getConnection: () => ({ execute }),
      getTransactionContext: () => undefined,
      config: { getSchema: () => undefined },
      schema: undefined,
    } as unknown as EntityManager;

    const [module] = await new MikroOrmGoalModuleReadRepository(
      manager,
    ).listJourney("goal-1");

    expect(module?.unlockedAt).toEqual(
      new Date("2026-08-10T09:00:00.000Z"),
    );
    expect(module?.generatedAt).toEqual(
      new Date("2026-08-10T09:05:00.000Z"),
    );
    expect(module?.units[0]?.completedAt).toEqual(
      new Date("2026-08-10T09:10:00.000Z"),
    );
    expect(module?.units[0]?.reviewCard?.nextReviewAt).toEqual(
      new Date("2026-08-11T09:10:00.000Z"),
    );
  });

  it("normalizes SQLite millisecond timestamps for the journey projection", async () => {
    const unlockedAt = 1_786_525_442_539;
    const completedAt = 1_786_525_742_539;
    const nextReviewAt = 1_786_612_142_539;
    const execute = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: "module-1",
          plannedOutcomes: "[]",
          entryFoundationBriefs: "[]",
          exitCapabilityBriefs: "[]",
          unitPlanningBrief: "{}",
          unlockedAt,
          generatedAt: null,
          completedAt: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "unit-1",
          completedAt,
          nextReviewAt,
          intervalDays: 1,
          moduleCapabilityRefs: "[]",
          planningOutcomeRefs: "[]",
        },
      ]);
    const manager = {
      getConnection: () => ({ execute }),
      getTransactionContext: () => undefined,
      config: { getSchema: () => undefined },
      schema: undefined,
    } as unknown as EntityManager;

    const [module] = await new MikroOrmGoalModuleReadRepository(
      manager,
    ).listJourney("goal-1");

    expect(module?.unlockedAt?.getTime()).toBe(unlockedAt);
    expect(module?.units[0]?.completedAt?.getTime()).toBe(completedAt);
    expect(module?.units[0]?.reviewCard?.nextReviewAt?.getTime()).toBe(
      nextReviewAt,
    );
  });
});
