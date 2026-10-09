import type {
  BeginOwnedOverviewCourseResult,
  CompleteOwnedOverviewUnitInput,
  CompleteOwnedOverviewUnitResult,
  EnsureOwnedOverviewCourseShellInput,
  EnsureOwnedOverviewCourseShellResult,
  OverviewCoursePublicationRepository,
  PublishOwnedOverviewCourseInput,
  PublishOwnedOverviewCourseResult,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for overview-course publication. */
export class MikroOrmOverviewCoursePublicationRuntimeAdapter implements OverviewCoursePublicationRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  beginOwnedOverviewCourse(
    userId: string,
    goalId: string,
  ): Promise<BeginOwnedOverviewCourseResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.overviewCoursePublication.beginOwnedOverviewCourse(
        userId,
        goalId,
      ),
    );
  }

  ensureOwnedOverviewCourseShell(
    input: EnsureOwnedOverviewCourseShellInput,
  ): Promise<EnsureOwnedOverviewCourseShellResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.overviewCoursePublication.ensureOwnedOverviewCourseShell(
        input,
      ),
    );
  }

  publishOwnedOverviewCourse(
    input: PublishOwnedOverviewCourseInput,
  ): Promise<PublishOwnedOverviewCourseResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.overviewCoursePublication.publishOwnedOverviewCourse(input),
    );
  }

  completeOwnedOverviewUnit(
    input: CompleteOwnedOverviewUnitInput,
  ): Promise<CompleteOwnedOverviewUnitResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.overviewCoursePublication.completeOwnedOverviewUnit(input),
    );
  }

  updateOwnedOverviewMaterial(
    input: Parameters<
      OverviewCoursePublicationRepository["updateOwnedOverviewMaterial"]
    >[0],
  ) {
    return this.runtime.runInTransaction((repositories) =>
      repositories.overviewCoursePublication.updateOwnedOverviewMaterial(input),
    );
  }
}
