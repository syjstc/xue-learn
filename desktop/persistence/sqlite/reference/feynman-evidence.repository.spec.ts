import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmFeynmanEvidenceRepository } from "./feynman-evidence.repository.ts";

describe("MikroOrmFeynmanEvidenceRepository", () => {
  class SqlitePlatform {}

  function repositoryWithResults(...results: unknown[]) {
    const execute = jest.fn();
    for (const result of results) execute.mockResolvedValueOnce(result);
    const em = {
      getConnection: () => ({
        execute,
        getPlatform: () => new SqlitePlatform(),
      }),
      getTransactionContext: () => undefined,
      config: { getSchema: () => undefined },
      schema: undefined,
    } as unknown as EntityManager;
    return {
      repository: new MikroOrmFeynmanEvidenceRepository(em),
      execute,
    };
  }

  it("writes an idempotent session shell through the scoped ORM boundary", async () => {
    const { repository, execute } = repositoryWithResults(
      [{ id: "unit-1", goalId: "goal-1", userId: "user-1" }],
      [],
    );

    await expect(
      repository.record({
        userId: "user-1",
        goalId: "goal-1",
        unitId: "unit-1",
        userText: "explanation",
        feedback: { passed: false },
        passed: false,
        observations: [],
      }),
    ).resolves.toEqual({
      feynmanSessionId: expect.stringMatching(/^feynman_[a-f0-9]{32}$/),
      observationCount: 0,
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][1]).toEqual(["unit-1", "goal-1"]);
  });

  it("rejects a unit outside the learner-owned goal scope", async () => {
    const { repository, execute } = repositoryWithResults([]);

    await expect(
      repository.record({
        userId: "user-1",
        goalId: "goal-1",
        unitId: "unit-1",
        userText: "explanation",
        feedback: {},
        passed: false,
        observations: [],
      }),
    ).rejects.toMatchObject({ code: "ownership_mismatch" });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
