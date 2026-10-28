import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmMaterialRegenerationRepository } from "./material-regeneration.repository.ts";

type Call = { sql: string; params: readonly unknown[] };

function fakeManager(results: readonly unknown[]): {
  manager: EntityManager;
  calls: Call[];
} {
  const calls: Call[] = [];
  let resultIndex = 0;
  const manager = {
    getTransactionContext: () => undefined,
    getConnection: () => ({
      execute: async (sql: string, params: readonly unknown[] = []) => {
        calls.push({ sql, params });
        return results[resultIndex++];
      },
    }),
  } as unknown as EntityManager;
  return { manager, calls };
}

describe("material regeneration reference repository", () => {
  it("treats SQLite changes=1 as a successful section CAS", async () => {
    const state = fakeManager([
      [{ id: "unit-1" }],
      { changes: 1 },
      { changes: 1 },
      { changes: 1 },
      [{ contentRevision: 12 }],
    ]);
    const repository = new MikroOrmMaterialRegenerationRepository(state.manager);

    await expect(
      repository.persistSectionBlocks({
        userId: "user-1",
        unitId: "unit-1",
        sectionId: "section-1",
        expectedSectionRevision: 3,
        blocksJson: "[]",
      }),
    ).resolves.toEqual({ applied: true, contentRevision: 12 });

    expect(state.calls[1]?.sql).toContain("RETURNING");
    expect(state.calls[1]?.sql).toContain('"generationStatus"=\'ready\'');
  });

  it("rejects a missed section CAS", async () => {
    const state = fakeManager([[{ id: "unit-1" }], { changes: 0 }]);
    const repository = new MikroOrmMaterialRegenerationRepository(state.manager);

    await expect(
      repository.persistSectionBlocks({
        userId: "user-1",
        unitId: "unit-1",
        sectionId: "section-1",
        expectedSectionRevision: 3,
        blocksJson: "[]",
      }),
    ).resolves.toEqual({ applied: false, contentRevision: 3 });
  });
});
