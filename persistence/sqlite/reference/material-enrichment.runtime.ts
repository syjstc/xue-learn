import type { MaterialEnrichmentRepository } from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

export class MikroOrmMaterialEnrichmentRuntimeAdapter implements MaterialEnrichmentRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  persistIfCurrent(input: Parameters<MaterialEnrichmentRepository["persistIfCurrent"]>[0]) {
    return this.runtime.runInTransaction((repositories) =>
      repositories.materialEnrichment.persistIfCurrent(input),
    );
  }
}
