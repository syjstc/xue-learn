import { createOpenAiCompatibleStructuredOutputAdapter } from "../../openai-compatible-structured-output.js";
import type {
  StructuredOutputAdapter,
  StructuredOutputCapableModel,
} from "../../structured-output-adapter.js";

/**
 * MiniMax M3/M2.x do not enforce `response_format.json_schema` (that parameter
 * is documented only for MiniMax-Text-01, and M3 accepts it while still
 * answering in prose or Markdown). Structured JSON for M3 is the function-tool
 * `parameters` JSON Schema. The OpenAI-compatible Chat Completions endpoint
 * accepts `tool_choice: "required"` and then returns schema-shaped tool
 * arguments — including SVG markup inside a JSON string. `auto` lets M3 skip
 * the tool and emit fences/`<svg>`, which fails JSON parse (component compile
 * and `unit.learning_material.svg_generate`).
 *
 * Native MiniMax `text-post` still lists `tool_choice` as `auto` | `none` only.
 * This adapter talks to the OpenAI-compatible endpoint used by ChatOpenAI.
 *
 * @see https://platform.minimax.io/docs/guides/text-m3-function-call
 * @see https://platform.minimax.io/docs/api-reference/text-post
 * @see https://platform.minimax.io/docs/api-reference/text-openai-api
 */
export function createMinimaxStructuredOutputAdapter(params: {
  getModel: (options?: { maxTokens?: number }) => StructuredOutputCapableModel;
}): StructuredOutputAdapter {
  return createOpenAiCompatibleStructuredOutputAdapter({
    getModel: params.getModel,
    // Give the model a schema-bearing tool twice before the shared prompt-json
    // recovery path. Do not send json_schema/json_object response_format: M3
    // does not constrain those responses. `strict` on the tool is a best-effort
    // hint for OpenAI-compatible gateways; M3 still does not grammar-constrain.
    methods: [
      { method: "functionCalling", strict: true },
      { method: "functionCalling", strict: true },
    ],
    toolChoice: "required",
    toolDescription:
      "Return the complete structured response. Always call this tool exactly once; do not answer with plain text or Markdown.",
  });
}
