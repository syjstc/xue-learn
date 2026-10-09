import type { UnitStructuredCleanupRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

export class MikroOrmUnitStructuredCleanupRuntimeAdapter implements UnitStructuredCleanupRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  clear(input: Parameters<UnitStructuredCleanupRepository["clear"]>[0]) {
    return this.runtime.runInTransaction((repositories) =>
      repositories.unitStructuredCleanup.clear(input),
    );
  }
}
