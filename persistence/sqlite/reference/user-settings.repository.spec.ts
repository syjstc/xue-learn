import type { EntityManager } from "@mikro-orm/core";
import type {
  UserSettingsRepository,
  UserSettingsRecord,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import { UserSettingsSchema, UserSettingsEntity } from "./user-settings.entity.ts";
import { MikroOrmUserSettingsRepository } from "./user-settings.repository.ts";

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
  row: UserSettingsEntity | null;
  upserts: UserSettingsEntity[];
  flushes: number;
};

function fakeManager(state: FakeManagerState): EntityManager {
  const manager = {
    findOne: async () => state.row,
    upsert: async (
      _entity: typeof UserSettingsEntity,
      input: Partial<UserSettingsEntity>,
    ) => {
      const entity = Object.assign(
        state.row ?? new UserSettingsEntity(),
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

describe("user settings reference repository", () => {
  it("declares the final hosted settings shape and ownership key", () => {
    expect(UserSettingsSchema.tableName).toBe("UserSettings");
    expect(UserSettingsSchema.meta.primaryKeys).toEqual(["user"]);
    expect(UserSettingsSchema.properties.user.fieldName).toBe("userId");
    expect(UserSettingsSchema.properties.user.deleteRule).toBe("cascade");
    expect(UserSettingsSchema.properties.teachingPersonaRef.default).toBe(
      "builtin:xiaohui_female",
    );
    expect(UserSettingsSchema.properties.personalMemoryEnabled.default).toBe(
      false,
    );
  });

  it("preserves nullable settings while upserting a capability patch", async () => {
    const state: FakeManagerState = { row: null, upserts: [], flushes: 0 };
    const repository: UserSettingsRepository =
      new MikroOrmUserSettingsRepository(fakeManager(state));

    await expect(repository.findByUserId("user-1")).resolves.toBeNull();

    const first = await repository.upsert({
      userId: "user-1",
      patch: { llmProvider: "deepseek", searchEnabled: false },
    });
    expect(first).toMatchObject({
      userId: "user-1",
      llmProvider: "deepseek",
      searchEnabled: false,
      teachingPersonaRef: "builtin:xiaohui_female",
      personalMemoryEnabled: false,
    });
    expect(state.upserts).toHaveLength(1);
    expect(state.flushes).toBe(1);

    const second = await repository.upsert({
      userId: "user-1",
      patch: { llmProvider: null, searchProvider: "tavily" },
    });
    expect(second.llmProvider).toBeNull();
    expect(second.searchProvider).toBe("tavily");
    expect(state.flushes).toBe(2);
  });

  it("keeps the port database-independent", () => {
    const value: UserSettingsRecord = {
      userId: "user-1",
      llmProvider: null,
      chatModel: null,
      embeddingModel: null,
      embeddingProvider: null,
      imageProvider: null,
      imageModel: null,
      imageGenerationEnabled: null,
      maxMaterialIllustrations: null,
      searchEnabled: null,
      searchProvider: null,
      minimaxThinkingEnabled: null,
      ollamaThinkingEnabled: null,
      deepseekThinkingEnabled: null,
      openaiThinkingEnabled: null,
      bigmodelThinkingEnabled: null,
      qwenThinkingEnabled: null,
      doubaoThinkingMode: null,
      customThinkingProtocol: null,
      teachingPersonaRef: "builtin:xiaohui_female",
      learningViewMode: "chat",
      chatAudioEnabled: false,
      personalMemoryEnabled: false,
      updatedAt: new Date(0),
    };
    expect(value.userId).toBe("user-1");
  });
});
