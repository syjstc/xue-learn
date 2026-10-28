import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmLearningUnitRepository } from "./learning-unit.repository.ts";

function fakeManager(rows: readonly Record<string, unknown>[]) {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const manager = {
    getConnection: () => ({
      execute: async (sql: string, params: readonly unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.trimStart().startsWith("SELECT")) return rows;
        return { affectedRows: 1 };
      },
    }),
    transactional: async <T>(work: (em: EntityManager) => Promise<T>) =>
      work(manager as unknown as EntityManager),
  } as unknown as EntityManager;
  return { manager, calls };
}

describe("learning unit projection repository", () => {
  it("orders the bounded curriculum projection and preserves expanded units", async () => {
    const startedAt = new Date("2026-08-09T00:00:00.000Z");
    const { manager, calls } = fakeManager([
      {
        id: "unit-2",
        goalId: "goal-1",
        curriculumKey: "lesson-2",
        parentUnitId: null,
        unitKind: "lesson",
        title: "Second",
        contentSummary: "",
        orderIndex: 1,
        difficulty: "medium",
        prerequisites: "[]",
        planAreaRef: "a_2",
        planningOutcomeRefs: '["o_2"]',
        cognitiveModelStatus: "expanded",
        cognitiveModelBuildStartedAt: null,
        cognitiveModelBuildToken: null,
        cognitiveModelBuildInputHash: "old",
      },
      {
        id: "unit-1",
        goalId: "goal-1",
        curriculumKey: "lesson-1",
        parentUnitId: null,
        unitKind: "lesson",
        title: "First",
        contentSummary: "",
        orderIndex: 0,
        difficulty: "easy",
        prerequisites: "[]",
        planAreaRef: "a_1",
        planningOutcomeRefs: ["o_1"],
        cognitiveModelStatus: "building",
        cognitiveModelBuildStartedAt: startedAt,
        cognitiveModelBuildToken: "lease",
        cognitiveModelBuildInputHash: "old",
      },
    ]);
    const repository = new MikroOrmLearningUnitRepository(manager);

    await expect(repository.listForCurriculum("goal-1")).resolves.toEqual([
      expect.objectContaining({
        id: "unit-2",
        planningOutcomeRefs: ["o_2"],
      }),
      expect.objectContaining({
        id: "unit-1",
        planningOutcomeRefs: ["o_1"],
      }),
    ]);
    await expect(
      repository.invalidateCognitiveModel({
        goalId: "goal-1",
        nextInputHash: "new",
        preserveExpanded: true,
      }),
    ).resolves.toEqual({ resetCount: 1, preservedExpandedCount: 1 });
    expect(
      calls.filter(({ sql }) => sql.trimStart().startsWith("UPDATE")),
    ).toHaveLength(2);
  });
});
