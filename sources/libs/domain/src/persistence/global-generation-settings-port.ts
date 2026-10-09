export type GlobalGenerationSettingsRecord = Readonly<{
  imageProvider: string;
  searchEnabled: boolean;
  searchProvider: string;
  chatAudioProvider: string;
  openaiBaseUrl: string;
  contentVerificationMode: string;
  contentVerificationProvider: string;
  contentVerificationModel: string;
  disabledMaterialComponentTypes: readonly string[];
  updatedAt: Date;
  updatedByUserId: string | null;
}>;

export type GlobalGenerationSettingsPatch = Partial<
  Omit<GlobalGenerationSettingsRecord, "updatedAt" | "updatedByUserId">
> & { updatedByUserId?: string | null };

export interface GlobalGenerationSettingsRepository {
  findUpdater(userId: string): Promise<{
    id: string;
    name: string | null;
    email: string;
  } | null>;
  get(): Promise<GlobalGenerationSettingsRecord>;
  update(
    patch: GlobalGenerationSettingsPatch,
  ): Promise<GlobalGenerationSettingsRecord>;
}
