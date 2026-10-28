import { createHash } from "node:crypto";
import type {
  GeneralMemoryRecord,
  GeneralMemoryRepositoryPort,
} from "../../../../../domain/src/index.js";
import {
  lexicalMemorySimilarity,
  normalizeStableKey,
  rankMemoryCandidates,
  type MemoryKind,
  type MemoryRecord as DomainMemoryRecord,
  type MemoryScope,
} from "../../../../../memory/src/index.js";
import type { MemoryItemDto } from "./schemas.js";
import { XUELEARN_MEMORY_PRODUCT_ID } from "./keys.js";
import { requireGeneralMemoryPersistence } from "./persistence.js";
import { getLlmRuntimeConfig } from "../../../llm/runtime-config.js";

function summaryOf(value: Record<string, unknown>): string {
  return typeof value.summary === "string" ? value.summary : "";
}

function sourceHash(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function defaultStableKey(kind: MemoryKind, summary: string): string {
  const normalized = normalizeStableKey(summary).slice(0, 180);
  return `${kind}.${normalized || sourceHash([summary]).slice(0, 20)}`;
}

function scopeInput(scope: MemoryScope, kind: MemoryKind, stableKey: string) {
  return {
    userId: scope.ownerId,
    productId: scope.productId,
    domain: scope.domain,
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    kind,
    stableKey,
  };
}

function domainRecord(row: GeneralMemoryRecord): DomainMemoryRecord {
  return {
    id: row.id,
    scope: {
      productId: row.productId,
      ownerId: row.userId,
      domain: row.domain,
      scopeType: row.scopeType as MemoryScope["scopeType"],
      scopeId: row.scopeId,
    },
    kind: row.kind as MemoryKind,
    stableKey: row.stableKey,
    content: { summary: summaryOf(row.contentJson) },
    authority: row.authority as DomainMemoryRecord["authority"],
    status: row.status as DomainMemoryRecord["status"],
    confidence: row.confidence,
    importance: row.importance,
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil?.toISOString() ?? null,
    lastConfirmedAt: row.lastConfirmedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    currentRevision: row.currentRevision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class GeneralMemoryRepository {
  private readonly persistence: GeneralMemoryRepositoryPort;

  constructor(persistence?: GeneralMemoryRepositoryPort) {
    this.persistence = persistence ?? requireGeneralMemoryPersistence();
  }

  isEnabled(userId: string): Promise<boolean> {
    return this.persistence.isEnabled(userId);
  }

  async setEnabled(userId: string, enabled: boolean): Promise<boolean> {
    await this.persistence.setEnabled(userId, enabled);
    return enabled;
  }

  async authorizeScope(userId: string, scope: MemoryScope): Promise<void> {
    if (
      scope.ownerId !== userId ||
      scope.productId !== XUELEARN_MEMORY_PRODUCT_ID
    ) {
      throw new Error("Memory scope is not owned by the learner");
    }
    if (scope.scopeType === "user") {
      if (scope.scopeId !== null)
        throw new Error("User memory scopeId must be null");
      return;
    }
    if (!scope.scopeId) throw new Error("Scoped memory requires scopeId");
    if (
      !(await this.persistence.scopeExists(
        userId,
        scope.scopeType,
        scope.scopeId,
      ))
    ) {
      throw new Error(
        scope.scopeType === "goal"
          ? "Memory goal scope is unavailable"
          : "Memory thread scope is unavailable",
      );
    }
  }

  async findActiveByStableKey(
    scope: MemoryScope,
    kind: MemoryKind,
    stableKey: string,
  ) {
    const row = await this.persistence.findActive(
      scopeInput(scope, kind, stableKey),
    );
    return row ? domainRecord(row) : null;
  }

  getOwned(userId: string, memoryId: string) {
    return this.persistence.findOwned(userId, memoryId);
  }

  toDto(row: GeneralMemoryRecord): MemoryItemDto {
    return {
      id: row.id,
      kind: row.kind as MemoryItemDto["kind"],
      summary: summaryOf(row.contentJson),
      stableKey: row.stableKey,
      authority: row.authority as MemoryItemDto["authority"],
      status: row.status as MemoryItemDto["status"],
      confidence: row.confidence,
      importance: row.importance,
      scope: {
        productId: row.productId,
        domain: row.domain,
        scopeType: row.scopeType as MemoryItemDto["scope"]["scopeType"],
        scopeId: row.scopeId,
      },
      evidence: row.evidence.map((evidence) => ({
        id: evidence.id,
        sourceType:
          evidence.sourceType as MemoryItemDto["evidence"][number]["sourceType"],
        excerpt: evidence.excerpt,
        occurredAt: evidence.occurredAt.toISOString(),
      })),
      asOf: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(input: {
    userId: string;
    status?: "active" | "archived";
    kind?: MemoryKind;
    scopeType?: MemoryScope["scopeType"];
    scopeId?: string | null;
    cursor?: string;
    limit?: number;
  }): Promise<{ items: MemoryItemDto[]; nextCursor: string | null }> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 50));
    const rows = await this.persistence.listOwned({
      ...input,
      status: input.status ?? "active",
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => this.toDto(row)),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async createManual(input: {
    userId: string;
    scope: MemoryScope;
    kind: Exclude<MemoryKind, "episode">;
    summary: string;
    stableKey?: string;
    importance: number;
  }): Promise<MemoryItemDto> {
    await this.authorizeScope(input.userId, input.scope);
    const stableKey = normalizeStableKey(
      input.stableKey || defaultStableKey(input.kind, input.summary),
    );
    if (!stableKey) throw new Error("Memory stable key is empty");
    const now = new Date();
    const result = await this.persistence.createIfAbsent({
      ...scopeInput(input.scope, input.kind, stableKey),
      summary: input.summary,
      authority: "learner_declared",
      confidence: 1,
      importance: input.importance,
      actorType: "learner",
      actorRef: input.userId,
      sourceType: "manual",
      sourceThreadId: null,
      sourceMessageId: null,
      excerpt: input.summary,
      sourceHash: sourceHash(["manual", input.userId, stableKey]),
      occurredAt: now,
    });
    if (!result.created) {
      return this.correct({
        userId: input.userId,
        memoryId: result.record.id,
        summary: input.summary,
        importance: input.importance,
        actorType: "learner",
      });
    }
    return this.toDto(result.record);
  }

  async createDerived(input: {
    userId: string;
    scope: MemoryScope;
    kind: Exclude<MemoryKind, "episode"> | "episode";
    summary: string;
    stableKey: string;
    confidence: number;
    importance: number;
    authority: "conversation_derived" | "trusted_workflow";
    sourceType: "message" | "workflow";
    sourceThreadId?: string;
    sourceMessageId?: string;
    excerpt: string;
    sourceRef: string;
  }): Promise<MemoryItemDto> {
    await this.authorizeScope(input.userId, input.scope);
    const stableKey = normalizeStableKey(input.stableKey);
    if (!stableKey) throw new Error("Memory stable key is empty");
    const result = await this.persistence.createIfAbsent({
      ...scopeInput(input.scope, input.kind, stableKey),
      summary: input.summary,
      authority: input.authority,
      confidence: input.confidence,
      importance: input.importance,
      actorType: input.sourceType === "workflow" ? "workflow" : "system",
      actorRef: input.sourceRef,
      sourceType: input.sourceType,
      sourceThreadId: input.sourceThreadId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      excerpt: input.excerpt,
      sourceHash: sourceHash([input.sourceType, input.sourceRef, stableKey]),
      occurredAt: new Date(),
    });
    return this.toDto(result.record);
  }

  async reinforce(input: {
    userId: string;
    memoryId: string;
    confidence: number;
    importance: number;
    sourceThreadId: string;
    sourceMessageId: string;
    excerpt: string;
  }): Promise<MemoryItemDto> {
    return this.toDto(
      await this.persistence.reinforce({
        ...input,
        sourceHash: sourceHash(["message", input.sourceMessageId]),
        occurredAt: new Date(),
      }),
    );
  }

  async correct(input: {
    userId: string;
    memoryId: string;
    summary: string;
    importance?: number;
    actorType?: "learner" | "system" | "workflow";
    sourceThreadId?: string;
    sourceMessageId?: string;
    excerpt?: string;
  }): Promise<MemoryItemDto> {
    const actorType = input.actorType ?? "learner";
    return this.toDto(
      await this.persistence.correct({
        ...input,
        actorType,
        actorRef: actorType === "learner" ? input.userId : null,
        sourceThreadId: input.sourceThreadId ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
        excerpt: input.excerpt ?? input.summary,
        sourceHash: sourceHash([
          input.sourceMessageId ?? "manual",
          input.summary,
        ]),
        occurredAt: new Date(),
      }),
    );
  }

  async archive(userId: string, memoryId: string): Promise<MemoryItemDto> {
    return this.toDto(await this.persistence.archive(userId, memoryId));
  }

  permanentDelete(userId: string, memoryId: string): Promise<void> {
    return this.persistence.deleteOwned(userId, memoryId);
  }

  async search(input: {
    userId: string;
    query: string;
    goalId?: string;
    threadId?: string;
    limit?: number;
    queryEmbedding?: readonly number[] | null;
  }): Promise<MemoryItemDto[]> {
    const now = new Date();
    const rows = await this.persistence.listSearchCandidates({
      userId: input.userId,
      goalId: input.goalId,
      threadId: input.threadId,
      now,
    });
    const semantic = input.queryEmbedding?.length
      ? await this.persistence.semanticScores({
          userId: input.userId,
          recordIds: rows.map((row) => row.id),
          vector: input.queryEmbedding,
          provider: getLlmRuntimeConfig().embeddingProvider,
          model: getLlmRuntimeConfig().embeddingModel,
        })
      : new Map<string, number>();
    const ranked = rankMemoryCandidates(
      rows.map((row) => ({
        item: row,
        signals: {
          semantic: semantic.get(row.id) ?? null,
          lexical: lexicalMemorySimilarity(input.query, row.searchText),
          importance: row.importance,
          confidence: row.confidence,
          recency: Math.exp(
            -Math.max(0, now.getTime() - row.updatedAt.getTime()) /
              (90 * 86_400_000),
          ),
          exactKey: normalizeStableKey(input.query) === row.stableKey,
        },
      })),
    );
    const limit = Math.max(1, Math.min(input.limit ?? 12, 20));
    return ranked.slice(0, limit).map(({ item }) => this.toDto(item));
  }

  markIndexed(input: {
    recordId: string;
    vector: readonly number[];
    provider: string;
    model: string;
  }): Promise<void> {
    return this.persistence.markIndexed(input);
  }

  markIndexFailed(recordId: string, error: string): Promise<void> {
    return this.persistence.markIndexFailed(recordId, error);
  }

  listReviewCandidates(userId: string, limit = 50) {
    return this.persistence.listReviewCandidates(userId, limit);
  }

  findReviewCandidate(userId: string, candidateId: string) {
    return this.persistence.findReviewCandidate(userId, candidateId);
  }

  rejectCandidate(candidateId: string, resolvedAt = new Date()) {
    return this.persistence.rejectCandidate(candidateId, resolvedAt);
  }

  activateCandidate(
    candidateId: string,
    memoryId: string,
    resolvedAt = new Date(),
  ) {
    return this.persistence.activateCandidate(
      candidateId,
      memoryId,
      resolvedAt,
    );
  }
}
