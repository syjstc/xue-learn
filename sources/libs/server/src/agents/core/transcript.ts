import type { LlmMessageRecord } from "./types.js";

function toolCallIds(record: LlmMessageRecord): Set<string> {
  return new Set(
    (record.toolCalls ?? [])
      .map((call) => call.id)
      .filter((id) => id.trim().length > 0),
  );
}

/**
 * Same-millisecond AgentMessage inserts can sort `tool` ahead of its assistant
 * `tool_calls` when the only stable order is `createdAt, id`. Swap those
 * adjacent inversions before dropping orphans.
 */
export function restoreAdjacentToolCallOrder(
  records: readonly LlmMessageRecord[],
): LlmMessageRecord[] {
  const restored: LlmMessageRecord[] = [];
  for (let i = 0; i < records.length; i += 1) {
    const current = records[i];
    const next = records[i + 1];
    if (
      current?.role === "tool" &&
      next?.role === "assistant" &&
      current.toolCallId &&
      toolCallIds(next).has(current.toolCallId)
    ) {
      restored.push(next, current);
      i += 1;
      continue;
    }
    restored.push(current);
  }
  return restored;
}

/**
 * Drop tool results that are not an immediate, complete reply to the preceding
 * assistant `tool_calls`. OpenAI-compatible providers 400 otherwise.
 */
export function repairLlmTranscript(
  records: readonly LlmMessageRecord[],
): LlmMessageRecord[] {
  const ordered = restoreAdjacentToolCallOrder(records);
  const repaired: LlmMessageRecord[] = [];

  for (let i = 0; i < ordered.length; i += 1) {
    const record = ordered[i];

    if (record.role === "tool") {
      continue;
    }

    if (record.role !== "assistant" || !record.toolCalls?.length) {
      repaired.push(record);
      continue;
    }

    const expectedIds = toolCallIds(record);
    const toolResults: LlmMessageRecord[] = [];
    let j = i + 1;

    while (j < ordered.length && ordered[j].role === "tool") {
      const toolResult = ordered[j];
      if (toolResult.toolCallId && expectedIds.has(toolResult.toolCallId)) {
        toolResults.push(toolResult);
      }
      j += 1;
    }

    const matchedIds = new Set(toolResults.map((m) => m.toolCallId));
    const hasAllResults =
      expectedIds.size > 0 &&
      expectedIds.size === record.toolCalls.length &&
      [...expectedIds].every((id) => matchedIds.has(id));

    if (hasAllResults) {
      repaired.push(record, ...toolResults);
      i = j - 1;
      continue;
    }

    if (record.content.trim()) {
      repaired.push({ role: "assistant", content: record.content });
    }
  }

  return repaired;
}
