import type {
  BeginOwnedMicroGoalConversionInput,
  BeginOwnedMicroGoalConversionResult,
  MicroUnitPublicationRepository,
  OwnedMicroGoalConversionContext,
  PublishOwnedMicroUnitInput,
  PublishOwnedMicroUnitResult,
  RestoreOwnedMicroGoalInput,
  RestoreOwnedMicroGoalResult,
  UpgradeOwnedOverviewToLessonInput,
  UpgradeOwnedOverviewToLessonResult,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { OwnedMicroUnitCreationContext } from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for micro-unit publication transitions. */
export class MikroOrmMicroUnitPublicationRuntimeAdapter implements MicroUnitPublicationRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  findOwnedConversionContext(
    userId: string,
    goalId: string,
  ): Promise<OwnedMicroGoalConversionContext | null> {
    return this.runtime.repositories.microUnitPublication.findOwnedConversionContext(
      userId,
      goalId,
    );
  }

  publishOwnedMicroUnit(
    input: PublishOwnedMicroUnitInput,
  ): Promise<PublishOwnedMicroUnitResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.microUnitPublication.publishOwnedMicroUnit(input),
    );
  }

  upgradeOwnedOverviewToLesson(
    input: UpgradeOwnedOverviewToLessonInput,
  ): Promise<UpgradeOwnedOverviewToLessonResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.microUnitPublication.upgradeOwnedOverviewToLesson(input),
    );
  }

  beginOwnedMicroGoalConversion(
    input: BeginOwnedMicroGoalConversionInput,
  ): Promise<BeginOwnedMicroGoalConversionResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.microUnitPublication.beginOwnedMicroGoalConversion(input),
    );
  }

  restoreOwnedMicroGoal(
    input: RestoreOwnedMicroGoalInput,
  ): Promise<RestoreOwnedMicroGoalResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.microUnitPublication.restoreOwnedMicroGoal(input),
    );
  }

  findOwnedCreationContext(userId: string, goalId: string): Promise<OwnedMicroUnitCreationContext | null> {
    return this.runtime.repositories.microUnitPublication.findOwnedCreationContext(userId, goalId);
  }
}
