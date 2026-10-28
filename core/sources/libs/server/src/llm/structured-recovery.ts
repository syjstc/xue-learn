import { z } from "zod";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import type { TopicCategory } from "../../../common/src/index.js";
import { streamChat } from "./chat-stream.js";
import { formatStructuredParseError } from "./parse-structured.js";
import {
  buildValidationReport,
  formatValidationReportForModel,
  type ValidationHint,
} from "./validation-report.js";
import { parseLlmJson } from "./sanitize-response.js";
import {
  createStructuredDeadline,
  type ResolvedStructuredContract,
  structuredContractLogMeta,
} from "./structured-contract.js";
import { streamStructuredNative } from "./structured-native.js";
import type {
  StructuredOutputHandlers,
  StructuredOutputOptions,
} from "./structured-output.js";

export type StructuredIssueAction = "normalize" | "repair" | "drop" | "fail";

export type StructuredIssueCategory =
  | "maximum"
  | "minimum"
  | "missing_or_wrong_type"
  | "invalid_value"
  | "unknown_keys"
  | "domain_invariant";

export type PositionalRepairSlot<T> = {
  description: string;
  /** Shared semantic/source context that the replacement must preserve. */
  context?: string;
  currentValue?: unknown;
  schema: z.ZodType<T>;
  expectedShape?: string;
};

export type PositionalRepairRunner = (
  schema: z.ZodType,
  prompt: string,
  options: StructuredOutputOptions,
  handlers?: StructuredOutputHandlers,
) => Promise<unknown>;

export class PositionalRepairError extends Error {
  readonly issues: string[];

  constructor(issues: readonly string[]) {
    const safeIssues = issues.slice(0, 20).map(sanitizeRecoveryText);
    super(safeIssues.join("; "));
    this.name = "PositionalRepairError";
    this.issues = safeIssues;
  }
}

function sanitizeRecoveryText(value: unknown): string {
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

export function normalizeGeneratedText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize JSON leaves without inventing content; null object fields omit. */
export function normalizeGeneratedJsonValue(value: unknown): unknown {
  if (typeof value === "string") return normalizeGeneratedText(value);
  if (Array.isArray(value)) return value.map(normalizeGeneratedJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) =>
      child === null
        ? []
        : [[key, normalizeGeneratedJsonValue(child)] as const],
    ),
  );
}

export function issueCategory(
  issue: z.core.$ZodIssue,
): StructuredIssueCategory {
  switch (issue.code) {
    case "too_big":
      return "maximum";
    case "too_small":
      return "minimum";
    case "invalid_type":
      return "missing_or_wrong_type";
    case "invalid_value":
    case "invalid_union":
      return "invalid_value";
    case "unrecognized_keys":
      return "unknown_keys";
    default:
      return "domain_invariant";
  }
}

export function defaultIssueAction(
  issue: z.core.$ZodIssue,
): StructuredIssueAction {
  switch (issueCategory(issue)) {
    case "maximum":
    case "unknown_keys":
      return "normalize";
    case "minimum":
    case "missing_or_wrong_type":
    case "invalid_value":
      return "repair";
    case "domain_invariant":
      return "fail";
  }
}

export function zodIssueCategories(
  error: z.ZodError,
): StructuredIssueCategory[] {
  return [...new Set(error.issues.map(issueCategory))];
}

export function normalizeExactDuplicates<T>(items: readonly T[]): {
  items: T[];
  droppedCount: number;
} {
  const seen = new Set<string>();
  const normalized: T[] = [];
  let droppedCount = 0;
  for (const item of items) {
    const fingerprint = JSON.stringify(item) ?? String(item);
    if (seen.has(fingerprint)) {
      droppedCount += 1;
      continue;
    }
    seen.add(fingerprint);
    normalized.push(item);
  }
  return { items: normalized, droppedCount };
}

