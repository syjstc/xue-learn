export interface WorkspaceLearningPort {
  assessments(input: {ownerId: string; unitId: string}): Promise<unknown>;
  progress(input: {ownerId: string; unitId: string}): Promise<unknown>;
  command(input: {ownerId: string; unitId: string; sectionId: string; action: "answers" | "complete";
    expectedContentRevision: number; expectedSectionRevision: number; answers?: Record<string, number | number[] | boolean>}): Promise<unknown>;
}
