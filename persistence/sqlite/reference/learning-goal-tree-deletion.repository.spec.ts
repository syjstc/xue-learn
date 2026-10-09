import type { EntityManager } from "@mikro-orm/core";
import type { LearningGoalTreeDeletionRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { MikroOrmLearningGoalTreeDeletionRepository } from "./learning-goal-tree-deletion.repository.ts";

type Call = { sql: string; params: readonly unknown[] };

class SqlitePlatform {}

function fakeManager(
  results: readonly unknown[],
  schema = "tenant_a",
): { manager: EntityManager; calls: Call[] } {
  const calls: Call[] = [];
  let resultIndex = 0;
  const manager = {
    schema,
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

describe("learning goal tree deletion reference repository", () => {
  it("deletes foundation children before the parent and queues both RAG scopes", async () => {
    const state = fakeManager([
      [{ id: "parent-1" }],
      [{ id: "child-1" }],
      [{ storageKey: "aa/hash/original.pdf" }],
      [],
    ]);
    const repository: LearningGoalTreeDeletionRepository =
      new MikroOrmLearningGoalTreeDeletionRepository(state.manager);

    await expect(
      repository.deleteOwnedGoalTree({ userId: "user-1", goalId: "parent-1" }),
    ).resolves.toEqual({
      deletedGoalIds: ["child-1", "parent-1"],
      deletedResourceStorageKeys: ["aa/hash/original.pdf"],
    });

    expect(state.calls).toHaveLength(12);
    expect(state.calls[0]).toMatchObject({
      sql: expect.stringContaining('FROM "tenant_a"."LearningGoal"'),
      params: ["parent-1", "user-1"],
    });
    expect(state.calls[1].sql).toContain('"goalRelationType"');
    expect(state.calls[2].sql).toContain('FROM "tenant_a"."UploadedDocument"');
    expect(state.calls[3].sql).toContain('FROM "tenant_a"."LearningSpaceItem"');
    expect(state.calls[4].sql).toContain(
      'DELETE FROM "tenant_a"."MemoryCandidate"',
    );
    expect(state.calls[6].sql).toContain(
      'INSERT INTO "tenant_a"."EventOutbox"',
    );
    expect(state.calls[7].sql).toContain(
      'DELETE FROM "tenant_a"."MemoryCandidate"',
    );
    expect(state.calls[10].sql).toContain(
      'DELETE FROM "tenant_a"."LearningGoal"',
    );
    expect(state.calls[10].params).toEqual(["child-1", "user-1"]);
    expect(state.calls[11].params).toEqual(["parent-1", "user-1"]);
    expect(state.calls).toHaveLength(12);
    expect(state.calls.some(call => call.sql.includes("course-production"))).toBe(false);
  });

  it("restores an activated planned-goal item before deleting its goal", async () => {
    const state = fakeManager([
      [{ id: "goal-1" }],
      [],
      [],
      [{ spaceId: "space-1" }],
    ]);
    const repository = new MikroOrmLearningGoalTreeDeletionRepository(
      state.manager,
    );

    await repository.deleteOwnedGoalTree({
      userId: "user-1",
      goalId: "goal-1",
    });

    expect(state.calls[4]).toMatchObject({
      sql: expect.stringContaining(
        `SET "itemType" = 'planned_goal', "goalId" = NULL`,
      ),
      params: ["goal-1"],
    });
    expect(state.calls[5]).toMatchObject({
      sql: expect.stringContaining('SET "revision" = "revision" + 1'),
      params: [expect.any(Date), "space-1", "user-1"],
    });
    expect(state.calls[9].sql).toContain(
      'DELETE FROM "tenant_a"."LearningGoal"',
    );
  });

  it("does not issue cleanup writes for an unowned parent", async () => {
    const state = fakeManager([[]], "public");
    const repository = new MikroOrmLearningGoalTreeDeletionRepository(
      state.manager,
    );

    await expect(
      repository.deleteOwnedGoalTree({
        userId: "other-user",
        goalId: "goal-1",
      }),
    ).resolves.toEqual({
      deletedGoalIds: [],
      deletedResourceStorageKeys: [],
    });
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].sql).toContain('FROM "public"."LearningGoal"');
  });
});
