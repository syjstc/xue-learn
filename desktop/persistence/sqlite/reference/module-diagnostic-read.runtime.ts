import type {
  ModuleDiagnosticReadRepository,
  ModuleDiagnosticReadRecord,
  ModuleDiagnosticSubmissionRecord,
} from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Runtime adapter for learner-owned module diagnostic reads. */
export class MikroOrmModuleDiagnosticReadRuntimeAdapter implements ModuleDiagnosticReadRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  findModule(input: {
    userId: string;
    goalId: string;
    moduleId: string;
  }): Promise<ModuleDiagnosticReadRecord | null> {
    return this.runtime.repositories.moduleDiagnosticRead.findModule(input);
  }

  findSubmission(input: {
    userId: string;
    goalId: string;
    moduleId: string;
    attemptId: string;
  }): Promise<ModuleDiagnosticSubmissionRecord | null> {
    return this.runtime.repositories.moduleDiagnosticRead.findSubmission(input);
  }
}
