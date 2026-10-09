import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmLegacyMapUnitMutationRepository } from "./legacy-map-unit-mutation.repository.ts";

const unit = (overrides: Record<string, unknown> = {}) => ({
  id: "unit-1",
  moduleId: null,
  title: "A unit",
  status: "available",
  unitKind: "lesson",
  parentUnitId: null,
  orderIndex: 0,
  prerequisites: "[]",
  contentSummary: "Summary",
  note: "",
  mapOrigin: "user",
  mapEdited: false,
  linkedGoalId: null,
  completionMethod: null,
  completionAttemptId: null,
  completedAt: null,
  ...overrides,
});

function fakeManager(options?: {
  goal?: Record<string, unknown>;
  unit?: Record<string, unknown>;
  maxOrder?: number;
  parent?: Record<string, unknown>;
}) {
  const calls: string[] = [];
  const connection = {
    execute: jest.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes('FROM "LearningGoal"')) {
        return options?.goal ? [options.goal] : [];
      }
      if (sql.includes("MAX(")) {
        return [{ maxOrder: String(options?.maxOrder ?? -1) }];
      }
      if (sql.includes('SELECT "id", "parentUnitId", "unitKind"')) {
        return options?.parent ? [options.parent] : [];
      }
      if (sql.includes('FROM "LearningUnit"')) {
        return options?.unit ? [options.unit] : [];
      }
      return [];
    }),
    getPlatform: () => ({ constructor: { name: "SqlitePlatform" } }),
  };
  return {
    manager: { getConnection: () => connection } as unknown as EntityManager,
    calls,
  };
}

describe("legacy map-unit mutation repository", () => {
  it("creates an owned editable unit with the next sibling order", async () => {
    const fake = fakeManager({
      goal: { userId: "user-1", curriculumVersion: 1 },
      unit: unit({ id: "created-unit", orderIndex: 4 }),
      maxOrder: 3,
    });
    const repository = new MikroOrmLegacyMapUnitMutationRepository(
      fake.manager,
    );

    await expect(
      repository.createOwnedEditableUnit({
        userId: "user-1",
        goalId: "goal-1",
        parentUnitId: null,
        unitKind: "branch",
        title: "  New unit  ",
        contentSummary: "Summary",
        note: "",
        mapOrigin: "user",
      }),
    ).resolves.toMatchObject({
      status: "created",
      unit: { id: "created-unit", title: "A unit", orderIndex: 4 },
    });
    expect(fake.calls.some((sql) => sql.startsWith("INSERT"))).toBe(true);
  });

  it("fails closed for another owner's goal and immutable curriculum", async () => {
    const forbidden = fakeManager({
      goal: { userId: "other-user", curriculumVersion: 1 },
    });
    const repository = new MikroOrmLegacyMapUnitMutationRepository(
      forbidden.manager,
    );
    await expect(
      repository.deleteOwnedEditableUnit({
        userId: "user-1",
        goalId: "goal-1",
        unitId: "unit-1",
      }),
    ).resolves.toEqual({ status: "goal_forbidden" });

    const immutable = fakeManager({
      goal: { userId: "user-1", curriculumVersion: 2 },
    });
    const immutableRepository = new MikroOrmLegacyMapUnitMutationRepository(
      immutable.manager,
    );
    await expect(
      immutableRepository.createOwnedEditableUnit({
        userId: "user-1",
        goalId: "goal-1",
        parentUnitId: null,
        unitKind: "branch",
        title: "New unit",
        contentSummary: "",
        note: "",
        mapOrigin: "user",
      }),
    ).resolves.toEqual({ status: "immutable_goal" });
  });

  it("rejects moving a unit below one of its descendants", async () => {
    const fake = fakeManager({
      goal: { userId: "user-1", curriculumVersion: 1 },
      unit: unit({ id: "unit-1" }),
      parent: { id: "unit-2", parentUnitId: "unit-1", unitKind: "lesson" },
    });
    const repository = new MikroOrmLegacyMapUnitMutationRepository(
      fake.manager,
    );

    await expect(
      repository.updateOwnedEditableUnit({
        userId: "user-1",
        goalId: "goal-1",
        unitId: "unit-1",
        parentUnitId: "unit-2",
      }),
    ).resolves.toEqual({ status: "invalid_edit" });
    expect(fake.calls.some((sql) => sql.startsWith("UPDATE"))).toBe(false);
  });

  it("rejects deleting an overview unit and empty reorder requests", async () => {
    const overview = fakeManager({
      goal: { userId: "user-1", curriculumVersion: 1 },
      unit: unit({ unitKind: "overview" }),
    });
    const repository = new MikroOrmLegacyMapUnitMutationRepository(
      overview.manager,
    );
    await expect(
      repository.deleteOwnedEditableUnit({
        userId: "user-1",
        goalId: "goal-1",
        unitId: "unit-1",
      }),
    ).resolves.toEqual({ status: "overview_readonly" });

    const reorder = fakeManager({
      goal: { userId: "user-1", curriculumVersion: 1 },
    });
    const reorderRepository = new MikroOrmLegacyMapUnitMutationRepository(
      reorder.manager,
    );
    await expect(
      reorderRepository.reorderOwnedEditableUnits({
        userId: "user-1",
        goalId: "goal-1",
        parentUnitId: null,
        orderedUnitIds: [],
      }),
    ).resolves.toEqual({ status: "invalid_edit" });
  });

  it("refines an owned map in one bulk mutation boundary", async () => {
    const fake = fakeManager({
      goal: { userId: "user-1", curriculumVersion: 1 },
      unit: unit({ id: "unit-1", title: "Old title" }),
    });
    const repository = new MikroOrmLegacyMapUnitMutationRepository(
      fake.manager,
    );

    await expect(
      repository.refineOwnedEditableUnits({
        userId: "user-1",
        goalId: "goal-1",
        updates: [
          {
            unitId: "unit-1",
            title: "New title",
            contentSummary: "New summary",
            orderIndex: 2,
          },
        ],
      }),
    ).resolves.toMatchObject({ status: "refined", units: [{ id: "unit-1" }] });
    expect(fake.calls.filter((sql) => sql.startsWith("UPDATE"))).toHaveLength(
      1,
    );
  });
});
