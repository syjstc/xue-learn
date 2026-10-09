import type { AgentConversationRepository } from "../../../../domain/src/index.js";
import type { AgentRegistry } from "./agent-registry.js";
import { initRegistry, syncLegacyFlagsFromRegistry } from "./agent-registry.js";
import type { LlmMessageRecord } from "./types.js";

let configuredRepository: AgentConversationRepository | undefined;

export function configureAgentCheckpointPersistence(
  repository: AgentConversationRepository | undefined,
): void {
  configuredRepository = repository;
}

export function requireAgentConversationPersistence(): AgentConversationRepository {
  if (!configuredRepository) {
    throw new Error("Agent checkpoint persistence is not configured");
  }
  return configuredRepository;
}

export type ThreadCheckpoint = {
  llmMessages: LlmMessageRecord[];
  /** LLM trace id for the in-flight agent task; cleared when the task completes. */
  activeTraceId?: string;
  pendingInterrupt?: {
    toolCallId: string;
    toolName: string;
    uiKind: string;
    args: Record<string, unknown>;
  } | null;
  agentRegistry?: AgentRegistry;
  goalCreationActive?: boolean;
  goalCreationPaused?: boolean;
  goalCreationMessages?: LlmMessageRecord[];
  goalCreationPausedInterrupt?: ThreadCheckpoint["pendingInterrupt"];
  goalState?: Record<string, unknown>;
  mainMessages?: LlmMessageRecord[];
  [key: string]: unknown;
};

function migrateCheckpoint(checkpoint: ThreadCheckpoint): ThreadCheckpoint {
  return initRegistry(checkpoint);
}

export async function loadCheckpoint(
  threadId: string,
): Promise<ThreadCheckpoint> {
  const thread =
    await requireAgentConversationPersistence().findThread(threadId);
  if (!thread?.stateJson) {
    return migrateCheckpoint({ llmMessages: [] });
  }
  try {
    return migrateCheckpoint(JSON.parse(thread.stateJson) as ThreadCheckpoint);
  } catch {
    return migrateCheckpoint({ llmMessages: [] });
  }
}

export async function saveCheckpoint(
  threadId: string,
  checkpoint: ThreadCheckpoint,
): Promise<void> {
  const synced = syncLegacyFlagsFromRegistry(checkpoint);
  await requireAgentConversationPersistence().updateThreadState(
    threadId,
    JSON.stringify(synced),
  );
}

export async function appendAgentMessage(
  threadId: string,
  message: {
    role: string;
    content?: string;
    toolCalls?: unknown[];
    toolCallId?: string;
    uiPayload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
) {
  return requireAgentConversationPersistence().appendMessage(threadId, {
    role: message.role,
    content: message.content ?? "",
    toolCalls: JSON.stringify(message.toolCalls ?? []),
    toolCallId: message.toolCallId ?? null,
    uiPayload: JSON.stringify(message.uiPayload ?? {}),
    metadataJson: JSON.stringify(
      message.metadata ??
        (message.uiPayload?.uiKind === "knowledge_activity"
          ? {
              knowledgeActivity: (
                message.uiPayload.args as Record<string, unknown> | undefined
              )?.activity,
            }
          : {}),
    ),
  });
}

export async function loadThreadMessages(threadId: string) {
  return requireAgentConversationPersistence().listAllMessages(threadId);
}
