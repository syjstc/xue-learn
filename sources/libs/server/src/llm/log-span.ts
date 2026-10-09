import type { LlmLogKind } from "./logger.js";
import { labelForOperation, toolNameFromOperation } from "./parse-log-response.js";

export type LlmSpanType = "llm" | "tool" | "parse" | "embedding";

export function spanTypeForKind(
  kind: LlmLogKind,
  operation: string
): LlmSpanType {
  if (operation.endsWith(".parse")) return "parse";
  if (kind === "embedding") return "embedding";
  if (kind === "search" || kind === "rag") return "tool";
  return "llm";
}

export function spanMetaForPayload(
  kind: LlmLogKind,
  operation: string
): { spanType: LlmSpanType; label: string; toolName?: string } {
  const spanType = spanTypeForKind(kind, operation);
  return {
    spanType,
    label: labelForOperation(operation, kind),
    toolName: toolNameFromOperation(operation),
  };
}
