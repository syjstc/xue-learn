import { z } from "zod";
import type {
  CapabilityQueryTool,
  CapabilitySettingsPort,
  ContextEnvelope,
  DomainEvent,
  LearningSystemCapability,
  LearningSystemSubject,
  SystemCommand,
} from "../../types.js";
import { defineLearningSystemCapability } from "../../define-capability.js";
import { GeneralMemoryApplication } from "./application.js";
import { embedMemoryQuery, enqueueMemoryFormationTurn } from "./formation.js";
import {
  GENERAL_MEMORY_COMMANDS,
  GENERAL_MEMORY_EVENTS,
  GENERAL_MEMORY_QUERY_TOOL_KEYS,
  GENERAL_MEMORY_SCHEMA_VERSION,
  GENERAL_MEMORY_VERSION,
  GENERAL_MEMORY_VIEW_KEYS,
} from "./keys.js";
import {
  correctMemoryPayloadSchema,
  createMemoryPayloadSchema,
  memoryIdPayloadSchema,
  relevantMemoryResultSchema,
} from "./schemas.js";

function envelope<T>(input: {
  authority: "conversation_context";
  scope: LearningSystemSubject;
  data: T;
  asOf?: string;
}): ContextEnvelope<T> {
  return {
    ownerCapabilityId: "general-memory",
    ownerCapabilityVersion: GENERAL_MEMORY_VERSION,
    schemaVersion: GENERAL_MEMORY_SCHEMA_VERSION,
    authority: input.authority,
    scope: input.scope,
    freshness: { asOf: input.asOf ?? new Date().toISOString(), stale: false },
    data: input.data,
  };
}

function requireUser(command: SystemCommand): string {
  const userId = command.subject.userId?.trim();
  if (!userId) throw new Error(`${command.type} requires a user subject`);
  return userId;
}

export function createGeneralMemoryCapability(): LearningSystemCapability {
  const application = new GeneralMemoryApplication();
  const findRelevantTool: CapabilityQueryTool<
    { query: string; limit?: number },
    z.infer<typeof relevantMemoryResultSchema>
  > = {
    key: GENERAL_MEMORY_QUERY_TOOL_KEYS.findRelevantMemory,
    ownerCapabilityId: "general-memory",
    schemaVersion: GENERAL_MEMORY_SCHEMA_VERSION,
    description:
      "Find opted-in personal memories and agent episodes for the current learner, preserving each item's source authority.",
    inputSchema: z
      .object({
        query: z.string().trim().max(500).default(""),
        limit: z.number().int().min(1).max(20).optional(),
      })
      .strict(),
    resultSchema: relevantMemoryResultSchema,
    requiredScopes: ["user"],
    authority: "conversation_context",
    maxResultTokens: 1_500,
    query: async (subject, input, signal) => {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const enabled = await application.repository.isEnabled(subject.userId);
      const memories = enabled
        ? await application.repository.search({
            userId: subject.userId,
            query: input.query,
            goalId: subject.goalId,
            threadId: subject.threadId,
            limit: input.limit,
            queryEmbedding: await embedMemoryQuery(input.query).catch(
              () => null,
            ),
          })
        : [];
      return envelope({
        authority: "conversation_context",
        scope: subject,
        data: { query: input.query, memories },
        asOf: memories[0]?.updatedAt,
      });
    },
  };

  const settingsPort: CapabilitySettingsPort<
    { enabled: boolean },
    { enabled: boolean }
  > = {
    capabilityId: "general-memory",
    scope: "user",
    read: async (subject) => {
      if (!subject.userId)
        throw new Error("Memory settings require user scope");
      return application.getSettings(subject.userId);
    },
    validatePatch: (input) =>
      z.object({ enabled: z.boolean() }).strict().parse(input),
    patch: async (subject, patch) => {
      if (!subject.userId)
        throw new Error("Memory settings require user scope");
      return application.setSettings(subject.userId, patch.enabled);
    },
  };

  return defineLearningSystemCapability({
    id: "general-memory",
    version: GENERAL_MEMORY_VERSION,
    views: {
      [GENERAL_MEMORY_VIEW_KEYS.learnerRelevantMemory]: async (request) => {
        if (!request.subject.userId) {
          return null;
        }
        if (!(await application.repository.isEnabled(request.subject.userId))) {
          return null;
        }
        const query = request.query ?? "";
        const memories = await application.repository.search({
          userId: request.subject.userId,
          query,
          goalId: request.subject.goalId,
          threadId: request.subject.threadId,
          queryEmbedding: await embedMemoryQuery(query).catch(() => null),
        });
        return envelope({
          authority: "conversation_context",
          scope: request.subject,
          data: { query, memories },
          asOf: memories[0]?.updatedAt,
        });
      },
    },
    queryTools: [findRelevantTool] as unknown as CapabilityQueryTool[],
    settingsPorts: [settingsPort] as unknown as CapabilitySettingsPort[],
    commands: Object.values(GENERAL_MEMORY_COMMANDS),
    events: [GENERAL_MEMORY_EVENTS.agentTurnCompleted],
    handleCommand: async (command) => {
      const userId = requireUser(command);
      if (command.type === GENERAL_MEMORY_COMMANDS.create) {
        const payload = createMemoryPayloadSchema.parse(command.payload);
        return {
          handledBy: "general-memory",
          value: await application.create({
            userId,
            kind: payload.kind,
            summary: payload.summary,
            stableKey: payload.stableKey,
            importance: payload.importance,
            scopeType: payload.scopeType,
            scopeId: payload.scopeId,
          }),
        };
      }
      if (command.type === GENERAL_MEMORY_COMMANDS.correct) {
        const payload = correctMemoryPayloadSchema.parse(command.payload);
        return {
          handledBy: "general-memory",
          value: await application.correct({ userId, ...payload }),
        };
      }
      if (command.type === GENERAL_MEMORY_COMMANDS.archive) {
        const payload = memoryIdPayloadSchema.parse(command.payload);
        return {
          handledBy: "general-memory",
          value: await application.archive(userId, payload.memoryId),
        };
      }
      if (command.type === GENERAL_MEMORY_COMMANDS.delete) {
        const payload = memoryIdPayloadSchema.parse(command.payload);
        await application.delete(userId, payload.memoryId);
        return { handledBy: "general-memory", value: { deleted: true } };
      }
      throw new Error(`Unsupported general-memory command "${command.type}"`);
    },
    handleEvent: async (event: DomainEvent) => {
      if (
        event.type !== GENERAL_MEMORY_EVENTS.agentTurnCompleted ||
        !event.subject.userId ||
        !event.subject.threadId
      ) {
        return;
      }
      const parsed = z
        .object({ throughMessageId: z.string().min(1) })
        .safeParse(event.payload);
      if (!parsed.success) return;
      await enqueueMemoryFormationTurn({
        userId: event.subject.userId,
        threadId: event.subject.threadId,
        throughMessageId: parsed.data.throughMessageId,
      });
    },
  });
}
