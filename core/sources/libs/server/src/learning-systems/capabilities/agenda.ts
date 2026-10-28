import { z } from "zod";
import type {
  CapabilityQueryTool,
  DomainEvent,
  LearningSystemCapability,
} from "../types.js";
import * as shared from "./support/runtime.js";
import type { RuntimeContextDependencies } from "./support/runtime.js";

export const AGENDA_GENERATION_VIEW_KEYS = Object.freeze({
  refineInstructionContext: "instruction.agenda.refine.v1",
});

export type AgendaRefineInvocation = {
  capacityMinutes: number;
  planningDate: string;
  timezone: string;
  languageInstruction: string;
  shortlist: unknown;
};

const AGENDA_REFINE_INSTRUCTION = `You refine a learner's study agenda for Today plus the next 7 days.

Rules:
- You may ONLY reorder / reassign plannedDate among the given items (same unitId + sectionId identities).
- Do not invent units. Do not change itemType. Do not exceed the supplied daily capacity (sum estimatedMinutes per plannedDate).
- Prefer overdue reviews early. Keep in-progress lessons before brand-new lessons when practical.
- Write concise learner-facing explanations (1 short sentence each). Do not switch languages because a title contains foreign technical terms.
- Return every item from the supplied shortlist exactly once.`;

export function buildAgendaRefineInvocationPrompt(
  input: AgendaRefineInvocation,
): string {
  return `${input.languageInstruction}

Capacity minutes/day: ${input.capacityMinutes}
Planning date (today): ${input.planningDate}
Timezone: ${input.timezone}

Shortlist JSON:
${JSON.stringify(input.shortlist)}`;
}

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

export function createAgendaCapability(
  deps: RuntimeContextDependencies,
): LearningSystemCapability {
  const capabilityId = "agenda";
  const agendaTool: CapabilityQueryTool<
    Record<string, never>,
    z.infer<typeof agendaResultSchema>
  > = {
    key: RUNTIME_CONTEXT_QUERY_TOOL_KEYS.getStudyAgenda,
    ownerCapabilityId: capabilityId,
    schemaVersion: SCHEMA_VERSION,
    description:
      "Read the current learner's persisted study agenda, already limited to the server-bound goal or unit when present.",
    inputSchema: z.object({}).strict(),
    resultSchema: agendaResultSchema,
    requiredScopes: ["user"],
    authority: "server_policy",
    maxResultTokens: 2_000,
    query: async (subject, _input, signal) => {
      abortIfNeeded(signal);
      const result = await readAgendaSnapshot(subject);
      abortIfNeeded(signal);
      return envelope({
        ownerCapabilityId: capabilityId,
        authority: "server_policy",
        scope: subject,
        asOf: result.asOf,
        stale: result.stale,
        data: result.data,
      });
    },
  };

  return {
    manifest: {
      id: capabilityId,
      version: VERSION,
      kind: "learning_system",
      providesViews: [
        RUNTIME_CONTEXT_VIEW_KEYS.agendaCurrent,
        AGENDA_GENERATION_VIEW_KEYS.refineInstructionContext,
      ],
      providesQueryTools: [agendaTool.key],
      subscribesToEvents: [...AGENDA_INVALIDATION_EVENTS],
    },
    getView: async (request) => {
      if (
        request.key === AGENDA_GENERATION_VIEW_KEYS.refineInstructionContext
      ) {
        return envelope({
          ownerCapabilityId: capabilityId,
          authority: "server_policy",
          scope: request.subject,
          asOf: nowIso(deps.now),
          data: { promptBlock: AGENDA_REFINE_INSTRUCTION },
        });
      }
      if (
        request.key !== RUNTIME_CONTEXT_VIEW_KEYS.agendaCurrent ||
        !request.subject.userId
      ) {
        return null;
      }
      const result = await readAgendaSnapshot({
        ...request.subject,
        userId: request.subject.userId,
      });
      return envelope({
        ownerCapabilityId: capabilityId,
        authority: "server_policy",
        scope: request.subject,
        asOf: result.asOf,
        stale: result.stale,
        data: result.data,
      });
    },
    getQueryTools: () => [agendaTool] as CapabilityQueryTool[],
    handleEvent: async (event: DomainEvent) => {
      if (
        !AGENDA_INVALIDATION_EVENTS.includes(
          event.type as (typeof AGENDA_INVALIDATION_EVENTS)[number],
        ) ||
        !event.subject.userId
      ) {
        return;
      }
      await deps.invalidateAgendaForUser(event.subject.userId);
    },
  };
}
