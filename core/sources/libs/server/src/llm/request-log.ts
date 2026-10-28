import {
  beginLlmRequestLog,
  logLlmRequest,
  type LlmLogPayload,
  type LlmLogStartPayload,
  type LlmRequestLogHandle,
} from "./logger.js";

type ToolLogPayload = Omit<LlmLogPayload, "kind">;
type ToolLogStartPayload = Omit<LlmLogStartPayload, "kind">;

/** Start a Tavily web-search log row (finish when the search completes). */
export async function beginSearchRequestLog(
  payload: ToolLogStartPayload,
): Promise<LlmRequestLogHandle | undefined> {
  return beginLlmRequestLog({ ...payload, kind: "search" });
}

/** Start a pgvector RAG log row (finish when retrieve/ingest completes). */
export async function beginRagRequestLog(
  payload: ToolLogStartPayload,
): Promise<LlmRequestLogHandle | undefined> {
  return beginLlmRequestLog({ ...payload, kind: "rag" });
}

/** Tavily web search (goal path or unit context). */
export async function logSearchRequest(payload: ToolLogPayload): Promise<void> {
  await logLlmRequest({ ...payload, kind: "search" });
}

/** pgvector RAG retrieve or ingest. */
export async function logRagRequest(payload: ToolLogPayload): Promise<void> {
  await logLlmRequest({ ...payload, kind: "rag" });
}

export type { LlmLogKind, LlmLogPayload } from "./logger.js";
