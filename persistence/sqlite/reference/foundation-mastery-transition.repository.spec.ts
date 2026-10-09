import type { EntityManager } from "@mikro-orm/core";
import type { FoundationMasteryTransitionRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { MikroOrmFoundationMasteryTransitionRepository } from "./foundation-mastery-transition.repository.ts";

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

describe("foundation mastery transition reference repository", () => {
  it("freezes curriculum keys and re-arms lesson cognitive state atomically", async () => {
    const state = fakeManager([
      [
        {
          id: "goal-1",
          goalKind: "full",
          learningMode: "exploration",
          learningModeTransitionStatus: "idle",
          mapPlanStatus: "approved",
          detailedPlanStatus: "ready",
          shareVisibility: "off",
        },
      ],
      [{ id: "module-1", generationStatus: "ready" }],
      [{ id: "unit-1", curriculumKey: "m1:u1" }],
      { affectedRows: 1 },
      { affectedRows: 1 },
    ]);
    const repository: FoundationMasteryTransitionRepository =
      new MikroOrmFoundationMasteryTransitionRepository(state.manager);

    await expect(
      repository.beginOwned({ userId: "user-1", goalId: "goal-1" }),
    ).resolves.toEqual(
      expect.objectContaining({
        goalId: "goal-1",
        transitionStatus: "queued",
        curriculumKeys: ["m1:u1"],
        started: true,
        token: expect.any(String),
      }),
    );
    expect(state.calls).toHaveLength(5);
    expect(state.calls[3].sql).toContain(
      "\"learningModeTransitionStatus\" = 'queued'",
    );
    expect(state.calls[4].sql).toContain(
      "\"cognitiveModelStatus\" = 'pending'",
    );
  });

  it("rejects an unready curriculum before writing", async () => {
    const state = fakeManager([
      [
        {
          id: "goal-1",
          goalKind: "full",
          learningMode: "exploration",
          learningModeTransitionStatus: "idle",
          mapPlanStatus: "approved",
          detailedPlanStatus: "ready",
          shareVisibility: "off",
        },
      ],
      [{ id: "module-1", generationStatus: "building" }],
      [{ id: "unit-1", curriculumKey: "m1:u1" }],
    ]);
    const repository = new MikroOrmFoundationMasteryTransitionRepository(
      state.manager,
    );

    await expect(
      repository.beginOwned({ userId: "user-1", goalId: "goal-1" }),
    ).rejects.toMatchObject({ code: "curriculum_not_ready" });
    expect(state.calls).toHaveLength(3);
  });

  it("finalizes only the owned, hash-matched transition token", async () => {
    const state = fakeManager([[{ id: "goal-1" }], []]);
    const repository: FoundationMasteryTransitionRepository =
      new MikroOrmFoundationMasteryTransitionRepository(state.manager);

    await expect(
      repository.finalizeOwned({
        userId: "user-1",
        goalId: "goal-1",
        token: "transition-1",
        inputHash: "hash-1",
      }),
    ).resolves.toBe(true);
    await expect(
      repository.finalizeOwned({
        userId: "user-1",
        goalId: "goal-1",
        token: "transition-1",
        inputHash: "hash-1",
      }),
    ).resolves.toBe(false);
    expect(state.calls[0].sql).toContain("\"learningMode\" = 'mastery'");
    expect(state.calls[0].sql).toContain('"cognitiveModelPublishedHash" = ?');
    expect(state.calls[0].params).toEqual([
      "{}",
      expect.any(Date),
      "goal-1",
      "user-1",
      "transition-1",
      "hash-1",
      "hash-1",
    ]);
  });

  it("marks only the queued transition with the matching fence token as building", async () => {
    const state = fakeManager([{ affectedRows: 1 }, { affectedRows: 0 }]);
    const repository = new MikroOrmFoundationMasteryTransitionRepository(
      state.manager,
    );

    await expect(
      repository.markBuilding({ goalId: "goal-1", token: "transition-1" }),
    ).resolves.toBe(true);
    await expect(
      repository.markBuilding({ goalId: "goal-1", token: "transition-1" }),
    ).resolves.toBe(false);
    expect(state.calls[0].sql).toContain(
      "\"learningModeTransitionStatus\" = 'building'",
    );
    expect(state.calls[0].sql).toContain(
      "\"learningModeTransitionStatus\" = 'queued'",
    );
    expect(state.calls[0].params).toEqual([
      expect.any(Date),
      "goal-1",
      "transition-1",
    ]);
  });
});
