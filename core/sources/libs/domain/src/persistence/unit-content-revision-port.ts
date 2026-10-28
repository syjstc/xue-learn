export interface UnitContentRevisionRepository {
  bump(unitId: string): Promise<number>;
  commitSqPreview(input: {
    unitId: string;
    expectedContentRevision: number;
    sq3rData: string;
  }): Promise<
    | Readonly<{ status: "committed"; contentRevision: number }>
    | Readonly<{ status: "stale"; currentContentRevision?: number }>
  >;
}
