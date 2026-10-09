import type { PrerequisiteBridgeRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

export class MikroOrmPrerequisiteBridgeRuntimeAdapter implements PrerequisiteBridgeRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  sync(input: {
    userId: string;
    goalId: string;
    moduleId: string;
    triggerAttemptId?: string;
  }): Promise<string | null> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.prerequisiteBridge.sync(input),
    );
  }
}