function repairSlotShape(slot: PositionalRepairSlot<unknown>): string {
  if (slot.expectedShape?.trim())
    return sanitizeRecoveryText(slot.expectedShape);
  try {
    // The provider-facing binding intentionally omits string/array cardinality
    // keywords for transport compatibility. The repair prompt must retain the
    // authoritative constraints, otherwise models commonly fill required
    // fields with empty strings/arrays that pass the provider binding but fail
    // application validation.
    return sanitizeRecoveryText(JSON.stringify(toJsonSchema(slot.schema)));
  } catch {
    return "Return one complete corrected JSON value with the required object shape.";
  }
}

const MAX_REPAIR_SOURCE_TEXT_CHARS = 48_000;
const MAX_REPAIR_CONTEXT_CHARS = 16_000;

function boundedRepairText(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  const marker = "\n...[server-bounded repair input]...\n";
  const retained = maximum - marker.length;
  const head = Math.ceil(retained * 0.7);
  return `${value.slice(0, head)}${marker}${value.slice(-(retained - head))}`;
}

function boundedCurrentValue(value: unknown): unknown {
  return typeof value === "string"
    ? boundedRepairText(value, MAX_REPAIR_SOURCE_TEXT_CHARS)
    : value;
}

export function describeRepairSlot(
  fallback: string,
  schema: z.ZodType,
  currentValue: unknown,
  hints: readonly ValidationHint[] = [],
): string {
  const parsed = schema.safeParse(currentValue);
  if (parsed.success || currentValue == null) return fallback;
  return `${fallback}\n${formatValidationReportForModel(
    buildValidationReport(parsed.error, currentValue, hints),
  )}`;
}

function repairPrompt(slots: readonly PositionalRepairSlot<unknown>[]): string {
  const contexts: string[] = [];
  const contextRefs = new Map<string, number>();
  const contextRef = (context: string | undefined): number | undefined => {
    const trimmed = context?.trim();
    if (!trimmed) return undefined;
    const bounded = boundedRepairText(trimmed, MAX_REPAIR_CONTEXT_CHARS);
    const existing = contextRefs.get(bounded);
    if (existing != null) return existing;
    const ref = contexts.length + 1;
    contexts.push(bounded);
    contextRefs.set(bounded, ref);
    return ref;
  };
  const requests = slots.map((slot, index) => ({
    position: index + 1,
    description: sanitizeRecoveryText(slot.description),
    contextRef: contextRef(slot.context),
    currentValue: boundedCurrentValue(slot.currentValue ?? null),
    expectedShape: repairSlotShape(slot),
  }));
  return `Repair only the listed invalid or missing structured values.
Return exactly one corrected value for each request, in the same order.
Do not return indexes, patch operations, prose, markdown, or extra keys.
Honor every constraint in expectedShape. Required strings and required arrays
must contain meaningful non-empty content; never return empty placeholders.
Preserve the meaning and topic of currentValue and its referenced repair context.

Repair contexts (contextRef points into this list):
${JSON.stringify(contexts.map((text, index) => ({ contextRef: index + 1, text })))}

Requests:
${JSON.stringify(requests)}

Return exactly this simple JSON shape:
{"values":[/* corrected value for request 1, request 2, ... */]}`;
}

function repairValueSchema(
  slots: readonly PositionalRepairSlot<unknown>[],
): z.ZodType<unknown> {
  const schemas = slots.map((slot) => slot.schema);
  if (schemas.length === 1) return schemas[0]!;
  return z.union(
    schemas as [
      z.ZodType<unknown>,
      z.ZodType<unknown>,
      ...z.ZodType<unknown>[],
    ],
  );
}

/**
 * One logical repair batch for heterogeneous server-owned slots. Provider
 * transports may retry within the batch, but the model never authors indexes
 * or mutations; the caller applies validated values to known positions.
 */
