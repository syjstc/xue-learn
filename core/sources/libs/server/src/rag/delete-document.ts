import type { LearningGoalMutationPort } from "../../../domain/src/index.js";
import {
  goalHasPersistedSearchContext,
  goalHasUserUploadedDocuments,
} from "../search/persist-search-context.js";
import { deleteChunksByMetadata } from "./vector-store.js";
import { sourceId } from "./url-source.js";
import { requireRagDocuments } from "./persistence.js";

async function resolvePathSourceAfterDocumentDelete(
  goalId: string,
): Promise<"rag" | "search" | "generic"> {
  if (await goalHasUserUploadedDocuments(goalId)) return "rag";
  if (await goalHasPersistedSearchContext(goalId)) return "search";
  return "generic";
}

export async function deleteGoalUploadedDocument(
  goalId: string,
  documentId: string,
  options?: Readonly<{
    userId?: string;
    goalMutations?: LearningGoalMutationPort;
  }>,
): Promise<{ filename: string }> {
  const documents = requireRagDocuments();
  const document = await documents.findById(goalId, documentId);
  if (!document) {
    throw new Error("DOCUMENT_NOT_FOUND");
  }

  const { filename } = document;

  try {
    await deleteChunksByMetadata(
      "goal",
      goalId,
      document.canonicalUrl
        ? { sourceId: sourceId(document.canonicalUrl) }
        : { filename },
    );
  } catch (err) {
    console.warn(
      "[rag] failed to delete chunks for document:",
      err instanceof Error ? err.message : err,
    );
  }

  await documents.delete(goalId, documentId);

  const pathSource = await resolvePathSourceAfterDocumentDelete(goalId);
  if (!options?.userId || !options.goalMutations) {
    throw new Error("Goal mutation persistence is not configured.");
  }
  const updated = await options.goalMutations.updateOwnedSemantic({
    userId: options.userId,
    goalId,
    patch: { pathSource },
  });
  if (!updated) throw new Error("GOAL_NOT_FOUND");

  return { filename };
}
