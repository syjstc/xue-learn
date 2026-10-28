/**
 * Per-user runtime settings owned by the learner-settings capability.
 *
 * Nullable fields intentionally remain nullable: the application resolves
 * provider/model defaults separately from persistence and must preserve the
 * distinction between an explicit null and a stored value.
 */
export type UserSettingsRecord = Readonly<{
  userId: string;
  llmProvider: string | null;
  chatModel: string | null;
  embeddingModel: string | null;
  embeddingProvider: string | null;
  imageProvider: string | null;
  imageModel: string | null;
  imageGenerationEnabled: boolean | null;
  maxMaterialIllustrations: number | null;
  searchEnabled: boolean | null;
  searchProvider: string | null;
  minimaxThinkingEnabled: boolean | null;
  ollamaThinkingEnabled: boolean | null;
  deepseekThinkingEnabled: boolean | null;
  openaiThinkingEnabled: boolean | null;
  bigmodelThinkingEnabled: boolean | null;
  qwenThinkingEnabled: boolean | null;
  doubaoThinkingMode: string | null;
  customThinkingProtocol: string | null;
  customChatEndpointsJson?: string;
  teachingPersonaRef: string;
  learningViewMode: string;
  chatAudioEnabled: boolean;
  personalMemoryEnabled: boolean;
  theme?: string;
  uiLocale?: string;
  clientPreferencesJson?: string;
  localRuntimeSettingsJson?: string;
  updatedAt: Date;
}>;

export type UserSettingsPatch = Readonly<
  Partial<Omit<UserSettingsRecord, "userId" | "updatedAt">>
>;

export type UpsertUserSettingsInput = Readonly<{
  userId: string;
  patch?: UserSettingsPatch;
}>;

/** Capability-specific persistence contract for one user's settings row. */
export interface UserSettingsRepository {
  findByUserId(userId: string): Promise<UserSettingsRecord | null>;
  upsert(input: UpsertUserSettingsInput): Promise<UserSettingsRecord>;
}
