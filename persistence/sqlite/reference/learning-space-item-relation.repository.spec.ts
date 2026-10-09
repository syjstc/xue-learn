import type { EntityManager } from "@mikro-orm/core";
import type { LearningSpaceItemRelationRepository } from "@xue-learn/core/domain";
import { LearningSpaceEntity } from "./learning-space.entity.ts";
import { LearningSpaceItemEntity } from "./learning-space-item.entity.ts";
import { LearningSpaceItemRelationEntity } from "./learning-space-item-relation.entity.ts";
import { MikroOrmLearningSpaceItemRelationRepository } from "./learning-space-item-relation.repository.ts";

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

function makeSpace(): LearningSpaceEntity {
  return Object.assign(new LearningSpaceEntity(), {
    id: "space-1",
    user: "user-1",
  });
}

function makeItem(id: string): LearningSpaceItemEntity {
  return Object.assign(new LearningSpaceItemEntity(), {
    id,
    space: makeSpace(),
    goal: null,
  });
}

type RelationState = {
  space: LearningSpaceEntity;
  items: LearningSpaceItemEntity[];
  relations: LearningSpaceItemRelationEntity[];
  persisted: LearningSpaceItemRelationEntity[];
  flushes: number;
  nativeDeleteCalls: unknown[][];
};

function fakeManager(state: RelationState): EntityManager {
  const manager = {
    getReference: (_entity: unknown, id: string) => id,
    findOne: async (entity: unknown) => {
      if (entity === LearningSpaceEntity) return state.space;
      if (entity === LearningSpaceItemRelationEntity) {
        return state.relations[0] ?? null;
      }
      return null;
    },
    find: async (entity: unknown) => {
      if (entity === LearningSpaceItemEntity) return state.items;
      if (entity === LearningSpaceItemRelationEntity) return state.relations;
      return [];
    },
    persist: (entity: LearningSpaceItemRelationEntity) => {
      state.persisted.push(entity);
    },
    remove: (_entity: LearningSpaceItemRelationEntity) => undefined,
    flush: async () => {
      state.flushes += 1;
    },
    nativeDelete: async (_entity: unknown, where: unknown) => {
      state.nativeDeleteCalls.push([_entity, where]);
      return 2;
    },
  };
  return manager as unknown as EntityManager;
}

describe("learning space item relation reference repository", () => {
  it("requires two distinct items in the same owned space", async () => {
    const state: RelationState = {
      space: makeSpace(),
      items: [makeItem("item-1"), makeItem("item-2")],
      relations: [],
      persisted: [],
      flushes: 0,
      nativeDeleteCalls: [],
    };
    const repository: LearningSpaceItemRelationRepository =
      new MikroOrmLearningSpaceItemRelationRepository(fakeManager(state));

    const relation = await repository.create({
      userId: "user-1",
      id: "relation-1",
      spaceId: "space-1",
      fromItemId: "item-1",
      toItemId: "item-2",
      relationType: "prerequisite",
      source: "assistant",
    });
    expect(relation).toMatchObject({
      id: "relation-1",
      spaceId: "space-1",
      fromItemId: "item-1",
      toItemId: "item-2",
      relationType: "prerequisite",
      source: "assistant",
    });
    expect(state.flushes).toBe(1);
    expect(state.space.revision).toBe(2);

    await expect(
      repository.create({
        userId: "user-1",
        id: "self",
        spaceId: "space-1",
        fromItemId: "item-1",
        toItemId: "item-1",
        relationType: "related",
      }),
    ).resolves.toBeNull();
  });

  it("keeps relation reads and deletes ownership-scoped", async () => {
    const relation = Object.assign(new LearningSpaceItemRelationEntity(), {
      id: "relation-1",
      space: makeSpace(),
      fromItem: makeItem("item-1"),
      toItem: makeItem("item-2"),
      relationType: "supports",
      source: "manual",
      createdAt: new Date(1),
    });
    const state: RelationState = {
      space: makeSpace(),
      items: [makeItem("item-1"), makeItem("item-2")],
      relations: [relation],
      persisted: [],
      flushes: 0,
      nativeDeleteCalls: [],
    };
    const repository = new MikroOrmLearningSpaceItemRelationRepository(
      fakeManager(state),
    );

    await expect(
      repository.listBySpaceId("user-1", "space-1"),
    ).resolves.toEqual([expect.objectContaining({ relationType: "supports" })]);
    await expect(repository.delete("user-1", "relation-1")).resolves.toBe(true);
    expect(state.flushes).toBe(1);
    expect(state.space.revision).toBe(2);
  });
});
