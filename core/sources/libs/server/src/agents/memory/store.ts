import { createHash } from "node:crypto";
import {
  lexicalMemorySimilarity,
  rankMemoryCandidates,
} from "../../../../memory/src/index.js";
import { requireGeneralMemoryPersistence } from "../../learning-systems/capabilities/general-memory/persistence.js";
import {
  loadThreadMessages,
  requireAgentConversationPersistence,
} from "../core/checkpoint.js";
import type { AgentMemoryStore, MemoryChunk } from "./types.js";

export class PostgresAgentMemoryStore implements AgentMemoryStore {
  async getWorkingContext(threadId: string): Promise<MemoryChunk[]> {
    const messages = await loadThreadMessages(threadId);
    return messages.slice(-20).map((m) => ({
      layer: "working" as const,
      key: m.id,
      content: m.content,
      source: `thread:${threadId}`,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  async getRelevantFacts(
    userId: string,
    query: string,
  ): Promise<MemoryChunk[]> {
    const repository = requireGeneralMemoryPersistence();
    if (!(await repository.isEnabled(userId))) return [];
    const now = new Date();
    const candidates = await repository.listSearchCandidates({ userId, now });
    const ranked = rankMemoryCandidates(
      candidates.map((item) => ({
        item,
        signals: {
          semantic: null,
          lexical: lexicalMemorySimilarity(query, item.searchText),
          importance: item.importance,
          confidence: item.confidence,
          recency: Math.exp(
            -Math.max(0, now.getTime() - item.updatedAt.getTime()) /
              (90 * 86_400_000),
          ),
          exactKey: false,
        },
      })),
    );
    return ranked.slice(0, 12).map(({ item }) => ({
      layer: item.kind === "episode" ? "episodic" : "semantic",
      key: item.stableKey,
      content:
        typeof item.contentJson.summary === "string"
          ? item.contentJson.summary
          : "",
      source: `${item.authority}:${item.scopeType}`,
      createdAt: item.updatedAt.toISOString(),
    }));
  }

  async recordEpisode(threadId: string, summary: string): Promise<void> {
    const thread =
      await requireAgentConversationPersistence().findThread(threadId);
    if (!thread) return;

    try {
      const repository = requireGeneralMemoryPersistence();
      if (!(await repository.isEnabled(thread.userId))) return;
      const digest = createHash("sha256").update(summary).digest("hex");
      await repository.createIfAbsent({
        userId: thread.userId,
        productId: "xuelearn",
        domain: "agent",
        scopeType: "thread",
        scopeId: threadId,
        kind: "episode",
        stableKey: `episode.agent-episode:${threadId}:${digest}`,
        summary,
        authority: "conversation_derived",
        confidence: 1,
        importance: 0.7,
        actorType: "workflow",
        actorRef: `agent-episode:${threadId}:${digest}`,
        sourceType: "workflow",
        sourceThreadId: threadId,
        sourceMessageId: null,
        excerpt: summary,
        sourceHash: digest,
        occurredAt: new Date(),
      });
    } catch {
      // Optional memory must never fail the authoritative agent workflow.
    }
  }

  async getProceduralDefaults(
    userId: string,
  ): Promise<Record<string, unknown>> {
    const defaults =
      await requireAgentConversationPersistence().readProceduralDefaults(
        userId,
      );
    return {
      llmProvider: defaults.llmProvider ?? undefined,
      teachingPersonaRef:
        defaults.teachingPersonaRef ?? "builtin:xiaohui_female",
      level: defaults.level ?? "zero",
      contentLanguage: defaults.contentLanguage ?? "auto",
    };
  }
}

export const agentMemoryStore = new PostgresAgentMemoryStore();
