import type { EntityManager } from "@mikro-orm/core";
import type {
  LearnerProfileRecord,
  LearnerProfileRepository,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import { LearnerProfileSchema } from "./learner-profile.entity.ts";
import { LearnerProfileEntity } from "./learner-profile.entity.ts";
import { MikroOrmLearnerProfileRepository } from "./learner-profile.repository.ts";

// MikroORM v7 is ESM-only while this repository's Jest projects currently
// execute CommonJS. The contract test mocks only EntitySchema metadata; the
// actual driver imports remain in the runtime adapter boundary.
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

type FakeManagerState = {
  row: LearnerProfileEntity | null;
  upserts: LearnerProfileEntity[];
  flushes: number;
};

function fakeManager(state: FakeManagerState): EntityManager {
  const manager = {
    findOne: async () => state.row,
    upsert: async (
      _entity: typeof LearnerProfileEntity,
      input: Partial<LearnerProfileEntity>,
    ) => {
      const entity = Object.assign(
        state.row ?? new LearnerProfileEntity(),
        input,
      );
      state.upserts.push(entity);
      state.row = entity;
      return entity;
    },
    flush: async () => {
      state.flushes += 1;
    },
  };
  return manager as unknown as EntityManager;
}

describe("learner profile reference repository", () => {
  it("declares the existing table shape for both SQL drivers", () => {
    expect(LearnerProfileSchema.tableName).toBe("LearningProfile");
    expect(LearnerProfileSchema.meta.primaryKeys).toEqual(["userId"]);
    expect(Object.keys(LearnerProfileSchema.properties)).toEqual([
      "userId",
      "profileJson",
      "updatedAt",
    ]);
    expect(LearnerProfileSchema.properties.profileJson.fieldName).toBe(
      "profileJson",
    );
  });

  it("implements the database-independent repository contract", async () => {
    const state: FakeManagerState = { row: null, upserts: [], flushes: 0 };
    const repository: LearnerProfileRepository =
      new MikroOrmLearnerProfileRepository(fakeManager(state));

    await expect(repository.findByUserId("user-1")).resolves.toBeNull();

    const first = await repository.upsert({
      userId: "user-1",
      profileJson: '{"nickname":"小慧"}',
    });
    expect(first).toMatchObject({
      userId: "user-1",
      profileJson: '{"nickname":"小慧"}',
    });
    expect(state.upserts).toHaveLength(1);
    expect(state.flushes).toBe(1);

    const second = await repository.upsert({
      userId: "user-1",
      profileJson: '{"nickname":"小会"}',
    });
    expect(second.profileJson).toBe('{"nickname":"小会"}');
    expect(state.upserts).toHaveLength(2);
    expect(state.flushes).toBe(2);
    await expect(repository.findByUserId("user-1")).resolves.toEqual(
      expect.objectContaining({ profileJson: '{"nickname":"小会"}' }),
    );
  });

  it("keeps the port free of ORM/database types", () => {
    const value: LearnerProfileRecord = {
      userId: "user-1",
      profileJson: "{}",
      updatedAt: new Date(0),
    };
    expect(value.userId).toBe("user-1");
  });
});
