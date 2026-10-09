import type { EntityManager } from "@mikro-orm/core";
import type { ExplorationModulePublicationRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { MikroOrmExplorationModulePublicationRepository } from "./exploration-module-publication.repository.ts";

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
  userId: "user-1",
  goalId: "goal-1",
  moduleId: "module-1",
  generationBuildToken: "lease-1",
  orderIndex: 1,
  units: [
    {
      title: "Explore first",
      contentSummary: "Start with a concrete example.",
      difficulty: "easy" as const,
      milestoneRole: "introduce" as const,
    },
    {
      title: "Explore second",
      contentSummary: "Connect the example to practice.",
      difficulty: "medium" as const,
      milestoneRole: "practice" as const,
    },
  ],
  publishedAt: new Date("2026-08-09T00:00:00.000Z"),
};

describe("exploration module publication reference repository", () => {
  it("publishes KACOM-free lessons and releases the lease", async () => {
    const state = fakeManager([
      [{ id: "goal-1", learningMode: "exploration" }],
      [
        {
          id: "module-1",
          goalId: "goal-1",
          generationBuildToken: "lease-1",
          generationVersion: 4,
        },
      ],
      [],
      undefined,
      undefined,
      [{ generationVersion: 5 }],
    ]);
    const repository: ExplorationModulePublicationRepository =
      new MikroOrmExplorationModulePublicationRepository(state.manager);

    await expect(repository.publish(input)).resolves.toEqual({
      moduleId: "module-1",
      published: true,
      createdUnitCount: 2,
      generationVersion: 5,
    });
    expect(state.calls).toHaveLength(6);
    expect(state.calls[0].params).toEqual(["goal-1", "user-1"]);
    expect(state.calls[3].sql).toContain(
      'INSERT INTO "tenant_a"."LearningUnit"',
    );
    expect(state.calls[3].params).toContain("Explore first");
    expect(state.calls[3].sql).toContain("'available', 'expanded', true");
    expect(state.calls[5].sql).toContain("\"generationStatus\" = 'ready'");
    expect(state.calls[5].params).toContain("lease-1");
  });

  it("rejects non-exploration goals and stale leases before inserting", async () => {
    const wrongMode = fakeManager([
      [{ id: "goal-1", learningMode: "mastery" }],
    ]);
    const repository = new MikroOrmExplorationModulePublicationRepository(
      wrongMode.manager,
    );
    await expect(repository.publish(input)).rejects.toThrow(
      "Module is not an exploration goal",
    );
    expect(wrongMode.calls).toHaveLength(1);

    const stale = fakeManager([
      [{ id: "goal-1", learningMode: "exploration" }],
      [{ id: "module-1", goalId: "goal-1", generationBuildToken: "newer" }],
    ]);
    await expect(
      new MikroOrmExplorationModulePublicationRepository(stale.manager).publish(
        input,
      ),
    ).rejects.toThrow("Module generation lease was superseded");
    expect(stale.calls).toHaveLength(2);
  });

  it("refuses duplicate candidate publication", async () => {
    const state = fakeManager([
      [{ id: "goal-1", learningMode: "exploration" }],
      [{ id: "module-1", goalId: "goal-1", generationBuildToken: "lease-1" }],
      [{ id: "existing-unit" }],
    ]);
    const repository = new MikroOrmExplorationModulePublicationRepository(
      state.manager,
    );

    await expect(repository.publish(input)).rejects.toThrow(
      "Module retry requires candidate cleanup",
    );
    expect(state.calls).toHaveLength(3);
  });
});
