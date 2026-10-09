import type { EntityManager } from "@mikro-orm/core";
import type { CognitiveModelPublicationFinalizationRepository } from "@xue-learn/core/domain";

import { MikroOrmCognitiveModelPublicationFinalizationRepository } from "./cognitive-model-publication-finalization.repository.ts";

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

const input = {
  goalId: "goal-1",
  unitId: "unit-1",
  inputHash: "hash-1",
  snapshotJson: JSON.stringify({ units: [{ unitId: "unit-1" }] }),
  auditJson: JSON.stringify({ phase: "finalized" }),
  allExpanded: true,
};

describe("cognitive-model publication finalization reference repository", () => {
  it("publishes a candidate and finalizes the goal in one adapter operation", async () => {
    const state = fakeManager([
      [
        {
          id: "goal-1",
          cognitiveModelInputHash: "hash-1",
          cognitiveModelPublishedHash: "hash-1",
          cognitiveModelVersion: 0,
          curriculumVersion: 1,
        },
      ],
      [
        {
          id: "unit-1",
          cognitiveModelStatus: "expanded",
          cognitiveModelBuildInputHash: "hash-1",
          targetCount: 1,
        },
      ],
      [],
      [
        {
          id: "unit-1",
          cognitiveModelStatus: "expanded",
          cognitiveModelBuildInputHash: "hash-1",
          targetCount: 1,
        },
      ],
      [],
      [{ version: 0 }],
      undefined,
      undefined,
      undefined,
      [],
      undefined,
    ]);
    const repository: CognitiveModelPublicationFinalizationRepository =
      new MikroOrmCognitiveModelPublicationFinalizationRepository(
        state.manager,
      );

    await expect(repository.finalize(input)).resolves.toEqual({
      goalId: "goal-1",
      unitId: "unit-1",
      inputHash: "hash-1",
      status: "already_expanded",
      published: true,
      version: 1,
    });
    expect(state.calls).toHaveLength(11);
    expect(state.calls[6].sql).toContain(
      'INSERT INTO "tenant_a"."CognitiveModelRevision"',
    );
    expect(state.calls[7].sql).toContain("SET \"status\" = 'published'");
    expect(state.calls[10].sql).toContain('"cognitiveModelStatus" = ?');
  });

  it("is idempotent when the latest full snapshot already contains the unit", async () => {
    const state = fakeManager([
      [
        {
          cognitiveModelInputHash: "hash-1",
          cognitiveModelPublishedHash: "hash-1",
          cognitiveModelVersion: 4,
          curriculumVersion: 1,
        },
      ],
      [
        {
          cognitiveModelStatus: "expanded",
          cognitiveModelBuildInputHash: "hash-1",
          targetCount: 1,
        },
      ],
      [{ version: 4, snapshotJson: { units: [{ unitId: "unit-1" }] } }],
    ]);
    const repository =
      new MikroOrmCognitiveModelPublicationFinalizationRepository(
        state.manager,
      );

    await expect(repository.finalize(input)).resolves.toMatchObject({
      version: 4,
      status: "already_expanded",
    });
    expect(state.calls).toHaveLength(3);
  });

  it("returns null without writes when the goal hash is stale", async () => {
    const state = fakeManager([
      [
        {
          cognitiveModelInputHash: "new-hash",
          cognitiveModelPublishedHash: "new-hash",
        },
      ],
    ]);
    const repository =
      new MikroOrmCognitiveModelPublicationFinalizationRepository(
        state.manager,
      );

    await expect(repository.finalize(input)).resolves.toBeNull();
    expect(state.calls).toHaveLength(1);
  });
});
