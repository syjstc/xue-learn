import { z } from "zod";
import {
  canonicalLlmOperationKey,
  getActiveLlmOperationRoute,
  getLlmProvider,
  markActiveLlmRouteOutputStarted,
  withLlmOperationRoute,
} from "../providers/llm/index.js";
import {
  GenerationCancelledError,
  isGenerationCancelled,
} from "../generation/errors.js";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import type { StreamTokenHandler } from "./chat-stream.js";
import { streamChat } from "./chat-stream.js";
import {
  patchActiveLlmRecoveryMetadata,
  patchActiveLlmStructuredOutcome,
} from "./logger.js";
import { isJsonSchemaCompatible } from "./json-schema-compat.js";
import { JsonArrayStreamAccumulator } from "./json-array-stream.js";
import { JsonLinesStreamAccumulator } from "./json-lines-stream.js";
import {
  formatStructuredParseError,
  type StructuredGenerationStage,
} from "./parse-structured.js";
import {
  buildValidationReport,
  formatValidationReportForModel,
  type ValidationIssue,
} from "./validation-report.js";
import { unwrapStructuredArrayCandidate } from "./sanitize-response.js";
import {
  runStructuredOutput,
  type StructuredOutputOptions,
} from "./structured-output.js";
import { streamStructuredNative } from "./structured-native.js";
import {
  normalizeExactDuplicates,
  PositionalRepairError,
  runSinglePositionalRepair,
  type PositionalRepairSlot,
  type StructuredIssueCategory,
  zodIssueCategories,
} from "./structured-recovery.js";
import {
  createStructuredDeadline,
  resolveStructuredContract,
  type ResolvedStructuredContract,
  type StructuredContractMetadata,
  StructuredOutputLimitError,
  structuredContractLogMeta,
} from "./structured-contract.js";
import { runMergedGenerationContextScope } from "../generation/kernel.js";
import type { LearningSystemSubject } from "../learning-systems/types.js";
import {
  getLlmTrace,
  runWithLlmTraceAsync,
} from "./trace-context.js";
import { getRequestContext } from "../observability/index.js";

export const STRUCTURED_REPAIR_MAX_ATTEMPTS = 2;

