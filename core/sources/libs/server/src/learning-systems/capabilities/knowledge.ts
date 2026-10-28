import { z } from "zod";
import type {
  CapabilityQueryTool,
  DomainEvent,
  LearningSystemCapability,
} from "../types.js";
import * as shared from "./support/runtime.js";
import type { RuntimeContextDependencies } from "./support/runtime.js";

const {
  VERSION,
  SCHEMA_VERSION,
  RUNTIME_CONTEXT_VIEW_KEYS,
  RUNTIME_CONTEXT_QUERY_TOOL_KEYS,
  AGENDA_INVALIDATION_EVENTS,
  knowledgeResultSchema,
  agendaResultSchema,
  reviewResultSchema,
  abortIfNeeded,
  compactText,
  nowIso,
  envelope,
  readAgendaSnapshot,
  readDueReviews,
} = shared;

export function createKnowledgeCapability(
  deps: RuntimeContextDependencies,
): LearningSystemCapability {
  const capabilityId = "knowledge";
  const searchTool: CapabilityQueryTool<
    { query: string; limit?: number },
    z.infer<typeof knowledgeResultSchema>
  > = {
    key: RUNTIME_CONTEXT_QUERY_TOOL_KEYS.searchKnowledge,
    ownerCapabilityId: capabilityId,
    schemaVersion: SCHEMA_VERSION,
    description: "Search the current learner's previously learned knowledge.",
    inputSchema: z
      .object({
        query: z.string().trim().min(1).max(500),
        limit: z.number().int().min(1).max(8).optional(),
      })
      .strict(),
    resultSchema: knowledgeResultSchema,
    requiredScopes: ["user"],
    authority: "conversation_context",
    maxResultTokens: 3_000,
    query: async (subject, input, signal) => {
      abortIfNeeded(signal);
      const limit = input.limit ?? 5;
      const learned = await deps.retrieveLearnedKnowledge(
        subject.userId,
        input.query,
        {
          k: limit,
          excludeUnitId: subject.unitId,
        },
      );
      abortIfNeeded(signal);
      return envelope({
        ownerCapabilityId: capabilityId,
        authority: "conversation_context",
        scope: subject,
        asOf: nowIso(deps.now),
        data: {
          query: input.query,
          learnedContext: compactText(learned.context, 6_000),
          learnedUnitIds: learned.unitIds.slice(0, 12),
        },
      });
    },
  };

  return {
    manifest: {
      id: capabilityId,
      version: VERSION,
      kind: "learning_system",
      providesQueryTools: [searchTool.key],
    },
    getQueryTools: () => [searchTool] as CapabilityQueryTool[],
  };
}
