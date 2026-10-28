import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmOverviewCoursePublicationRepository } from "./overview-course-publication.repository.ts";

function fakeManager(options?: {
  goal?: Record<string, unknown>;
  overviewUnitIds?: readonly string[];
  unpublishedEventIds?: readonly string[];
}) {
  const calls: Array<{ sql: string; params: unknown[]; context?: unknown }> =
    [];
  const transactionContext = { id: "overview-test-transaction" };
  const connection = {
    execute: jest.fn(
      async (
        sql: string,
        params?: unknown[],
        _method?: unknown,
        context?: unknown,
      ) => {
        calls.push({ sql, params: params ?? [], context });
        if (sql.includes('FROM "LearningGoal"')) {
          return options?.goal ? [options.goal] : [];
        }
        if (
          sql.includes('FROM "LearningUnit"') &&
          sql.includes("\"unitKind\" = 'overview'")
        ) {
          return (options?.overviewUnitIds ?? []).map((id) => ({ id }));
        }
        if (sql.includes('FROM "EventOutbox"')) {
          return (options?.unpublishedEventIds ?? []).map((id) => ({ id }));
        }
        if (
          sql.startsWith("UPDATE") &&
          sql.includes('"overviewCourseStatus"')
        ) {
          return { affectedRows: options?.goal ? 1 : 0 };
        }
        return [];
      },
    ),
    getPlatform: () => ({ constructor: { name: "SqlitePlatform" } }),
  };
  const manager = {
    getConnection: () => connection,
    getTransactionContext: () => transactionContext,
    transactional: jest.fn(async <T>(work: (tx: EntityManager) => Promise<T>) =>
      work(manager as unknown as EntityManager),
    ),
  };
  return {
    manager: manager as unknown as EntityManager,
    calls,
  };
}

const input = {
  userId: "user-1",
  goalId: "goal-1",
  title: "Orientation",
  difficulty: "easy",
  contentSummary: "A short orientation.",
  note: '{"keyConcepts":[],"branchIncludes":[],"checkQuestion":""}',
  material: {
    introduction: "Start here.",
    sections: '[{"type":"markdown","content":"Welcome"}]',
    keyTakeaways: '["Welcome"]',
  },
  topicOverview: "  A concise topic overview.  ",
} as const;

