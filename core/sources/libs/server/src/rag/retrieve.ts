import { beginRagRequestLog } from "../llm/request-log.js";
import {
  type ContentSource,
  formatRetrievedDocs,
  sourcesFromRagDocs,
} from "./content-sources.js";
import {
  getCollectionDocumentCount,
  queryCollection,
  queryScopedCollectionByMetadata,
} from "./vector-store.js";
import { requireRagDocuments } from "./persistence.js";

export type RetrievedUnitContext = {
  context: string;
  sources: ContentSource[];
  /** How reference context was obtained for this call. */
  mode: "rag" | "search" | "none";
};

/** True when the goal has uploaded documents indexed (or recorded) for RAG. */
export async function goalHasRagDocuments(goalId: string): Promise<boolean> {
  const count = await requireRagDocuments().countByGoal(goalId);
  return count > 0;
}

export async function retrieveForUnitWithSources(
  goalId: string,
  unitTitle: string,
  extraQuery?: string,
  k = 4,
  options: { metadataFilter?: Record<string, string> } = {},
): Promise<RetrievedUnitContext> {
  if (!(await goalHasRagDocuments(goalId))) {
    return { context: "", sources: [], mode: "none" };
  }

  const query = extraQuery
    ? `${unitTitle}: ${extraQuery}`
    : `Learning content about: ${unitTitle}`;
  const logHandle = await beginRagRequestLog({
    operation: "rag.retrieve",
    request: { goalId, unitTitle, query, k },
    meta: { goalId, mode: "retrieve" },
  });
  const started = Date.now();
  try {
    const collectionCount = await getCollectionDocumentCount(goalId);
    const docs = options.metadataFilter
      ? await queryScopedCollectionByMetadata(
          "goal",
          goalId,
          query,
          options.metadataFilter,
          k,
        )
      : await queryCollection(goalId, query, k);
    const sources = sourcesFromRagDocs(docs);
    const text = docs.length === 0 ? "" : formatRetrievedDocs(docs);
    if (collectionCount === 0) {
      console.warn(
        `[rag] goal ${goalId} has uploadedDocument rows but pgvector scope is empty — re-upload the file(s)`,
      );
    } else {
      console.info(
        `[rag] Retrieved ${docs.length}/${collectionCount} chunks for goal ${goalId} (${sources.length} source(s), ${text.length} context chars, ${Date.now() - started}ms)`,
      );
    }
    await logHandle?.finish({
      status: "success",
      durationMs: Date.now() - started,
      response: {
        hitCount: docs.length,
        collectionCount,
        sources,
        promptContext: text,
        contextChars: text.length,
      },
    });
    return {
      context: text,
      sources,
      mode: text ? "rag" : "none",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logHandle?.finish({
      status: "error",
      durationMs: Date.now() - started,
      error: message,
    });
    console.warn(
      "[rag] pgvector unavailable, continuing without retrieved context:",
      message,
    );
    return { context: "", sources: [], mode: "none" };
  }
}

/** Retrieve only learner-uploaded files, excluding indexed web-search context. */
export async function retrieveUploadedForUnitWithSources(
  goalId: string,
  unitTitle: string,
  extraQuery?: string,
  k = 4,
): Promise<RetrievedUnitContext> {
  return retrieveForUnitWithSources(goalId, unitTitle, extraQuery, k, {
    metadataFilter: { source: "upload" },
  });
}

export async function retrieveForUnit(
  goalId: string,
  unitTitle: string,
  extraQuery?: string,
  k = 4,
): Promise<string> {
  const { context } = await retrieveForUnitWithSources(
    goalId,
    unitTitle,
    extraQuery,
    k,
  );
  return context;
}

/** Uploaded-doc RAG only (SQ, Cornell, quiz, follow-up, subdivide, etc.). */
export async function retrieveContextForUnitWithSources(
  goalId: string,
  unitTitle: string,
  extraQuery?: string,
  k = 4,
): Promise<RetrievedUnitContext> {
  return retrieveForUnitWithSources(goalId, unitTitle, extraQuery, k);
}

export async function retrieveContextForUnit(
  goalId: string,
  unitTitle: string,
  extraQuery?: string,
  k = 4,
): Promise<string> {
  const { context } = await retrieveContextForUnitWithSources(
    goalId,
    unitTitle,
    extraQuery,
    k,
  );
  return context;
}

/**
 * Reference context for interactive learning material.
 * Uses indexed uploads and persisted web-search docs only — no live Tavily calls.
 */
export async function retrieveMaterialReferenceWithSources(
  goalId: string,
  unitTitle: string,
  extraQuery?: string,
  k = 4,
): Promise<RetrievedUnitContext> {
  return retrieveForUnitWithSources(goalId, unitTitle, extraQuery, k);
}

export async function retrieveMaterialReference(
  goalId: string,
  unitTitle: string,
  extraQuery?: string,
  k = 4,
): Promise<string> {
  const { context } = await retrieveMaterialReferenceWithSources(
    goalId,
    unitTitle,
    extraQuery,
    k,
  );
  return context;
}
