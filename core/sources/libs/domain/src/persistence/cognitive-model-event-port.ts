export type EnqueueCognitiveModelExpansionInput = Readonly<{
  goalId: string;
}>;

export type EnqueueCognitiveModelExpansionResult = Readonly<{
  eventId: string;
}>;

export type RecoverFailedCognitiveModelUnitInput = Readonly<{
  goalId: string;
  unitId: string;
}>;

export type RecoverFailedCognitiveModelUnitResult =
  | Readonly<{
      triggered: false;
      goalStatus: null;
      eventId: null;
    }>
  | Readonly<{
      triggered: true;
      goalStatus: "building" | "needs_reconciliation";
      eventId: string;
    }>;

export type CognitiveModelEventGoalState = Readonly<{
  goalKind: string;
  learningMode: string;
  learningModeTransitionStatus: string;
  learningModeTransitionToken: string | null;
  userId: string | null;
  cognitiveModelInputHash: string;
  cognitiveModelPublishedHash: string | null;
  cognitiveModelVersion: number;
  cognitiveModelStatus: string;
  nextExpandableUnitId: string | null;
  transitionReady: boolean;
}>;

/** Owns the atomic event/state fences used by cognitive-model readiness paths. */
export interface CognitiveModelEventRepository {
  inspectGoal(goalId: string): Promise<CognitiveModelEventGoalState | null>;
  enqueueNext(
    input: EnqueueCognitiveModelExpansionInput,
  ): Promise<EnqueueCognitiveModelExpansionResult | null>;
  recoverFailedUnit(
    input: RecoverFailedCognitiveModelUnitInput,
  ): Promise<RecoverFailedCognitiveModelUnitResult>;
}
