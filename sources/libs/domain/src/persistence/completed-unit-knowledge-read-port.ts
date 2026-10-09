export type CompletedUnitKnowledgeSnapshot = Readonly<{
  userId: string;
  goalId: string;
  goalTitle: string;
  unitId: string;
  unitTitle: string;
  contentSummary: string;
  material: Readonly<{
    introduction: string;
    sections: string;
    keyTakeaways: string;
  }>;
}>;

/** Owner-scoped source projection for post-completion learned-knowledge indexing. */
export interface CompletedUnitKnowledgeReadRepository {
  findOwnedSnapshot(
    userId: string,
    unitId: string,
  ): Promise<CompletedUnitKnowledgeSnapshot | null>;
}
