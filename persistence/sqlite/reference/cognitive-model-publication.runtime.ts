import type {
  CognitiveModelPublicationRepository,
  CognitiveModelPublicationResult,
  PublishCognitiveModelExpansionInput,
} from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning adapter for the complete successful KACOM publication. */
export class MikroOrmCognitiveModelPublicationRuntimeAdapter implements CognitiveModelPublicationRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  publishMappingOnlyRevision(input: {
    goalId: string;
    reason: string;
  }): Promise<number> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.cognitiveModelPublication.publishMappingOnlyRevision(input),
    );
  }

  ensureSkeleton(input: { goalId: string; inputHash: string }) {
    return this.runtime.runInTransaction((repositories) =>
      repositories.cognitiveModelPublication.ensureSkeleton(input),
    );
  }

  publishExpandedUnit(
    input: PublishCognitiveModelExpansionInput,
  ): Promise<CognitiveModelPublicationResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.cognitiveModelPublication.publishExpandedUnit(input),
    );
  }
}
