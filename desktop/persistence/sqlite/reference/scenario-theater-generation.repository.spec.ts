import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmScenarioTheaterGenerationRepository } from "./scenario-theater-generation.repository.ts";

describe("scenario theater generation reference repository", () => {
  function repositoryWithResult(result: unknown) {
    const execute = jest.fn().mockResolvedValue(result);
    const em = {
      schema: undefined,
      config: { getSchema: () => undefined },
      getTransactionContext: () => undefined,
      getConnection: () => ({ execute }),
    } as unknown as EntityManager;
    return {
      execute,
      repository: new MikroOrmScenarioTheaterGenerationRepository(em),
    };
  }

  it("recognizes a scene claimed through UPDATE RETURNING", async () => {
    const { repository, execute } = repositoryWithResult([
      { sceneId: "scene-0" },
    ]);

    await expect(
      repository.claimScene({
        theaterId: "theater-1",
        revision: 1,
        sceneId: "scene-0",
        staleBefore: new Date("2026-08-13T00:00:00.000Z"),
      }),
    ).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('RETURNING "sceneId"'),
      expect.any(Array),
      undefined,
      undefined,
    );
  });

  it("does not claim a scene updated by another worker", async () => {
    const { repository } = repositoryWithResult([]);

    await expect(
      repository.claimScene({
        theaterId: "theater-1",
        revision: 1,
        sceneId: "scene-0",
        staleBefore: new Date("2026-08-13T00:00:00.000Z"),
      }),
    ).resolves.toBe(false);
  });
});
