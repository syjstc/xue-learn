export type ScenarioTheaterGenerationContext = Readonly<{
  unit: Readonly<{ id: string; title: string; contentSummary: string; goalId: string; contentRevision: number; goalTitle: string }>;
  sq3rData: string | null;
  legacyMaterial: Readonly<{ introduction: string; sections: string; keyTakeaways: string }> | null;
}>;
export type ScenarioTheaterRecord = Readonly<{
  id: string; unitId: string; revision: number; status: string; source: string; recommended: boolean; recommendation: string; definitionJson: unknown; generationInputHash: string; generationError: string; updatedAt: Date;
}>;
export type ScenarioTheaterSceneRecord = Readonly<{ sceneId: string; status: string; contentJson: unknown; attemptCount: number }>;

/** Persistence boundary for optional scenario-theater authoring and worker events. */
export interface ScenarioTheaterGenerationRepository {
  findContext(input: { userId?: string; unitId: string }): Promise<ScenarioTheaterGenerationContext | null>;
  findTheater(unitId: string): Promise<ScenarioTheaterRecord | null>;
  recommend(input: { unitId: string; recommendation: string }): Promise<ScenarioTheaterRecord>;
  invalidate(unitId: string): Promise<boolean>;
  enqueue(input: { type: string; payloadJson: string }): Promise<boolean>;
  beginPreparation(input: { unitId: string; revision: number; source: string; recommended: boolean; recommendation: string; inputHash: string; abandonActiveRuns: boolean }): Promise<ScenarioTheaterRecord>;
  publishPrepared(input: { theaterId: string; revision: number; definitionJson: unknown; sceneIds: readonly string[] }): Promise<void>;
  markTheaterFailed(input: { theaterId: string; error: string }): Promise<void>;
  listScenes(input: { theaterId: string; revision: number }): Promise<readonly ScenarioTheaterSceneRecord[]>;
  claimScene(input: { theaterId: string; revision: number; sceneId: string; staleBefore: Date }): Promise<boolean>;
  saveScenes(input: { theaterId: string; revision: number; scenes: readonly Readonly<{ sceneId: string; status: "ready" | "fallback"; contentJson?: unknown; error: string }>[] }): Promise<void>;
  failClaimedScenes(input: { theaterId: string; revision: number; sceneIds: readonly string[]; error: string }): Promise<void>;
  findActiveRun(input: { userId: string; unitId: string; runId: string }): Promise<{ theaterRevision: number; currentSceneId: string | null } | null>;
  markReady(input: { theaterId: string; definitionJson?: unknown }): Promise<void>;
  bumpContentRevision(unitId: string): Promise<number>;
}
