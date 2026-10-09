import type {
  DeleteOwnedLearningGoalScopeInput,
  DeleteOwnedLearningGoalScopeResult,
  LearningGoalMutationPort,
  UpdateOwnedLearningGoalSemanticInput,
  UpdateOwnedLearningGoalSemanticResult,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { ReferencePersistenceRuntime } from "./runtime.ts";
import { LearningGoalMutationService } from "./learning-goal-mutation.service.ts";

/**
 * Transaction-owning adapter for the semantic goal mutation port.
 *
 * The operation service itself only sees repositories. This wrapper keeps the
 * MikroORM transaction callback at the infrastructure composition boundary so
 * goal, curriculum, memory, and outbox writes share one unit of work.
 */
export class MikroOrmLearningGoalMutationRuntimeAdapter implements LearningGoalMutationPort {
  constructor(private readonly runtime: ReferencePersistenceRuntime) {}

  updateOwnedSemantic(
    input: UpdateOwnedLearningGoalSemanticInput,
  ): Promise<UpdateOwnedLearningGoalSemanticResult> {
    return this.runtime.runInTransaction((repositories) =>
      new LearningGoalMutationService({
        learningGoal: repositories.learningGoal,
        learningUnit: repositories.learningUnit,
        scopedMemory: repositories.scopedMemory,
        eventOutbox: repositories.eventOutbox,
      }).updateOwnedSemantic(input),
    );
  }

  deleteOwnedGoalScope(
    input: DeleteOwnedLearningGoalScopeInput,
  ): Promise<DeleteOwnedLearningGoalScopeResult> {
    return this.runtime.runInTransaction((repositories) =>
      new LearningGoalMutationService({
        learningGoal: repositories.learningGoal,
        learningUnit: repositories.learningUnit,
        scopedMemory: repositories.scopedMemory,
        eventOutbox: repositories.eventOutbox,
      }).deleteOwnedGoalScope(input),
    );
  }
}
