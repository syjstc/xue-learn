export type UnitSessionArtifactSnapshot = Readonly<{
  contentRevision: number;
  sectionCount: number;
  hasLearningMaterial: boolean;
  hasCornellNote: boolean;
}>;

/** Small learner-unit artifacts that participate in GELC session commands. */
export interface UnitSessionArtifactRepository {
  inspect(input: { userId: string; unitId: string }): Promise<UnitSessionArtifactSnapshot | null>;
  deleteLegacyMaterial(input: { userId: string; unitId: string }): Promise<boolean>;
  saveCornell(input: { userId: string; unitId: string; notes: string; cues: string; summary: string }): Promise<boolean>;
  createDiagnosticAttempt(input: { userId: string; unitId: string; questionsJson: string }): Promise<{ id: string } | null>;
  createFeynmanSession(input: { userId: string; unitId: string; userText: string; feedbackJson: string; passed: boolean }): Promise<{ id: string } | null>;
  findLatestFeynman(input: { userId: string; unitId: string }): Promise<{ id: string; passed: boolean } | null>;
}
