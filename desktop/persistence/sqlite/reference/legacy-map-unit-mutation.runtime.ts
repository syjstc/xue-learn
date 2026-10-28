import type {
  CreateOwnedLegacyMapUnitInput,
  CreateOwnedLegacyMapUnitResult,
  DeleteOwnedLegacyMapUnitInput,
  DeleteOwnedLegacyMapUnitResult,
  LegacyMapUnitMutationRepository,
  ReorderOwnedLegacyMapUnitsInput,
  ReorderOwnedLegacyMapUnitsResult,
  RefineOwnedLegacyMapUnitsInput,
  RefineOwnedLegacyMapUnitsResult,
  UpdateOwnedLegacyMapUnitInput,
  UpdateOwnedLegacyMapUnitResult,
} from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for hosted legacy map-unit mutations. */
export class MikroOrmLegacyMapUnitMutationRuntimeAdapter implements LegacyMapUnitMutationRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  createOwnedEditableUnit(
    input: CreateOwnedLegacyMapUnitInput,
  ): Promise<CreateOwnedLegacyMapUnitResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.legacyMapUnitMutation.createOwnedEditableUnit(input),
    );
  }

  updateOwnedEditableUnit(
    input: UpdateOwnedLegacyMapUnitInput,
  ): Promise<UpdateOwnedLegacyMapUnitResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.legacyMapUnitMutation.updateOwnedEditableUnit(input),
    );
  }

  reorderOwnedEditableUnits(
    input: ReorderOwnedLegacyMapUnitsInput,
  ): Promise<ReorderOwnedLegacyMapUnitsResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.legacyMapUnitMutation.reorderOwnedEditableUnits(input),
    );
  }

  deleteOwnedEditableUnit(
    input: DeleteOwnedLegacyMapUnitInput,
  ): Promise<DeleteOwnedLegacyMapUnitResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.legacyMapUnitMutation.deleteOwnedEditableUnit(input),
    );
  }

  refineOwnedEditableUnits(
    input: RefineOwnedLegacyMapUnitsInput,
  ): Promise<RefineOwnedLegacyMapUnitsResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.legacyMapUnitMutation.refineOwnedEditableUnits(input),
    );
  }
}
