import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmModuleGenerationRetryRepository } from "./module-generation-retry.repository.ts";

type Call = { sql: string; params: readonly unknown[] };

class SqlitePlatform {}

function fakeManager(results: readonly unknown[]): {
  manager: EntityManager;
  calls: Call[];
} {
  const calls: Call[] = [];
  let resultIndex = 0;
  const manager = {
    schema: undefined,
    config: { getSchema: () => undefined },
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

function isoTimestamp(params: readonly unknown[]): string {
  const value = params.find(
    (param) => typeof param === "string" && /^\d{4}-\d{2}-\d{2}T/.test(param),
  );
  if (typeof value !== "string") {
    throw new Error("Expected an ISO timestamp parameter");
  }
  return value;
}

describe("module generation retry reference repository", () => {
  const moduleRow = {
    id: "module-1",
    goalId: "goal-1",
    unlockStatus: "unlocked",
    generationStatus: "building",
    learningMode: "mastery",
    cognitiveModelInputHash: "hash-1",
    cognitiveModelPublishedHash: "hash-1",
    cognitiveModelVersion: 1,
  };

  it("enqueues expand_next with SQLite-safe ISO nextAttemptAt", async () => {
    const state = fakeManager([
      [moduleRow],
      [
        {
          id: "unit-2",
          cognitiveModelStatus: "pending",
          cognitiveModelBuildStartedAt: null,
        },
      ],
      [],
      undefined,
      undefined,
      undefined,
    ]);
    const repository = new MikroOrmModuleGenerationRetryRepository(
      state.manager,
    );

    await expect(
      repository.retryOwned({
        userId: "user-1",
        goalId: "goal-1",
        moduleId: "module-1",
      }),
    ).resolves.toEqual({ enqueued: true, status: "pending" });

    const insert = state.calls.find((call) =>
      call.sql.includes('INSERT INTO "EventOutbox"'),
    );
    expect(insert?.params).toEqual(
      expect.arrayContaining([
        "cognitive.model.expand_next",
        expect.stringContaining('"reason":"manual_module_unit_recovery"'),
      ]),
    );
    const dueAt = isoTimestamp(insert?.params ?? []);
    expect(insert?.params.filter((param) => param === dueAt)).toHaveLength(2);
    expect(
      insert?.params.some((param) => param instanceof Date),
    ).toBe(false);
  });

  it("nudges a live expand with SQLite-safe ISO nextAttemptAt", async () => {
    const state = fakeManager([
      [moduleRow],
      [
        {
          id: "unit-2",
          cognitiveModelStatus: "pending",
          cognitiveModelBuildStartedAt: null,
        },
      ],
      [
        {
          id: "live-1",
          payload: JSON.stringify({
            goalId: "goal-1",
            inputHash: "hash-1",
            baseModelVersion: 1,
          }),
        },
      ],
      undefined,
      undefined,
    ]);
    const repository = new MikroOrmModuleGenerationRetryRepository(
      state.manager,
    );

    await expect(
      repository.retryOwned({
        userId: "user-1",
        goalId: "goal-1",
        moduleId: "module-1",
      }),
    ).resolves.toEqual({
      enqueued: true,
      status: "pending",
      rearmed: false,
      nudged: true,
    });

    const nudge = state.calls.find(
      (call) =>
        call.sql.includes('SET "nextAttemptAt"') &&
        call.sql.includes('"EventOutbox"'),
    );
    expect(nudge?.params[0]).toEqual(isoTimestamp(nudge?.params ?? []));
    expect(nudge?.params[0]).not.toBeInstanceOf(Date);
    expect(nudge?.params).toContain("live-1");
  });
});
