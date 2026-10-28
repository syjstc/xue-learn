import type { z } from "zod";
import type { TopicCategory } from "../../../common/src/index.js";
import type { StreamTokenHandler } from "./chat-stream.js";
import { streamStructured } from "./structured-stream.js";
import type {
  ResolvedStructuredContract,
  StructuredContractMetadata,
} from "./structured-contract.js";

/** Options shared by invoke and stream structured LLM output. */
export type StructuredOutputOptions = {
  operation: string;
  /** Example JSON for prompt-based fallback when native structured output is unavailable. */
  schemaShape?: string;
  /**
   * Structural schema used for provider-native binding. This may omit
   * cross-field refinements that the final schema still validates after the
   * provider returns a candidate.
   */
  bindingSchema?: z.ZodType | Record<string, unknown>;
  /**
   * For DeepSeek, require strict forced-function transport and fail closed
   * instead of falling back to JSON mode or prompt-authored JSON.
   */
  deepseekStrictOnly?: boolean;
  meta?: Record<string, unknown>;
  topicCategory?: TopicCategory | null;
  contract?: StructuredContractMetadata;
  /** Resolved by the validated gateway; internal callers should not set this. */
  resolvedContract?: ResolvedStructuredContract;
};

export type StructuredOutputHandlers = {
  /** Called immediately before each provider attempt, excluding skipped fallbacks. */
  onAttempt?: () => void;
  /** Meaningful stream activity for a containing idle deadline. */
  onProgress?: () => void;
  onToken?: StreamTokenHandler;
  /** Provider-native best-effort candidate snapshots while arguments stream. */
  onPartial?: (partial: unknown) => void | Promise<void>;
  signal?: AbortSignal;
};

/**
 * Parse structured LLM JSON with optional token streaming.
 * Non-streaming callers omit handlers; UI progress uses onToken.
 */
export async function runStructuredOutput<T extends z.ZodType>(
  schema: T,
  prompt: string,
  options: StructuredOutputOptions,
  handlers?: StructuredOutputHandlers,
): Promise<z.infer<T>> {
  return streamStructured(
    schema,
    prompt,
    options.operation,
    {
      ...(options.meta ?? {}),
      ...(options.topicCategory !== undefined
        ? { topicCategory: options.topicCategory }
        : {}),
    },
    handlers?.onToken,
    handlers?.signal,
    options.schemaShape,
    handlers?.onPartial,
    options.bindingSchema,
    options.resolvedContract,
    options.deepseekStrictOnly,
    handlers?.onAttempt,
    handlers?.onProgress,
  );
}
