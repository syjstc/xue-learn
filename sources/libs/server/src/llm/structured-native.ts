import type { z } from "zod";
import type { StreamTokenHandler } from "./chat-stream.js";
import { isJsonSchemaCompatible } from "./json-schema-compat.js";
import { beginLlmRequestLog, logLlmContextResolutionFailure } from "./logger.js";
import {
  structuredResponseRawForLog,
  type ParsedChatLog,
} from "./parse-log-response.js";
import { formatStructuredParseError } from "./parse-structured.js";
import { resolveNativeStructuredPayload } from "./structured-native-parse.js";
import { getLlmProvider } from "./providers/index.js";
import { extractTokenUsage, usageLogFields } from "./token-usage.js";
import { projectProviderBindingSchema } from "../providers/llm/provider-binding-schema.js";
import type { StructuredOutputMode } from "../providers/llm/structured-output-adapter.js";
import { StructuredOutputAttemptError } from "../providers/llm/structured-output-adapter.js";
import {
  findUnknownStructuredKeys,
  structuredCandidateHash,
  StructuredTextLimitGuard,
  type ResolvedStructuredContract,
} from "./structured-contract.js";
import {
  generationContextPromptPrefix,
  prepareGenerationInvocation,
} from "../generation/kernel.js";

type StructuredNativeOptions = {
  operation: string;
  bindingSchema?: z.ZodType | Record<string, unknown>;
  /** Normalize a recovered provider candidate before final schema validation. */
  normalizeCandidate?: (candidate: unknown) => unknown;
  /**
   * Select exactly one provider-native method for this logical attempt. An
   * out-of-range index means native output is unavailable and makes no model
   * request, allowing the caller to use prompt JSON in the same attempt.
   */
  methodIndex?: number;
  /** Surface an attempted native-output failure instead of returning null. */
  throwOnError?: boolean;
  mode?: StructuredOutputMode;
  preferSchemaConstrained?: boolean;
  schemaShape?: string;
  meta?: Record<string, unknown>;
  contract?: ResolvedStructuredContract;
  /** Internal deadline activity, independent of UI token/preview consumers. */
  onProgress?: () => void;
};

export class StructuredNativeOutputError extends Error {
  constructor(
    message: string,
    readonly candidateHash?: string,
    /** Original provider output retained for schema-guided format repair. */
    readonly originalText?: string,
  ) {
    super(message);
    this.name = "StructuredNativeOutputError";
  }
}

class StructuredNativeConsumerCallbackError extends Error {
  constructor(readonly originalError: unknown) {
    super(
      originalError instanceof Error
        ? originalError.message
        : "Structured-output consumer callback failed",
    );
    this.name = "StructuredNativeConsumerCallbackError";
  }
}

type RawStructuredResult = {
  raw?: unknown;
  parsed?: unknown;
};

function isRawStructuredResult(value: unknown): value is RawStructuredResult {
  return typeof value === "object" && value !== null && "parsed" in value;
}

function isAbortLike(error: unknown, signal?: AbortSignal): boolean {
  return (
    Boolean(signal?.aborted) ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error &&
      (error.name === "AbortError" ||
        error.name === "GenerationCancelledError"))
  );
}

function isAuthorizationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status = Number(candidate.statusCode ?? candidate.status);
  return status === 401 || status === 403;
}

function passthroughError(
  error: unknown,
  signal?: AbortSignal,
): { passthrough: true; error: unknown } | { passthrough: false } {
  if (error instanceof StructuredNativeConsumerCallbackError) {
    return { passthrough: true, error: error.originalError };
  }
  if (isAbortLike(error, signal)) {
    return {
      passthrough: true,
      error:
        signal?.reason instanceof Error && signal.aborted
          ? signal.reason
          : error,
    };
  }
  if (isAuthorizationError(error)) return { passthrough: true, error };
  return { passthrough: false };
}

/** Build a ParsedChatLog from a structured candidate when the provider raw message is empty. */
function parsedLogFromCandidate(candidate: unknown): ParsedChatLog {
  const raw =
    typeof candidate === "string"
      ? candidate
      : JSON.stringify(candidate ?? null);
  return {
    raw,
    text: raw,
    toolCalls: [],
    jsonPreview:
      candidate != null && typeof candidate === "object"
        ? candidate
        : undefined,
  };
}

