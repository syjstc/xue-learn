import type {
  PreparedModulePublicationRepository,
  PublishPreparedModuleInput,
  PublishPreparedModuleResult,
} from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning composition adapter for prepared module publication. */
export class MikroOrmPreparedModulePublicationRuntimeAdapter implements PreparedModulePublicationRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  publish(
    input: PublishPreparedModuleInput,
  ): Promise<PublishPreparedModuleResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.preparedModulePublication.publish(input),
    );
  }

  publishMastery(
    input: Parameters<PreparedModulePublicationRepository["publishMastery"]>[0],
  ) {
    return this.runtime.runInTransaction((repositories) =>
      repositories.preparedModulePublication.publishMastery(input),
    );
  }
}
