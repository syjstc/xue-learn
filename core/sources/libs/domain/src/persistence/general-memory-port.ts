export type GeneralMemoryEvidenceRecord = Readonly<{
  id: string;
  sourceType: string;
  excerpt: string;
  occurredAt: Date;
}>;

export type GeneralMemoryRecord = Readonly<{
  id: string;
  userId: string;
  productId: string;
  domain: string;
  scopeType: string;
  scopeId: string | null;
  kind: string;
  stableKey: string;
  contentJson: Record<string, unknown>;
  searchText: string;
  authority: string;
  status: string;
  confidence: number;
  importance: number;
  validFrom: Date;
  validUntil: Date | null;
  lastConfirmedAt: Date | null;
  expiresAt: Date | null;
  currentRevision: number;
  updatedAt: Date;
  createdAt: Date;
  evidence: readonly GeneralMemoryEvidenceRecord[];
}>;

export type GeneralMemoryScopeInput = Readonly<{
  userId: string;
  productId: string;
  domain: string;
  scopeType: string;
  scopeId: string | null;
  kind: string;
  stableKey: string;
}>;

export type GeneralMemoryCreateInput = GeneralMemoryScopeInput &
  Readonly<{
    summary: string;
    authority: string;
    confidence: number;
    importance: number;
    actorType: string;
    actorRef: string | null;
    sourceType: string;
    sourceThreadId: string | null;
    sourceMessageId: string | null;
    excerpt: string;
    sourceHash: string;
    occurredAt: Date;
  }>;

export type GeneralMemoryCandidateRecord = Readonly<{
  id: string;
  userId: string;
  kind: string;
  stableKey: string;
  proposedContent: Record<string, unknown>;
  proposedAction: string;
  existingRecordId: string | null;
  confidence: number;
  importance: number;
  scopeType: string;
  scopeId: string | null;
  createdAt: Date;
}>;

export type GeneralMemoryFormationCursor = Readonly<{
  id: string;
  userId: string;
  threadId: string;
  requestedThroughMessageId: string;
  attempts: number;
  threadScope: string;
  messages: readonly Readonly<{
    id: string;
    role: string;
    content: string;
    createdAt: Date;
  }>[];
}>;

export type GeneralMemoryFormationCandidateInput = Readonly<{
  userId: string;
  threadId: string;
  sourceEventId: string;
  extractorPolicyVersion: number;
  extractorOperation: string;
  extractorProvider: string;
  extractorModel: string;
  kind: string;
  stableKey: string;
  proposedContent: Record<string, unknown>;
  proposedAction: string;
  existingRecordId: string | null;
  confidence: number;
  importance: number;
  explicit: boolean;
  status: string;
  rejectionReason: string;
  resolvedAt: Date | null;
}>;

export interface GeneralMemoryRepositoryPort {
  isEnabled(userId: string): Promise<boolean>;
  setEnabled(userId: string, enabled: boolean): Promise<void>;
  scopeExists(
    userId: string,
    scopeType: "goal" | "thread",
    scopeId: string,
  ): Promise<boolean>;
  findActive(
    input: GeneralMemoryScopeInput,
  ): Promise<GeneralMemoryRecord | null>;
  findOwned(
    userId: string,
    memoryId: string,
  ): Promise<GeneralMemoryRecord | null>;
  listOwned(
    input: Readonly<{
      userId: string;
      status: string;
      kind?: string;
      scopeType?: string;
      scopeId?: string | null;
      cursor?: string;
      limit: number;
    }>,
  ): Promise<readonly GeneralMemoryRecord[]>;
  createIfAbsent(
    input: GeneralMemoryCreateInput,
  ): Promise<Readonly<{ record: GeneralMemoryRecord; created: boolean }>>;
  reinforce(
    input: Readonly<{
      userId: string;
      memoryId: string;
      confidence: number;
      importance: number;
      sourceThreadId: string;
      sourceMessageId: string;
      excerpt: string;
      sourceHash: string;
      occurredAt: Date;
    }>,
  ): Promise<GeneralMemoryRecord>;
  correct(
    input: Readonly<{
      userId: string;
      memoryId: string;
      summary: string;
      importance?: number;
      actorType: string;
      actorRef: string | null;
      sourceThreadId: string | null;
      sourceMessageId: string | null;
      excerpt: string;
      sourceHash: string;
      occurredAt: Date;
    }>,
  ): Promise<GeneralMemoryRecord>;
  archive(userId: string, memoryId: string): Promise<GeneralMemoryRecord>;
  deleteOwned(userId: string, memoryId: string): Promise<void>;
  listSearchCandidates(
    input: Readonly<{
      userId: string;
      goalId?: string;
      threadId?: string;
      now: Date;
    }>,
  ): Promise<readonly GeneralMemoryRecord[]>;
  semanticScores(
    input: Readonly<{
      userId: string;
      recordIds: readonly string[];
      vector: readonly number[];
      provider: string;
      model: string;
    }>,
  ): Promise<ReadonlyMap<string, number>>;
  markIndexed(
    input: Readonly<{
      recordId: string;
      vector: readonly number[];
      provider: string;
      model: string;
    }>,
  ): Promise<void>;
  markIndexFailed(recordId: string, error: string): Promise<void>;
  listReviewCandidates(
    userId: string,
    limit: number,
  ): Promise<readonly GeneralMemoryCandidateRecord[]>;
  findReviewCandidate(
    userId: string,
    candidateId: string,
  ): Promise<GeneralMemoryCandidateRecord | null>;
  rejectCandidate(candidateId: string, resolvedAt: Date): Promise<void>;
  activateCandidate(
    candidateId: string,
    memoryId: string,
    resolvedAt: Date,
  ): Promise<void>;
  enqueueFormationTurn(
    input: Readonly<{
      userId: string;
      threadId: string;
      throughMessageId: string;
    }>,
  ): Promise<boolean>;
  claimFormationCursors(
    input: Readonly<{
      now: Date;
      workerId: string;
      limit: number;
      leaseExpiresAt: Date;
    }>,
  ): Promise<
    readonly Readonly<{
      id: string;
      requestedThroughMessageId: string;
      attempts: number;
    }>[]
  >;
  loadFormationCursor(
    cursorId: string,
  ): Promise<GeneralMemoryFormationCursor | null>;
  deleteFormationCursor(cursorId: string): Promise<void>;
  settleFormationCursor(
    input: Readonly<{
      cursorId: string;
      workerId: string;
      requestedThroughMessageId: string;
      now: Date;
    }>,
  ): Promise<void>;
  failFormationCursor(
    input: Readonly<{
      cursorId: string;
      workerId: string;
      nextAttemptAt: Date;
      error: string;
      now: Date;
    }>,
  ): Promise<void>;
  upsertFormationCandidate(
    input: GeneralMemoryFormationCandidateInput,
  ): Promise<Readonly<{ id: string; status: string }>>;
  updateFormationCandidate(
    input: Readonly<{
      candidateId: string;
      status: string;
      rejectionReason?: string;
      existingRecordId?: string;
      resolvedAt?: Date;
    }>,
  ): Promise<void>;
  listPendingIndexes(
    input: Readonly<{
      before: Date;
      limit: number;
      provider?: string;
      model?: string;
    }>,
  ): Promise<readonly Readonly<{ id: string; summary: string }>[]>;
}
