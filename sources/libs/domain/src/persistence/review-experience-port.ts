export type DueReviewEntityCandidate = Readonly<{
  entity: Readonly<{
    id: string;
    title: string;
    description: string;
    atom: Readonly<{ explanation: string }> | null;
  }>;
  state: Readonly<{
    estimate: number | null;
    evidenceSufficiency: number;
    status: string;
  }> | null;
  gate: boolean;
  required: boolean;
  mappingRole: string;
  mappingOrder: number;
  requirementOrder: number;
}>;

export type DueReviewCardRecord = Readonly<{
  id: string;
  intervalDays: number;
  easeFactor: number;
  nextReviewAt: Date;
  lastGrade: number | null;
  unitId: string;
  unitTitle: string;
  goalId: string;
  goalTitle: string;
  candidates: readonly DueReviewEntityCandidate[];
}>;

export type ReviewPracticeUnitRecord = Readonly<{
  id: string;
  title: string;
  status: string;
  goalId: string;
  goalTitle: string;
}>;

export type SubmitUnitReviewResult =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{
      status: "updated";
      card: Readonly<{
        id: string;
        unitId: string;
        intervalDays: number;
        easeFactor: number;
        nextReviewAt: Date;
        lastGrade: number;
      }>;
    }>;

export interface ReviewExperienceRepository {
  findUnitNotes(
    userId: string,
    unitId: string,
  ): Promise<Readonly<{ summary: string; cues: string; notes: string }> | null>;
  listDue(userId: string, now: Date): Promise<readonly DueReviewCardRecord[]>;
  listPracticeUnits(
    userId: string,
    limit: number,
  ): Promise<readonly ReviewPracticeUnitRecord[]>;
  submitGrade(
    userId: string,
    cardId: string,
    grade: number,
  ): Promise<SubmitUnitReviewResult>;
}
