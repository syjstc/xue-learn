import { createOpenAiCompatibleStructuredOutputAdapter } from "../../openai-compatible-structured-output.js";
import type {
  StructuredOutputAdapter,
  StructuredOutputAttempt,
  StructuredOutputAttemptPlanRequest,
  StructuredOutputCapableModel,
} from "../../structured-output-adapter.js";
import { createBigModelStructuredOutputAdapter } from "../bigmodel/structured-output.js";
import { createDeepseekStructuredOutputAdapter } from "../deepseek/structured-output.js";
import { createMinimaxStructuredOutputAdapter } from "../minimax/structured-output.js";
import {
  isQwenChatModel,
  isQwenCompatibleEndpoint,
} from "../qwen/options.js";
import { createQwenStructuredOutputAdapter } from "../qwen/structured-output.js";
import type { CustomThinkingProtocol } from "./options.js";

type GetCustomModel = (options?: {
  maxTokens?: number;
}) => StructuredOutputCapableModel;

function createOpenAiJsonSchemaAdapter(getModel: GetCustomModel) {
  return createOpenAiCompatibleStructuredOutputAdapter({
    getModel,
    // Prefer response_format.json_schema (with a compiled schema). Non-strict
    // json_schema covers gateways that 400 on `strict`. Function calling is
    // the schema-bearing fallback when the endpoint has no json_schema.
    methods: [
      { method: "jsonSchema", strict: true },
      "jsonSchema",
      { method: "functionCalling", strict: true },
    ],
    strictBinding: "openai",
  });
}

function createDeepseekToolAdapter(
  getModel: GetCustomModel,
  thinkingEnabled?: boolean,
) {
  return createDeepseekStructuredOutputAdapter({
    getDefaultModel: getModel,
    // Custom endpoints have one URL; reuse it for DeepSeek-style strict FC.
    getStrictModel: getModel,
    strictEnabled: true,
    thinkingEnabled,
  });
}

function uniqueAttempts(
  attempts: readonly StructuredOutputAttempt[],
): StructuredOutputAttempt[] {
  const seen = new Set<string>();
  const unique: StructuredOutputAttempt[] = [];
  for (const attempt of attempts) {
    const key = `${attempt.transport}:${attempt.method ?? ""}:${attempt.strict === true}:${attempt.modelTarget ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(attempt);
  }
  return unique;
}

/**
 * Unknown OpenAI-compatible gateways: try OpenAI json_schema, then DeepSeek
 * strict tool calling, then prompt JSON recovery.
 */
function createUnknownCustomStructuredOutputAdapter(
  getModel: GetCustomModel,
): StructuredOutputAdapter {
  const openaiAdapter = createOpenAiJsonSchemaAdapter(getModel);
  const deepseekAdapter = createDeepseekToolAdapter(getModel);
  return {
    createAttemptPlan(request: StructuredOutputAttemptPlanRequest) {
      if (request.mode === "root-array" || request.mode === "json-lines") {
        return [{ id: "raw", transport: "raw" }];
      }
      const maxAttempts = Math.min(request.maxAttempts ?? 4, 4);
      if (request.preferSchemaConstrained) {
        const deepseek = uniqueAttempts(
          deepseekAdapter.createAttemptPlan(request),
        ).filter(
          (attempt) =>
            attempt.transport === "native" &&
            attempt.method === "functionCalling" &&
            attempt.strict === true,
        );
        if (deepseek.length > 0) return deepseek.slice(0, maxAttempts);
        return uniqueAttempts(openaiAdapter.createAttemptPlan(request))
          .filter(
            (attempt) =>
              attempt.transport === "native" && attempt.method === "jsonSchema",
          )
          .slice(0, maxAttempts);
      }
      const jsonSchema = uniqueAttempts(
        openaiAdapter.createAttemptPlan({ ...request, maxAttempts: 3 }),
      ).filter(
        (attempt) =>
          attempt.transport === "native" && attempt.method === "jsonSchema",
      );
      const toolCall = uniqueAttempts(
        deepseekAdapter.createAttemptPlan({ ...request, maxAttempts: 3 }),
      ).find((attempt) => attempt.method === "functionCalling");
      const attempts: StructuredOutputAttempt[] = [
        ...jsonSchema,
        ...(toolCall ? [toolCall] : []),
        { id: "prompt-json", transport: "prompt-json" },
      ];
      return attempts.slice(0, maxAttempts);
    },
    executeAttempt(request, callbacks) {
      if (request.attempt.method === "functionCalling") {
        return deepseekAdapter.executeAttempt(request, callbacks);
      }
      return openaiAdapter.executeAttempt(request, callbacks);
    },
  };
}

export function createCustomStructuredOutputAdapter(params: {
  protocol: CustomThinkingProtocol;
  getModel: GetCustomModel;
  thinkingEnabled?: boolean;
  chatModel?: string;
  baseUrl?: string;
}): StructuredOutputAdapter {
  const protocol =
    params.protocol === "none" &&
    (isQwenChatModel(params.chatModel) ||
      isQwenCompatibleEndpoint(params.baseUrl))
      ? "qwen"
      : params.protocol;
  switch (protocol) {
    case "openai":
      return createOpenAiJsonSchemaAdapter(params.getModel);
    case "deepseek":
      return createDeepseekToolAdapter(
        params.getModel,
        params.thinkingEnabled,
      );
    case "minimax":
      return createMinimaxStructuredOutputAdapter({
        getModel: params.getModel,
      });
    case "doubao":
      return createOpenAiCompatibleStructuredOutputAdapter({
        getModel: params.getModel,
        methods: [
          { method: "jsonSchema", strict: true },
          "jsonSchema",
          "functionCalling",
        ],
        strictBinding: "openai",
      });
    case "bigmodel":
      return createBigModelStructuredOutputAdapter({
        getModel: params.getModel,
      });
    case "qwen":
      return createQwenStructuredOutputAdapter({
        getModel: params.getModel,
        thinkingEnabled: params.thinkingEnabled,
      });
    case "ollama":
      return createOpenAiCompatibleStructuredOutputAdapter({
        getModel: params.getModel,
        methods: ["jsonMode", "functionCalling"],
      });
    default:
      return createUnknownCustomStructuredOutputAdapter(params.getModel);
  }
}
