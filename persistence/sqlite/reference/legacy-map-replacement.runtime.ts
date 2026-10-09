import type {
  LegacyMapReplacementRepository,
  LegacyMapReconciliationUnit,
  PersistOwnedLegacyMapReplacementInput,
  PersistOwnedLegacyMapReplacementResult,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for hosted legacy map replacement. */
export class MikroOrmLegacyMapReplacementRuntimeAdapter implements LegacyMapReplacementRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  listOwnedReconciliationUnits(
    userId: string,
    goalId: string,
  ): Promise<readonly LegacyMapReconciliationUnit[] | null> {
    return this.runtime.repositories.legacyMapReplacement.listOwnedReconciliationUnits(
      userId,
      goalId,
    );
  }

  replaceOwned(
    input: PersistOwnedLegacyMapReplacementInput,
  ): Promise<PersistOwnedLegacyMapReplacementResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.legacyMapReplacement.replaceOwned(input),
    );
  }
}
