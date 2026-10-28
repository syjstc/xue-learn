import type { TopicCategory } from "../../../common/src/index.js";
import { GenerationCancelledError } from "../generation/errors.js";
import { getChatModel } from "./client.js";
import { beginLlmRequestLog, logLlmContextResolutionFailure } from "./logger.js";
import {
  extractAssistantStreamDelta,
  extractAssistantStreamChunk,
  stripThinkingTags,
  ThinkingTagStreamFilter,
} from "./sanitize-response.js";
import { parseChatLogResponse } from "./parse-log-response.js";
import {
  extractTokenUsage,
  rememberStreamUsageChunk,
  usageLogFields,
} from "./token-usage.js";
import {
  StructuredTextLimitGuard,
  type ResolvedStructuredContract,
  type StructuredOutputLimits,
  structuredContractLogMeta,
} from "./structured-contract.js";
import {
  canonicalLlmOperationKey,
  getActiveLlmOperationRoute,
  markActiveLlmRouteOutputStarted,
  withLlmOperationRoute,
} from "../providers/llm/index.js";
import {
  generationContextPromptPrefix,
  prepareGenerationInvocation,
  runMergedGenerationContextScope,
} from "../generation/kernel.js";
import type { LearningSystemSubject } from "../learning-systems/types.js";

export type StreamTokenHandler = (delta: string) => void | Promise<void>;
export type StreamThinkingHandler = () => void | Promise<void>;

/** Stream chat tokens; returns full assembled text. */
export async function streamChat(
  prompt: string,
  options: {
    operation: string;
    meta?: Record<string, unknown>;
    topicCategory?: TopicCategory | null;
    onToken?: StreamTokenHandler;
    onThinking?: StreamThinkingHandler;
    /** Internal streaming activity, without exposing hidden reasoning text. */
    onProgress?: () => void;
    signal?: AbortSignal;
    structuredContract?: ResolvedStructuredContract;
    outputLimits?: StructuredOutputLimits;
    outputMode?: string;
    contextSubject?: LearningSystemSubject;
    contextQuery?: string;
    contextInvocation?: unknown;
  },
): Promise<string> {
  if (options.contextSubject) {
    return runMergedGenerationContextScope(
      {
        subject: { ...options.contextSubject },
        query: options.contextQuery,
        invocation: options.contextInvocation,
      },
      () =>
        streamChat(prompt, {
          ...options,
          contextSubject: undefined,
          contextQuery: undefined,
          contextInvocation: undefined,
        }),
    );
  }
  if (
    getActiveLlmOperationRoute()?.operationKey !==
    canonicalLlmOperationKey(options.operation)
  ) {
    return withLlmOperationRoute(options.operation, () =>
      streamChat(prompt, options),
    );
  }
  const started = Date.now();
  let prepared: Awaited<ReturnType<typeof prepareGenerationInvocation>>;
  try {
    prepared = await prepareGenerationInvocation(options.operation, prompt);
  } catch (error) {
    await logLlmContextResolutionFailure({
      operation: options.operation,
      request: {
        promptLength: prompt.length,
        ...(options.structuredContract
          ? structuredContractLogMeta(options.structuredContract)
          : {}),
        ...options.meta,
      },
      startedAt: started,
      error,
    });
    throw error;
  }
  const promptWithMarkup = prepared.prompt;
  const redactLogs = options.meta?.redactLogs === true;
  const request = {
    prompt: redactLogs ? "[redacted-sensitive-input]" : promptWithMarkup,
    promptLength: prompt.length,
    ...prepared.contextMeta,
    ...(options.structuredContract
      ? structuredContractLogMeta(options.structuredContract)
      : {}),
    ...options.meta,
  };
  let raw = "";
  let lastChunk: { usage_metadata?: unknown; response_metadata?: unknown } | undefined;
  let usageChunk: typeof lastChunk;
  const tagFilter = new ThinkingTagStreamFilter();
  const guard = options.outputLimits
    ? new StructuredTextLimitGuard(
        options.outputLimits,
        options.outputMode ?? "object",
      )
    : undefined;

  const logHandle = await beginLlmRequestLog({
    operation: options.operation,
    kind: "chat",
    request,
    setActiveSpan: true,
  });

  try {
    const stream = await (
      await getChatModel({
        maxTokens: options.outputLimits?.maxTokens,
        cachePrefix: generationContextPromptPrefix(
          promptWithMarkup,
          prepared.contextMeta,
        ),
      })
    ).stream(promptWithMarkup, {
      signal: options.signal,
    });
    for await (const chunk of stream) {
      lastChunk = chunk;
      usageChunk = rememberStreamUsageChunk(usageChunk, chunk);
      if (options.signal?.aborted)
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new GenerationCancelledError();
      const streamChunk = extractAssistantStreamChunk(chunk);
      if (!streamChunk.delta && !streamChunk.thinking) continue;
      options.onProgress?.();
      if (logHandle) {
        await logHandle.recordFirstResponse();
      }
      const rawDelta = extractAssistantStreamDelta(chunk);
      if (rawDelta) guard?.push(rawDelta);
      raw += rawDelta;
      if (streamChunk.thinking) {
        await options.onThinking?.();
      }
      if (streamChunk.delta) {
        await tagFilter.push(streamChunk.delta, {
          onVisible: async (delta) => {
            markActiveLlmRouteOutputStarted();
            await options.onToken?.(delta);
          },
          onThinking: options.onThinking,
        });
      }
      if (options.signal?.aborted)
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new GenerationCancelledError();
    }
    guard?.finish();
    await tagFilter.flush({
      onVisible: async (delta) => {
        markActiveLlmRouteOutputStarted();
        await options.onToken?.(delta);
      },
      onThinking: options.onThinking,
    });

    const parsed = parseChatLogResponse(stripThinkingTags(raw));
    const durationMs = Date.now() - started;

    await logHandle?.finish({
      status: "success",
      durationMs,
      response: {
        raw: redactLogs ? "[redacted-sensitive-output]" : raw,
        rawLength: parsed.raw.length,
        streamed: true,
        toolCallCount: parsed.toolCalls.length,
        ...usageLogFields(
          extractTokenUsage(usageChunk ?? lastChunk),
          durationMs,
        ),
      },
    });

    return raw;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const partialParsed = raw
      ? parseChatLogResponse(stripThinkingTags(raw))
      : undefined;
    await logHandle?.finish({
      status: "error",
      durationMs: Date.now() - started,
      response: partialParsed
        ? {
            raw: redactLogs ? "[redacted-sensitive-output]" : raw,
            rawLength: partialParsed.raw.length,
            streamed: true,
            partial: true,
          }
        : undefined,
      error: redactLogs ? "[redacted-sensitive-error]" : message,
    });
    throw err;
  }
}
