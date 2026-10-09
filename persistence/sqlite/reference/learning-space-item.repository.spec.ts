import type { EntityManager } from "@mikro-orm/core";
import type {
  LearningSpaceItemRepository,
  LearningSpaceItemRecord,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import { LearningGoalEntity } from "./learning-goal.entity.ts";
import { LearningSpaceEntity } from "./learning-space.entity.ts";
import { LearningSpaceItemEntity } from "./learning-space-item.entity.ts";
import { MikroOrmLearningSpaceItemRepository } from "./learning-space-item.repository.ts";

jest.mock("@mikro-orm/core", () => ({
  EntitySchema: class EntitySchema<T extends object> {
    readonly tableName: string;
    readonly properties: Record<string, Record<string, unknown>>;
    readonly meta: { primaryKeys: string[] };

    constructor(input: {
      tableName: string;
      properties: Record<string, Record<string, unknown>>;
    }) {
      this.tableName = input.tableName;
      this.properties = input.properties;
      this.meta = {
        primaryKeys: Object.entries(input.properties)
          .filter(([, property]) => property.primary === true)
          .map(([name]) => name),
      };
    }
  },
}));

function makeSpace(user = "user-1"): LearningSpaceEntity {
  return Object.assign(new LearningSpaceEntity(), {
    id: "space-1",
    user,
  });
}

function makeGoal(user = "user-1"): LearningGoalEntity {
  return Object.assign(new LearningGoalEntity(), {
    id: "goal-1",
    user,
    title: "Learn TypeScript",
    level: "beginner",
  });
}

function makeItem(
  input: Partial<LearningSpaceItemEntity> &
    Pick<LearningSpaceItemEntity, "itemType" | "id">,
): LearningSpaceItemEntity {
  return Object.assign(new LearningSpaceItemEntity(), {
    space: makeSpace(),
    goal: null,
    plannedTitle: "",
    rationale: "",
    suggestedGoalKind: "full",
    source: "manual",
    sortIndex: 0,
    createdAt: new Date(1),
    updatedAt: new Date(1),
    ...input,
  });
}

type ItemState = {
  spaces: LearningSpaceEntity[];
  goals: LearningGoalEntity[];
  items: LearningSpaceItemEntity[];
  findOneCalls: unknown[][];
  nativeDeleteCalls: unknown[][];
  flushes: number;
};

function fakeManager(state: ItemState): EntityManager {
  const manager = {
    getReference: (_entity: unknown, id: string) => id,
    findOne: async (entity: unknown, where: unknown) => {
      state.findOneCalls.push([entity, where]);
      if (entity === LearningSpaceEntity) return state.spaces[0] ?? null;
      if (entity === LearningGoalEntity) return state.goals[0] ?? null;
      if (entity === LearningSpaceItemEntity) {
        const query = where as { itemType?: string; id?: string };
        return (
          state.items.find(
            (item) =>
              (query.id === undefined || item.id === query.id) &&
              (query.itemType === undefined ||
                item.itemType === query.itemType),
          ) ?? null
        );
      }
      return null;
    },
    find: async (entity: unknown) => {
      if (entity === LearningSpaceItemEntity) return state.items;
      return [];
    },
    persist: (entity: LearningSpaceItemEntity) => {
      state.items.push(entity);
    },
    remove: (_entity: LearningSpaceItemEntity) => undefined,
    flush: async () => {
      state.flushes += 1;
    },
    nativeDelete: async (_entity: unknown, where: unknown) => {
      state.nativeDeleteCalls.push([_entity, where]);
      return 1;
    },
  };
  return manager as unknown as EntityManager;
}

describe("learning space item reference repository", () => {
  it("exposes the real/planned item sum and scopes lookups by owner", async () => {
    const planned = makeItem({
      id: "planned-1",
      itemType: "planned_goal",
      plannedTitle: "Build a TypeScript app",
    });
    const real = makeItem({
      id: "goal-item-1",
      itemType: "goal",
      goal: makeGoal(),
    });
    const state: ItemState = {
      spaces: [makeSpace()],
      goals: [makeGoal()],
      items: [planned, real],
      findOneCalls: [],
      nativeDeleteCalls: [],
      flushes: 0,
    };
    const repository: LearningSpaceItemRepository =
      new MikroOrmLearningSpaceItemRepository(fakeManager(state));

    const records = await repository.listBySpaceId("user-1", "space-1");
    expect(records).toEqual([
      expect.objectContaining({
        itemType: "planned_goal",
        goalId: null,
        plannedTitle: "Build a TypeScript app",
      }),
      expect.objectContaining({
        itemType: "goal",
        goalId: "goal-1",
      }),
    ] satisfies readonly Partial<LearningSpaceItemRecord>[]);

    await repository.findById("user-1", "planned-1");
    expect(state.findOneCalls).toEqual(
      expect.arrayContaining([
        [
          LearningSpaceItemEntity,
          expect.objectContaining({
            id: "planned-1",
            space: { user: "user-1" },
          }),
        ],
      ]),
    );
  });

  it("creates and activates distinct item variants without losing placeholder order", async () => {
    const state: ItemState = {
      spaces: [makeSpace()],
      goals: [makeGoal()],
      items: [],
      findOneCalls: [],
      nativeDeleteCalls: [],
      flushes: 0,
    };
    const repository = new MikroOrmLearningSpaceItemRepository(
      fakeManager(state),
    );

    const planned = await repository.createPlannedGoalItem({
      userId: "user-1",
      id: "planned-1",
      spaceId: "space-1",
      plannedTitle: "Build a TypeScript app",
      goalBrief: {
        schemaVersion: 1,
        originalRequest: "Learn TypeScript by building an app",
        intendedOutcome: "Build a typed web app",
        scopeIncluded: ["TypeScript"],
        scopeExcluded: [],
        prerequisites: [],
        desiredOutputs: ["web app"],
        suggestedLevel: "basic",
        suggestedLearningMode: "mastery",
        suggestedPlanningMode: "deep",
        suggestedContentLanguage: "en",
      },
      sortIndex: 4,
    });
    expect(planned).toMatchObject({
      itemType: "planned_goal",
      goalId: null,
      sortIndex: 4,
    });

    const activated = await repository.activatePlannedGoalItem(
      "user-1",
      "planned-1",
      "goal-1",
      "assistant",
    );
    expect(activated).toMatchObject({
      itemType: "goal",
      goalId: "goal-1",
      plannedTitle: "Build a TypeScript app",
      sortIndex: 4,
      goalBrief: null,
      source: "assistant",
    });
    expect(state.flushes).toBe(2);
    expect(state.spaces[0].revision).toBe(3);
  });

  it("rejects partial reorders instead of moving an unowned or omitted item", async () => {
    const state: ItemState = {
      spaces: [makeSpace()],
      goals: [],
      items: [
        makeItem({ id: "item-1", itemType: "planned_goal", plannedTitle: "A" }),
        makeItem({ id: "item-2", itemType: "planned_goal", plannedTitle: "B" }),
      ],
      findOneCalls: [],
      nativeDeleteCalls: [],
      flushes: 0,
    };
    const repository = new MikroOrmLearningSpaceItemRepository(
      fakeManager(state),
    );

    await expect(
      repository.reorder("user-1", "space-1", ["item-1"]),
    ).resolves.toBe(false);
    await expect(
      repository.reorder("user-1", "space-1", ["item-2", "item-1"]),
    ).resolves.toBe(true);
    expect(state.items.map((item) => item.sortIndex)).toEqual([1, 0]);
    expect(state.spaces[0].revision).toBe(2);
  });
});
