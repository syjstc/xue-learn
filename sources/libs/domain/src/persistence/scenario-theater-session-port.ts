export type ScenarioTheaterRunRecord = Readonly<{
  id: string;
  theaterRevision: number;
  runVersion: number;
  status: string;
  currentSceneId: string | null;
  metersJson: unknown;
  pathJson: unknown;
  endingId: string | null;
  startedAt: Date;
  completedAt: Date | null;
}>;

export type ScenarioTheaterSessionRecord = Readonly<{
  goalId: string;
  theater: Readonly<{
    id: string;
    revision: number;
    status: string;
    recommended: boolean;
    recommendation: string;
    definitionJson: unknown;
    generationError: string;
  }> | null;
  scenes: readonly Readonly<{ sceneId: string; status: string; contentJson: unknown }>[];
  activeRun: ScenarioTheaterRunRecord | null;
  completedOnce: boolean;
}>;

/** Owner-scoped persistence for deterministic scenario-theater playthroughs. */
export interface ScenarioTheaterSessionRepository {
  load(input: { userId: string; unitId: string }): Promise<ScenarioTheaterSessionRecord | null>;
  createOrReuse(input: { userId: string; unitId: string; theaterId: string; theaterRevision: number; initialSceneId: string; metersJson: unknown }): Promise<ScenarioTheaterRunRecord>;
  restart(input: { userId: string; unitId: string; theaterId: string; theaterRevision: number; initialSceneId: string; metersJson: unknown }): Promise<{ run: ScenarioTheaterRunRecord; completedOnce: boolean }>;
  commitChoice(input: { userId: string; unitId: string; runId: string; theaterId: string; theaterRevision: number; runVersion: number; sceneId: string; currentSceneId: string | null; metersJson: unknown; pathJson: unknown; endingId: string | null; completed: boolean }): Promise<"saved" | "missing" | "conflict">;
  findRun(input: { userId: string; unitId: string; runId: string }): Promise<ScenarioTheaterRunRecord | null>;
}
