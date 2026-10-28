import {
  createOpenAiCompatibleStructuredOutputAdapter,
  executeOpenAiCompatibleStructuredAttempt,
} from "../../openai-compatible-structured-output.js";
import {
  compileStrictBindingSchema,
  normalizeStrictBindingCandidate,
} from "../../strict-binding-schema.js";
import { projectProviderBindingSchema } from "../../provider-binding-schema.js";
import type {
  StructuredOutputAdapter,
  StructuredOutputAttempt,
  StructuredOutputCapableModel,
} from "../../structured-output-adapter.js";

export function compileDeepseekStrictBindingSchema(
  schema: Parameters<typeof projectProviderBindingSchema>[0],
): Record<string, unknown> | null {
  return compileStrictBindingSchema(schema, "deepseek");
}

export function isDeepseekStrictSchemaCompatible(
  schema: Parameters<typeof projectProviderBindingSchema>[0],
): boolean {
  return compileDeepseekStrictBindingSchema(schema) != null;
}

function normalizeDeepseekStrictCandidate(
  candidate: unknown,
  schema: Parameters<typeof projectProviderBindingSchema>[0],
): unknown {
  return normalizeStrictBindingCandidate(candidate, schema);
}

export function createDeepseekStructuredOutputAdapter(params: {
  getDefaultModel: (options?: {
    maxTokens?: number;
  }) => StructuredOutputCapableModel;
  getStrictModel: (options?: {
    maxTokens?: number;
  }) => StructuredOutputCapableModel;
  strictEnabled: boolean;
  /** Thinking mode rejects the tool_choice used by forced function calling. */
  thinkingEnabled?: boolean;
}): StructuredOutputAdapter {
  const defaultAdapter = createOpenAiCompatibleStructuredOutputAdapter({
    getModel: params.getDefaultModel,
    methods: ["functionCalling", "jsonMode"],
  });
  return {
    createAttemptPlan(request) {
      if (request.mode === "root-array" || request.mode === "json-lines") {
        return [{ id: "raw", transport: "raw" }];
      }
      const strict =
        params.strictEnabled &&
        request.bindingSchema != null &&
        isDeepseekStrictSchemaCompatible(request.bindingSchema);
      if (request.preferSchemaConstrained) {
        if (!strict) return [];
        const strictAttempts: StructuredOutputAttempt[] = [
          {
            id: "deepseek-strict-function",
            transport: "native",
            method: "functionCalling",
            strict: true,
            modelTarget: "strict",
          },
          {
            id: "deepseek-strict-function-retry",
            transport: "native",
            method: "functionCalling",
            strict: true,
            modelTarget: "strict",
          },
        ];
        return strictAttempts.slice(0, Math.min(request.maxAttempts ?? 2, 2));
      }
      if (params.thinkingEnabled) {
        const attempts: StructuredOutputAttempt[] = [
          {
            id: "deepseek-thinking-json-mode",
            transport: "native",
            method: "jsonMode",
            modelTarget: "default",
          },
          {
            id: "deepseek-thinking-json-mode-retry",
            transport: "native",
            method: "jsonMode",
            modelTarget: "default",
          },
          { id: "deepseek-thinking-prompt-json", transport: "prompt-json" },
        ];
        return attempts.slice(0, Math.min(request.maxAttempts ?? 3, 3));
      }
      const attempts: StructuredOutputAttempt[] = strict
        ? [
            {
              id: "deepseek-strict-function",
              transport: "native",
              method: "functionCalling",
              strict: true,
              modelTarget: "strict",
            },
            {
              id: "deepseek-strict-function-retry",
              transport: "native",
              method: "functionCalling",
              strict: true,
              modelTarget: "strict",
            },
            {
              id: "deepseek-json-mode-fallback",
              transport: "native",
              method: "jsonMode",
              modelTarget: "default",
            },
          ]
        : [
            {
              id: "deepseek-function",
              transport: "native",
              method: "functionCalling",
              modelTarget: "default",
            },
            {
              id: "deepseek-json-mode",
              transport: "native",
              method: "jsonMode",
              modelTarget: "default",
            },
          ];
      return attempts.slice(0, Math.min(request.maxAttempts ?? 3, 3));
    },
    executeAttempt(request, callbacks) {
      if (request.attempt.transport !== "native") {
        return defaultAdapter.executeAttempt(request, callbacks);
      }
      const model =
        request.attempt.modelTarget === "strict"
          ? params.getStrictModel({ maxTokens: request.maxTokens })
          : params.getDefaultModel({ maxTokens: request.maxTokens });
      const strictBinding = request.attempt.strict
        ? compileDeepseekStrictBindingSchema(request.bindingSchema)
        : null;
      if (request.attempt.strict && !strictBinding) {
        return Promise.resolve({
          kind: "unavailable" as const,
          reason: "schema cannot be represented by DeepSeek strict mode",
        });
      }
      const executionRequest = strictBinding
        ? { ...request, bindingSchema: strictBinding }
        : request;
      const normalizeCandidate = (candidate: unknown) =>
        request.attempt.strict
          ? normalizeDeepseekStrictCandidate(candidate, request.bindingSchema)
          : candidate;
      return executeOpenAiCompatibleStructuredAttempt(model, executionRequest, {
        ...callbacks,
        onPartialCandidate: callbacks.onPartialCandidate
          ? (candidate) =>
              callbacks.onPartialCandidate?.(normalizeCandidate(candidate))
          : undefined,
      }).then((result) =>
        result.kind === "candidate"
          ? { ...result, candidate: normalizeCandidate(result.candidate) }
          : result,
      );
    },
  };
}
