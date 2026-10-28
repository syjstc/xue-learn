import type { GeneralMemoryRepositoryPort } from "../../../../../domain/src/index.js";
import type { MemoryKind, MemoryScope } from "../../../../../memory/src/index.js";
import { GeneralMemoryRepository } from "./repository.js";
import { XUELEARN_MEMORY_PRODUCT_ID } from "./keys.js";

export class GeneralMemoryApplication {
  readonly repository: GeneralMemoryRepository;

  constructor(persistence?: GeneralMemoryRepositoryPort) {
    this.repository = new GeneralMemoryRepository(persistence);
  }

  getSettings(userId: string) {
    return this.repository.isEnabled(userId).then((enabled) => ({ enabled }));
  }

  setSettings(userId: string, enabled: boolean) {
    return this.repository
      .setEnabled(userId, enabled)
      .then(() => ({ enabled }));
  }

  list(input: {
    userId: string;
    status?: "active" | "archived";
    kind?: MemoryKind;
    scopeType?: MemoryScope["scopeType"];
    scopeId?: string | null;
    cursor?: string;
    limit?: number;
  }) {
    return this.repository.list(input);
  }

  async get(userId: string, memoryId: string) {
    const row = await this.repository.getOwned(userId, memoryId);
    if (!row) throw new Error("Memory not found");
    return this.repository.toDto(row);
  }

  create(input: {
    userId: string;
    kind: Exclude<MemoryKind, "episode">;
    summary: string;
    stableKey?: string;
    importance: number;
    scopeType?: "user" | "goal" | "thread";
    scopeId?: string | null;
  }) {
    const scopeType = input.scopeType ?? "user";
    const scope: MemoryScope = {
      productId: XUELEARN_MEMORY_PRODUCT_ID,
      ownerId: input.userId,
      domain: "personal",
      scopeType,
      scopeId: scopeType === "user" ? null : (input.scopeId ?? null),
    };
    return this.repository.createManual({
      userId: input.userId,
      scope,
      kind: input.kind,
      summary: input.summary,
      stableKey: input.stableKey,
      importance: input.importance,
    });
  }

  correct(input: {
    userId: string;
    memoryId: string;
    summary: string;
    importance?: number;
  }) {
    return this.repository.correct({ ...input, actorType: "learner" });
  }

  archive(userId: string, memoryId: string) {
    return this.repository.archive(userId, memoryId);
  }

  delete(userId: string, memoryId: string) {
    return this.repository.permanentDelete(userId, memoryId);
  }

  async listCandidates(userId: string) {
    const rows = await this.repository.listReviewCandidates(userId, 50);
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      stableKey: row.stableKey,
      summary:
        typeof (row.proposedContent as { summary?: unknown }).summary ===
        "string"
          ? (row.proposedContent as { summary: string }).summary
          : "",
      action: row.proposedAction,
      confidence: row.confidence,
      importance: row.importance,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async resolveCandidate(input: {
    userId: string;
    candidateId: string;
    decision: "accept" | "reject";
  }) {
    const candidate = await this.repository.findReviewCandidate(
      input.userId,
      input.candidateId,
    );
    if (!candidate) throw new Error("Memory candidate not found");
    if (input.decision === "reject") {
      await this.repository.rejectCandidate(candidate.id);
      return { status: "rejected" as const, memory: null };
    }
    const summary =
      typeof (candidate.proposedContent as { summary?: unknown }).summary ===
      "string"
        ? (candidate.proposedContent as { summary: string }).summary
        : "";
    if (!summary) throw new Error("Memory candidate has no summary");
    const existingRecord = candidate.existingRecordId
      ? await this.repository.getOwned(input.userId, candidate.existingRecordId)
      : null;
    const activeExisting =
      existingRecord?.status === "active" ? existingRecord : null;
    const memory = activeExisting
      ? await this.repository.correct({
          userId: input.userId,
          memoryId: activeExisting.id,
          summary,
          importance: candidate.importance,
          actorType: "learner",
        })
      : await this.create({
          userId: input.userId,
          kind: candidate.kind as Exclude<MemoryKind, "episode">,
          summary,
          stableKey: candidate.stableKey,
          importance: candidate.importance,
          scopeType: candidate.scopeType as "user" | "goal" | "thread",
          scopeId: candidate.scopeId,
        });
    await this.repository.activateCandidate(candidate.id, memory.id);
    return { status: "activated" as const, memory };
  }

  async recordEpisode(input: {
    userId: string;
    threadId: string;
    summary: string;
    sourceRef: string;
  }) {
    if (!(await this.repository.isEnabled(input.userId))) return null;
    try {
      return await this.repository.createDerived({
        userId: input.userId,
        scope: {
          productId: XUELEARN_MEMORY_PRODUCT_ID,
          ownerId: input.userId,
          domain: "agent",
          scopeType: "thread",
          scopeId: input.threadId,
        },
        kind: "episode",
        summary: input.summary,
        stableKey: `episode.${input.sourceRef}`,
        confidence: 1,
        importance: 0.7,
        authority: "conversation_derived",
        sourceType: "workflow",
        sourceThreadId: input.threadId,
        excerpt: input.summary,
        sourceRef: input.sourceRef,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Memory thread scope is unavailable"
      ) {
        return null;
      }
      throw error;
    }
  }
}

export function createGeneralMemoryApplication(
  persistence?: GeneralMemoryRepositoryPort,
) {
  return new GeneralMemoryApplication(persistence);
}
