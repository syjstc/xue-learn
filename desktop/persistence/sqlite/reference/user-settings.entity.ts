import { EntitySchema } from "@mikro-orm/core";
import { UserEntity } from "./user.entity.ts";

/** Final hosted `UserSettings` shape after all Persistence-era alterations. */
export class UserSettingsEntity {
  /** `mapToPk` keeps the capability repository independent of a loaded User. */
  user!: UserEntity | string;
  llmProvider: string | null = null;
  chatModel: string | null = null;
  embeddingModel: string | null = null;
  embeddingProvider: string | null = null;
  imageProvider: string | null = null;
  imageModel: string | null = null;
  imageGenerationEnabled: boolean | null = null;
  maxMaterialIllustrations: number | null = null;
  searchEnabled: boolean | null = null;
  searchProvider: string | null = null;
  minimaxThinkingEnabled: boolean | null = null;
  ollamaThinkingEnabled: boolean | null = null;
  deepseekThinkingEnabled: boolean | null = null;
  openaiThinkingEnabled: boolean | null = null;
  bigmodelThinkingEnabled: boolean | null = null;
  qwenThinkingEnabled: boolean | null = null;
  doubaoThinkingMode: string | null = null;
  customThinkingProtocol: string | null = null;
  customChatEndpointsJson = '{"activeProfileId":null,"profiles":[]}';
  teachingPersonaRef = "builtin:xiaohui_female";
  learningViewMode = "chat";
  chatAudioEnabled = false;
  personalMemoryEnabled = false;
  theme = "system";
  uiLocale = "system";
  clientPreferencesJson = "{}";
  localRuntimeSettingsJson = "{}";
  updatedAt!: Date;
}

export const UserSettingsSchema = new EntitySchema<UserSettingsEntity>({
  class: UserSettingsEntity,
  name: "UserSettings",
  tableName: "UserSettings",
  properties: {
    user: {
      kind: "m:1",
      entity: () => UserEntity,
      fieldName: "userId",
      primary: true,
      mapToPk: true,
      deleteRule: "cascade",
      updateRule: "cascade",
      foreignKeyName: "UserSettings_userId_fkey",
    },
    llmProvider: {
      type: String,
      columnType: "text",
      nullable: true,
      fieldName: "llmProvider",
    },
    chatModel: {
      type: String,
      columnType: "text",
      nullable: true,
      fieldName: "chatModel",
    },
    embeddingModel: {
      type: String,
      columnType: "text",
      nullable: true,
      fieldName: "embeddingModel",
    },
    embeddingProvider: {
      type: String,
      columnType: "text",
      nullable: true,
      fieldName: "embeddingProvider",
    },
    imageProvider: {
      type: String,
      columnType: "text",
      nullable: true,
      fieldName: "imageProvider",
    },
    imageModel: {
      type: String,
      columnType: "text",
      nullable: true,
      fieldName: "imageModel",
    },
    imageGenerationEnabled: {
      type: Boolean,
      columnType: "boolean",
      nullable: true,
      fieldName: "imageGenerationEnabled",
    },
    maxMaterialIllustrations: {
      type: Number,
      columnType: "integer",
      nullable: true,
      fieldName: "maxMaterialIllustrations",
    },
    searchEnabled: {
      type: Boolean,
      columnType: "boolean",
      nullable: true,
      fieldName: "searchEnabled",
    },
    searchProvider: {
      type: String,
      columnType: "text",
      nullable: true,
      fieldName: "searchProvider",
    },
    minimaxThinkingEnabled: {
      type: Boolean,
      columnType: "boolean",
      nullable: true,
      fieldName: "minimaxThinkingEnabled",
    },
    ollamaThinkingEnabled: {
      type: Boolean,
      columnType: "boolean",
      nullable: true,
      fieldName: "ollamaThinkingEnabled",
    },
    deepseekThinkingEnabled: {
      type: Boolean,
      columnType: "boolean",
      nullable: true,
      fieldName: "deepseekThinkingEnabled",
    },
    openaiThinkingEnabled: {
      type: Boolean,
      columnType: "boolean",
      nullable: true,
      fieldName: "openaiThinkingEnabled",
    },
    bigmodelThinkingEnabled: {
      type: Boolean,
      columnType: "boolean",
      nullable: true,
      fieldName: "bigmodelThinkingEnabled",
    },
    qwenThinkingEnabled: {
      type: Boolean,
      columnType: "boolean",
      nullable: true,
      fieldName: "qwenThinkingEnabled",
    },
    doubaoThinkingMode: {
      type: String,
      columnType: "text",
      nullable: true,
      fieldName: "doubaoThinkingMode",
    },
    customThinkingProtocol: {
      type: String,
      columnType: "text",
      nullable: true,
      fieldName: "customThinkingProtocol",
    },
    customChatEndpointsJson: {
      type: String,
      columnType: "text",
      default: '{"activeProfileId":null,"profiles":[]}',
      fieldName: "customChatEndpointsJson",
    },
    teachingPersonaRef: {
      type: String,
      columnType: "text",
      default: "builtin:xiaohui_female",
      fieldName: "teachingPersonaRef",
    },
    learningViewMode: {
      type: String,
      columnType: "text",
      default: "chat",
      fieldName: "learningViewMode",
    },
    chatAudioEnabled: {
      type: Boolean,
      columnType: "boolean",
      default: false,
      fieldName: "chatAudioEnabled",
    },
    personalMemoryEnabled: {
      type: Boolean,
      columnType: "boolean",
      default: false,
      fieldName: "personalMemoryEnabled",
    },
    theme: {
      type: String,
      columnType: "text",
      default: "system",
      fieldName: "theme",
    },
    uiLocale: {
      type: String,
      columnType: "text",
      default: "system",
      fieldName: "uiLocale",
    },
    clientPreferencesJson: {
      type: String,
      columnType: "text",
      default: "{}",
      fieldName: "clientPreferencesJson",
    },
    localRuntimeSettingsJson: {
      type: String,
      columnType: "text",
      default: "{}",
      fieldName: "localRuntimeSettingsJson",
    },
    updatedAt: {
      type: Date,
      columnType: "timestamp(3)",
      fieldName: "updatedAt",
      onCreate: () => new Date(),
      onUpdate: () => new Date(),
    },
  },
});
