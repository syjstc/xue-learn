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

export function createReviewCapability(
  deps: RuntimeContextDependencies,
): LearningSystemCapability {
  const capabilityId = "review-practice";
  const reviewsTool: CapabilityQueryTool<
    { limit?: number },
    z.infer<typeof reviewResultSchema>
  > = {
    key: RUNTIME_CONTEXT_QUERY_TOOL_KEYS.getDueReviews,
    ownerCapabilityId: capabilityId,
    schemaVersion: SCHEMA_VERSION,
    description:
      "Read due review cards for the current learner, already limited to the server-bound goal or unit when present.",
    inputSchema: z
      .object({ limit: z.number().int().min(1).max(20).optional() })
      .strict(),
    resultSchema: reviewResultSchema,
    requiredScopes: ["user"],
    authority: "verified_learner_state",
    maxResultTokens: 1_500,
    query: async (subject, input, signal) => {
      abortIfNeeded(signal);
      const data = await readDueReviews(subject, deps.now(), input.limit ?? 10);
      abortIfNeeded(signal);
      return envelope({
        ownerCapabilityId: capabilityId,
        authority: "verified_learner_state",
        scope: subject,
        asOf: nowIso(deps.now),
        data,
      });
    },
  };

  return {
    manifest: {
      id: capabilityId,
      version: VERSION,
      kind: "learning_system",
      providesViews: [RUNTIME_CONTEXT_VIEW_KEYS.reviewDue],
      providesQueryTools: [reviewsTool.key],
    },
    getView: async (request) => {
      if (
        request.key !== RUNTIME_CONTEXT_VIEW_KEYS.reviewDue ||
        !request.subject.userId
      ) {
        return null;
      }
      const data = await readDueReviews(
        { ...request.subject, userId: request.subject.userId },
        deps.now(),
        10,
      );
      return envelope({
        ownerCapabilityId: capabilityId,
        authority: "verified_learner_state",
        scope: request.subject,
        asOf: nowIso(deps.now),
        data,
      });
    },
    getQueryTools: () => [reviewsTool] as CapabilityQueryTool[],
  };
}
