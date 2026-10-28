export type UnitMapContextRecord = Readonly<{
  unit: Readonly<{
    id: string;
    goalId: string;
    title: string;
    contentSummary: string;
    parentUnitId: string | null;
  }>;
  goal: Readonly<{ title: string; mapPlanJson: string }>;
  units: readonly Readonly<{
    id: string;
    title: string;
    contentSummary: string;
    parentUnitId: string | null;
    orderIndex: number;
  }>[];
}>;

/** Read projection used to scope unit authoring and subdivision to its map. */
export interface UnitMapContextRepository {
  find(unitId: string): Promise<UnitMapContextRecord | null>;
}
