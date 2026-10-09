import type { EntityManager } from "@mikro-orm/core";
import type { CognitiveModelExpansionLeaseRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { MikroOrmCognitiveModelExpansionLeaseRepository } from "./cognitive-model-expansion-lease.repository.ts";

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

const baseInput = {
  userId: "user-1",
  goalId: "goal-1",
  unitId: "unit-1",
  inputHash: "hash-1",
  token: "token-1",
  startedAt: new Date("2026-08-09T00:00:00.000Z"),
  staleBefore: new Date("2026-08-08T23:45:00.000Z"),
  hasLearningTargets: true,
};

describe("cognitive-model expansion lease reference repository", () => {
  it("claims an owned unit and updates the goal lease state", async () => {
    const state = fakeManager([
      [{ id: "goal-1", cognitiveModelInputHash: "hash-1" }],
      [
        {
          id: "unit-1",
          unitKind: "lesson",
          cognitiveModelStatus: "pending",
          cognitiveModelBuildStartedAt: null,
          cognitiveModelBuildInputHash: null,
        },
      ],
      [{ id: "unit-1" }],
      [{ id: "goal-1" }],
    ]);
    const repository: CognitiveModelExpansionLeaseRepository =
      new MikroOrmCognitiveModelExpansionLeaseRepository(state.manager);

    await expect(repository.claim(baseInput)).resolves.toEqual({
      status: "claimed",
    });
    expect(state.calls).toHaveLength(4);
    expect(state.calls[2].sql).toContain(
      "\"cognitiveModelStatus\" = 'building'",
    );
    expect(state.calls[3].sql).toContain('"cognitiveModelStatus" = CASE');
  });

  it("joins a fresh lease and reports an already expanded unit as complete", async () => {
    const recent = fakeManager([
      [{ id: "goal-1", cognitiveModelInputHash: "hash-1" }],
      [
        {
          id: "unit-1",
          unitKind: "lesson",
          cognitiveModelStatus: "building",
          cognitiveModelBuildStartedAt: new Date("2026-08-09T00:00:00.000Z"),
          cognitiveModelBuildInputHash: "hash-1",
        },
      ],
    ]);
    const complete = fakeManager([
      [{ id: "goal-1", cognitiveModelInputHash: "hash-1" }],
      [
        {
          id: "unit-1",
          unitKind: "lesson",
          cognitiveModelStatus: "expanded",
          cognitiveModelBuildStartedAt: null,
          cognitiveModelBuildInputHash: "hash-1",
        },
      ],
    ]);

    await expect(
      new MikroOrmCognitiveModelExpansionLeaseRepository(recent.manager).claim(
        baseInput,
      ),
    ).resolves.toEqual({ status: "join" });
    await expect(
      new MikroOrmCognitiveModelExpansionLeaseRepository(
        complete.manager,
      ).claim(baseInput),
    ).resolves.toEqual({ status: "complete" });
    expect(recent.calls).toHaveLength(2);
    expect(complete.calls).toHaveLength(2);
  });

  it("takes over a stale building lease with a fresh token", async () => {
    const state = fakeManager([
      [{ id: "goal-1", cognitiveModelInputHash: "hash-1" }],
      [
        {
          id: "unit-1",
          unitKind: "lesson",
          cognitiveModelStatus: "building",
          cognitiveModelBuildStartedAt: new Date("2026-08-08T00:00:00.000Z"),
          cognitiveModelBuildInputHash: "hash-1",
        },
      ],
      [{ id: "unit-1" }],
      [{ id: "goal-1" }],
    ]);

    await expect(
      new MikroOrmCognitiveModelExpansionLeaseRepository(state.manager).claim({
        ...baseInput,
        token: "replacement-token",
      }),
    ).resolves.toEqual({ status: "claimed" });
    expect(state.calls[2].params).toContain("replacement-token");
  });

  it("rejects an owner or input-hash mismatch before writing", async () => {
    const state = fakeManager([
      [{ id: "goal-1", cognitiveModelInputHash: "new-hash" }],
    ]);
    const repository = new MikroOrmCognitiveModelExpansionLeaseRepository(
      state.manager,
    );

    await expect(repository.claim(baseInput)).rejects.toThrow(
      "Course map changed during cognitive-model preparation",
    );
    expect(state.calls).toHaveLength(1);
  });
});
