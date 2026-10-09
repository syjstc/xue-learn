import type {
  BeginOwnedLearningGoalPlanResult,
  BeginOwnedLearningGoalDetailedPlanRefreshResult,
  LearningGoalDetailedPlanFailureResult,
  LearningGoalPlanApprovalResult,
  LearningGoalPlanContext,
  LearningGoalPlanMutationResult,
  LearningGoalPlanRepository,
  LearningGoalPlanningModeMutationResult,
  PublishOwnedLearningGoalDetailedPlanInput,
  PublishOwnedLearningGoalPlanInput,
  UpdateOwnedLearningGoalPlanInput,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";

/** Transaction-owning runtime adapter for legacy goal-plan writes. */
export class MikroOrmLearningGoalPlanRuntimeAdapter implements LearningGoalPlanRepository {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  findOwnedContext(
    userId: string,
    goalId: string,
  ): Promise<LearningGoalPlanContext | null> {
    return this.runtime.repositories.learningGoalPlan.findOwnedContext(
      userId,
      goalId,
    );
  }

  countOwnedLessons(userId: string, goalId: string): Promise<number | null> {
    return this.runtime.repositories.learningGoalPlan.countOwnedLessons(
      userId,
      goalId,
    );
  }

  listOwnedOverviewBranches(userId: string, goalId: string) {
    return this.runtime.repositories.learningGoalPlan.listOwnedOverviewBranches(
      userId,
      goalId,
    );
  }

  listOwnedModules(userId: string, goalId: string) {
    return this.runtime.repositories.learningGoalPlan.listOwnedModules(
      userId,
      goalId,
    );
  }

  beginOwnedPlan(
    userId: string,
    goalId: string,
    pathSource: string,
  ): Promise<BeginOwnedLearningGoalPlanResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.learningGoalPlan.beginOwnedPlan(userId, goalId, pathSource),
    );
  }

  beginOwnedDetailedPlanRefresh(
    userId: string,
    goalId: string,
  ): Promise<BeginOwnedLearningGoalDetailedPlanRefreshResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.learningGoalPlan.beginOwnedDetailedPlanRefresh(
        userId,
        goalId,
      ),
    );
  }

  publishOwnedDetailedPlan(
    input: PublishOwnedLearningGoalDetailedPlanInput,
  ): Promise<LearningGoalPlanMutationResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.learningGoalPlan.publishOwnedDetailedPlan(input),
    );
  }

  markOwnedDetailedPlanRefreshFailed(
    userId: string,
    goalId: string,
  ): Promise<LearningGoalDetailedPlanFailureResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.learningGoalPlan.markOwnedDetailedPlanRefreshFailed(
        userId,
        goalId,
      ),
    );
  }

  updateOwnedPlan(
    input: UpdateOwnedLearningGoalPlanInput,
  ): Promise<LearningGoalPlanMutationResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.learningGoalPlan.updateOwnedPlan(input),
    );
  }

  publishOwnedPlan(
    input: PublishOwnedLearningGoalPlanInput,
  ): Promise<LearningGoalPlanMutationResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.learningGoalPlan.publishOwnedPlan(input),
    );
  }

  approveOwnedPlan(
    userId: string,
    goalId: string,
  ): Promise<LearningGoalPlanApprovalResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.learningGoalPlan.approveOwnedPlan(userId, goalId),
    );
  }

  updateOwnedPlanningMode(
    userId: string,
    goalId: string,
    planningMode: string,
  ): Promise<LearningGoalPlanningModeMutationResult> {
    return this.runtime.runInTransaction((repositories) =>
      repositories.learningGoalPlan.updateOwnedPlanningMode(
        userId,
        goalId,
        planningMode,
      ),
    );
  }
}
