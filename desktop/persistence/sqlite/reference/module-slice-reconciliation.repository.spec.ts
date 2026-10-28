import type { EntityManager } from "@mikro-orm/core";
import type { ModuleSliceReconciliationRepository } from "@xue-learn/core/domain";
import { MikroOrmModuleSliceReconciliationRepository } from "./module-slice-reconciliation.repository.ts";

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
  } as unknown as EntityManager;
  return { manager, calls };
}

describe("module slice reconciliation reference repository", () => {
  it("reconciles only owned, hash-matched modules and re-arms their lessons", async () => {
    const state = fakeManager([
      [{ id: "goal-1" }],
      [{ id: "module-1" }],
      { affectedRows: 2 },
      [],
    ]);
    const repository: ModuleSliceReconciliationRepository =
      new MikroOrmModuleSliceReconciliationRepository(state.manager);

    await expect(
      repository.reconcile({
        userId: "user-1",
        goalId: "goal-1",
        goalInputHash: "goal-hash-2",
        modules: [
          {
            moduleId: "module-1",
            expectedGenerationInputHash: "old-hash",
            nextGenerationInputHash: "new-hash",
          },
          {
            moduleId: "module-2",
            expectedGenerationInputHash: "old-two",
            nextGenerationInputHash: "new-two",
          },
        ],
        updatedAt: new Date("2026-08-09T00:00:00.000Z"),
      }),
    ).resolves.toEqual({ reconciledModuleIds: ["module-1"] });

    expect(state.calls).toHaveLength(4);
    expect(state.calls[1].sql).toContain('"generationStatus" = CASE');
    expect(state.calls[1].sql).toContain(
      '"generationInputHash" IS NULL AND ? IS NULL',
    );
    expect(state.calls[2].sql).toContain(
      "\"cognitiveModelStatus\" = 'pending'",
    );
    expect(state.calls[1].params).toEqual([
      "new-hash",
      new Date("2026-08-09T00:00:00.000Z"),
      "module-1",
      "goal-1",
      "user-1",
      "goal-hash-2",
      "old-hash",
      "old-hash",
    ]);
  });

  it("rejects an owner or goal-input mismatch before writing", async () => {
    const state = fakeManager([[]]);
    const repository = new MikroOrmModuleSliceReconciliationRepository(
      state.manager,
    );

    await expect(
      repository.reconcile({
        userId: "not-the-owner",
        goalId: "goal-1",
        goalInputHash: "stale-hash",
        modules: [],
        updatedAt: new Date(),
      }),
    ).rejects.toThrow("Goal ownership or cognitive-model input changed");
    expect(state.calls).toHaveLength(1);
  });
});
