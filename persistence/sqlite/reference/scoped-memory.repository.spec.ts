import type { EntityManager } from "@mikro-orm/core";
import type { ScopedMemoryPort } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { MikroOrmScopedMemoryRepository } from "./scoped-memory.repository.ts";

type Call = {
  sql: string;
  params: readonly unknown[];
};

function fakeManager(
  results: readonly unknown[],
  schema = "tenant_a",
): {
  manager: EntityManager;
  calls: Call[];
  transactionalCalls: () => number;
} {
  const calls: Call[] = [];
  let resultIndex = 0;
  let transactionalCalls = 0;
  const manager = {
    schema,
    getConnection: () => ({
      execute: async (sql: string, params: readonly unknown[] = []) => {
        calls.push({ sql, params });
        return results[resultIndex++];
      },
    }),
    transactional: async () => {
      transactionalCalls += 1;
      throw new Error("nested transaction must not be opened");
    },
  } as unknown as EntityManager;
  return { manager, calls, transactionalCalls: () => transactionalCalls };
}

describe("scoped memory reference repository", () => {
  it("checks ownership and deletes goal-scoped rows in trigger order", async () => {
    const state = fakeManager([
      [{ id: "goal-1" }],
      { affectedRows: 3 },
      { rowCount: 2 },
    ]);
    const repository: ScopedMemoryPort = new MikroOrmScopedMemoryRepository(
      state.manager,
    );

    await expect(
      repository.deleteOwnedGoalScope({ userId: "user-1", goalId: "goal-1" }),
    ).resolves.toEqual({ recordsDeleted: 2, candidatesDeleted: 3 });

    expect(state.calls).toHaveLength(3);
    expect(state.calls[0]).toMatchObject({
      sql: expect.stringContaining('FROM "tenant_a"."LearningGoal"'),
      params: ["goal-1", "user-1"],
    });
    expect(state.calls[1]).toMatchObject({
      sql: expect.stringContaining('DELETE FROM "tenant_a"."MemoryCandidate"'),
      params: ["goal-1"],
    });
    expect(state.calls[2]).toMatchObject({
      sql: expect.stringContaining('DELETE FROM "tenant_a"."MemoryRecord"'),
      params: ["goal-1"],
    });
    expect(state.transactionalCalls()).toBe(0);
  });

  it("does not delete memory for an unowned or missing goal", async () => {
    const state = fakeManager([[]], "public");
    const repository = new MikroOrmScopedMemoryRepository(state.manager);

    await expect(
      repository.deleteOwnedGoalScope({
        userId: "other-user",
        goalId: "goal-1",
      }),
    ).resolves.toEqual({ recordsDeleted: 0, candidatesDeleted: 0 });

    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].sql).toContain('FROM "public"."LearningGoal"');
    expect(state.calls[0].params).toEqual(["goal-1", "other-user"]);
    expect(state.transactionalCalls()).toBe(0);
  });
});
