export interface MasterySummaryReadRepository {
  load(input: Readonly<{ userId: string; goalId: string; moduleId?: string }>): Promise<Readonly<{
    modelVersion: number;
    targets: any[];
    evidenceCutoffAt: Date | null;
    lifecycleCutoffAt: Date | null;
    claims: any[];
  }> | null>;
}
