import type {
  SectionMaterialReplacementInput,
  SectionMaterialReplacementRepository,
  MaterialReplacementResult,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for section material replacement. */
export class MikroOrmSectionMaterialReplacementRuntimeAdapter implements SectionMaterialReplacementRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  replaceSection(
    input: SectionMaterialReplacementInput,
  ): Promise<MaterialReplacementResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.sectionMaterialReplacement.replaceSection(input),
    );
  }
}
