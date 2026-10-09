import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmDiagnosticRemediationRepository } from "./diagnostic-remediation.repository.ts";

describe("MikroOrmDiagnosticRemediationRepository", () => {
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
      repository: new MikroOrmDiagnosticRemediationRepository(em),
      execute,
    };
  }

  const input = {
    userId: "user-1",
    sourceUnitId: "unit-1",
    attemptId: "attempt-1",
    weakTargets: [
      { learningTargetId: "target-1", title: "Target", score: 0.2 },
    ],
  };

  it("returns no remediation for an out-of-scope source unit", async () => {
    const { repository, execute } = repositoryWithResults([]);

    await expect(repository.upsert(input)).resolves.toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not touch persistence when all targets are already resolved", async () => {
    const { repository, execute } = repositoryWithResults();

    await expect(
      repository.upsert({ ...input, weakTargets: [] }),
    ).resolves.toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("resolves only learner-owned remediation units", async () => {
    const { repository, execute } = repositoryWithResults({ affectedRows: 1 });

    await expect(
      repository.resolve({
        userId: "user-1",
        sourceUnitId: "unit-1",
        completedAt: new Date("2026-08-10T00:00:00.000Z"),
      }),
    ).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][1]).toEqual([
      new Date("2026-08-10T00:00:00.000Z"),
      "unit-1",
      "user-1",
    ]);
  });
});
