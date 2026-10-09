import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmScenarioTheaterSessionRepository } from "./scenario-theater-session.repository.ts";

describe("scenario theater session reference repository", () => {
  it("hydrates SQLite epoch timestamps as valid run dates", async () => {
    const startedAt = 1_786_611_100_000;
    const completedAt = 1_786_611_200_000;
    const em = {
      schema: undefined,
      config: { getSchema: () => undefined },
      getTransactionContext: () => undefined,
      getConnection: () => ({
        execute: async () => [
          {
            id: "run-1",
            theaterRevision: 1,
            runVersion: 2,
            status: "completed",
            currentSceneId: null,
            metersJson: "{}",
            pathJson: "[]",
            endingId: "ending-1",
            startedAt,
            completedAt: String(completedAt),
          },
        ],
      }),
    } as unknown as EntityManager;

    const repository = new MikroOrmScenarioTheaterSessionRepository(em);
    const run = await repository.findRun({
      userId: "user-1",
      unitId: "unit-1",
      runId: "run-1",
    });

    expect(run?.startedAt.toISOString()).toBe("2026-08-13T08:51:40.000Z");
    expect(run?.completedAt?.toISOString()).toBe("2026-08-13T08:53:20.000Z");
  });

  it("uses run mode so a committed SQLite choice is reported as saved", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([{ id: "run-1" }])
      .mockImplementationOnce(
        async (
          _sql: string,
          _params: unknown[],
          method: "all" | "run" | undefined,
        ) => (method === "run" ? { affectedRows: 1 } : []),
      );
    const em = {
      schema: undefined,
      config: { getSchema: () => undefined },
      getTransactionContext: () => undefined,
      getConnection: () => ({ execute }),
    } as unknown as EntityManager;

    const repository = new MikroOrmScenarioTheaterSessionRepository(em);
    const outcome = await repository.commitChoice({
      userId: "user-1",
      unitId: "unit-1",
      runId: "run-1",
      theaterId: "theater-1",
      theaterRevision: 1,
      runVersion: 1,
      sceneId: "scene-1",
      currentSceneId: "scene-2",
      metersJson: { trust: 55 },
      pathJson: [{ sceneId: "scene-1", choiceId: "choice-1" }],
      endingId: null,
      completed: false,
    });

    expect(outcome).toBe("saved");
    expect(execute).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE "ScenarioTheaterRun"'),
      expect.any(Array),
      "run",
      undefined,
    );
  });
});
