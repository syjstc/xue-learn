import type {
  LearnerStateProjectionReadRecord,
  LearnerStateProjectionReadRepository,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Runtime adapter for learner-state projection reads. */
export class MikroOrmLearnerStateProjectionReadRuntimeAdapter implements LearnerStateProjectionReadRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  listPromptStates(
    input: Parameters<LearnerStateProjectionReadRepository["listPromptStates"]>[0],
  ) {
    return this.runtime.repositories.learnerStateProjectionRead.listPromptStates(
      input,
    );
  }

  findMany(input: {
    userId: string;
    cognitiveEntityIds: readonly string[];
    asOf: Date;
  }): Promise<readonly LearnerStateProjectionReadRecord[] | null> {
    return this.runtime.repositories.learnerStateProjectionRead.findMany(input);
  }
}
