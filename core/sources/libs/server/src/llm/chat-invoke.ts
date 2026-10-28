import type { BaseMessage } from "@langchain/core/messages";
import type { TopicCategory } from "../../../common/src/index.js";
import { getChatModel } from "./client.js";
import { beginLlmRequestLog, logLlmContextResolutionFailure } from "./logger.js";
import { parseMessageForLog } from "./parse-log-response.js";
import { extractTokenUsage, usageLogFields } from "./token-usage.js";
import {
  canonicalLlmOperationKey,
  getActiveLlmOperationRoute,
  withLlmOperationRoute,
} from "../providers/llm/index.js";
import {
  generationContextPromptPrefix,
  prepareGenerationInvocation,
  runMergedGenerationContextScope,
} from "../generation/kernel.js";
import type { LearningSystemSubject } from "../learning-systems/types.js";

export type ChatInvokeOptions = {
  operation: string;
  meta?: Record<string, unknown>;
  topicCategory?: TopicCategory | null;
  contextSubject?: LearningSystemSubject;
  contextQuery?: string;
};

/** Invoke chat model with full request/response logging. */
export async function invokeChat(
  prompt: string,
  options: ChatInvokeOptions,
): Promise<BaseMessage> {
  if (options.contextSubject) {
    return runMergedGenerationContextScope(
      {
        subject: { ...options.contextSubject },
        query: options.contextQuery,
      },
      () =>
        invokeChat(prompt, {
          ...options,
          contextSubject: undefined,
          contextQuery: undefined,
        }),
    );
  }
  if (
    getActiveLlmOperationRoute()?.operationKey !==
    canonicalLlmOperationKey(options.operation)
  ) {
    return withLlmOperationRoute(options.operation, () =>
      invokeChat(prompt, options),
    );
  }
  const started = Date.now();
  let prepared: Awaited<ReturnType<typeof prepareGenerationInvocation>>;
  try {
    prepared = await prepareGenerationInvocation(options.operation, prompt);
  } catch (error) {
    await logLlmContextResolutionFailure({
      operation: options.operation,
      request: { promptLength: prompt.length, ...options.meta },
      startedAt: started,
      error,
    });
    throw error;
  }
  const promptWithMarkup = prepared.prompt;
  const request = {
    prompt: promptWithMarkup,
    promptLength: prompt.length,
    ...prepared.contextMeta,
    ...options.meta,
  };

  const logHandle = await beginLlmRequestLog({
    operation: options.operation,
    kind: "chat",
    request,
    setActiveSpan: true,
  });

  try {
    const msg = await (
      await getChatModel({
        cachePrefix: generationContextPromptPrefix(
          promptWithMarkup,
          prepared.contextMeta,
        ),
      })
    ).invoke(promptWithMarkup);
    const parsed = parseMessageForLog(msg);
    const durationMs = Date.now() - started;

    await logHandle?.finish({
      status: "success",
      durationMs,
      response: {
        raw: parsed.raw,
        ...(parsed.toolCalls.length ? { toolCalls: parsed.toolCalls } : {}),
        rawLength: parsed.raw.length,
        toolCallCount: parsed.toolCalls.length,
        ...usageLogFields(extractTokenUsage(msg), durationMs),
      },
    });

    return msg;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logHandle?.finish({
      status: "error",
      durationMs: Date.now() - started,
      error: message,
    });
    throw err;
  }
}
