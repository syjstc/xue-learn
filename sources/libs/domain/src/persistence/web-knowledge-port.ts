export type WebKnowledgeSourceRecord = { id: string; userId: string; goalId: string; canonicalUrl: string; originalUrl: string; title: string; publisher: string | null; provider: string; status: string; createdAt: Date; updatedAt: Date };
export type WebKnowledgeRevisionRecord = { id: string; sourceId: string; content: string; contentHash: string; publishedAt: Date | null; retrievedAt: Date; freshUntil: Date; freshnessClass: string; searchQuery: string };
export type WebKnowledgeSourceProjection = WebKnowledgeSourceRecord & { revisions: WebKnowledgeRevisionRecord[]; targets: Array<{ learningTarget: { id: string; title: string } }> };
export interface WebKnowledgeRepository {
  goalIsOwned(userId: string, goalId: string): Promise<boolean>;
  validTargetIds(goalId: string, targetIds: string[]): Promise<string[]>;
  saveSourceRevision(input: Readonly<{ userId: string; goalId: string; canonicalUrl: string; originalUrl: string; title: string; publisher: string | null; provider: string; content: string; contentHash: string; retrievedAt: Date; freshUntil: Date; freshnessClass: string; searchQuery: string; targetIds: string[] }>): Promise<{ source: WebKnowledgeSourceRecord; revision: WebKnowledgeRevisionRecord; revisionCreated: boolean }>;
  listSources(input: Readonly<{ userId: string; goalId?: string; targetIds?: string[]; limit: number }>): Promise<WebKnowledgeSourceProjection[]>;
  findOwnedSource(userId: string, goalId: string, sourceId: string): Promise<WebKnowledgeSourceRecord | null>;
  deleteSourceWithCleanup(userId: string, sourceId: string, cleanupPayload: string): Promise<void>;
  markSourceError(sourceId: string): Promise<void>;
  bindSourcesToUnitTargets(goalId: string, unitId: string, sourceIds: string[]): Promise<void>;
}
