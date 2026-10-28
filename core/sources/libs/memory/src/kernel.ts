import type {
  MemoryCandidate,
  MemoryRecord,
  MemoryScope,
  MemorySearchCandidate,
  MemorySearchResult,
  MemoryStatus,
} from "./types.js";

const TRANSITIONS: Record<MemoryStatus, readonly MemoryStatus[]> = {
  active: ["superseded", "archived"],
  superseded: [],
  archived: ["active"],
};

export function assertMemoryScope(scope: MemoryScope): void {
  if (
    !scope.productId.trim() ||
    !scope.ownerId.trim() ||
    !scope.domain.trim()
  ) {
    throw new Error("Memory scope identifiers must not be empty");
  }
  if (scope.scopeType === "user" && scope.scopeId !== null) {
    throw new Error("User memory scopeId must be null");
  }
  if (scope.scopeType !== "user" && !scope.scopeId?.trim()) {
    throw new Error(`${scope.scopeType} memory requires scopeId`);
  }
}

export function assertMemoryRecord(record: MemoryRecord): void {
  assertMemoryScope(record.scope);
  if (!record.id.trim() || !record.stableKey.trim()) {
    throw new Error("Memory record identity must not be empty");
  }
  if (
    !Number.isFinite(record.confidence) ||
    record.confidence < 0 ||
    record.confidence > 1 ||
    !Number.isFinite(record.importance) ||
    record.importance < 0 ||
    record.importance > 1
  ) {
    throw new Error("Memory confidence and importance must be between 0 and 1");
  }
  if (
    !Number.isSafeInteger(record.currentRevision) ||
    record.currentRevision < 1
  ) {
    throw new Error("Memory currentRevision must be a positive integer");
  }
  if (!Number.isFinite(Date.parse(record.validFrom))) {
    throw new Error("Memory validFrom must be a valid timestamp");
  }
}

export function normalizeStableKey(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s._/\\:]+/g, ".")
    .replace(/[^\p{Letter}\p{Number}.-]+/gu, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.|\.$/g, "")
    .slice(0, 240);
}

export function canTransitionMemoryStatus(
  from: MemoryStatus,
  to: MemoryStatus,
): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function assertMemoryStatusTransition(
  from: MemoryStatus,
  to: MemoryStatus,
): void {
  if (!canTransitionMemoryStatus(from, to)) {
    throw new Error(`Invalid memory status transition: ${from} -> ${to}`);
  }
}

export function memoryScopeCanRead(
  query: MemoryScope,
  stored: MemoryScope,
): boolean {
  if (
    query.productId !== stored.productId ||
    query.ownerId !== stored.ownerId ||
    query.domain !== stored.domain
  ) {
    return false;
  }
  if (stored.scopeType === "user") return stored.scopeId === null;
  return (
    query.scopeType === stored.scopeType && query.scopeId === stored.scopeId
  );
}

export type ConsolidationPlan =
  | { type: "create" }
  | { type: "reinforce"; recordId: string }
  | { type: "correct"; recordId: string }
  | { type: "needs_review"; reason: string }
  | { type: "noop"; reason: string };

export function planMemoryConsolidation(input: {
  candidate: MemoryCandidate;
  existing: MemoryRecord | null;
  activationThreshold?: number;
}): ConsolidationPlan {
  const threshold = input.activationThreshold ?? 0.8;
  const { candidate, existing } = input;
  if (candidate.action === "noop")
    return { type: "noop", reason: "model_noop" };
  if (!candidate.explicit || candidate.confidence < threshold) {
    return { type: "needs_review", reason: "insufficient_explicit_confidence" };
  }
  if (candidate.action === "add") {
    return existing
      ? { type: "needs_review", reason: "active_key_already_exists" }
      : { type: "create" };
  }
  if (!existing) {
    return { type: "needs_review", reason: "referenced_memory_missing" };
  }
  if (
    candidate.existingRecordId &&
    candidate.existingRecordId !== existing.id
  ) {
    return { type: "needs_review", reason: "record_reference_mismatch" };
  }
  return candidate.action === "reinforce"
    ? { type: "reinforce", recordId: existing.id }
    : { type: "correct", recordId: existing.id };
}

const WEIGHTS = {
  semantic: 0.45,
  lexical: 0.25,
  importance: 0.15,
  confidence: 0.1,
  recency: 0.05,
} as const;

function bounded(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function lexicalMemorySimilarity(query: string, text: string): number {
  const tokens = (value: string) => {
    const normalized = value.normalize("NFKC").toLocaleLowerCase();
    const result = new Set<string>(
      normalized.match(/[\p{Letter}\p{Number}]+/gu) ?? [],
    );
    for (const run of normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
      result.delete(run);
      for (let index = 0; index < run.length - 1; index += 1) {
        result.add(run.slice(index, index + 2));
      }
    }
    return result;
  };
  const left = tokens(query);
  const right = tokens(text);
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / left.size;
}

export function rankMemoryCandidates<T>(
  candidates: readonly MemorySearchCandidate<T>[],
): MemorySearchResult<T>[] {
  return candidates
    .map((candidate) => {
      const semanticAvailable = candidate.signals.semantic !== null;
      const activeWeight = semanticAvailable ? 1 : 1 - WEIGHTS.semantic;
      const raw =
        (semanticAvailable
          ? bounded(candidate.signals.semantic ?? 0) * WEIGHTS.semantic
          : 0) +
        bounded(candidate.signals.lexical) * WEIGHTS.lexical +
        bounded(candidate.signals.importance) * WEIGHTS.importance +
        bounded(candidate.signals.confidence) * WEIGHTS.confidence +
        bounded(candidate.signals.recency) * WEIGHTS.recency;
      const normalized = semanticAvailable ? raw : raw / activeWeight;
      return {
        ...candidate,
        score: Math.min(1, normalized + (candidate.signals.exactKey ? 0.2 : 0)),
      };
    })
    .sort((left, right) => right.score - left.score);
}
