export interface UnitStructuredCleanupRepository {
  clear(input: {
    userId: string;
    unitId: string;
    from: "sq" | "material";
  }): Promise<void>;
}