export async function runSinglePositionalRepair<T>(params: {
  operation: string;
  slots: readonly PositionalRepairSlot<T>[];
  meta?: Record<string, unknown>;
  repairType?: "positional" | "prefix_continuation";
  topicCategory?: TopicCategory | null;
  signal?: AbortSignal;
  contract?: ResolvedStructuredContract;
  /** Provider adapter used by portable runtimes; hosted callers omit it. */
  runner?: PositionalRepairRunner;
}): Promise<T[]> {
  if (params.slots.length === 0) return [];
  const deadline = params.contract
    ? createStructuredDeadline(params.signal, params.contract.limits.timeoutMs, params.contract.timeoutPolicy)
    : undefined;
  const envelopeSchema = z
    .object({
      values: z.array(
        repairValueSchema(
          params.slots as readonly PositionalRepairSlot<unknown>[],
        ),
      ),
    })
    .strict();
  const prompt = repairPrompt(
    params.slots as readonly PositionalRepairSlot<unknown>[],
  );
  const repairMeta = {
    ...(params.meta ?? {}),
    ...(params.contract ? structuredContractLogMeta(params.contract) : {}),
    structuredRecovery: true,
    structuredRepairType: params.repairType ?? "positional",
    structuredStage: "repair",
    repairSlotCount: params.slots.length,
    outputFormat: "structured_positional_values",
  };
  let candidate: z.infer<typeof envelopeSchema> | null = null;
  let lastNativeError: unknown;
  try {
    if (params.runner) {
      candidate = envelopeSchema.parse(
        await params.runner(
          envelopeSchema,
          prompt,
          {
            operation: `${params.operation}.repair`,
            bindingSchema: envelopeSchema,
            meta: repairMeta,
            topicCategory: params.topicCategory,
            resolvedContract: params.contract,
          },
          { signal: deadline?.signal ?? params.signal, onProgress: deadline?.recordProgress },
        ),
      );
    }
    for (
      let methodIndex = 0;
      candidate == null && methodIndex < 3;
      methodIndex += 1
    ) {
      try {
        candidate = await streamStructuredNative(
          envelopeSchema,
          prompt,
          {
            operation:
              methodIndex === 0
                ? `${params.operation}.repair`
                : `${params.operation}.repair.retry`,
            mode: "repair-envelope",
            bindingSchema: envelopeSchema,
            methodIndex,
            throwOnError: true,
            meta: {
              ...repairMeta,
              repairTransportAttempt: methodIndex + 1,
            },
            contract: params.contract,
            onProgress: deadline?.recordProgress,
          },
          undefined,
          deadline?.signal ?? params.signal,
        );
        if (candidate != null) break;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.name !== "StructuredNativeOutputError"
        ) {
          throw error;
        }
        lastNativeError = error;
      }
    }
    if (candidate == null && !params.runner) {
      const raw = await streamChat(prompt, {
        operation: `${params.operation}.repair`,
        meta: {
          ...repairMeta,
          structuredTransport: "prompt-json",
          nativeRepairError: lastNativeError
            ? sanitizeRecoveryText(formatStructuredParseError(lastNativeError))
            : undefined,
        },
        topicCategory: params.topicCategory,
        signal: deadline?.signal ?? params.signal,
        structuredContract: params.contract,
        outputLimits: params.contract?.limits,
        outputMode: "object",
        onProgress: deadline?.recordProgress,
      });
      const parsed = envelopeSchema.safeParse(parseLlmJson(raw));
      if (!parsed.success) {
        throw new PositionalRepairError([
          formatStructuredParseError(parsed.error),
        ]);
      }
      candidate = parsed.data;
    }
  } finally {
    deadline?.cleanup();
  }

  if (candidate == null) {
    throw new PositionalRepairError([
      "repair response did not contain one valid structured object",
    ]);
  }
  if (candidate.values.length !== params.slots.length) {
    throw new PositionalRepairError([
      `repair response returned ${candidate.values.length} value(s); expected ${params.slots.length}`,
    ]);
  }

  const parsed = candidate.values.map((value, index) => {
    const result = params.slots[index]!.schema.safeParse(value);
    return result.success
      ? { success: true as const, data: result.data }
      : {
          success: false as const,
          error: `repair value ${index + 1}: ${formatStructuredParseError(result.error)}`,
        };
  });
  const issues = parsed.flatMap((result) =>
    result.success ? [] : [result.error],
  );
  if (issues.length > 0) throw new PositionalRepairError(issues);

  return parsed.flatMap((result) => (result.success ? [result.data] : []));
}
