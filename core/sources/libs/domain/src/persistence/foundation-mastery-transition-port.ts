export type FoundationMasteryTransitionConflict =
  | "not_found"
  | "not_full_goal"
  | "not_exploration"
  | "curriculum_not_ready"
  | "share_active"
  | "transition_conflict";

export class FoundationMasteryTransitionPersistenceError extends Error {
  constructor(
    message: string,
    readonly code: FoundationMasteryTransitionConflict,
  ) {
    super(message);
    this.name = "FoundationMasteryTransitionPersistenceError";
  }
}

export type BeginOwnedFoundationMasteryTransitionInput = Readonly<{
  userId: string;
  goalId: string;
}>;

export type BeginOwnedFoundationMasteryTransitionResult = Readonly<{
  goalId: string;
  learningMode: "exploration";
  transitionStatus: "queued" | "building";
  transitionError: string;
  token: string;
  curriculumKeys: readonly string[];
  started: boolean;
}>;

export type FailFoundationMasteryTransitionInput = Readonly<{
  goalId: string;
  token: string;
  message: string;
}>;

export type MarkBuildingFoundationMasteryTransitionInput = Readonly<{
  goalId: string;
  token: string;
}>;

export type FinalizeOwnedFoundationMasteryTransitionInput = Readonly<{
  userId: string;
  goalId: string;
  token: string;
  inputHash: string;
}>;

/** Durable fencing/readiness boundary for exploration → mastery preparation. */
export interface FoundationMasteryTransitionRepository {
  detachKacom(goalId: string): Promise<Readonly<{
    userId: string | null;
    cognitiveModelVersion: number;
    alreadyDetached: boolean;
  }>>;
  markCurrentFailed(goalId: string, message: string): Promise<void>;
  beginOwned(
    input: BeginOwnedFoundationMasteryTransitionInput,
  ): Promise<BeginOwnedFoundationMasteryTransitionResult>;
  markBuilding(
    input: MarkBuildingFoundationMasteryTransitionInput,
  ): Promise<boolean>;
  markFailed(input: FailFoundationMasteryTransitionInput): Promise<boolean>;
  finalizeOwned(
    input: FinalizeOwnedFoundationMasteryTransitionInput,
  ): Promise<boolean>;
}
