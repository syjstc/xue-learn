export const MEMORY_KINDS = [
  "personal_fact",
  "preference",
  "constraint",
  "episode",
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_AUTHORITIES = [
  "learner_declared",
  "conversation_derived",
  "trusted_workflow",
] as const;
export type MemoryAuthority = (typeof MEMORY_AUTHORITIES)[number];

export const MEMORY_STATUSES = ["active", "superseded", "archived"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const MEMORY_CANDIDATE_STATUSES = [
  "pending",
  "activated",
  "rejected",
  "needs_review",
  "failed",
] as const;
export type MemoryCandidateStatus = (typeof MEMORY_CANDIDATE_STATUSES)[number];

export type MemoryScopeType = "user" | "goal" | "thread";

export type MemoryScope = {
  productId: string;
  ownerId: string;
  domain: string;
  scopeType: MemoryScopeType;
  scopeId: string | null;
};

export type MemoryContent = {
  summary: string;
  value?: unknown;
};

export type MemoryRecord = {
  id: string;
  scope: MemoryScope;
  kind: MemoryKind;
  stableKey: string;
  content: MemoryContent;
  authority: MemoryAuthority;
  status: MemoryStatus;
  confidence: number;
  importance: number;
  validFrom: string;
  validUntil: string | null;
  lastConfirmedAt: string | null;
  expiresAt: string | null;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
};

export type MemoryCandidateAction = "add" | "reinforce" | "correct" | "noop";

export type MemoryCandidate = {
  id: string;
  scope: MemoryScope;
  kind: MemoryKind;
  stableKey: string;
  content: MemoryContent;
  action: MemoryCandidateAction;
  confidence: number;
  importance: number;
  explicit: boolean;
  existingRecordId: string | null;
  status: MemoryCandidateStatus;
};

export type MemoryEvidence = {
  id: string;
  recordId: string;
  revision: number;
  sourceType: "message" | "workflow" | "manual";
  sourceRef: string | null;
  excerpt: string;
  sourceHash: string;
  occurredAt: string;
};

export type MemoryRevisionAction =
  "create" | "reinforce" | "correct" | "consolidate" | "supersede" | "archive";

export type MemoryRevision = {
  id: string;
  recordId: string;
  revision: number;
  action: MemoryRevisionAction;
  content: MemoryContent;
  confidence: number;
  importance: number;
  actorType: "learner" | "system" | "workflow";
  actorRef: string | null;
  createdAt: string;
};

export type MemorySearchSignals = {
  semantic: number | null;
  lexical: number;
  importance: number;
  confidence: number;
  recency: number;
  exactKey: boolean;
};

export type MemorySearchCandidate<T = MemoryRecord> = {
  item: T;
  signals: MemorySearchSignals;
};

export type MemorySearchResult<T = MemoryRecord> = MemorySearchCandidate<T> & {
  score: number;
};

export interface MemoryRepository {
  get(id: string): Promise<MemoryRecord | null>;
  findActiveByStableKey(
    scope: MemoryScope,
    kind: MemoryKind,
    stableKey: string,
  ): Promise<MemoryRecord | null>;
  search(
    scope: MemoryScope,
    query: string,
    limit: number,
  ): Promise<MemoryRecord[]>;
  create(input: {
    record: MemoryRecord;
    revision: MemoryRevision;
    evidence: readonly MemoryEvidence[];
  }): Promise<MemoryRecord>;
  appendRevision(input: {
    record: MemoryRecord;
    revision: MemoryRevision;
    evidence: readonly MemoryEvidence[];
  }): Promise<MemoryRecord>;
  delete(id: string): Promise<void>;
}

export interface MemoryEmbeddingPort {
  embedDocuments(texts: readonly string[]): Promise<readonly number[][]>;
  embedQuery(text: string): Promise<readonly number[]>;
}

export interface MemoryCandidateExtractor {
  extract(input: {
    transcript: readonly { id: string; role: string; content: string }[];
    existing: readonly MemoryRecord[];
  }): Promise<readonly MemoryCandidate[]>;
}
