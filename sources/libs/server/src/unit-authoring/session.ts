import { presentationCapabilitiesSchema } from "../../../domain/src/presentation-capabilities.js";
import { getActivePresentationCapabilities } from "../llm/display-capabilities.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAgentConversationPersistence } from "../agents/core/checkpoint.js";
import type { LlmMessageRecord } from "../agents/core/types.js";

export const UNIT_AUTHORING_THREAD_SCOPE = "unit_authoring";

export const unitAuthoringStageSchema = z.enum([
  "component_selection",
  "survey",
  "section_plan",
  "section_material",
  "audit",
  "repair",
  "complete",
]);

export type UnitAuthoringStage = z.infer<typeof unitAuthoringStageSchema>;

export const unitAuthoringStateSchema = z.object({
  schemaVersion: z.literal(1),
  unitId: z.string().min(1),
  goalId: z.string().min(1),
  traceId: z.string().uuid(),
  stage: unitAuthoringStageSchema,
  currentSectionId: z.string().nullable().default(null),
  completedSectionIds: z.array(z.string()).default([]),
  basePromptHash: z.string().nullable().default(null),
  lastMessageId: z.string().nullable().default(null),
  presentationCapabilities: presentationCapabilitiesSchema.optional(),
});

export type UnitAuthoringState = z.infer<typeof unitAuthoringStateSchema>;

function initialState(input: {
  unitId: string;
  goalId: string;
}): UnitAuthoringState {
  return {
    schemaVersion: 1,
    ...(getActivePresentationCapabilities() ? {presentationCapabilities: getActivePresentationCapabilities()} : {}),
    unitId: input.unitId,
    goalId: input.goalId,
    traceId: randomUUID(),
    stage: "component_selection",
    currentSectionId: null,
    completedSectionIds: [],
    basePromptHash: null,
    lastMessageId: null,
  };
}

export async function ensureUnitAuthoringSession(input: {
  userId: string;
  unitId: string;
  goalId: string;
}): Promise<{ threadId: string; state: UnitAuthoringState }> {
  const repository = requireAgentConversationPersistence();
  const thread = await repository.findOrCreateScopedThread({
    userId: input.userId,
    scope: UNIT_AUTHORING_THREAD_SCOPE,
    scopeId: input.unitId,
    stateJson: JSON.stringify(initialState(input)),
  });
  const storedState = JSON.parse(thread.stateJson || "{}") as Record<
    string,
    unknown
  >;
  // Sessions created before authoring-cycle traces were introduced need one
  // stable id persisted before another HTTP/SSE stage resumes the transcript.
  const candidateState =
    typeof storedState.traceId === "string"
      ? storedState
      : { ...storedState, traceId: randomUUID() };
  const parsed = unitAuthoringStateSchema.safeParse(candidateState);
  if (!parsed.success || parsed.data.unitId !== input.unitId) {
    throw new Error("Invalid durable unit authoring session state");
  }
  if (parsed.data.goalId !== input.goalId) {
    throw new Error("Unit authoring session goal ownership mismatch");
  }
  if (typeof storedState.traceId !== "string") {
    await repository.updateThreadState(
      thread.id,
      JSON.stringify(parsed.data),
    );
  }
  return { threadId: thread.id, state: parsed.data };
}

export async function saveUnitAuthoringState(
  threadId: string,
  state: UnitAuthoringState,
): Promise<void> {
  await requireAgentConversationPersistence().updateThreadState(
    threadId,
    JSON.stringify(unitAuthoringStateSchema.parse(state)),
  );
}

/** Start a new durable authoring cycle so regeneration cannot replay accepted artifacts. */
export async function resetUnitAuthoringSession(input: {
  userId: string;
  unitId: string;
  goalId: string;
}): Promise<void> {
  const repository = requireAgentConversationPersistence();
  const session = await ensureUnitAuthoringSession(input);
  await repository.resetThread(
    session.threadId,
    JSON.stringify(initialState(input)),
  );
}

