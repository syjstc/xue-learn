import type { LearningGoalRecord } from "./learning-goal-port.js";

type AtLeastOne<T extends object> = Partial<T> &
  {
    [Key in keyof T]-?: Pick<T, Key>;
  }[keyof T];

/** Fields whose update invalidates the goal's cognitive-model lifecycle. */
export type LearningGoalSemanticPatch = Readonly<
  AtLeastOne<
    Pick<
      LearningGoalRecord,
      | "title"
      | "level"
      | "domainTag"
      | "topicCategory"
      | "contentLanguage"
      | "pathSource"
      | "generationOptions"
    >
  >
>;

export type UpdateOwnedLearningGoalSemanticInput = Readonly<{
  userId: string;
  goalId: string;
  patch: LearningGoalSemanticPatch;
}>;

export type DeleteOwnedLearningGoalScopeInput = Readonly<{
  userId: string;
  goalId: string;
}>;

export type UpdateOwnedLearningGoalSemanticResult = LearningGoalRecord | null;
export type DeleteOwnedLearningGoalScopeResult = boolean;

/**
 * Effectful goal mutations whose adapters must preserve the goal trigger
 * contract: semantic updates invalidate dependent cognitive-model state, and
 * scope deletion includes goal-scoped cleanup in the same owned operation.
 *
 * The dependent cleanup is deliberately represented by the operation rather
 * than by a memory or retrieval implementation at this boundary.
 */
export interface LearningGoalMutationPort {
  updateOwnedSemantic(
    input: UpdateOwnedLearningGoalSemanticInput,
  ): Promise<UpdateOwnedLearningGoalSemanticResult>;
  deleteOwnedGoalScope(
    input: DeleteOwnedLearningGoalScopeInput,
  ): Promise<DeleteOwnedLearningGoalScopeResult>;
}
