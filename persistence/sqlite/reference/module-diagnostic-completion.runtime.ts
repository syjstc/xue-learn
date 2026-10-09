import type {
  CompleteModuleDiagnosticInput,
  ModuleDiagnosticCompletionRepository,
  ModuleDiagnosticCompletionResult,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for module diagnostic submission. */
export class MikroOrmModuleDiagnosticCompletionRuntimeAdapter implements ModuleDiagnosticCompletionRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  publishMainTask(input: Parameters<ModuleDiagnosticCompletionRepository["publishMainTask"]>[0]) {
    return this.runtime.runInTransaction((repositories) =>
      repositories.moduleDiagnosticCompletion.publishMainTask(input),
    );
  }

  complete(
    input: CompleteModuleDiagnosticInput,
  ): Promise<ModuleDiagnosticCompletionResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.moduleDiagnosticCompletion.complete(input),
    );
  }
}
