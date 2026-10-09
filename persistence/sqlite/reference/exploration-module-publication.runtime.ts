import type {
  ExplorationModulePublicationRepository,
  PublishExplorationModuleInput,
  PublishExplorationModuleResult,
} from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning composition adapter for exploration publication. */
export class MikroOrmExplorationModulePublicationRuntimeAdapter implements ExplorationModulePublicationRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  publish(
    input: PublishExplorationModuleInput,
  ): Promise<PublishExplorationModuleResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.explorationModulePublication.publish(input),
    );
  }
}
