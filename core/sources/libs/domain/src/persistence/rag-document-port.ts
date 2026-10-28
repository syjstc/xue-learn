export type RagDocumentRecord = Readonly<{
  id: string;
  goalId: string;
  filename: string;
  sourceType: string;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  provider: string | null;
  title: string | null;
  warning: string | null;
  subtitleStatus: string | null;
  storageKey: string | null;
  contentHash: string | null;
  contentType: string | null;
  byteSize: number | null;
}>;

export type CreateRagDocumentInput = Omit<
  RagDocumentRecord,
  "id" | "storageKey" | "contentHash" | "contentType" | "byteSize"
> &
  Partial<
    Pick<
      RagDocumentRecord,
      "storageKey" | "contentHash" | "contentType" | "byteSize"
    >
  >;

export interface RagDocumentRepository {
  findGoalSearchContext(
    goalId: string,
  ): Promise<Readonly<{ userId: string; generationOptions: string }> | null>;
  resolveOwnedScope(
    userId: string,
    subject: Readonly<{ goalId?: string; unitId?: string }>,
  ): Promise<Readonly<{ goalId: string; unitTitle: string }> | null>;
  ownsGoal(userId: string, goalId: string): Promise<boolean>;
  countByGoal(
    goalId: string,
    filter?: Readonly<{ filename?: string; excludeFilename?: string }>,
  ): Promise<number>;
  findById(
    goalId: string,
    documentId: string,
  ): Promise<RagDocumentRecord | null>;
  findByFilename(
    goalId: string,
    filename: string,
  ): Promise<RagDocumentRecord | null>;
  findByCanonicalUrl(
    goalId: string,
    canonicalUrl: string,
  ): Promise<RagDocumentRecord | null>;
  countByStorageKey(storageKey: string): Promise<number>;
  create(input: CreateRagDocumentInput): Promise<RagDocumentRecord>;
  update(
    documentId: string,
    patch: Partial<Omit<RagDocumentRecord, "id" | "goalId">>,
  ): Promise<RagDocumentRecord | null>;
  delete(goalId: string, documentId: string): Promise<boolean>;
  deleteByFilename(goalId: string, filename: string): Promise<number>;
}
