import type {
  ModuleSliceReconciliationRepository,
  ReconcileModuleSlicesInput,
  ReconcileModuleSlicesResult,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning composition adapter for curriculum reconciliation. */
export class MikroOrmModuleSliceReconciliationRuntimeAdapter implements ModuleSliceReconciliationRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  reconcile(
    input: ReconcileModuleSlicesInput,
  ): Promise<ReconcileModuleSlicesResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.moduleSliceReconciliation.reconcile(input),
    );
  }
}
