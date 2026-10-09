import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmUnitDeliveryReadRepository } from "./unit-delivery-read.repository.ts";

describe("unit delivery reference repository", () => {
  it("hydrates a SQLite JSON theater definition for stable content reads", async () => {
    const definition = {
      version: 2,
      type: "scenario_theater",
      title: "Async incident response",
    };
    const execute = jest.fn().mockResolvedValueOnce([
      {
        goalId: "goal-1",
        status: "prepared",
        recommended: 0,
        recommendation: "",
        revision: 1,
        definitionJson: JSON.stringify(definition),
        generationError: "",
      },
    ]);
    const em = {
      schema: undefined,
      config: { getSchema: () => undefined },
      getTransactionContext: () => undefined,
      getConnection: () => ({ execute }),
    } as unknown as EntityManager;

    const repository = new MikroOrmUnitDeliveryReadRepository(em);

    await expect(
      repository.findScenarioContent({ userId: "user-1", unitId: "unit-1" }),
    ).resolves.toMatchObject({ definitionJson: definition });
  });

  it("hydrates SQLite epoch timestamps for an active scenario run", async () => {
    const startedAt = 1_786_612_671_757;
    const completedAt = 1_786_612_700_000;
    const execute = jest
      .fn()
      .mockResolvedValueOnce([
        { id: "theater-1", status: "prepared", revision: 1 },
      ])
      .mockResolvedValueOnce([
        {
          id: "run-1",
          theaterRevision: 1,
          runVersion: 2,
          status: "active",
          currentSceneId: "scene-1",
          metersJson: "{}",
          pathJson: "[]",
          endingId: null,
          startedAt,
          completedAt: String(completedAt),
        },
      ])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ status: "building" }]);
    const em = {
      schema: undefined,
      config: { getSchema: () => undefined },
      getTransactionContext: () => undefined,
      getConnection: () => ({ execute }),
    } as unknown as EntityManager;

    const repository = new MikroOrmUnitDeliveryReadRepository(em);
    const result = await repository.findScenarioSession({
      userId: "user-1",
      unitId: "unit-1",
    });

    expect(result?.activeRun?.startedAt.toISOString()).toBe(
      "2026-08-13T09:17:51.757Z",
    );
    expect(result?.activeRun?.completedAt?.toISOString()).toBe(
      "2026-08-13T09:18:20.000Z",
    );
    expect(result?.currentSceneStatus).toBe("building");
  });
});
