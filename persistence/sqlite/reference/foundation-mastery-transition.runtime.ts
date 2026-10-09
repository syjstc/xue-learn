import type {
  BeginOwnedFoundationMasteryTransitionInput,
  BeginOwnedFoundationMasteryTransitionResult,
  FailFoundationMasteryTransitionInput,
  MarkBuildingFoundationMasteryTransitionInput,
  FoundationMasteryTransitionRepository,
  FinalizeOwnedFoundationMasteryTransitionInput,
} from "@xue-learn/core/domain";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning composition adapter for transition preparation. */
export class MikroOrmFoundationMasteryTransitionRuntimeAdapter implements FoundationMasteryTransitionRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  detachKacom(goalId: string) {
    return this.runtime.runInTransaction((repositories) =>
      repositories.foundationMasteryTransition.detachKacom(goalId),
    );
  }

  markCurrentFailed(goalId: string, message: string) {
    return this.runtime.runInTransaction((repositories) =>
      repositories.foundationMasteryTransition.markCurrentFailed(goalId, message),
    );
  }

  beginOwned(
    input: BeginOwnedFoundationMasteryTransitionInput,
  ): Promise<BeginOwnedFoundationMasteryTransitionResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.foundationMasteryTransition.beginOwned(input),
    );
  }

  markBuilding(
    input: MarkBuildingFoundationMasteryTransitionInput,
  ): Promise<boolean> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.foundationMasteryTransition.markBuilding(input),
    );
  }

  markFailed(input: FailFoundationMasteryTransitionInput): Promise<boolean> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.foundationMasteryTransition.markFailed(input),
    );
  }

  finalizeOwned(
    input: FinalizeOwnedFoundationMasteryTransitionInput,
  ): Promise<boolean> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.foundationMasteryTransition.finalizeOwned(input),
    );
  }
}
