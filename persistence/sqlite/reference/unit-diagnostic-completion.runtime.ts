import type {
  CompleteUnitDiagnosticInput,
  UnitDiagnosticCompletionRepository,
  UnitDiagnosticCompletionResult,
} from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for unit diagnostic submission. */
export class MikroOrmUnitDiagnosticCompletionRuntimeAdapter implements UnitDiagnosticCompletionRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  complete(
    input: CompleteUnitDiagnosticInput,
  ): Promise<UnitDiagnosticCompletionResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.unitDiagnosticCompletion.complete(input),
    );
  }
}
