import type {
  MaterialReplacementInput,
  MaterialReplacementRepository,
  MaterialReplacementResult,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for full-unit material replacement. */
export class MikroOrmMaterialReplacementRuntimeAdapter implements MaterialReplacementRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  replace(input: MaterialReplacementInput): Promise<MaterialReplacementResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.materialReplacement.replace(input),
    );
  }
}
