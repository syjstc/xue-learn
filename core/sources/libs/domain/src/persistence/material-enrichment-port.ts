export interface MaterialEnrichmentRepository {
  persistIfCurrent(input: {
    userId: string;
    unitId: string;
    expectedContentRevision: number;
    sections: string;
    sourceItemsJson: string;
  }): Promise<{ applied: boolean; contentRevision: number }>;
}
