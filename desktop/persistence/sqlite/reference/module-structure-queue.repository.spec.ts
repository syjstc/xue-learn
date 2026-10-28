import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmModuleStructureQueueRepository } from "./module-structure-queue.repository.ts";

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

describe("module structure queue initial KACOM", () => {
  it("authorizes expansion when lessons are already listed", async () => {
    const state = fakeManager([
      [{ learningMode: "mastery" }],
      [{ id: "module-1", generationStatus: "building" }],
      [],
      [],
      [{ id: "unit-1" }],
      undefined,
    ]);
    const repository = new MikroOrmModuleStructureQueueRepository(state.manager);

    await expect(repository.enqueueInitialKacom("goal-1")).resolves.toEqual({
      enqueued: true,
      moduleId: "module-1",
      authorizeExpansion: true,
    });
    expect(state.calls[5]?.sql).toContain('"generationBuildToken"=NULL');
    expect(
      state.calls.some((call) =>
        call.params.includes("course.module.generate"),
      ),
    ).toBe(false);
  });

  it("queues structure follow-up when no lessons exist yet", async () => {
    const state = fakeManager([
      [{ learningMode: "mastery" }],
      [{ id: "module-1", generationStatus: "pending" }],
      [],
      [],
      [],
      [],
      undefined,
    ]);
    const repository = new MikroOrmModuleStructureQueueRepository(state.manager);

    await expect(repository.enqueueInitialKacom("goal-1")).resolves.toEqual({
      enqueued: true,
      moduleId: "module-1",
    });
    expect(state.calls[6]?.sql).toContain('INSERT INTO "EventOutbox"');
    expect(state.calls[6]?.params).toEqual(
      expect.arrayContaining([
        "course.module.generate",
        JSON.stringify({
          goalId: "goal-1",
          moduleId: "module-1",
          reason: "goal_page_open",
        }),
      ]),
    );
  });

  it("does not enqueue when a lesson has already left pending", async () => {
    const state = fakeManager([
      [{ learningMode: "mastery" }],
      [{ id: "module-1", generationStatus: "building" }],
      [{ id: "unit-1" }],
    ]);
    const repository = new MikroOrmModuleStructureQueueRepository(state.manager);

    await expect(repository.enqueueInitialKacom("goal-1")).resolves.toEqual({
      enqueued: false,
    });
    expect(state.calls).toHaveLength(3);
    expect(state.calls.some((call) => call.sql.includes("ModuleLearningTarget"))).toBe(
      false,
    );
  });

  it("skips when a live skeleton or expand event already exists", async () => {
    const state = fakeManager([
      [{ learningMode: "mastery" }],
      [{ id: "module-1", generationStatus: "building" }],
      [],
      [{ id: "event-1" }],
    ]);
    const repository = new MikroOrmModuleStructureQueueRepository(state.manager);

    await expect(repository.enqueueInitialKacom("goal-1")).resolves.toEqual({
      enqueued: false,
    });
    expect(state.calls[3]?.params).toEqual(
      expect.arrayContaining([
        "cognitive.model.skeleton",
        "cognitive.model.expand_next",
      ]),
    );
  });
});
