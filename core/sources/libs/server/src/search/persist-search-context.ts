import type { ContentSource } from "../rag/content-sources.js";
import {
  deleteAllChunksByMetadata,
  deleteChunksByMetadata,
} from "../rag/vector-store.js";
import { ingestText } from "../rag/ingest.js";
import { requireRagDocuments } from "../rag/persistence.js";

export const WEB_SEARCH_REFERENCE_FILENAME = "网页搜索参考.md";

export async function goalHasPersistedSearchContext(
  goalId: string,
): Promise<boolean> {
  const count = await requireRagDocuments().countByGoal(goalId, {
    filename: WEB_SEARCH_REFERENCE_FILENAME,
  });
  return count > 0;
}

export async function goalHasUserUploadedDocuments(
  goalId: string,
): Promise<boolean> {
  const count = await requireRagDocuments().countByGoal(goalId, {
    excludeFilename: WEB_SEARCH_REFERENCE_FILENAME,
  });
  return count > 0;
}

export async function deleteLegacyPersistedSearchContext(
  goalId: string,
): Promise<void> {
  await deleteAllChunksByMetadata("goal", goalId, { source: "web_search" });
  await requireRagDocuments().deleteByFilename(
    goalId,
    WEB_SEARCH_REFERENCE_FILENAME,
  );
}

async function deletePersistedSearchChunks(goalId: string): Promise<void> {
  try {
    await deleteChunksByMetadata("goal", goalId, { source: "web_search" });
  } catch (err) {
    console.warn(
      "[search] failed to delete prior web-search chunks:",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Index Tavily results into the goal RAG collection for later unit generations. */
export async function persistSearchContextAsDocument(
  goalId: string,
  context: string,
  sources: ContentSource[] = [],
): Promise<number> {
  const trimmed = context.trim();
  if (!trimmed) return 0;

  const sourceLines = sources
    .map((s, i) => {
      const label = s.title?.trim() || s.url?.trim() || `Source ${i + 1}`;
      return s.url ? `- ${label} (${s.url})` : `- ${label}`;
    })
    .filter(Boolean);
  const text =
    sourceLines.length > 0
      ? `${trimmed}\n\nSources:\n${sourceLines.join("\n")}`
      : trimmed;

  await deletePersistedSearchChunks(goalId);

  const chunks = await ingestText(goalId, text, {
    filename: WEB_SEARCH_REFERENCE_FILENAME,
    source: "web_search",
  });

  const documents = requireRagDocuments();
  const existing = await documents.findByFilename(
    goalId,
    WEB_SEARCH_REFERENCE_FILENAME,
  );
  if (!existing) {
    await documents.create({
      goalId,
      filename: WEB_SEARCH_REFERENCE_FILENAME,
      sourceType: "file",
      sourceUrl: null,
      canonicalUrl: null,
      provider: null,
      title: null,
      warning: null,
      subtitleStatus: null,
    });
  }

  return chunks;
}
