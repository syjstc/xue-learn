import { HumanMessage } from "@langchain/core/messages";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import type { z } from "zod";
import {
  withExplicitLlmSelection,
  withLlmOperationRoute,
  type LlmProviderSelection,
} from "../providers/llm/index.js";
import { prepareGenerationInvocation } from "../generation/kernel.js";
import { getChatModel } from "./client.js";
import { beginLlmRequestLog, logLlmContextResolutionFailure } from "./logger.js";
import {
  parseMessageForLog,
  structuredResponseRawForLog,
} from "./parse-log-response.js";
import { extractTokenUsage, usageLogFields } from "./token-usage.js";
import {
  compileOpenAiStrictBindingSchema,
  normalizeStrictBindingCandidate,
} from "../providers/llm/strict-binding-schema.js";

/** Generation Kernel adapter for one image plus a strict structured result. */
export async function invokeMultimodalStructured<T extends z.ZodType>(params: {
  operation: string;
  prompt: string;
  imageDataUrl: string;
  imageDetail: "low" | "high" | "original" | "auto";
  schema: T;
  bindingName: string;
  selection: LlmProviderSelection;
  maxTokens?: number;
  signal?: AbortSignal;
  meta?: Record<string, unknown>;
}): Promise<z.infer<T>> {
  return withLlmOperationRoute(params.operation, () =>
    withExplicitLlmSelection(params.selection, async () => {
      const started = Date.now();
      let prepared: Awaited<ReturnType<typeof prepareGenerationInvocation>>;
      try {
        prepared = await prepareGenerationInvocation(
          params.operation,
          params.prompt,
        );
      } catch (error) {
        await logLlmContextResolutionFailure({
          operation: params.operation,
          request: { promptLength: params.prompt.length, ...params.meta },
          startedAt: started,
          error,
        });
        throw error;
      }
      const log = await beginLlmRequestLog({
        operation: params.operation,
        kind: "chat",
        request: {
          prompt: prepared.prompt,
          promptLength: params.prompt.length,
          imageCount: 1,
          imageDetail: params.imageDetail,
          ...prepared.contextMeta,
          ...params.meta,
        },
        setActiveSpan: true,
      });
      try {
        const model = await getChatModel({ maxTokens: params.maxTokens });
        // GLM accepts JSON Object output but not a forced function choice.
        const protocol =
          params.selection.id === "custom"
            ? params.selection.options?.customThinkingProtocol
            : params.selection.id;
        const jsonMode =
          protocol === "bigmodel" ||
          (protocol === "deepseek" &&
            params.selection.options?.deepseekThinkingEnabled === true) ||
          (protocol === "qwen" &&
            params.selection.options?.qwenThinkingEnabled === true);
        const method = jsonMode ? "jsonMode" : "functionCalling";
        const openAiStrict =
          !jsonMode && (protocol === "codex" || protocol === "openai");
        const binding = openAiStrict
          ? compileOpenAiStrictBindingSchema(params.schema)
          : params.schema;
        if (!binding)
          throw new Error(
            "Image observation schema cannot be represented by OpenAI strict mode",
          );
        const runnable = model.withStructuredOutput(binding, {
          name: params.bindingName,
          method,
          ...(jsonMode ? {} : { strict: true }),
          includeRaw: true,
        });
        const result = (await runnable.invoke(
          [
            new HumanMessage({
              content: [
                {
                  type: "text",
                  text: jsonMode
                    ? `${prepared.prompt}\nReturn a JSON object matching this schema:\n${JSON.stringify(toJsonSchema(params.schema))}`
                    : prepared.prompt,
                },
                {
                  type: "image_url",
                  image_url: {
                    url: params.imageDataUrl,
                    detail: params.imageDetail,
                  },
                },
              ],
            }),
          ],
          { signal: params.signal },
        )) as { parsed?: unknown; raw?: unknown };
        const parsed = params.schema.parse(
          openAiStrict
            ? normalizeStrictBindingCandidate(result.parsed, params.schema)
            : result.parsed,
        );
        const durationMs = Date.now() - started;
        const raw = result.raw as Parameters<typeof parseMessageForLog>[0];
        const logged = raw ? parseMessageForLog(raw) : null;
        const responseRaw = structuredResponseRawForLog(logged, parsed);
        await log?.finish({
          status: "success",
          durationMs,
          response: {
            raw: responseRaw,
            ...(logged?.toolCalls.length
              ? { toolCalls: logged.toolCalls }
              : {}),
            rawLength:
              typeof responseRaw === "string"
                ? responseRaw.length
                : JSON.stringify(responseRaw ?? null).length,
            structuredOutput: true,
            structuredOutputMethod: method,
            structuredOutcome: "success",
            ...(raw ? usageLogFields(extractTokenUsage(raw), durationMs) : {}),
          },
        });
        return parsed;
      } catch (error) {
        await log?.finish({
          status: "error",
          durationMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }),
  );
}
