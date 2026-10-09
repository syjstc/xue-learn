import { randomUUID } from "node:crypto";
import type {
  DeleteOwnedLearningGoalScopeInput,
  EventOutboxRepository,
  LearningGoalMutationPort,
  LearningGoalRepository,
  LearningUnitRepository,
  ScopedMemoryPort,
  UpdateOwnedLearningGoalSemanticInput,
} from "@xue-learn/core/domain";
import { COGNITIVE_MODEL_SKELETON_EVENT } from "@xue-learn/core/server/cognitive-model/event-types";
import { computeCognitiveModelInputHash } from "@xue-learn/core/server/cognitive-model/pure";

export type LearningGoalMutationRepositories = Readonly<{
  learningGoal: LearningGoalRepository;
  learningUnit: LearningUnitRepository;
  scopedMemory: ScopedMemoryPort;
  eventOutbox: EventOutboxRepository;
}>;

/**
 * Transaction-neutral application service for the semantic goal trigger.
 * The caller supplies repositories bound to its unit of work; this service
 * deliberately never opens, commits, or rolls back a transaction.
 */
export class LearningGoalMutationService implements LearningGoalMutationPort {
  constructor(
    private readonly repositories: LearningGoalMutationRepositories,
  ) {}

  async updateOwnedSemantic(input: UpdateOwnedLearningGoalSemanticInput) {
    const { learningGoal, learningUnit, eventOutbox } = this.repositories;
    const current = await learningGoal.findOwnedById(
      input.userId,
      input.goalId,
    );
    if (!current) return null;

    const units = (await learningUnit.listForCurriculum(input.goalId)).filter(
      (unit) => unit.unitKind !== "overview",
    );
    const nextGoal = { ...current, ...input.patch };
    const inputHash = computeCognitiveModelInputHash(nextGoal, units);
    const changed = inputHash !== current.cognitiveModelInputHash;

    if (changed) {
      await learningUnit.invalidateCognitiveModel({
        goalId: input.goalId,
        nextInputHash: inputHash,
        preserveExpanded: current.curriculumVersion === 2,
      });
    }

    const updated = await learningGoal.updateOwned(
      input.userId,
      input.goalId,
      changed
        ? {
            ...input.patch,
            cognitiveModelEnabled: true,
            cognitiveModelInputHash: inputHash,
            cognitiveModelStatus:
              current.curriculumVersion === 2 &&
              current.cognitiveModelVersion > 0
                ? "building"
                : current.cognitiveModelVersion > 0
                  ? "needs_reconciliation"
                  : "pending",
          }
        : input.patch,
    );
    if (!updated || !changed) return updated;

    await eventOutbox.append({
      id: randomUUID(),
      type: COGNITIVE_MODEL_SKELETON_EVENT,
      payload: JSON.stringify({
        goalId: input.goalId,
        inputHash,
        baseModelVersion: current.cognitiveModelVersion,
        reason: "curriculum_changed",
      }),
    });
    return updated;
  }

  async deleteOwnedGoalScope(
    input: DeleteOwnedLearningGoalScopeInput,
  ): Promise<boolean> {
    const { learningGoal, scopedMemory } = this.repositories;
    const ownedGoal = await learningGoal.findOwnedById(
      input.userId,
      input.goalId,
    );
    if (!ownedGoal) return false;

    await scopedMemory.deleteOwnedGoalScope(input);
    return learningGoal.deleteOwned(input.userId, input.goalId);
  }
}
