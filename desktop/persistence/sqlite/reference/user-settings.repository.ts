import type { EntityManager } from "@mikro-orm/core";
import type {
  UserSettingsRecord,
  UserSettingsRepository,
  UpsertUserSettingsInput,
} from "@xue-learn/core/domain";
import { UserSettingsEntity } from "./user-settings.entity.ts";
import { UserEntity } from "./user.entity.ts";

function toRecord(entity: UserSettingsEntity): UserSettingsRecord {
  return {
    userId: typeof entity.user === "string" ? entity.user : entity.user.id,
    llmProvider: entity.llmProvider,
    chatModel: entity.chatModel,
    embeddingModel: entity.embeddingModel,
    embeddingProvider: entity.embeddingProvider,
    imageProvider: entity.imageProvider,
    imageModel: entity.imageModel,
    imageGenerationEnabled: entity.imageGenerationEnabled,
    maxMaterialIllustrations: entity.maxMaterialIllustrations,
    searchEnabled: entity.searchEnabled,
    searchProvider: entity.searchProvider,
    minimaxThinkingEnabled: entity.minimaxThinkingEnabled,
    ollamaThinkingEnabled: entity.ollamaThinkingEnabled,
    deepseekThinkingEnabled: entity.deepseekThinkingEnabled,
    openaiThinkingEnabled: entity.openaiThinkingEnabled,
    bigmodelThinkingEnabled: entity.bigmodelThinkingEnabled,
    qwenThinkingEnabled: entity.qwenThinkingEnabled,
    doubaoThinkingMode: entity.doubaoThinkingMode,
    customThinkingProtocol: entity.customThinkingProtocol,
    customChatEndpointsJson: entity.customChatEndpointsJson,
    teachingPersonaRef: entity.teachingPersonaRef,
    learningViewMode: entity.learningViewMode,
    chatAudioEnabled: entity.chatAudioEnabled,
    personalMemoryEnabled: entity.personalMemoryEnabled,
    theme: entity.theme,
    uiLocale: entity.uiLocale,
    clientPreferencesJson: entity.clientPreferencesJson,
    localRuntimeSettingsJson: entity.localRuntimeSettingsJson,
    updatedAt: entity.updatedAt,
  };
}

export class MikroOrmUserSettingsRepository implements UserSettingsRepository {
  constructor(private readonly em: EntityManager) {}

  private userReference(userId: string) {
    // The lightweight CommonJS contract fake does not implement references;
    // the live MikroORM manager does, and uses this path for FK-safe queries.
    return typeof this.em.getReference === "function"
      ? this.em.getReference(UserEntity, userId)
      : userId;
  }

  async findByUserId(userId: string): Promise<UserSettingsRecord | null> {
    // Goal deletion can remove production preferences through atomic SQL.
    const entity = await this.em.findOne(
      UserSettingsEntity,
      { user: this.userReference(userId) },
      { refresh: true },
    );
    return entity ? toRecord(entity) : null;
  }

  async upsert(input: UpsertUserSettingsInput): Promise<UserSettingsRecord> {
    const patch = input.patch ?? {};
    const entity = await this.em.upsert(
      UserSettingsEntity,
      {
        user: this.userReference(input.userId),
        // Old SQLite libraries still have a Chinese column default. Use the
        // system language for new rows without overwriting an existing choice.
        uiLocale: "system",
        ...patch,
        updatedAt: new Date(),
      },
      {
        onConflictFields: ["user"],
        onConflictMergeFields: [
          ...Object.keys(patch),
          "updatedAt",
        ] as (keyof UserSettingsEntity)[],
      },
    );
    await this.em.flush();
    return toRecord(entity);
  }
}
