import type {
  ModuleEntryReadinessReadRecord,
  ModuleEntryReadinessReadRepository,
} from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Runtime adapter for learner-owned module entry readiness reads. */
export class MikroOrmModuleEntryReadinessReadRuntimeAdapter implements ModuleEntryReadinessReadRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  findForModule(input: {
    userId: string;
    goalId: string;
    moduleId: string;
  }): Promise<ModuleEntryReadinessReadRecord | null> {
    return this.runtime.repositories.moduleEntryReadinessRead.findForModule(
      input,
    );
  }
}
