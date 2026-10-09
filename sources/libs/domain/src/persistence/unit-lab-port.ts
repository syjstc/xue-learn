export type UnitLabRecord = Readonly<{
  id: string;
  unitId: string;
  revision: number;
  status: string;
  source: string;
  recommended: boolean;
  recommendation: string;
  definitionJson: unknown;
  generationInputHash: string;
  generationError: string;
  updatedAt: Date;
}>;

export type UnitLabGenerationContext = Readonly<{
  unit: Readonly<{
    id: string;
    title: string;
    contentSummary: string;
    goalId: string;
    contentRevision: number;
    goalTitle: string;
  }>;
  sq3rData: string | null;
  legacyMaterial: Readonly<{
    introduction: string;
    sections: string;
    keyTakeaways: string;
  }> | null;
}>;

export type UnitLabContentReadRecord = Readonly<{
  goalId: string;
  status: string;
  recommended: boolean;
  recommendation: string;
  revision: number;
  definitionJson: unknown;
  generationError: string;
}>;

export type UnitLabSessionReadRecord = Readonly<{
  status: string;
  revision: number;
  completedOnce: boolean;
  openedOnce: boolean;
}>;

/** Persistence for optional unit-lab prepare, reads, and learner visits. */
export interface UnitLabRepository {
  findContext(input: {
    userId?: string;
    unitId: string;
  }): Promise<UnitLabGenerationContext | null>;
  findLab(unitId: string): Promise<UnitLabRecord | null>;
  recommend(input: {
    unitId: string;
    recommendation: string;
  }): Promise<UnitLabRecord>;
  invalidate(unitId: string): Promise<boolean>;
  enqueue(input: { type: string; payloadJson: string }): Promise<boolean>;
  beginPreparation(input: {
    unitId: string;
    revision: number;
    source: string;
    recommended: boolean;
    recommendation: string;
    inputHash: string;
  }): Promise<UnitLabRecord>;
  publishPrepared(input: {
    labId: string;
    definitionJson: unknown;
  }): Promise<void>;
  publishRegeneratedItem(input: {
    labId: string;
    expectedRevision: number;
    definitionJson: unknown;
  }): Promise<boolean>;
  /**
   * Publish a regenerated item and advance the owning unit revision in the
   * same persistence transaction. Keeping these writes together prevents a
   * successful lab replacement from being reported as a failed request when
   * the follow-up revision bump cannot complete.
   */
  publishRegeneratedItemAndBumpContentRevision(input: {
    labId: string;
    unitId: string;
    expectedRevision: number;
    definitionJson: unknown;
  }): Promise<{ applied: boolean; contentRevision: number }>;
  markFailed(input: { labId: string; error: string }): Promise<void>;
  bumpContentRevision(unitId: string): Promise<number>;
  findLabContent(input: {
    userId: string;
    unitId: string;
  }): Promise<UnitLabContentReadRecord | null>;
  findLabSession(input: {
    userId: string;
    unitId: string;
  }): Promise<UnitLabSessionReadRecord | null>;
  markOpened(input: { userId: string; unitId: string }): Promise<void>;
  markCompleted(input: { userId: string; unitId: string }): Promise<void>;
}
