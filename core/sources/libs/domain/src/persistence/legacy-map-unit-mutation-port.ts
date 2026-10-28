export type LegacyMapUnitRecord = Readonly<{
  id: string;
  moduleId: string | null;
  title: string;
  status: string;
  unitKind: string;
  parentUnitId: string | null;
  orderIndex: number;
  prerequisites: string;
  contentSummary: string;
  note: string;
  mapOrigin: string;
  mapEdited: boolean;
  linkedGoalId: string | null;
  completionMethod: string | null;
  completionAttemptId: string | null;
  completedAt: Date | null;
}>;

export type LegacyMapUnitMutationFailureStatus =
  | "goal_not_found"
  | "goal_forbidden"
  | "immutable_goal"
  | "unit_not_found"
  | "parent_not_found"
  | "overview_readonly"
  | "invalid_edit"
  | "title_required";

export type LegacyMapUnitMutationFailure = Readonly<{
  status: LegacyMapUnitMutationFailureStatus;
}>;

export type CreateOwnedLegacyMapUnitInput = Readonly<{
  userId: string;
  goalId: string;
  parentUnitId: string | null;
  unitKind: string;
  title: string;
  contentSummary: string;
  note: string;
  mapOrigin: string;
}>;

export type UpdateOwnedLegacyMapUnitInput = Readonly<{
  userId: string;
  goalId: string;
  unitId: string;
  title?: string;
  contentSummary?: string;
  note?: string;
  parentUnitId?: string | null;
  orderIndex?: number;
}>;

export type ReorderOwnedLegacyMapUnitsInput = Readonly<{
  userId: string;
  goalId: string;
  parentUnitId: string | null;
  orderedUnitIds: readonly string[];
}>;

export type DeleteOwnedLegacyMapUnitInput = Readonly<{
  userId: string;
  goalId: string;
  unitId: string;
}>;

export type RefineOwnedLegacyMapUnitsInput = Readonly<{
  userId: string;
  goalId: string;
  updates: readonly Readonly<{
    unitId: string;
    title: string;
    contentSummary: string;
    orderIndex: number;
  }>[];
}>;

export type CreateOwnedLegacyMapUnitResult =
  | LegacyMapUnitMutationFailure
  | Readonly<{ status: "created"; unit: LegacyMapUnitRecord }>;

export type UpdateOwnedLegacyMapUnitResult =
  | LegacyMapUnitMutationFailure
  | Readonly<{ status: "updated"; unit: LegacyMapUnitRecord }>;

export type ReorderOwnedLegacyMapUnitsResult =
  | LegacyMapUnitMutationFailure
  | Readonly<{
      status: "reordered";
      units: readonly LegacyMapUnitRecord[];
    }>;

export type DeleteOwnedLegacyMapUnitResult =
  LegacyMapUnitMutationFailure | Readonly<{ status: "deleted" }>;

export type RefineOwnedLegacyMapUnitsResult =
  | LegacyMapUnitMutationFailure
  | Readonly<{
      status: "refined";
      units: readonly LegacyMapUnitRecord[];
    }>;

/** Owner-scoped persistence for editable legacy goal-map unit mutations. */
export interface LegacyMapUnitMutationRepository {
  createOwnedEditableUnit(
    input: CreateOwnedLegacyMapUnitInput,
  ): Promise<CreateOwnedLegacyMapUnitResult>;
  updateOwnedEditableUnit(
    input: UpdateOwnedLegacyMapUnitInput,
  ): Promise<UpdateOwnedLegacyMapUnitResult>;
  reorderOwnedEditableUnits(
    input: ReorderOwnedLegacyMapUnitsInput,
  ): Promise<ReorderOwnedLegacyMapUnitsResult>;
  deleteOwnedEditableUnit(
    input: DeleteOwnedLegacyMapUnitInput,
  ): Promise<DeleteOwnedLegacyMapUnitResult>;
  refineOwnedEditableUnits(
    input: RefineOwnedLegacyMapUnitsInput,
  ): Promise<RefineOwnedLegacyMapUnitsResult>;
}
