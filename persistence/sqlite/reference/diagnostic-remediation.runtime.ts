import type {
  DiagnosticRemediationRepository,
  ResolveDiagnosticRemediationInput,
  UpsertDiagnosticRemediationInput,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for diagnostic remediation. */
export class MikroOrmDiagnosticRemediationRuntimeAdapter implements DiagnosticRemediationRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  upsert(input: UpsertDiagnosticRemediationInput): Promise<string | null> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.diagnosticRemediation.upsert(input),
    );
  }

  resolve(input: ResolveDiagnosticRemediationInput): Promise<void> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.diagnosticRemediation.resolve(input),
    );
  }
}