function resolveAttemptRawLog(
  candidate: unknown,
  raw: unknown,
): ParsedChatLog | undefined {
  const { rawLog } = resolveNativeStructuredPayload(
    isRawStructuredResult(raw) ? raw : { parsed: candidate, raw },
  );
  const hasVisibleOutput =
    Boolean(rawLog?.text?.trim()) ||
    Boolean(rawLog?.toolCalls?.length) ||
    rawLog?.jsonPreview != null;
  if (hasVisibleOutput) return rawLog;
  if (candidate == null) return rawLog;
  return parsedLogFromCandidate(candidate);
}

function structuredErrorResponse(
  rawLog: ParsedChatLog | undefined,
  method?: string,
  failedCandidate?: unknown,
) {
  const parsed =
    rawLog ??
    (failedCandidate != null
      ? parsedLogFromCandidate(failedCandidate)
      : undefined);
  if (!parsed && failedCandidate == null) return undefined;
  return {
    raw: structuredResponseRawForLog(parsed, failedCandidate),
    rawLength: parsed?.raw.length ?? 0,
    structuredOutput: true,
    ...(method ? { structuredOutputMethod: method } : {}),
  };
}

async function invokeNativeStructured<T extends z.ZodType>(
  schema: T,
  prompt: string,
  options: StructuredNativeOptions,
  signal?: AbortSignal,
  onPartial?: (partial: unknown) => void | Promise<void>,
  onToken?: StreamTokenHandler,
): Promise<z.infer<T> | null> {
  signal?.throwIfAborted();
  const schemaForBinding = options.bindingSchema ?? schema;
  if (!options.bindingSchema && !isJsonSchemaCompatible(schemaForBinding)) {
    return null;
  }

  const provider = getLlmProvider();
  let projectedBindingSchema: Record<string, unknown>;
  try {
    projectedBindingSchema = projectProviderBindingSchema(schemaForBinding);
  } catch {
    // The schema cannot be represented as a provider JSON Schema (e.g. it
    // embeds transforms); native output is unavailable and the caller falls
    // back to prompt JSON.
    return null;
  }
  const attempts = provider.structuredOutput.createAttemptPlan({
    mode: options.mode ?? "object",
    bindingSchema: projectedBindingSchema,
    preferSchemaConstrained: options.preferSchemaConstrained,
  });
  const methodIndex = options.methodIndex ?? 0;
  const selectedAttempt =
    Number.isInteger(methodIndex) && methodIndex >= 0
      ? attempts[methodIndex]
      : undefined;
  if (!selectedAttempt || selectedAttempt.transport !== "native") return null;
  const started = Date.now();
  let prepared: Awaited<ReturnType<typeof prepareGenerationInvocation>>;
  try {
    prepared = await prepareGenerationInvocation(options.operation, prompt);
  } catch (error) {
    await logLlmContextResolutionFailure({
      operation: options.operation,
      request: {
        promptLength: prompt.length,
        schemaShape: options.schemaShape,
        hasBindingSchema: Boolean(options.bindingSchema),
        ...options.meta,
      },
      startedAt: started,
      error,
    });
    throw error;
  }
  const request = {
    prompt:
      options.meta?.redactLogs === true
        ? "[redacted-sensitive-input]"
        : prepared.prompt,
    promptLength: prompt.length,
    schemaShape: options.schemaShape,
    hasBindingSchema: Boolean(options.bindingSchema),
    provider: getLlmProvider().id,
    ...prepared.contextMeta,
    ...options.meta,
  };

  let lastError = "";
  let lastRawLog: ParsedChatLog | undefined;
  let lastFailedCandidate: unknown;
  let lastMethod: string | undefined = selectedAttempt.id;
  let lastUnknownKeyCount = 0;
  let streamedRaw = "";
  let outputEvents = 0;
  let reasoningEvents = 0;
  let outputBytes = 0;
  let firstProgressMs: number | undefined;
  let lastProgressMs: number | undefined;
  const redactLogs = options.meta?.redactLogs === true;

  const logHandle = await beginLlmRequestLog({
    operation: options.operation,
    kind: "chat",
    request,
    setActiveSpan: true,
  });
  const progressMeta = () => ({
    structuredStreamProgress: {
      outputEvents, reasoningEvents, outputBytes, firstProgressMs, lastProgressMs,
    },
  });
  const recordProgress = async (kind: "output" | "reasoning") => {
    if (kind === "reasoning") reasoningEvents += 1;
    else outputEvents += 1;
    lastProgressMs = Date.now() - started;
    firstProgressMs ??= lastProgressMs;
    options.onProgress?.();
    await logHandle?.recordFirstResponse?.();
  };

  try {
    const result = await provider.structuredOutput.executeAttempt(
      {
        schema,
        bindingSchema: projectedBindingSchema,
        prompt: prepared.prompt,
        attempt: selectedAttempt,
        maxTokens: options.contract?.limits.maxTokens,
        cachePrefix: generationContextPromptPrefix(
          prepared.prompt,
          prepared.contextMeta,
        ),
        limits: options.contract?.limits,
        contract: options.contract,
        signal,
      },
      {
        onProgress: recordProgress,
        onToken: async (delta) => {
          // Keep output evidence even when the caller has no live preview.
          // Native schema streams can publish cumulative JSON snapshots.
          if (delta) {
            streamedRaw = delta.startsWith(streamedRaw) ? delta : streamedRaw + delta;
            streamedRaw = streamedRaw.slice(0, options.contract?.limits.maximumRawBytes ?? 1024 * 1024);
            outputBytes = Buffer.byteLength(streamedRaw);
          }
          try {
            await onToken?.(delta);
          } catch (error) {
            throw new StructuredNativeConsumerCallbackError(error);
          }
        },
        onPartialCandidate: onPartial
          ? async (candidate) => {
              try {
                await onPartial(candidate);
              } catch (error) {
                throw new StructuredNativeConsumerCallbackError(error);
              }
            }
          : undefined,
      },
    );
    if (result.kind === "unavailable") {
      await logHandle?.finish({
        status: "error",
        durationMs: Date.now() - started,
        response: { structuredOutcome: "unavailable", ...progressMeta() },
        error: redactLogs ? "[redacted-sensitive-error]" : result.reason,
      });
      return null;
    }
    const parsedCandidate = result.candidate;
    lastFailedCandidate = parsedCandidate;
    const rawLog = resolveAttemptRawLog(parsedCandidate, result.raw);
    lastRawLog = rawLog;
    lastMethod = selectedAttempt.id;
    if (parsedCandidate == null) {
      throw new Error("Native structured output returned no parsed payload");
    }
    if (options.contract) {
      const serialized = JSON.stringify(parsedCandidate);
      const guard = new StructuredTextLimitGuard(
        options.contract.limits,
        options.contract.mode,
      );
      guard.push(serialized);
      guard.finish();
    }

    const normalizedCandidate = options.normalizeCandidate
      ? options.normalizeCandidate(parsedCandidate)
      : parsedCandidate;
    lastFailedCandidate = normalizedCandidate;
    const unknownKeys = findUnknownStructuredKeys(
      normalizedCandidate,
      projectedBindingSchema,
    );
    lastUnknownKeyCount = unknownKeys.length;
    if (
      options.contract?.unknownKeyMode === "enforce" &&
      unknownKeys.length > 0
    ) {
      throw new Error(
        `response contains unknown properties: ${unknownKeys.slice(0, 20).join(", ")}`,
      );
    }
    const parsed = schema.parse(normalizedCandidate);
    const durationMs = Date.now() - started;
    const raw = isRawStructuredResult(result.raw) ? result.raw.raw : result.raw;

    await logHandle?.finish({
      status: "success",
      durationMs,
      response: {
        ...progressMeta(),
        raw: redactLogs
          ? "[redacted-sensitive-output]"
          : structuredResponseRawForLog(rawLog, parsedCandidate),
        rawLength: rawLog?.raw.length ?? JSON.stringify(parsedCandidate).length,
        structuredOutput: true,
        structuredOutputMethod: selectedAttempt.id,
        structuredOutputStrict: selectedAttempt.strict === true,
        structuredSyntaxRepaired: result.syntaxRepaired === true,
        structuredRepairType:
          result.syntaxRepaired === true ? "deterministic_json" : undefined,
        structuredUnknownKeyCount: lastUnknownKeyCount,
        structuredValidationStage: "schema",
        structuredOutcome: "success",
        ...usageLogFields(
          extractTokenUsage(raw as { usage_metadata?: unknown } | undefined),
          durationMs,
        ),
      },
    });

    return parsed;
  } catch (err) {
    if (err instanceof StructuredOutputAttemptError) {
      lastRawLog = resolveAttemptRawLog(undefined, {
        parsed: null,
        raw: err.rawResponse,
      });
    }
    if (!lastRawLog && streamedRaw) {
      // This is diagnostic evidence only; never promote an interrupted prefix
      // to an accepted candidate or commit it as complete teaching content.
      lastRawLog = resolveAttemptRawLog(undefined, { content: streamedRaw });
    }
    const passthrough = passthroughError(err, signal);
    if (passthrough.passthrough) {
      await logHandle?.finish({
        status: "error",
        durationMs: Date.now() - started,
        response: {
          ...progressMeta(),
          ...(redactLogs
            ? {}
            : (structuredErrorResponse(
                lastRawLog,
                lastMethod,
                lastFailedCandidate,
              ) ?? {})),
          structuredUnknownKeyCount: lastUnknownKeyCount,
          structuredValidationStage:
            lastFailedCandidate == null ? "generation" : "schema",
          structuredOutcome: "error",
          ...(lastFailedCandidate == null && streamedRaw ? { partial: true } : {}),
        },
        error: redactLogs
          ? "[redacted-sensitive-error]"
          : formatStructuredParseError(passthrough.error),
      });
      throw err;
    }
    lastError = formatStructuredParseError(err);
  }

  await logHandle?.finish({
    status: "error",
    durationMs: Date.now() - started,
    response: {
      ...progressMeta(),
      ...(redactLogs
        ? {}
        : (structuredErrorResponse(
            lastRawLog,
            lastMethod,
            lastFailedCandidate,
          ) ?? {})),
      structuredUnknownKeyCount: lastUnknownKeyCount,
      structuredValidationStage:
        lastFailedCandidate == null ? "generation" : "schema",
      structuredOutcome: "error",
      ...(lastFailedCandidate == null && streamedRaw ? { partial: true } : {}),
    },
    error: redactLogs
      ? "[redacted-sensitive-error]"
      : lastError || "Native structured output attempt failed",
  });

  throw new StructuredNativeOutputError(
    redactLogs
      ? "Sensitive structured output attempt failed"
      : lastError || "Native structured output attempt failed",
    lastFailedCandidate == null
      ? undefined
      : structuredCandidateHash(lastFailedCandidate),
    !redactLogs &&
      typeof structuredResponseRawForLog(lastRawLog, lastFailedCandidate) ===
        "string"
      ? (structuredResponseRawForLog(lastRawLog, lastFailedCandidate) as string)
      : undefined,
  );
}

