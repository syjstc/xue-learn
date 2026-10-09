import { createHash } from "node:crypto";

export type CompactPayload = {
  preview: string;
  hash: string;
};

export type UsageFields = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  reasoningTokens?: number;
  outputTps?: number;
};

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ unserializable: true, type: typeof value });
  }
}

export function compactPayload(
  value: unknown,
  previewChars: number,
): CompactPayload {
  const raw = stableStringify(value);
  return {
    preview:
      previewChars > 0 && raw.length > previewChars
        ? `${raw.slice(0, previewChars)}… [truncated ${raw.length - previewChars} chars]`
        : raw,
    hash: createHash("sha256").update(raw).digest("hex"),
  };
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function extractUsageFields(response: unknown): UsageFields {
  if (!response || typeof response !== "object") return {};
  const record = response as Record<string, unknown>;
  const usage = record.usage;
  const usageRecord =
    usage && typeof usage === "object"
      ? (usage as Record<string, unknown>)
      : undefined;
  const inputTokenDetails =
    usageRecord?.input_token_details &&
    typeof usageRecord.input_token_details === "object"
      ? (usageRecord.input_token_details as Record<string, unknown>)
      : undefined;
  const outputTokenDetails =
    usageRecord?.output_token_details &&
    typeof usageRecord.output_token_details === "object"
      ? (usageRecord.output_token_details as Record<string, unknown>)
      : undefined;
  const inputTokens = numberField(usageRecord?.input_tokens);
  const outputTokens = numberField(usageRecord?.output_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      numberField(usageRecord?.total_tokens) ??
      (inputTokens !== undefined || outputTokens !== undefined
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : undefined),
    cacheReadTokens: numberField(inputTokenDetails?.cache_read),
    cacheCreationTokens: numberField(inputTokenDetails?.cache_creation),
    reasoningTokens: numberField(outputTokenDetails?.reasoning),
    outputTps: numberField(record.outputTps),
  };
}

export function compactJsonColumn(
  value: unknown,
  preview: CompactPayload,
  usage?: UsageFields,
): string {
  const usagePayload =
    usage &&
    (usage.inputTokens !== undefined ||
      usage.outputTokens !== undefined ||
      usage.totalTokens !== undefined)
      ? {
          usage: {
            input_tokens: usage.inputTokens ?? 0,
            output_tokens: usage.outputTokens ?? 0,
            total_tokens:
              usage.totalTokens ??
              (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
            ...(usage.cacheReadTokens !== undefined ||
            usage.cacheCreationTokens !== undefined
              ? {
                  input_token_details: {
                    ...(usage.cacheReadTokens !== undefined
                      ? { cache_read: usage.cacheReadTokens }
                      : {}),
                    ...(usage.cacheCreationTokens !== undefined
                      ? { cache_creation: usage.cacheCreationTokens }
                      : {}),
                  },
                }
              : {}),
            output_token_details: {
              reasoning: usage.reasoningTokens ?? 0,
            },
          },
          outputTps: usage.outputTps,
        }
      : {};
  const truncated = /\[truncated \d+ chars\]/.test(preview.preview);
  return JSON.stringify({
    compact: true,
    // Prefer the structured object when the full payload fits the preview budget
    // so admin LLM logs can expand nested JSON instead of a double-encoded string.
    preview: truncated ? preview.preview : value,
    hash: preview.hash,
    ...usagePayload,
  });
}
