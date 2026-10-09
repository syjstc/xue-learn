import type {
  LearnerStateMemoryReadRecord,
  LearnerStateMemoryReadRepository,
} from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Runtime adapter for global learner-state memory reads. */
export class MikroOrmLearnerStateMemoryReadRuntimeAdapter implements LearnerStateMemoryReadRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  findByUser(input: {
    userId: string;
  }): Promise<LearnerStateMemoryReadRecord | null> {
    return this.runtime.repositories.learnerStateMemoryRead.findByUser(input);
  }
}
