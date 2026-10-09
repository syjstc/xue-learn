import type { LearnerStateMemoryInvalidationRepository } from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Runtime adapter for post-commit global learner-state cache invalidation. */
export class MikroOrmLearnerStateMemoryInvalidationRuntimeAdapter implements LearnerStateMemoryInvalidationRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  invalidate(input: {
    userId: string;
    reason: string;
    invalidatedAt?: Date;
  }): Promise<void> {
    return this.runtime.repositories.learnerStateMemoryInvalidation.invalidate(
      input,
    );
  }
}
