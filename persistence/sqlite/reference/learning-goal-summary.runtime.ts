import type {
  BeginOwnedLearningGoalSummaryResult,
  LearningGoalSummaryApprovalResult,
  LearningGoalSummaryContext,
  LearningGoalSummaryMutationResult,
  LearningGoalSummaryRepository,
  PublishOwnedLearningGoalSummaryInput,
  UpdateOwnedLearningGoalSummaryInput,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for legacy goal-summary writes. */
export class MikroOrmLearningGoalSummaryRuntimeAdapter implements LearningGoalSummaryRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  findOwnedContext(
    userId: string,
    goalId: string,
  ): Promise<LearningGoalSummaryContext | null> {
    return this.runtime.repositories.learningGoalSummary.findOwnedContext(
      userId,
      goalId,
    );
  }

  beginOwnedSummary(
    userId: string,
    goalId: string,
    pathSource: string,
  ): Promise<BeginOwnedLearningGoalSummaryResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.learningGoalSummary.beginOwnedSummary(
        userId,
        goalId,
        pathSource,
      ),
    );
  }

  updateOwnedSummary(
    input: UpdateOwnedLearningGoalSummaryInput,
  ): Promise<LearningGoalSummaryMutationResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.learningGoalSummary.updateOwnedSummary(input),
    );
  }

  publishOwnedSummary(
    input: PublishOwnedLearningGoalSummaryInput,
  ): Promise<LearningGoalSummaryMutationResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.learningGoalSummary.publishOwnedSummary(input),
    );
  }

  approveOwnedSummary(
    userId: string,
    goalId: string,
  ): Promise<LearningGoalSummaryApprovalResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.learningGoalSummary.approveOwnedSummary(userId, goalId),
    );
  }
}
