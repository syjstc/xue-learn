import type { PlannedGoalBrief } from "../planned-goal-brief.js";

export type LearningSpaceItemSource = string;
export type LearningSpaceItemGoalKind = "full" | "micro";

type LearningSpaceItemRecordBase = Readonly<{
  id: string;
  spaceId: string;
  plannedTitle: string;
  rationale: string;
  suggestedGoalKind: LearningSpaceItemGoalKind;
  goalBrief?: PlannedGoalBrief | null;
  source: LearningSpaceItemSource;
  sortIndex: number;
  createdAt: Date;
  updatedAt: Date;
}>;

/** A roadmap membership for an existing real learning goal. */
export type LearningSpaceGoalItemRecord = LearningSpaceItemRecordBase &
  Readonly<{
    itemType: "goal";
    goalId: string;
  }>;

/** A roadmap placeholder that has not been activated into a learning goal. */
export type LearningSpacePlannedGoalItemRecord = LearningSpaceItemRecordBase &
  Readonly<{
    itemType: "planned_goal";
    goalId: null;
  }>;

/** The database-enforced goal/planned-goal sum shape. */
export type LearningSpaceItemRecord =
  LearningSpaceGoalItemRecord | LearningSpacePlannedGoalItemRecord;

export type CreateLearningSpaceGoalItemInput = Readonly<{
  userId: string;
  id: string;
  spaceId: string;
  goalId: string;
  source?: LearningSpaceItemSource;
  sortIndex?: number;
}>;

export type CreateLearningSpacePlannedGoalItemInput = Readonly<{
  userId: string;
  id: string;
  spaceId: string;
  plannedTitle: string;
  rationale?: string;
  suggestedGoalKind?: LearningSpaceItemGoalKind;
  goalBrief?: PlannedGoalBrief | null;
  source?: LearningSpaceItemSource;
  sortIndex?: number;
}>;

export type UpdateLearningSpacePlannedGoalItemInput = Readonly<
  Partial<
    Pick<
      LearningSpacePlannedGoalItemRecord,
      "plannedTitle" | "rationale" | "suggestedGoalKind" | "goalBrief"
    >
  >
>;

/** Capability-specific persistence for ordered roadmap memberships. */
export interface LearningSpaceItemRepository {
  listBySpaceId(
    userId: string,
    spaceId: string,
  ): Promise<readonly LearningSpaceItemRecord[]>;
  findById(
    userId: string,
    itemId: string,
  ): Promise<LearningSpaceItemRecord | null>;
  findByGoalId(
    userId: string,
    goalId: string,
  ): Promise<LearningSpaceGoalItemRecord | null>;
  createGoalItem(
    input: CreateLearningSpaceGoalItemInput,
  ): Promise<LearningSpaceGoalItemRecord | null>;
  createPlannedGoalItem(
    input: CreateLearningSpacePlannedGoalItemInput,
  ): Promise<LearningSpacePlannedGoalItemRecord | null>;
  updatePlannedGoalItem(
    userId: string,
    itemId: string,
    patch: UpdateLearningSpacePlannedGoalItemInput,
  ): Promise<LearningSpacePlannedGoalItemRecord | null>;
  activatePlannedGoalItem(
    userId: string,
    itemId: string,
    goalId: string,
    source?: LearningSpaceItemSource,
  ): Promise<LearningSpaceGoalItemRecord | null>;
  delete(userId: string, itemId: string): Promise<boolean>;
  reorder(
    userId: string,
    spaceId: string,
    orderedItemIds: readonly string[],
  ): Promise<boolean>;
}
