import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAgentConversationPersistence } from "../agents/core/checkpoint.js";
import type { LlmMessageRecord } from "../agents/core/types.js";

export const GOAL_AUTHORING_THREAD_SCOPE = "goal_authoring";

const goalAuthoringStateSchema = z.object({
  schemaVersion: z.literal(1),
  goalId: z.string().min(1),
  traceId: z.string().uuid(),
  blueprintMessageId: z.string().nullable().default(null),
});

export type GoalAuthoringState = z.infer<typeof goalAuthoringStateSchema>;

export function alignGoalAuthoringBranchTrace(
  branch: GoalAuthoringState,
  rootTraceId: string,
): GoalAuthoringState {
  return branch.traceId === rootTraceId
    ? branch
    : { ...branch, traceId: rootTraceId };
}

function initialState(goalId: string, traceId?: string): GoalAuthoringState {
  return {
    schemaVersion: 1,
    goalId,
    traceId: traceId ?? randomUUID(),
    blueprintMessageId: null,
  };
}

export async function ensureGoalAuthoringSession(input: {
  userId: string;
  goalId: string;
  branchId?: string;
  traceId?: string;
}) {
  const scopeId = input.branchId
    ? `${input.goalId}:branch:${input.branchId}`
    : input.goalId;
  const repository = requireAgentConversationPersistence();
  const thread = await repository.findOrCreateScopedThread({
    userId: input.userId,
    scope: GOAL_AUTHORING_THREAD_SCOPE,
    scopeId,
    stateJson: JSON.stringify(initialState(input.goalId, input.traceId)),
  });
  const parsed = goalAuthoringStateSchema.parse(
    JSON.parse(thread.stateJson || "{}"),
  );
  if (parsed.goalId !== input.goalId)
    throw new Error("Goal authoring ownership mismatch");
  return { threadId: thread.id, state: parsed };
}

export async function saveGoalAuthoringState(
  threadId: string,
  state: GoalAuthoringState,
) {
  await requireAgentConversationPersistence().updateThreadState(
    threadId,
    JSON.stringify(goalAuthoringStateSchema.parse(state)),
  );
}

export async function loadGoalAuthoringMessages(
  threadId: string,
): Promise<LlmMessageRecord[]> {
  const rows =
    await requireAgentConversationPersistence().listAllMessages(threadId);
  return rows.map((row) => {
    const metadata = JSON.parse(row.metadataJson || "{}") as {
      reasoningContent?: unknown;
    };
    return {
      role: z.enum(["system", "user", "assistant", "tool"]).parse(row.role),
      content: row.content,
      ...(row.toolCallId ? { toolCallId: row.toolCallId } : {}),
      ...(row.toolCalls && row.toolCalls !== "[]"
        ? { toolCalls: JSON.parse(row.toolCalls) }
        : {}),
      ...(typeof metadata.reasoningContent === "string"
        ? { reasoningContent: metadata.reasoningContent }
        : {}),
    };
  });
}

export async function appendGoalAuthoringMessage(input: {
  threadId: string;
  message: LlmMessageRecord;
  branchKind: "main" | "module" | "audit" | "repair";
}) {
  return requireAgentConversationPersistence().appendMessage(input.threadId, {
    role: input.message.role,
    content: input.message.content,
    toolCalls: JSON.stringify(input.message.toolCalls ?? []),
    toolCallId: input.message.toolCallId ?? null,
    uiPayload: "{}",
    metadataJson: JSON.stringify({
      conversationKind: GOAL_AUTHORING_THREAD_SCOPE,
      branchKind: input.branchKind,
      ...(input.message.reasoningContent
        ? { reasoningContent: input.message.reasoningContent }
        : {}),
    }),
  });
}

export async function seedGoalAuthoringBranch(input: {
  userId: string;
  goalId: string;
  branchId: string;
}): Promise<{
  threadId: string;
  state: GoalAuthoringState;
  messages: LlmMessageRecord[];
}> {
  const root = await ensureGoalAuthoringSession({
    userId: input.userId,
    goalId: input.goalId,
  });
  if (!root.state.blueprintMessageId)
    throw new Error("Goal blueprint branch point is unavailable");
  const rootRows = await requireAgentConversationPersistence().listAllMessages(
    root.threadId,
  );
  const end = rootRows.findIndex(
    (row) => row.id === root.state.blueprintMessageId,
  );
  if (end < 0) throw new Error("Goal blueprint branch point was not found");
  const branch = await ensureGoalAuthoringSession({
    ...input,
    branchId: `${input.branchId}:blueprint:${root.state.blueprintMessageId}`,
    traceId: root.state.traceId,
  });
  const branchState = alignGoalAuthoringBranchTrace(
    branch.state,
    root.state.traceId,
  );
  if (branchState !== branch.state) {
    await saveGoalAuthoringState(branch.threadId, branchState);
  }
  let messages = await loadGoalAuthoringMessages(branch.threadId);
  if (messages.length === 0) {
    const rootMessages = await loadGoalAuthoringMessages(root.threadId);
    for (const message of rootMessages.slice(0, end + 1)) {
      await appendGoalAuthoringMessage({
        threadId: branch.threadId,
        message,
        branchKind: "main",
      });
    }
    messages = await loadGoalAuthoringMessages(branch.threadId);
  }
  return { ...branch, state: branchState, messages };
}