export async function invokeStructuredNative<T extends z.ZodType>(
  schema: T,
  prompt: string,
  options: StructuredNativeOptions,
  signal?: AbortSignal,
): Promise<z.infer<T> | null> {
  try {
    return await invokeNativeStructured(schema, prompt, options, signal);
  } catch (error) {
    const passthrough = passthroughError(error, signal);
    if (passthrough.passthrough) throw passthrough.error;
    if (options.throwOnError) {
      throw error instanceof StructuredNativeOutputError
        ? error
        : new StructuredNativeOutputError(formatStructuredParseError(error));
    }
    return null;
  }
}

export async function streamStructuredNative<T extends z.ZodType>(
  schema: T,
  prompt: string,
  options: StructuredNativeOptions,
  onToken?: StreamTokenHandler,
  signal?: AbortSignal,
  onPartial?: (partial: unknown) => void | Promise<void>,
): Promise<z.infer<T> | null> {
  let parsed: z.infer<T> | null;
  try {
    parsed = await invokeNativeStructured(
      schema,
      prompt,
      options,
      signal,
      onPartial,
      onToken,
    );
  } catch (error) {
    const passthrough = passthroughError(error, signal);
    if (passthrough.passthrough) throw passthrough.error;
    if (options.throwOnError) {
      throw error instanceof StructuredNativeOutputError
        ? error
        : new StructuredNativeOutputError(formatStructuredParseError(error));
    }
    parsed = null;
  }
  return parsed;
}
