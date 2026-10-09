import { parseJson } from "../utils.js";
import {
  deleteAllChunksByMetadata,
  deleteScopedCollectionOrThrow,
  type RagScope,
} from "./vector-store.js";

export const RAG_SCOPE_CLEANUP_EVENT = "rag.scope.cleanup";

export type RagScopeCleanupPayload = {
  scope: RagScope;
  scopeId: string;
  reason: "account_delete" | "goal_delete" | "source_delete";
  metadataFilter?: Record<string, string>;
};

const LEGACY_STOPPED_GOAL_CREATION_DELETE =
  "stopped_goal_creation_delete" as const;

export async function processRagScopeCleanupEvent(
  payloadJson: string,
): Promise<void> {
  const payload = parseJson<
    | RagScopeCleanupPayload
    | (Omit<RagScopeCleanupPayload, "reason"> & {
        reason: typeof LEGACY_STOPPED_GOAL_CREATION_DELETE;
      })
    | null
  >(payloadJson, null);
  if (
    !payload?.scopeId ||
    (payload.scope !== "goal" &&
      payload.scope !== "learned" &&
      payload.scope !== "web_knowledge") ||
    (payload.reason !== "account_delete" &&
      payload.reason !== "goal_delete" &&
      payload.reason !== "source_delete" &&
      payload.reason !== LEGACY_STOPPED_GOAL_CREATION_DELETE)
  ) {
    throw new Error("invalid rag.scope.cleanup payload");
  }
  if (payload.metadataFilter) {
    await deleteAllChunksByMetadata(
      payload.scope,
      payload.scopeId,
      payload.metadataFilter,
    );
    return;
  }
  await deleteScopedCollectionOrThrow(payload.scope, payload.scopeId);
}
