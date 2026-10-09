import type { EntityManager } from "@mikro-orm/core";
import type { ModuleGenerationLeaseRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { MikroOrmModuleGenerationLeaseRepository } from "./module-generation-lease.repository.ts";

type Call = { sql: string; params: readonly unknown[] };

class SqlitePlatform {}

function fakeManager(results: readonly unknown[]): {
  manager: EntityManager;
  calls: Call[];
} {
  const calls: Call[] = [];
  let resultIndex = 0;
  const manager = {
    schema: "tenant_a",
    getTransactionContext: () => undefined,
    getConnection: () => ({
      getPlatform: () => new SqlitePlatform(),
      execute: async (sql: string, params: readonly unknown[] = []) => {
        calls.push({ sql, params });
        return results[resultIndex++];
      },
    }),
    transactional: async <T>(work: (em: EntityManager) => Promise<T>) =>
      work(manager as unknown as EntityManager),
  } as unknown as EntityManager;
  return { manager, calls };
}

describe("module generation lease reference repository", () => {
  it("claims a lease and token-fences failure finalization", async () => {
    const state = fakeManager([
      [
        {
          id: "module-1",
          goalId: "goal-1",
          unlockStatus: "unlocked",
          generationStatus: "pending",
          generationBuildStartedAt: null,
        },
      ],
      undefined,
      [{ id: "module-1" }],
      [],
    ]);
    const repository: ModuleGenerationLeaseRepository =
      new MikroOrmModuleGenerationLeaseRepository(state.manager);
    const startedAt = new Date("2026-08-09T00:00:00.000Z");

    await expect(
      repository.claim({
        goalId: "goal-1",
        moduleId: "module-1",
        token: "lease-1",
        startedAt,
        allowLockedBeforeNavigation: false,
      }),
    ).resolves.toEqual({ claimed: true });
    await expect(
      repository.fail({
        goalId: "goal-1",
        moduleId: "module-1",
        token: "lease-1",
        message: "generation failed",
      }),
    ).resolves.toEqual({ applied: true });
    await expect(
      repository.fail({
        goalId: "goal-1",
        moduleId: "module-1",
        token: "superseded",
        message: "late failure",
      }),
    ).resolves.toEqual({ applied: false });

    expect(state.calls).toHaveLength(4);
    expect(state.calls[2].sql).toContain("\"generationStatus\" = 'failed'");
    expect(state.calls[2].sql).toContain('"generationBuildToken" = NULL');
    expect(state.calls[2].params).toEqual([
      "generation failed",
      expect.any(Date),
      "module-1",
      "goal-1",
      "lease-1",
    ]);
    expect(state.calls[3].params).toContain("superseded");
  });

  it("releases a successful publication lease without failing the module", async () => {
    const state = fakeManager([[{ id: "module-1" }]]);
    const repository: ModuleGenerationLeaseRepository =
      new MikroOrmModuleGenerationLeaseRepository(state.manager);

    await expect(
      repository.release({
        goalId: "goal-1",
        moduleId: "module-1",
        token: "lease-1",
      }),
    ).resolves.toEqual({ applied: true });
    expect(state.calls[0].sql).toContain('"generationBuildToken" = NULL');
    expect(state.calls[0].sql).toContain('"generationBuildStartedAt" = NULL');
    expect(state.calls[0].sql).not.toContain("\"generationStatus\" = 'failed'");
    expect(state.calls[0].params).toEqual([
      expect.any(Date),
      "module-1",
      "goal-1",
      "lease-1",
    ]);
  });
});