function isAbortError(error: unknown): boolean {
  return (
    isGenerationCancelled(error) ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function normalizedCancellationError(error: unknown): GenerationCancelledError {
  return error instanceof GenerationCancelledError
    ? error
    : new GenerationCancelledError();
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new GenerationCancelledError();
}

function isStructuredNativeOutputError(error: unknown): boolean {
  return error instanceof Error && error.name === "StructuredNativeOutputError";
}

function nativeJsonBindingSchema(
  schema: z.ZodType,
): Record<string, unknown> | undefined {
  if (!isJsonSchemaCompatible(schema)) return undefined;
  return toJsonSchema(schema) as Record<string, unknown>;
}

function sanitizedStructuredIssues(error: unknown): string[] {
  if (error instanceof StructuredOutputLimitError) {
    return sanitizeIssues([error.message]);
  }
  if (error instanceof z.ZodError) {
    return sanitizeIssues([formatStructuredParseError(error)]);
  }
  // Keep the real failure reason for non-validation errors (transport,
  // persistence, routing, ...) instead of masking it with a generic message.
  const formatted = formatStructuredParseError(error);
  return sanitizeIssues(
    formatted ? [formatted] : ["response: invalid structured output"],
  );
}

function structuredIssuesFromError(
  error: unknown,
  candidate?: unknown,
): ValidationIssue[] {
  if (error instanceof z.ZodError) {
    return buildValidationReport(error, candidate).issues;
  }
  return [
    {
      code: structuredFailureCategory(error),
      path: "response",
      message: formatStructuredParseError(error),
    },
  ];
}

function structuredFailureCategory(error: unknown): string {
  if (isAbortError(error)) return "cancellation";
  if (error instanceof StructuredOutputLimitError) {
    return error.code === "ATTEMPT_TIMEOUT" ? "timeout" : "resource_limit";
  }
  const status =
    error && typeof error === "object"
      ? Number(
          (error as { status?: unknown; statusCode?: unknown }).statusCode ??
            (error as { status?: unknown }).status,
        )
      : Number.NaN;
  if (status === 401 || status === 403) return "authorization";
  // Native transports retain a candidate hash only after receiving a complete
  // candidate and reaching schema validation. Their formatted error text does
  // not necessarily contain the word "validation" (for example target errors).
  if (
    error instanceof z.ZodError ||
    (isStructuredNativeOutputError(error) &&
      typeof (error as { candidateHash?: unknown }).candidateHash === "string")
  ) {
    return "validation";
  }
  const message = formatStructuredParseError(error).toLowerCase();
  if (message.includes("repeated")) return "repeated_output";
  if (
    error instanceof Error &&
    isStructuredNativeOutputError(error.cause)
  ) {
    return structuredFailureCategory(error.cause);
  }
  if (message.includes("empty") || message.includes("no parsed payload"))
    return "empty_output";
  if (message.includes("budget") || message.includes("exhausted"))
    return "budget_exhaustion";
  if (message.includes("timeout") || message.includes("attempt exceeded"))
    return "timeout";
  if (message.includes("validation")) return "validation";
  return "provider_or_transport";
}

export function isRetryableToolPayloadError(error: unknown): boolean {
  if (error instanceof SyntaxError || error instanceof z.ZodError) return true;
  const message = formatStructuredParseError(error).toLowerCase();
  return (
    message.includes("in json at position") ||
    message.includes("json parse") ||
    message.includes("invalid json") ||
    message.includes("unterminated string") ||
    message.includes("expected ':' after property name") ||
    message.includes("expected ',' or '}'") ||
    message.includes("no number after minus sign") ||
    message.includes("must call exactly one") ||
    message.includes("invalid_tool_results") ||
    message.includes("too small") ||
    message.includes("material requires") ||
    (message.includes("svg edit") &&
      (message.includes("oldtext was not found") ||
        message.includes("oldtext is not unique"))) ||
    message.includes("failed server validation")
  );
}

function sanitizeIssue(issue: unknown): string {
  const value = String(issue)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (value || "response: invalid structured output").slice(0, 600);
}

function sanitizeIssues(issues: readonly unknown[]): string[] {
  return issues.slice(0, 20).map(sanitizeIssue);
}

export class StructuredGenerationError extends Error {
  readonly retryable = true;
  readonly issues: string[];

  constructor(
    public readonly operation: string,
    public readonly stage: StructuredGenerationStage,
    public readonly attempts: number,
    issues: string[],
  ) {
    const sanitizedIssues = sanitizeIssues(issues);
    super(
      `${operation} structured generation failed during ${stage} after ${attempts} attempt(s): ${sanitizedIssues.join("; ")}`,
    );
    this.name = "StructuredGenerationError";
    this.issues = sanitizedIssues;
  }
}

export type StructuredGenerationHandlers<TItem, TPartial, TResult> = {
  onToken?: StreamTokenHandler;
  onValidItem?: (item: TItem, index: number) => void | Promise<void>;
  onPartial?: (partial: TPartial) => void | Promise<void>;
  onFinal?: (result: TResult) => void | Promise<void>;
  signal?: AbortSignal;
};

type FinalStructuredGenerationHandlers<TResult> = Pick<
  StructuredGenerationHandlers<never, never, TResult>,
  "onToken" | "onFinal" | "signal"
> & {
  /** Raw provider-native object snapshots; final schema validation happens later. */
  onPartial?: (partial: unknown) => void | Promise<void>;
};

export type ObjectContract<TResult> = {
  mode: "object";
  schema: z.ZodType<TResult>;
  prompt: string;
  options: StructuredOutputOptions;
  recoveryPolicy?: ObjectRecoveryPolicy;
  contextSubject?: LearningSystemSubject;
  contextQuery?: string;
  contextInvocation?: unknown;
};

export type ObjectRepairSlot = {
  slot: PositionalRepairSlot<unknown>;
  apply: (root: unknown, value: unknown) => unknown;
};

export type ObjectRecoveryPolicy = {
  /** Capture an addressable JSON candidate before authoritative validation. */
  sourceSchema?: z.ZodType<unknown>;
  /** Deterministic, meaning-preserving cleanup performed before repair. */
  normalize?: (candidate: unknown) => {
    value: unknown;
    normalizedCount?: number;
    droppedCount?: number;
  };
  /** Build server-owned slots for only the invalid or missing values. */
  repairSlots: (params: {
    candidate: unknown;
    error: z.ZodError;
  }) => ObjectRepairSlot[];
};

export type ItemArrayContract<TItem, TPartial, TResult> = {
  mode: "item-array";
  operation: string;
  prompt: string;
  itemSchema: z.ZodType<TItem>;
  /** JSON-schema-safe item contract used for provider-native binding. */
  bindingItemSchema?: z.ZodType<TItem>;
  /**
   * Optional provider-native envelope. The provider sees this schema while the
   * validated item pipeline receives its normalized `{items:[...]}` form.
   */
  nativeEnvelopeBindingSchema?: z.ZodType | Record<string, unknown>;
  normalizeNativeEnvelopeCandidate?: (candidate: unknown) => unknown;
  resultSchema: z.ZodType<TResult>;
  assemble: (items: TItem[]) => unknown;
  assemblePartial?: (
    items: TItem[],
    placeholderCount: number,
  ) => TPartial | null;
  semanticValidate?: (
    items: TItem[],
  ) => string[] | void | Promise<string[] | void>;
  recoveryPolicy?: ItemArrayRecoveryPolicy<TItem>;
  meta?: Record<string, unknown>;
  repairContext?: string;
  maxRepairAttempts?: number;
  /**
   * Long arrays stream more reliably as prompt JSON on providers whose native
   * function-call transport buffers or truncates tool arguments.
   */
  preferRawStream?: boolean;
  /** Cap provider-native attempts before prompt-JSON fallback. Defaults to 2. */
  nativeAttemptLimit?: number;
  /**
   * Prefer schema-constrained native transports. Defaults on when a native
   * envelope exists. Growing arrays of unconstrained objects must turn this
   * off: DeepSeek/OpenAI strict cannot keep extra per-item fields.
   */
  preferSchemaConstrained?: boolean;
  /**
   * For DeepSeek, require the provider-native strict function transport and
   * fail closed instead of falling back to prompt JSON.
   */
  deepseekStrictOnly?: boolean;
  /**
   * Preserve every addressable valid item and repair only invalid or missing
   * item slots. Never ask the model to rewrite an unusable root/envelope.
   */
  repairInvalidItemsOnly?: boolean;
  /** Wire format for prompt-based item streaming. Defaults to a root array. */
  rawStreamFormat?: "json-array" | "json-lines";
  /** Regenerate only when the root is unusable and no valid item is addressable. */
  regenerateOnFailure?: boolean;
  contract?: StructuredContractMetadata;
  contextSubject?: LearningSystemSubject;
  contextQuery?: string;
  contextInvocation?: unknown;
};

export type MissingItemRepair<TItem> = {
  description: string;
  schema?: z.ZodType<TItem>;
  expectedShape?: string;
  insertAt?: number;
};

export type InvalidItemRepair<TItem> = {
  index: number;
  description: string;
  schema?: z.ZodType<TItem>;
};

export type ItemArrayRecoveryPolicy<TItem> = {
  /** Normalize one raw source value before item validation. */
  normalizeItem?: (value: unknown) => unknown;
  /** Apply deterministic collection cleanup after item validation/repair. */
  normalize?: (items: TItem[]) => {
    items: TItem[];
    normalizedCount?: number;
    droppedCount?: number;
  };
  /** Keep the first exact duplicate and discard later copies. */
  dedupeExact?: boolean;
  /** Keep the first N normalized items without a model repair call. */
  maxItems?: number;
  /**
   * Mark collection-context-invalid items for positional replacement while
   * preserving every other valid source position.
   */
  invalidItems?: (params: {
    items: ReadonlyArray<TItem | undefined>;
    sourceItems: readonly unknown[];
  }) => InvalidItemRepair<TItem>[];
  /** Describe required logical items that are definitely missing. */
  missingItems?: (params: {
    validItems: TItem[];
    sourceItems: unknown[];
  }) => MissingItemRepair<TItem>[];
};

export type ToolCallContract<TResult> = {
  mode: "tool-call";
  operation: string;
  schema: z.ZodType<TResult>;
  invoke: (params: {
    attempt: number;
    validationError?: string;
    signal?: AbortSignal;
    /** Provider output budget for this bounded structured attempt. */
    maxTokens?: number;
  }) => Promise<unknown>;
  maxRepairAttempts?: number;
  contract?: StructuredContractMetadata;
  contextSubject?: LearningSystemSubject;
  contextQuery?: string;
  contextInvocation?: unknown;
};

export type StructuredGenerationContract<TItem, TPartial, TResult> =
  | ObjectContract<TResult>
  | ItemArrayContract<TItem, TPartial, TResult>
  | ToolCallContract<TResult>;

function normalizeArrayEnvelopeCandidate<T>(
  candidate: unknown,
  key: "items",
  singletonSchema?: z.ZodType<T>,
): unknown {
  if (Array.isArray(candidate)) return { [key]: candidate };
  if (candidate === null || typeof candidate !== "object") return candidate;
  if (key in candidate) return candidate;
  if (!singletonSchema) return candidate;
  const singleton = singletonSchema.safeParse(candidate);
  return singleton.success ? { [key]: [singleton.data] } : candidate;
}

function arrayEnvelopeValues(
  candidate: unknown,
  key: "items",
): unknown[] | null {
  if (Array.isArray(candidate)) return candidate;
  if (candidate === null || typeof candidate !== "object") return null;
  const value = (candidate as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : null;
}

async function validateAssembled<TItem, TPartial, TResult>(
  contract: ItemArrayContract<TItem, TPartial, TResult>,
  items: TItem[],
): Promise<
  { success: true; data: TResult } | { success: false; issues: string[] }
> {
  const semanticIssues = await contract.semanticValidate?.(items);
  if (semanticIssues && semanticIssues.length > 0) {
    return { success: false, issues: semanticIssues };
  }
  const parsed = contract.resultSchema.safeParse(contract.assemble(items));
  return parsed.success
    ? { success: true, data: parsed.data }
    : {
        success: false,
        issues: [formatStructuredParseError(parsed.error)],
      };
}

function bareArrayPrompt(prompt: string): string {
  return `${prompt}\n\nReturn ONLY one minified root JSON array. Do not wrap it in an object. Do not include markdown, prose, or thinking tags.`;
}

function rawItemStreamPrompt(
  prompt: string,
  format: "json-array" | "json-lines",
): string {
  return format === "json-lines"
    ? `${prompt}\n\nTransport rule: return ONLY JSON Lines (NDJSON), with exactly one complete minified item object per physical line. Do not use a root array, commas between lines, code fences, prose, or thinking tags. Escape newlines inside string fields as \\n.`
    : bareArrayPrompt(prompt);
}

function nativeArrayPrompt(prompt: string, key: "items"): string {
  return `${prompt}\n\nProvider transport rule (overrides any bare/root-array wording above): put the complete requested array in the top-level structured field "${key}". Do not add prose or unrelated fields.`;
}

async function emitPartial<TItem, TPartial, TResult>(
  contract: ItemArrayContract<TItem, TPartial, TResult>,
  handlers: StructuredGenerationHandlers<TItem, TPartial, TResult>,
  items: TItem[],
  placeholders: number,
): Promise<void> {
  const partial = contract.assemblePartial?.(items, placeholders);
  if (partial != null) await handlers.onPartial?.(partial);
}

async function runItemArray<TItem, TPartial, TResult>(
  contract: ItemArrayContract<TItem, TPartial, TResult>,
  handlers: StructuredGenerationHandlers<TItem, TPartial, TResult>,
): Promise<TResult> {
  const resolvedContract = resolveStructuredContract({
    operation: contract.operation,
    mode: contract.rawStreamFormat ?? "json-array",
    schemas: [
      contract.nativeEnvelopeBindingSchema ??
        contract.bindingItemSchema ??
        contract.itemSchema,
      contract.resultSchema,
    ],
    metadata: {
      ...(contract.contract ?? {}),
      transportPolicy: contract.preferRawStream
        ? (contract.rawStreamFormat ?? "json-array")
        : contract.nativeEnvelopeBindingSchema
          ? "provider-canonical-object-envelope"
          : "provider-adapter",
      recoveryPolicy: "single-positional-repair",
      semanticValidatorId: contract.semanticValidate
        ? `${contract.operation}.semantic`
        : undefined,
    },
  });
  const published = new Map<number, string>();
  let partialValues: Array<{ index: number; value: TItem }> = [];
  let partialPlaceholders = -1;
  const publishEntries = async (
    entries: Array<{ index: number; value: TItem }>,
    placeholders: number,
    publishValidItems = true,
  ) => {
    if (publishValidItems) {
      for (const entry of entries) {
        const fingerprint = JSON.stringify(entry.value) ?? String(entry.value);
        if (published.get(entry.index) === fingerprint) continue;
        published.set(entry.index, fingerprint);
        await handlers.onValidItem?.(entry.value, entry.index);
      }
    }
    const partialChanged =
      placeholders !== partialPlaceholders ||
      entries.length !== partialValues.length ||
      entries.some(
        (entry, index) =>
          entry.index !== partialValues[index]?.index ||
          !Object.is(entry.value, partialValues[index]?.value),
      );
    if (!partialChanged) return;
    partialValues = entries.map((entry) => ({ ...entry }));
    partialPlaceholders = placeholders;
    await emitPartial(
      contract,
      handlers,
      entries.map((entry) => entry.value),
      placeholders,
    );
  };

  type GenerationState = {
    slots: Array<TItem | undefined>;
    sourceSlots: unknown[];
    issues: string[];
    issueCategories: StructuredIssueCategory[];
    normalizedItemCount: number;
    fatal: boolean;
    repairCallsUsed?: number;
    originalText?: string;
  };

  const sourceItemEnvelopeSchema = z.object({
    items: z.array(z.unknown()),
  });
  const validationItemSchema: z.ZodType<TItem> =
    contract.recoveryPolicy?.normalizeItem != null
      ? z.preprocess(contract.recoveryPolicy.normalizeItem, contract.itemSchema)
      : contract.itemSchema;
  const providerItemEnvelopeSchema =
    contract.nativeEnvelopeBindingSchema ??
    z.object({
      items: z.array(contract.bindingItemSchema ?? contract.itemSchema),
    });
  const bindingItemEnvelopeSchema =
    providerItemEnvelopeSchema &&
    typeof providerItemEnvelopeSchema === "object" &&
    !("_zod" in providerItemEnvelopeSchema) &&
    !("_def" in providerItemEnvelopeSchema)
      ? providerItemEnvelopeSchema
      : nativeJsonBindingSchema(providerItemEnvelopeSchema as z.ZodType);
  const normalizeNativeEnvelopeCandidate = (candidate: unknown) =>
    contract.normalizeNativeEnvelopeCandidate
      ? contract.normalizeNativeEnvelopeCandidate(candidate)
      : normalizeArrayEnvelopeCandidate(candidate, "items");
  const stateFromNativeEnvelope = async (
    nativeEnvelope: {
      items: unknown[];
    },
    nativePreviewTokenEmitted: boolean,
    repairCallsUsed = 0,
  ): Promise<GenerationState> => {
    const sourceItems = nativeEnvelope.items;
    if (!nativePreviewTokenEmitted) {
      await handlers.onToken?.(JSON.stringify(sourceItems));
    }
    const slots: Array<TItem | undefined> = Array.from({
      length: sourceItems.length,
    });
    const entries = sourceItems.flatMap((value, index) => {
      const parsed = validationItemSchema.safeParse(value);
      if (!parsed.success) return [];
      slots[index] = parsed.data;
      return [{ index, value: parsed.data }];
    });
    const issues = sanitizeIssues(
      sourceItems.flatMap((value, index) => {
        const parsed = validationItemSchema.safeParse(value);
        return parsed.success
          ? []
          : [`item ${index}: ${formatStructuredParseError(parsed.error)}`];
      }),
    );
    const issueCategories = [
      ...new Set(
        sourceItems.flatMap((value) => {
          const parsed = validationItemSchema.safeParse(value);
          return parsed.success ? [] : zodIssueCategories(parsed.error);
        }),
      ),
    ];
    await publishEntries(entries, sourceItems.length - entries.length);
    return {
      slots,
      sourceSlots: [...sourceItems],
      issues,
      issueCategories,
      normalizedItemCount: entries.filter(
        (entry) =>
          JSON.stringify(sourceItems[entry.index]) !==
          JSON.stringify(entry.value),
      ).length,
      fatal: false,
      repairCallsUsed,
    };
  };
  const nativeAttemptLimit = Math.max(
    0,
    Math.min(
      STRUCTURED_REPAIR_MAX_ATTEMPTS,
      contract.nativeAttemptLimit ?? STRUCTURED_REPAIR_MAX_ATTEMPTS,
    ),
  );

  const generateWholeArray = async (
    prompt: string,
    generationAttempt: number,
  ): Promise<GenerationState> => {
    let nativePreviewTokenEmitted = false;
    const nativePreview = { values: null as unknown[] | null };
    let repairCallsUsed = 0;
    let lastNativeError: unknown;
    const requireDeepseekStrict =
      contract.deepseekStrictOnly === true &&
      // A host can replace this logical route with a separately validated
      // transport. Enforce the wire guarantee on the resolved provider, as the
      // object generation path does, rather than the saved model selection.
      getLlmProvider().id === "deepseek";
    if (!contract.preferRawStream && generationAttempt < nativeAttemptLimit) {
      for (
        let methodIndex = generationAttempt;
        methodIndex < nativeAttemptLimit;
        methodIndex += 1
      ) {
        let nativeEnvelope: { items: unknown[] } | null = null;
        const deadline = bindingItemEnvelopeSchema
          ? createStructuredDeadline(
              handlers.signal,
              resolvedContract.limits.timeoutMs,
              resolvedContract.timeoutPolicy,
            )
          : undefined;
        try {
          nativeEnvelope = bindingItemEnvelopeSchema
            ? await streamStructuredNative(
                sourceItemEnvelopeSchema,
                contract.nativeEnvelopeBindingSchema
                  ? prompt
                  : nativeArrayPrompt(prompt, "items"),
                {
                  operation:
                    methodIndex === generationAttempt
                      ? contract.operation
                      : `${contract.operation}.retry`,
                  mode: "item-envelope",
                  preferSchemaConstrained:
                    contract.preferSchemaConstrained ??
                    Boolean(contract.nativeEnvelopeBindingSchema),
                  bindingSchema: bindingItemEnvelopeSchema,
                  methodIndex,
                  throwOnError: true,
                  meta: {
                    ...(contract.meta ?? {}),
                    generationAttempt: methodIndex + 1,
                    outputFormat: "structured_item_array",
                  },
                  normalizeCandidate: normalizeNativeEnvelopeCandidate,
                  contract: resolvedContract,
                  onProgress: deadline?.recordProgress,
                },
                // Forward raw tool-argument / JSON deltas so UIs can paint a
                // text preview before the first Zod-valid item exists.
                handlers.onToken,
                deadline?.signal ?? handlers.signal,
                async (partial) => {
                  const values = arrayEnvelopeValues(
                    normalizeNativeEnvelopeCandidate(partial),
                    "items",
                  );
                  if (values == null) return;
                  nativePreview.values = values;
                  if (!nativePreviewTokenEmitted) {
                    await handlers.onToken?.(JSON.stringify(values));
                  }
                  nativePreviewTokenEmitted = true;
                  const entries = values.flatMap((value, index) => {
                    const parsed = validationItemSchema.safeParse(value);
                    return parsed.success
                      ? [{ index, value: parsed.data }]
                      : [];
                  });
                  // Provider-native streams are cumulative and may still mutate an
                  // item. These are previews only; side effects wait for final data.
                  await publishEntries(
                    entries,
                    values.length - entries.length,
                    false,
                  );
                },
              )
            : null;
        } catch (error) {
          if (!isStructuredNativeOutputError(error)) throw error;
          lastNativeError = error;
          const visibleValues = nativePreview.values;
          if (
            contract.repairInvalidItemsOnly &&
            handlers.onPartial &&
            nativePreviewTokenEmitted &&
            visibleValues &&
            visibleValues.length > 1
          ) {
            // The tolerant incremental parser may synthesize the final item by
            // closing an unfinished string/container. Preserve only the valid
            // prefix before that uncertain tail; these are the items the JIT UI
            // has already rendered and that remained complete in a later
            // cumulative candidate.
            const frozenPrefix: TItem[] = [];
            for (let index = 0; index < visibleValues.length - 1; index += 1) {
              const parsed = validationItemSchema.safeParse(
                visibleValues[index],
              );
              if (!parsed.success) break;
              frozenPrefix.push(parsed.data);
            }
            if (frozenPrefix.length > 0) {
              const remainingCapacity = Math.max(
                1,
                (contract.recoveryPolicy?.maxItems ?? 132) -
                  frozenPrefix.length,
              );
              const continuationSchema = z.preprocess(
                unwrapStructuredArrayCandidate,
                z.array(validationItemSchema).min(1).max(remainingCapacity),
              );
              try {
                const [continuation] = await runSinglePositionalRepair<TItem[]>(
                  {
                    operation: contract.operation,
                    repairType: "prefix_continuation",
                    slots: [
                      {
                        description: `Continue the interrupted structured item collection after ${frozenPrefix.length} frozen valid item(s). Return only the ordered suffix needed to complete the original request. Do not repeat or rewrite the introduction or any frozen item. The malformed provider attempt ended with: ${sanitizeIssue(formatStructuredParseError(error))}`,
                        context: `${contract.repairContext ?? "Complete the original structured generation request."}\n\nFrozen prefix summary (authoritative; do not repeat):\n${JSON.stringify(frozenPrefix.slice(-6))}`,
                        schema: continuationSchema as z.ZodType<TItem[]>,
                        expectedShape:
                          "One array containing only continuation items after the frozen prefix, including all still-required ending items such as takeaways. Do not wrap it in another domain object.",
                      },
                    ],
                    meta: {
                      ...(contract.meta ?? {}),
                      continuationAttempt: 1,
                      preservedPrefixCount: frozenPrefix.length,
                      issueCategories: ["invalid_value"],
                    },
                    signal: handlers.signal,
                    contract: resolvedContract,
                  },
                );
                const merged = [...frozenPrefix, ...(continuation ?? [])];
                await patchActiveLlmRecoveryMetadata({
                  continuationCount: 1,
                  continuationItemCount: continuation?.length ?? 0,
                  preservedPrefixCount: frozenPrefix.length,
                  recoveryType: "prefix_continuation",
                });
                return stateFromNativeEnvelope(
                  { items: merged },
                  nativePreviewTokenEmitted,
                );
              } catch (continuationError) {
                if (isAbortError(continuationError)) {
                  throw normalizedCancellationError(continuationError);
                }
                throw new StructuredGenerationError(
                  contract.operation,
                  "repair",
                  1,
                  sanitizeIssues([
                    formatStructuredParseError(error),
                    formatStructuredParseError(continuationError),
                  ]),
                );
              }
            }
          }
          const originalText = (error as { originalText?: unknown })
            .originalText;
          const envelopeRepairSchema = contract.nativeEnvelopeBindingSchema;
          if (
            typeof originalText === "string" &&
            originalText.trim() &&
            envelopeRepairSchema &&
            !contract.repairInvalidItemsOnly &&
            typeof (envelopeRepairSchema as { safeParse?: unknown })
              .safeParse === "function"
          ) {
            try {
              repairCallsUsed = 1;
              const [repairedEnvelope] = await runSinglePositionalRepair({
                operation: contract.operation,
                slots: [
                  {
                    description:
                      "Repair the original provider output into one complete material envelope without omitting, summarizing, or inventing lesson content.",
                    context: contract.repairContext,
                    currentValue: originalText,
                    schema: envelopeRepairSchema as z.ZodType<unknown>,
                  },
                ],
                meta: {
                  ...(contract.meta ?? {}),
                  repairAttempt: 1,
                  rootRepair: true,
                  issueCategories: ["invalid_value"],
                },
                signal: handlers.signal,
                contract: resolvedContract,
              });
              const normalized = sourceItemEnvelopeSchema.parse(
                normalizeNativeEnvelopeCandidate(repairedEnvelope),
              );
              const repairedState = await stateFromNativeEnvelope(
                normalized,
                nativePreviewTokenEmitted,
                repairCallsUsed,
              );
              const repairedItems = repairedState.slots.filter(
                (item): item is TItem => item !== undefined,
              );
              const repairedCandidate = await validateAssembled(
                contract,
                repairedItems,
              );
              if (!repairedCandidate.success) continue;
              return repairedState;
            } catch (repairError) {
              if (isAbortError(repairError)) {
                throw normalizedCancellationError(repairError);
              }
              const status =
                repairError && typeof repairError === "object"
                  ? Number(
                      (
                        repairError as {
                          status?: unknown;
                          statusCode?: unknown;
                        }
                      ).statusCode ??
                        (repairError as { status?: unknown }).status,
                    )
                  : Number.NaN;
              if (status === 401 || status === 403) throw repairError;
              // Try the next native transport, then the raw item fallback.
            }
          }
          continue;
        } finally {
          deadline?.cleanup();
        }

        if (nativeEnvelope != null)
          return stateFromNativeEnvelope(
            nativeEnvelope,
            nativePreviewTokenEmitted,
            repairCallsUsed,
          );
      }
    }

    if (requireDeepseekStrict) {
      if (lastNativeError) throw lastNativeError;
      throw new StructuredGenerationError(contract.operation, "parse", 1, [
        "DeepSeek strict structured output is required for this operation",
      ]);
    }

    const rawStreamFormat = contract.rawStreamFormat ?? "json-array";
    const accumulator =
      rawStreamFormat === "json-lines"
        ? new JsonLinesStreamAccumulator(validationItemSchema)
        : new JsonArrayStreamAccumulator(validationItemSchema);
    let lastSnapshot = accumulator.append("");
    const publishSnapshot = async () =>
      publishEntries(lastSnapshot.items, lastSnapshot.placeholderCount);
    const deadline = createStructuredDeadline(
      handlers.signal,
      resolvedContract.limits.timeoutMs,
      resolvedContract.timeoutPolicy,
    );
    let raw: string;
    try {
      const rawAttempt = contract.preferRawStream
        ? generationAttempt + 1
        : nativeAttemptLimit + 1;
      const rawFallbackPrompt =
        contract.nativeEnvelopeBindingSchema && contract.repairContext
          ? `${prompt}

Provider fallback wire format (overrides canonical object/envelope wording above):
Encode the same requested content as ordered items using only these item shapes:
${contract.repairContext}`
          : prompt;
      raw = await streamChat(
        rawItemStreamPrompt(rawFallbackPrompt, rawStreamFormat),
        {
          operation:
            rawAttempt === 1
              ? contract.operation
              : `${contract.operation}.retry`,
          meta: {
            ...(contract.meta ?? {}),
            ...structuredContractLogMeta(resolvedContract),
            structuredAttempt: rawAttempt,
            structuredTransport: rawStreamFormat,
            structuredStage: "generation",
            generationAttempt: rawAttempt,
            outputFormat:
              rawStreamFormat === "json-lines"
                ? "structured_item_jsonl"
                : "structured_item_array",
            structuredOutput: false,
          },
          signal: deadline.signal,
          structuredContract: resolvedContract,
          outputLimits: resolvedContract.limits,
          outputMode: rawStreamFormat,
          onProgress: deadline.recordProgress,
          onToken: async (delta) => {
            await handlers.onToken?.(delta);
            lastSnapshot = accumulator.append(delta);
            await publishSnapshot();
          },
        },
      );
    } finally {
      deadline.cleanup();
    }
    if (!accumulator.rawText() && raw) {
      lastSnapshot = accumulator.append(raw);
      await publishSnapshot();
    }
    lastSnapshot = accumulator.finish();
    await publishSnapshot();
    const slots: Array<TItem | undefined> = Array.from({
      length: lastSnapshot.itemCount,
    });
    for (const entry of lastSnapshot.items) slots[entry.index] = entry.value;
    const sourceSlots: unknown[] = Array.from({
      length: lastSnapshot.itemCount,
    });
    for (const entry of lastSnapshot.sourceItems) {
      sourceSlots[entry.index] = entry.value;
    }
    const issues = sanitizeIssues(
      lastSnapshot.issues.map(
        (issue) =>
          `${issue.index >= 0 ? `item ${issue.index}` : "response"}: ${issue.message}`,
      ),
    );
    return {
      slots,
      sourceSlots,
      issues,
      issueCategories: issues.length > 0 ? ["invalid_value"] : [],
      normalizedItemCount: slots.filter(
        (value, index) =>
          value !== undefined &&
          JSON.stringify(sourceSlots[index]) !== JSON.stringify(value),
      ).length,
      fatal:
        !lastSnapshot.closed ||
        lastSnapshot.issues.some((issue) => issue.index < 0),
      repairCallsUsed,
      originalText: raw || accumulator.rawText(),
    };
  };

  const maxRepairCalls = Math.max(
    0,
    Math.min(1, contract.maxRepairAttempts ?? 1),
  );
  let state = await generateWholeArray(contract.prompt, 0);
  let repairCalls = state.repairCallsUsed ?? 0;
  let issues = [...state.issues];

  const addressableCount = state.slots.filter(
    (item) => item !== undefined,
  ).length;
  if (
    state.fatal &&
    addressableCount === 0 &&
    contract.regenerateOnFailure &&
    !contract.repairInvalidItemsOnly &&
    repairCalls < maxRepairCalls
  ) {
    repairCalls += 1;
    try {
      const [repairedRoot] = await runSinglePositionalRepair<TItem[]>({
        operation: contract.operation,
        slots: [
          {
            description: `Replace the unusable root with the complete required item collection. ${issues.join(" ")}`,
            context: contract.repairContext,
            currentValue: state.originalText,
            schema: z.array(validationItemSchema),
            expectedShape:
              "Return the complete ordered item array as this slot's one value.",
          },
        ],
        meta: {
          ...(contract.meta ?? {}),
          repairAttempt: repairCalls,
          rootRepair: true,
          issueCategories: state.issueCategories,
        },
        signal: handlers.signal,
        contract: resolvedContract,
      });
      state = {
        slots: repairedRoot,
        sourceSlots: [...repairedRoot],
        issues: [],
        issueCategories: state.issueCategories,
        normalizedItemCount: 0,
        fatal: false,
      };
      issues = [];
    } catch (error) {
      if (isAbortError(error)) throw normalizedCancellationError(error);
      const repairIssues =
        error instanceof PositionalRepairError
          ? error.issues
          : [formatStructuredParseError(error)];
      throw new StructuredGenerationError(
        contract.operation,
        "repair",
        repairCalls + 1,
        sanitizeIssues([...issues, ...repairIssues]),
      );
    }
  }

  assertNotAborted(handlers.signal);
  const policyInvalidItems =
    contract.recoveryPolicy?.invalidItems?.({
      items: state.slots,
      sourceItems: state.sourceSlots,
    }) ?? [];
  const policyInvalidByIndex = new Map<number, InvalidItemRepair<TItem>>();
  for (const invalid of policyInvalidItems) {
    if (
      invalid.index < 0 ||
      invalid.index >= state.slots.length ||
      state.slots[invalid.index] === undefined
    ) {
      continue;
    }
    policyInvalidByIndex.set(invalid.index, invalid);
    state.slots[invalid.index] = undefined;
  }
  const invalidIndexes = state.slots.flatMap((item, index) =>
    item === undefined ? [index] : [],
  );
  const validItems = state.slots.filter(
    (item): item is TItem => item !== undefined,
  );
  const policyMissingItems =
    contract.recoveryPolicy?.missingItems?.({
      validItems,
      sourceItems: state.sourceSlots,
    }) ?? [];
  const genericMissingItems: MissingItemRepair<TItem>[] = [];
  if (!contract.recoveryPolicy?.missingItems) {
    const preflight = contract.resultSchema.safeParse(
      contract.assemble(validItems),
    );
    if (!preflight.success) {
      const minimum = preflight.error.issues.reduce((largest, issue) => {
        if (issue.code !== "too_small") return largest;
        const candidate = Number((issue as z.core.$ZodIssueTooSmall).minimum);
        return Number.isFinite(candidate)
          ? Math.max(largest, candidate)
          : largest;
      }, 0);
      const missingCount = Math.max(0, minimum - state.slots.length);
      for (let index = 0; index < missingCount; index += 1) {
        genericMissingItems.push({
          description: `Add missing required item ${state.slots.length + index + 1}.`,
        });
      }
    }
  }
  const missingItems = [...policyMissingItems, ...genericMissingItems];
  const repairSlots: Array<
    | { kind: "replace"; index: number; slot: PositionalRepairSlot<TItem> }
    | {
        kind: "insert";
        insertAt?: number;
        slot: PositionalRepairSlot<TItem>;
      }
  > = [
    ...invalidIndexes.map((index) => {
      const sourceValue = state.sourceSlots[index];
      const parsed = validationItemSchema.safeParse(sourceValue);
      const policyInvalid = policyInvalidByIndex.get(index);
      return {
        kind: "replace" as const,
        index,
        slot: {
          description: `${
            policyInvalid?.description ??
            `Correct invalid item ${index + 1}. ${
              parsed.success ? "" : formatStructuredParseError(parsed.error)
            }`
          }`,
          context: contract.repairContext,
          currentValue: sourceValue,
          schema: policyInvalid?.schema ?? validationItemSchema,
        },
      };
    }),
    ...missingItems.map((missing) => ({
      kind: "insert" as const,
      insertAt: missing.insertAt,
      slot: {
        description: missing.description,
        context: contract.repairContext,
        schema: missing.schema ?? validationItemSchema,
        expectedShape: missing.expectedShape,
      },
    })),
  ];

  if (repairSlots.length > 0) {
    if (repairCalls >= maxRepairCalls) {
      throw new StructuredGenerationError(
        contract.operation,
        state.fatal ? "regeneration" : "repair",
        repairCalls + 1,
        sanitizeIssues(
          issues.length > 0
            ? issues
            : ["required item repair budget exhausted"],
        ),
      );
    }
    repairCalls += 1;
    try {
      const repaired = await runSinglePositionalRepair({
        operation: contract.operation,
        slots: repairSlots.map((repair) => repair.slot),
        meta: {
          ...(contract.meta ?? {}),
          repairAttempt: repairCalls,
          invalidItemCount: invalidIndexes.length,
          missingItemCount: missingItems.length,
          issueCategories: [
            ...new Set([
              ...state.issueCategories,
              ...(missingItems.length > 0 ? (["minimum"] as const) : []),
            ]),
          ],
        },
        signal: handlers.signal,
        contract: resolvedContract,
      });
      const insertions: Array<{ insertAt?: number; value: TItem }> = [];
      repairSlots.forEach((repair, index) => {
        const value = repaired[index]!;
        if (repair.kind === "replace") {
          state.slots[repair.index] = value;
          state.sourceSlots[repair.index] = value;
        } else {
          insertions.push({ insertAt: repair.insertAt, value });
        }
      });
      for (const insertion of insertions) {
        if (insertion.insertAt == null) {
          state.slots.push(insertion.value);
          state.sourceSlots.push(insertion.value);
        } else {
          const index = Math.max(
            0,
            Math.min(insertion.insertAt, state.slots.length),
          );
          state.slots.splice(index, 0, insertion.value);
          state.sourceSlots.splice(index, 0, insertion.value);
        }
      }
    } catch (error) {
      if (isAbortError(error)) throw normalizedCancellationError(error);
      const repairIssues =
        error instanceof PositionalRepairError
          ? error.issues
          : [formatStructuredParseError(error)];
      throw new StructuredGenerationError(
        contract.operation,
        "repair",
        repairCalls + 1,
        sanitizeIssues([...issues, ...repairIssues]),
      );
    }
  }

  const unresolvedIndexes = state.slots.flatMap((item, index) =>
    item === undefined ? [index] : [],
  );
  if (unresolvedIndexes.length > 0) {
    throw new StructuredGenerationError(
      contract.operation,
      "repair",
      repairCalls + 1,
      [
        `items ${unresolvedIndexes.join(", ")} remain invalid after targeted repair`,
      ],
    );
  }

  let items = state.slots as TItem[];
  let normalizedCount = state.normalizedItemCount;
  let droppedCount = 0;
  if (contract.recoveryPolicy?.dedupeExact) {
    const deduplicated = normalizeExactDuplicates(items);
    items = deduplicated.items;
    droppedCount += deduplicated.droppedCount;
  }
  if (contract.recoveryPolicy?.normalize) {
    const normalized = contract.recoveryPolicy.normalize(items);
    items = normalized.items;
    normalizedCount += normalized.normalizedCount ?? 0;
    droppedCount += normalized.droppedCount ?? 0;
  }
  if (
    contract.recoveryPolicy?.maxItems != null &&
    items.length > contract.recoveryPolicy.maxItems
  ) {
    droppedCount += items.length - contract.recoveryPolicy.maxItems;
    items = items.slice(0, contract.recoveryPolicy.maxItems);
  }

  const candidate = await validateAssembled(contract, items);
  if (!candidate.success) {
    throw new StructuredGenerationError(
      contract.operation,
      "validation",
      repairCalls + 1,
      sanitizeIssues(candidate.issues),
    );
  }
  assertNotAborted(handlers.signal);
  await patchActiveLlmRecoveryMetadata({
    normalizedCount,
    repairCount: repairCalls,
    repairedValueCount: repairSlots.length,
    droppedCount,
    fallbackCount: 0,
    issueCategories: [
      ...new Set([
        ...state.issueCategories,
        ...(missingItems.length > 0 ? (["minimum"] as const) : []),
        ...(droppedCount > 0 ? (["maximum"] as const) : []),
      ]),
    ],
  });
  await publishEntries(
    items.map((value, index) => ({ index, value })),
    0,
  );
  assertNotAborted(handlers.signal);
  await handlers.onFinal?.(candidate.data);
  await patchActiveLlmStructuredOutcome("final_success", {
    structuredValidationStage: "business",
  });
  return candidate.data;
}

export function runValidatedStructuredGeneration<TItem, TPartial, TResult>(
  contract: ItemArrayContract<TItem, TPartial, TResult>,
  handlers?: StructuredGenerationHandlers<TItem, TPartial, TResult>,
): Promise<TResult>;
export function runValidatedStructuredGeneration<TSchema extends z.ZodType>(
  contract: Omit<ObjectContract<z.infer<TSchema>>, "schema"> & {
    schema: TSchema;
  },
  handlers?: FinalStructuredGenerationHandlers<z.infer<TSchema>>,
): Promise<z.infer<TSchema>>;
export function runValidatedStructuredGeneration<TSchema extends z.ZodType>(
  contract: Omit<ToolCallContract<z.infer<TSchema>>, "schema"> & {
    schema: TSchema;
  },
  handlers?: FinalStructuredGenerationHandlers<z.infer<TSchema>>,
): Promise<z.infer<TSchema>>;
export async function runValidatedStructuredGeneration<
  TItem = never,
  TPartial = never,
  TResult = unknown,
>(
  contract: StructuredGenerationContract<TItem, TPartial, TResult>,
  handlers: StructuredGenerationHandlers<TItem, TPartial, TResult> = {},
): Promise<TResult> {
  if (!getLlmTrace()) {
    const rerun = runValidatedStructuredGeneration as unknown as (
      nextContract: StructuredGenerationContract<TItem, TPartial, TResult>,
      nextHandlers: StructuredGenerationHandlers<TItem, TPartial, TResult>,
    ) => Promise<TResult>;
    return runWithLlmTraceAsync({ traceId: getRequestContext()?.traceId }, () =>
      rerun(contract, handlers),
    );
  }
  if (contract.contextSubject) {
    const rerun = runValidatedStructuredGeneration as unknown as (
      nextContract: StructuredGenerationContract<TItem, TPartial, TResult>,
      nextHandlers: StructuredGenerationHandlers<TItem, TPartial, TResult>,
    ) => Promise<TResult>;
    const scopedContract = {
      ...contract,
      contextSubject: undefined,
      contextQuery: undefined,
      contextInvocation: undefined,
    } as StructuredGenerationContract<TItem, TPartial, TResult>;
    return runMergedGenerationContextScope(
      {
        subject: { ...contract.contextSubject },
        query: contract.contextQuery,
        invocation: contract.contextInvocation,
      },
      () => rerun(scopedContract, handlers),
    );
  }
  const operation =
    contract.mode === "object"
      ? contract.options.operation
      : contract.operation;
  if (
    getActiveLlmOperationRoute()?.operationKey !==
    canonicalLlmOperationKey(operation)
  ) {
    const rerun = runValidatedStructuredGeneration as unknown as (
      nextContract: StructuredGenerationContract<TItem, TPartial, TResult>,
      nextHandlers: StructuredGenerationHandlers<TItem, TPartial, TResult>,
    ) => Promise<TResult>;
    const routedHandlers: StructuredGenerationHandlers<
      TItem,
      TPartial,
      TResult
    > = {
      ...handlers,
      onToken: handlers.onToken
        ? async (delta) => {
            markActiveLlmRouteOutputStarted();
            await handlers.onToken?.(delta);
          }
        : undefined,
      onValidItem: handlers.onValidItem
        ? async (item, index) => {
            markActiveLlmRouteOutputStarted();
            await handlers.onValidItem?.(item, index);
          }
        : undefined,
      onPartial: handlers.onPartial
        ? async (partial) => {
            markActiveLlmRouteOutputStarted();
            await handlers.onPartial?.(partial);
          }
        : undefined,
      onFinal: handlers.onFinal
        ? async (result) => {
            markActiveLlmRouteOutputStarted();
            await handlers.onFinal?.(result);
          }
        : undefined,
    };
    return withLlmOperationRoute(operation, () =>
      rerun(contract, routedHandlers),
    );
  }
  if (contract.mode === "object") {
    const resolvedContract = resolveStructuredContract({
      operation: contract.options.operation,
      mode: "object",
      schemas: [
        contract.options.bindingSchema ??
          contract.recoveryPolicy?.sourceSchema ??
          contract.schema,
        contract.schema,
      ],
      metadata: {
        ...(contract.options.contract ?? {}),
        promptExample:
          contract.options.contract?.promptExample ??
          (contract.options.schemaShape?.trim().startsWith("{") ||
          contract.options.schemaShape?.trim().startsWith("[")
            ? contract.options.schemaShape
            : undefined),
        transportPolicy: "provider-adapter",
        recoveryPolicy: contract.recoveryPolicy
          ? "single-positional-repair"
          : "bounded-retry",
      },
    });
    let result: TResult;
    let recovered: unknown;
    let attempts = 0;
    try {
      const candidate = await runStructuredOutput(
        contract.recoveryPolicy?.sourceSchema ?? contract.schema,
        contract.prompt,
        {
          ...contract.options,
          resolvedContract,
          meta: {
            ...(contract.options.meta ?? {}),
            ...structuredContractLogMeta(resolvedContract),
          },
        },
        {
          onAttempt: () => { attempts += 1; },
          onToken: handlers.onToken,
          onPartial: handlers.onPartial as
            ((partial: unknown) => void | Promise<void>) | undefined,
          signal: handlers.signal,
        },
      );
      const firstNormalization =
        contract.recoveryPolicy?.normalize?.(candidate);
      let normalizedCount = firstNormalization?.normalizedCount ?? 0;
      let droppedCount = firstNormalization?.droppedCount ?? 0;
      let repairCount = 0;
      let repairedValueCount = 0;
      let issueCategories: StructuredIssueCategory[] = [];
      recovered = firstNormalization?.value ?? candidate;
      let parsed = contract.schema.safeParse(recovered);
      if (!parsed.success && contract.recoveryPolicy) {
        issueCategories = zodIssueCategories(parsed.error);
        const repairs = contract.recoveryPolicy.repairSlots({
          candidate: recovered,
          error: parsed.error,
        });
        if (repairs.length === 0) {
          throw parsed.error;
        }
        repairCount = 1;
        repairedValueCount = repairs.length;
        attempts += 1;
        const values = await runSinglePositionalRepair({
          operation: contract.options.operation,
          slots: repairs.map((repair) => repair.slot),
          meta: {
            ...(contract.options.meta ?? {}),
            repairAttempt: 1,
            repairSlotCount: repairs.length,
            issueCategories: zodIssueCategories(parsed.error),
          },
          topicCategory: contract.options.topicCategory,
          signal: handlers.signal,
          contract: resolvedContract,
        });
        repairs.forEach((repair, index) => {
          recovered = repair.apply(recovered, values[index]);
        });
        const finalNormalization =
          contract.recoveryPolicy.normalize?.(recovered);
        normalizedCount += finalNormalization?.normalizedCount ?? 0;
        droppedCount += finalNormalization?.droppedCount ?? 0;
        parsed = contract.schema.safeParse(
          finalNormalization?.value ?? recovered,
        );
      }
      if (!parsed.success) throw parsed.error;
      result = parsed.data;
      if (contract.recoveryPolicy) {
        await patchActiveLlmRecoveryMetadata({
          normalizedCount,
          repairCount,
          repairedValueCount,
          droppedCount,
          fallbackCount: 0,
          issueCategories,
        });
      }
    } catch (error) {
      const failureCategory = structuredFailureCategory(error);
      await patchActiveLlmStructuredOutcome(
        "final_error",
        {
          structuredValidationStage:
            recovered !== undefined
              ? "business"
              : failureCategory === "validation" ? "schema" : "generation",
          structuredFailureCategory: failureCategory,
          structuredIssues: structuredIssuesFromError(error, recovered),
        },
        formatStructuredParseError(error),
      );
      if (isAbortError(error)) {
        throw normalizedCancellationError(error);
      }
      if (error instanceof StructuredGenerationError) {
        throw error;
      }
      throw new StructuredGenerationError(
        contract.options.operation,
        failureCategory === "timeout" ? "regeneration" : "validation",
        attempts,
        sanitizedStructuredIssues(error),
      );
    }
    assertNotAborted(handlers.signal);
    await handlers.onFinal?.(result);
    await patchActiveLlmStructuredOutcome("final_success", {
      structuredValidationStage: "business",
    });
    return result;
  }

  if (contract.mode === "tool-call") {
    const resolvedContract = resolveStructuredContract({
      operation: contract.operation,
      mode: "tool-call",
      schemas: [contract.schema],
      metadata: {
        ...(contract.contract ?? {}),
        transportPolicy: "tool-call",
        recoveryPolicy: "bounded-validation-retry",
        semanticValidatorId:
          contract.contract?.semanticValidatorId ??
          `${contract.operation}.tool-result`,
      },
    });
    const maxRepairs = Math.max(
      0,
      Math.min(
        STRUCTURED_REPAIR_MAX_ATTEMPTS,
        contract.maxRepairAttempts ?? STRUCTURED_REPAIR_MAX_ATTEMPTS,
      ),
    );
    let validationError: string | undefined;
    let lastInvokeError: unknown;
    let lastIssues: ValidationIssue[] = [];
    for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
      assertNotAborted(handlers.signal);
      let candidate: unknown;
      try {
        const deadline = createStructuredDeadline(
          handlers.signal,
          resolvedContract.limits.timeoutMs,
        );
        try {
          candidate = await contract.invoke({
            attempt,
            validationError,
            signal: deadline.signal,
            maxTokens: resolvedContract.limits.maxTokens,
          });
        } finally {
          deadline.cleanup();
        }
      } catch (error) {
        if (
          !isAbortError(error) &&
          !(error instanceof StructuredGenerationError) &&
          isRetryableToolPayloadError(error) &&
          attempt < maxRepairs
        ) {
          lastInvokeError = error;
          lastIssues = structuredIssuesFromError(error);
          validationError = sanitizeIssue(formatStructuredParseError(error));
          continue;
        }
        await patchActiveLlmStructuredOutcome(
          "final_error",
          {
            structuredValidationStage: "tool-call",
            structuredFailureCategory: structuredFailureCategory(error),
            structuredIssues: structuredIssuesFromError(error),
          },
          formatStructuredParseError(error),
        );
        if (isAbortError(error)) throw normalizedCancellationError(error);
        if (error instanceof StructuredGenerationError) throw error;
        throw new StructuredGenerationError(
          contract.operation,
          error instanceof StructuredOutputLimitError &&
            error.code === "ATTEMPT_TIMEOUT"
            ? "regeneration"
            : "tool-call",
          attempt + 1,
          [formatStructuredParseError(error)],
        );
      }
      assertNotAborted(handlers.signal);
      // A returned candidate supersedes an earlier argument-decoding failure.
      // Final diagnostics must describe the attempt that actually exhausted
      // validation, rather than the first malformed response.
      lastInvokeError = undefined;
      const parsed = contract.schema.safeParse(candidate);
      if (parsed.success) {
        assertNotAborted(handlers.signal);
        await handlers.onFinal?.(parsed.data);
        await patchActiveLlmStructuredOutcome("final_success", {
          structuredValidationStage: "tool-call",
        });
        return parsed.data;
      }
      const report = buildValidationReport(parsed.error, candidate);
      lastIssues = report.issues;
      validationError = sanitizeIssue(formatValidationReportForModel(report));
    }
    await patchActiveLlmStructuredOutcome(
      "final_error",
      {
        structuredValidationStage: "tool-call",
        structuredFailureCategory: lastInvokeError
          ? structuredFailureCategory(lastInvokeError)
          : "validation",
        structuredIssues: lastIssues,
      },
      validationError ?? "tool call returned no valid arguments",
    );
    throw new StructuredGenerationError(
      contract.operation,
      "tool-call",
      maxRepairs + 1,
      sanitizeIssues([
        validationError ?? "tool call returned no valid arguments",
      ]),
    );
  }

  try {
    return await runItemArray(contract, handlers);
  } catch (error) {
    await patchActiveLlmStructuredOutcome(
      "final_error",
      {
        structuredValidationStage: "business",
        structuredFailureCategory: structuredFailureCategory(error),
        structuredIssues: structuredIssuesFromError(error),
      },
      formatStructuredParseError(error),
    );
    if (isAbortError(error)) throw normalizedCancellationError(error);
    if (error instanceof StructuredOutputLimitError) {
      throw new StructuredGenerationError(
        contract.operation,
        error.code === "ATTEMPT_TIMEOUT" ? "regeneration" : "validation",
        1,
        [error.message],
      );
    }
    throw error;
  }
}
