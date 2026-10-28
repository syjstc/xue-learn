export type ModuleEntryReadinessRequirementRecord = Readonly<{
  dimension: string;
  threshold: number;
  required: boolean;
  gate: boolean;
  estimate: number | null;
  evidenceSufficiency: number;
  status: string | null;
}>;

export type ModuleEntryReadinessTargetRecord = Readonly<{
  learningTargetId: string;
  title: string;
  required: boolean;
  requirements: readonly ModuleEntryReadinessRequirementRecord[];
}>;

export type ModuleEntryReadinessReadRecord = Readonly<{
  bridgeUnitId: string | null;
  targets: readonly ModuleEntryReadinessTargetRecord[];
}>;

/** Learner-owned module entry target/state reads; bridge writes remain separate. */
export interface ModuleEntryReadinessReadRepository {
  findForModule(input: {
    userId: string;
    goalId: string;
    moduleId: string;
  }): Promise<ModuleEntryReadinessReadRecord | null>;
}