describe("overview course publication repository", () => {
  it("starts an owned overview-course refresh", async () => {
    const fake = fakeManager({ goal: { id: "goal-1" } });
    const repository = new MikroOrmOverviewCoursePublicationRepository(
      fake.manager,
    );

    await expect(
      repository.beginOwnedOverviewCourse("user-1", "goal-1"),
    ).resolves.toEqual({ status: "started" });
    expect(
      fake.calls.some(({ sql }) => sql.includes('"overviewCourseStatus"')),
    ).toBe(true);
    expect(fake.calls[0]?.context).toEqual({ id: "overview-test-transaction" });
  });

  it("creates a pending orientation shell without replacing an existing unit", async () => {
    const existing = fakeManager({
      goal: { id: "goal-1" },
      overviewUnitIds: ["overview-1"],
    });
    const existingRepo = new MikroOrmOverviewCoursePublicationRepository(
      existing.manager,
    );
    await expect(
      existingRepo.ensureOwnedOverviewCourseShell({
        userId: "user-1",
        goalId: "goal-1",
        title: "课程导览",
        difficulty: "easy",
        contentSummary: "Module A: intro",
        note: "{}",
      }),
    ).resolves.toEqual({
      status: "ready",
      unitId: "overview-1",
      created: false,
    });
    expect(
      existing.calls.some(
        ({ sql }) => sql.startsWith("INSERT") && sql.includes('"LearningUnit"'),
      ),
    ).toBe(false);
    expect(
      existing.calls.some(
        ({ sql, params }) =>
          sql.startsWith("UPDATE") &&
          sql.includes('"LearningUnit"') &&
          params.includes("课程导览"),
      ),
    ).toBe(true);

    const created = fakeManager({ goal: { id: "goal-1" } });
    const createdRepo = new MikroOrmOverviewCoursePublicationRepository(
      created.manager,
    );
    const result = await createdRepo.ensureOwnedOverviewCourseShell({
      userId: "user-1",
      goalId: "goal-1",
      title: "课程导览",
      difficulty: "easy",
      contentSummary: "Module A: intro",
      note: "{}",
    });
    expect(result).toMatchObject({ status: "ready", created: true });
    const sectionInsert = created.calls.find(
      ({ sql }) => sql.startsWith("INSERT") && sql.includes('"UnitSection"'),
    );
    expect(sectionInsert?.sql).toContain("'pending'");
    expect(
      created.calls.some(
        ({ sql }) =>
          sql.startsWith("INSERT") && sql.includes('"LearningMaterial"'),
      ),
    ).toBe(false);
  });

  it("replaces owned overview content and marks the goal ready", async () => {
    const fake = fakeManager({
      goal: { id: "goal-1" },
      overviewUnitIds: ["old-overview-1", "old-overview-2"],
    });
    const repository = new MikroOrmOverviewCoursePublicationRepository(
      fake.manager,
    );

    const result = await repository.publishOwnedOverviewCourse(input);

    expect(result.status).toBe("published");
    if (result.status !== "published") return;
    expect(result.unitId).toEqual(expect.any(String));

    const materialDelete = fake.calls.findIndex(
      ({ sql }) =>
        sql.startsWith("DELETE") && sql.includes('"LearningMaterial"'),
    );
    const unitDelete = fake.calls.findIndex(
      ({ sql }) => sql.startsWith("DELETE") && sql.includes('"LearningUnit"'),
    );
    expect(materialDelete).toBeGreaterThanOrEqual(0);
    expect(unitDelete).toBeGreaterThan(materialDelete);

    const unitInsert = fake.calls.find(
      ({ sql }) => sql.startsWith("INSERT") && sql.includes('"LearningUnit"'),
    );
    expect(unitInsert?.params).toEqual(
      expect.arrayContaining([
        result.unitId,
        "goal-1",
        "Orientation",
        "easy",
        "A short orientation.",
        input.note,
      ]),
    );

    const materialInsert = fake.calls.find(
      ({ sql }) =>
        sql.startsWith("INSERT") && sql.includes('"LearningMaterial"'),
    );
    expect(materialInsert?.params).toEqual(
      expect.arrayContaining([
        result.unitId,
        "Start here.",
        '[{"type":"markdown","content":"Welcome"}]',
        '["Welcome"]',
      ]),
    );
    // SQLite has no server default for the audit timestamps; the insert must
    // supply them or publication fails with a NOT NULL constraint error.
    expect(materialInsert?.sql).toContain('"createdAt", "updatedAt"');
    expect(materialInsert?.params).toHaveLength(7);
    expect(typeof materialInsert?.params?.[5]).toBe("string");
    expect(typeof materialInsert?.params?.[6]).toBe("string");

    expect(
      fake.calls.some(
        ({ sql }) => sql.startsWith("INSERT") && sql.includes('"UnitSection"'),
      ),
    ).toBe(true);
    expect(
      fake.calls.some(
        ({ sql }) =>
          sql.startsWith("INSERT") && sql.includes('"UnitSectionMaterial"'),
      ),
    ).toBe(true);

    const goalUpdate = fake.calls.find(
      ({ sql }) => sql.startsWith("UPDATE") && sql.includes('"LearningGoal"'),
    );
    expect(goalUpdate?.sql).toContain("\"overviewCourseStatus\" = 'ready'");
    expect(goalUpdate?.params).toContain("A concise topic overview.");
  });

  it("does not mutate a goal the learner does not own", async () => {
    const fake = fakeManager();
    const repository = new MikroOrmOverviewCoursePublicationRepository(
      fake.manager,
    );

    await expect(repository.publishOwnedOverviewCourse(input)).resolves.toEqual(
      { status: "not_found" },
    );
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.sql).toContain('"userId" = ?');
  });

  it("does not overwrite topic overview with blank input", async () => {
    const fake = fakeManager({ goal: { id: "goal-1" } });
    const repository = new MikroOrmOverviewCoursePublicationRepository(
      fake.manager,
    );

    await repository.publishOwnedOverviewCourse({
      ...input,
      topicOverview: "   ",
    });

    const goalUpdate = fake.calls.find(
      ({ sql }) => sql.startsWith("UPDATE") && sql.includes('"LearningGoal"'),
    );
    expect(goalUpdate?.sql).not.toContain('"topicOverview"');
  });

  it("updates an owned overview unit completion state", async () => {
    const fake = fakeManager({
      overviewUnitIds: ["overview-1"],
    });
    const repository = new MikroOrmOverviewCoursePublicationRepository(
      fake.manager,
    );

    const completedAt = new Date("2026-08-10T00:00:00.000Z");
    await expect(
      repository.completeOwnedOverviewUnit({
        userId: "user-1",
        goalId: "goal-1",
        unitId: "overview-1",
        completedAt,
      }),
    ).resolves.toMatchObject({
      status: "updated",
      unit: {
        id: "overview-1",
      },
    });

    const update = fake.calls.find(
      ({ sql }) => sql.startsWith("UPDATE") && sql.includes('"LearningUnit"'),
    );
    expect(update?.sql).toContain('"status" = ?');
    expect(update?.params).toEqual(
      expect.arrayContaining([
        "completed",
        expect.stringContaining(completedAt.toISOString()),
      ]),
    );
    expect(update?.sql).toContain('"goalId" = ?');
    expect(update?.sql).toContain("\"unitKind\" = 'overview'");
  });
});