export async function appendUnitAuthoringMessage(input: {
  threadId: string;
  stage: UnitAuthoringStage;
  message: LlmMessageRecord;
  sectionId?: string;
  branchKind?:
    | "main"
    | "svg"
    | "component"
    | "html"
    | "notes"
    | "assessment"
    | "audit"
    | "repair";
}) {
  return requireAgentConversationPersistence().appendMessage(input.threadId, {
    role: input.message.role,
    content: input.message.content,
    toolCalls: JSON.stringify(input.message.toolCalls ?? []),
    toolCallId: input.message.toolCallId ?? null,
    uiPayload: "{}",
    metadataJson: JSON.stringify({
      conversationKind: UNIT_AUTHORING_THREAD_SCOPE,
      stage: input.stage,
      branchKind: input.branchKind ?? "main",
      ...(input.sectionId ? { sectionId: input.sectionId } : {}),
      ...(input.message.reasoningContent
        ? { reasoningContent: input.message.reasoningContent }
        : {}),
    }),
  });
}

export type StoredUnitAuthoringMessage = {
  id: string;
  stage: UnitAuthoringStage;
  branchKind: string;
  sectionId?: string;
  message: LlmMessageRecord;
};

export async function loadUnitAuthoringTranscriptRecords(
  threadId: string,
): Promise<StoredUnitAuthoringMessage[]> {
  const messages =
    await requireAgentConversationPersistence().listAllMessages(threadId);
  return messages.map((record) => {
    const metadata = JSON.parse(record.metadataJson || "{}") as {
      stage?: UnitAuthoringStage;
      branchKind?: string;
      sectionId?: string;
      reasoningContent?: unknown;
    };
    return {
      id: record.id,
      stage: metadata.stage ?? "section_material",
      branchKind: metadata.branchKind ?? "main",
      ...(metadata.sectionId ? { sectionId: metadata.sectionId } : {}),
      message: {
        role: z.enum(["system", "user", "assistant", "tool"]).parse(record.role),
        content: record.content,
        ...(record.toolCallId ? { toolCallId: record.toolCallId } : {}),
        ...(record.toolCalls && record.toolCalls !== "[]"
          ? { toolCalls: JSON.parse(record.toolCalls) }
          : {}),
        ...(typeof metadata.reasoningContent === "string"
          ? { reasoningContent: metadata.reasoningContent }
          : {}),
      },
    };
  });
}

export function messagesForAuthoringSection(
  records: readonly StoredUnitAuthoringMessage[],
  sectionId: string,
): LlmMessageRecord[] {
  return records
    .filter(
      (record) =>
        record.stage === "section_material" && record.sectionId === sectionId,
    )
    .map((record) => record.message);
}

export function filterTranscriptBeforeSection(
  records: readonly StoredUnitAuthoringMessage[],
  targetSectionId: string,
): LlmMessageRecord[] {
  const result: LlmMessageRecord[] = [];
  for (const record of records) {
    if (record.stage === "section_material") {
      if (record.sectionId === targetSectionId) {
        break;
      }
      if (!record.sectionId) {
        break;
      }
    }
    result.push(record.message);
  }
  return result;
}

export async function loadUnitAuthoringTranscript(
  threadId: string,
): Promise<LlmMessageRecord[]> {
  const records = await loadUnitAuthoringTranscriptRecords(threadId);
  return records.map((record) => record.message);
}

/** Immutable transcript prefix used by asynchronous SVG/audit branches. */
export async function snapshotUnitAuthoringBranch(input: {
  threadId: string;
  throughMessageId?: string;
}): Promise<LlmMessageRecord[]> {
  const records = await requireAgentConversationPersistence().listAllMessages(
    input.threadId,
  );
  const end = input.throughMessageId
    ? records.findIndex((record) => record.id === input.throughMessageId)
    : records.length - 1;
  if (input.throughMessageId && end < 0) {
    throw new Error("Unit authoring branch point was not found");
  }
  return records.slice(0, end + 1).map((message) => {
    const metadata = JSON.parse(message.metadataJson || "{}") as {
      reasoningContent?: unknown;
    };
    return {
      role: z.enum(["system", "user", "assistant", "tool"]).parse(message.role),
      content: message.content,
      ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
      ...(message.toolCalls && message.toolCalls !== "[]"
        ? { toolCalls: JSON.parse(message.toolCalls) }
        : {}),
      ...(typeof metadata.reasoningContent === "string"
        ? { reasoningContent: metadata.reasoningContent }
        : {}),
    };
  });
}
