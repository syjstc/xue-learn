export type ReconcileModuleSlice = Readonly<{
  moduleId: string;
  expectedGenerationInputHash: string | null;
  nextGenerationInputHash: string;
}>;

export type ReconcileModuleSlicesInput = Readonly<{
  userId: string;
  goalId: string;
  goalInputHash: string;
  modules: readonly ReconcileModuleSlice[];
  updatedAt: Date;
}>;

export type ReconcileModuleSlicesResult = Readonly<{
  reconciledModuleIds: readonly string[];
}>;

/**
 * Applies the curriculum-only half of downstream module reconciliation.
 * KACOM-derived fingerprints are computed and validated by the caller; this
 * port owns only the fenced module/unit state transition.
 */
export interface ModuleSliceReconciliationRepository {
  reconcile(
    input: ReconcileModuleSlicesInput,
  ): Promise<ReconcileModuleSlicesResult>;
}
