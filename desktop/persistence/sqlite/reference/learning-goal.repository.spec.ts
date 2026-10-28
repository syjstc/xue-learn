import type { EntityManager } from "@mikro-orm/core";
import { LearningGoalEntity, LearningGoalSchema } from "./learning-goal.entity.ts";
import { MikroOrmLearningGoalRepository } from "./learning-goal.repository.ts";

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

type State = {
  row: LearningGoalEntity | null;
  persisted: LearningGoalEntity[];
  deleted: number;
  flushes: number;
};

function fakeManager(state: State): EntityManager {
  return {
    find: async () => (state.row ? [state.row] : []),
    findOne: async () => state.row,
    persist: (entity: LearningGoalEntity) => {
      state.persisted.push(entity);
      state.row = entity;
    },
    flush: async () => {
      state.flushes += 1;
    },
    nativeDelete: async () => {
      const deleted = state.row ? 1 : 0;
      state.deleted += deleted;
      state.row = null;
      return deleted;
    },
  } as unknown as EntityManager;
}

describe("learning goal reference repository", () => {
  it("declares the final goal table and ownership relationships", () => {
    expect(LearningGoalSchema.tableName).toBe("LearningGoal");
    expect(LearningGoalSchema.properties.user.fieldName).toBe("userId");
    expect(LearningGoalSchema.properties.user.deleteRule).toBe("set null");
    expect(LearningGoalSchema.properties.parentGoal.fieldName).toBe(
      "parentGoalId",
    );
    expect(LearningGoalSchema.properties.parentGoal.deleteRule).toBe(
      "set null",
    );
  });

  it("creates, updates, scopes, and deletes a goal without exposing ORM types", async () => {
    const state: State = { row: null, persisted: [], deleted: 0, flushes: 0 };
    const repository = new MikroOrmLearningGoalRepository(fakeManager(state));
    const created = await repository.create({
      id: "goal-1",
      userId: "user-1",
      title: "Learn SQL",
      level: "beginner",
    });
    expect(created).toMatchObject({
      id: "goal-1",
      userId: "user-1",
      title: "Learn SQL",
      level: "beginner",
      planningMode: "fast",
      cognitiveModelVersion: 0,
    });
    expect(state.persisted).toHaveLength(1);

    const updated = await repository.updateOwned("user-1", "goal-1", {
      title: "Learn PostgreSQL",
      parentGoalId: "goal-parent",
      cognitiveModelVersion: 2,
    });
    expect(updated).toMatchObject({
      title: "Learn PostgreSQL",
      parentGoalId: "goal-parent",
      cognitiveModelVersion: 2,
    });
    await expect(
      repository.findOwnedById("user-1", "goal-1"),
    ).resolves.toMatchObject({
      id: "goal-1",
    });
    await expect(repository.deleteOwned("user-1", "goal-1")).resolves.toBe(
      true,
    );
    expect(state.deleted).toBe(1);
    expect(state.flushes).toBe(2);
  });
});
