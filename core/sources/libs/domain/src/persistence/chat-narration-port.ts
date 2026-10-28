export type ChatNarrationAudioRecord = Readonly<{
  id: string;
  userId: string;
  unitId: string;
  sectionId: string | null;
  scopeKey: string;
  contentKey: string;
  textHash: string;
  provider: string;
  model: string;
  speaker: string;
  timingVersion: string;
  status: string;
  generationStartedAt: Date | null;
  error: string;
  objectKey: string | null;
  mimeType: string | null;
  durationMs: number | null;
  chars: unknown;
  createdAt: Date;
}>;

export type ChatNarrationMaterialSource = Readonly<{
  goalId: string;
  material: null | Readonly<{
    introduction: string;
    sections: string;
    keyTakeaways: string;
  }>;
}>;

/** Portable persistence for progressive lesson narration audio. */
export interface ChatNarrationRepository {
  readLearnerSettings(userId: string): Promise<{
    chatAudioEnabled: boolean;
    learningViewMode: string;
  } | null>;
  claim(input: {
    userId: string;
    unitId: string;
    sectionId: string | null;
    scopeKey: string;
    contentKey: string;
    textHash: string;
    provider: string;
    model: string;
    speaker: string;
    timingVersion: string;
    staleBefore: Date;
  }): Promise<{ row: ChatNarrationAudioRecord; claimed: boolean }>;
  markReady(input: {
    id: string;
    objectKey: string;
    mimeType: string;
    durationMs: number;
    chars: unknown;
  }): Promise<ChatNarrationAudioRecord>;
  markFailed(input: { ids: readonly string[]; error: string }): Promise<number>;
  loadMaterial(input: {
    userId: string;
    unitId: string;
    sectionId?: string;
  }): Promise<ChatNarrationMaterialSource | null>;
  listReady(input: {
    userId: string;
    unitId: string;
    scopeKey: string;
    provider: string;
    model: string;
    speaker: string;
  }): Promise<readonly ChatNarrationAudioRecord[]>;
  findReadyOwned(input: {
    userId: string;
    unitId: string;
    id: string;
  }): Promise<ChatNarrationAudioRecord | null>;
}
