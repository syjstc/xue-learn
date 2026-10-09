import type { EntityManager } from "@mikro-orm/core";
import type { PreparedModulePublicationRepository } from "@xue-learn/core/domain";
import { MikroOrmPreparedModulePublicationRepository } from "./prepared-module-publication.repository.ts";

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
  capabilities: [{ title: "capability", objective: "do" }],
  structure: {
    coverageRationale: "Build from foundations to practice.",
    units: [
      {
        title: "First lesson",
        contentSummary: "Start here.",
        difficulty: "easy" as const,
        capabilityRefs: ["capability"],
        milestoneRole: "introduce" as const,
      },
      {
        title: "Second lesson",
        contentSummary: "Apply it.",
        difficulty: "medium" as const,
        capabilityRefs: ["capability"],
        milestoneRole: "practice" as const,
      },
    ],
  },
  baseUnitPlanningBrief: { scope: "test" },
  publishedAt: new Date("2026-08-09T00:00:00.000Z"),
};

describe("prepared module publication reference repository", () => {
  it("publishes lesson structure and fences the generation lease", async () => {
    const state = fakeManager([
      [{ id: "goal-1" }],
      [
        {
          id: "module-1",
          goalId: "goal-1",
          orderIndex: 1,
          generationBuildToken: "lease-1",
          generationVersion: 2,
          unitPlanningBrief: {},
        },
      ],
      [],
      undefined,
      undefined,
      [{ generationVersion: 3 }],
    ]);
    const repository: PreparedModulePublicationRepository =
      new MikroOrmPreparedModulePublicationRepository(state.manager);

    await expect(repository.publish(input)).resolves.toEqual({
      moduleId: "module-1",
      published: true,
      createdUnitCount: 2,
      generationVersion: 3,
    });
    expect(state.calls).toHaveLength(6);
    expect(state.calls[0].sql).toContain('FROM "tenant_a"."LearningGoal"');
    expect(state.calls[3].sql).toContain(
      'INSERT INTO "tenant_a"."LearningUnit"',
    );
    expect(state.calls[3].params).toContain("First lesson");
    expect(state.calls[5].sql).toContain('"generationBuildToken" = NULL');
    expect(state.calls[5].params).toContain("lease-1");
    expect(state.calls[5].params).toContain(
      JSON.stringify({
        scope: "test",
        preparedMasteryModule: {
          capabilities: input.capabilities,
          structure: input.structure,
        },
      }),
    );
  });

  it("rejects a superseded lease before inserting units", async () => {
    const state = fakeManager([
      [{ id: "goal-1" }],
      [
        {
          id: "module-1",
          goalId: "goal-1",
          generationBuildToken: "newer-lease",
          generationVersion: 2,
        },
      ],
    ]);
    const repository = new MikroOrmPreparedModulePublicationRepository(
      state.manager,
    );

    await expect(repository.publish(input)).rejects.toThrow(
      "Module generation lease was superseded",
    );
    expect(state.calls).toHaveLength(2);
  });
});
