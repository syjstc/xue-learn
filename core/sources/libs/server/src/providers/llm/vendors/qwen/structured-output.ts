import { createOpenAiCompatibleStructuredOutputAdapter } from "../../openai-compatible-structured-output.js";
import type {
  StructuredOutputAdapter,
  StructuredOutputCapableModel,
} from "../../structured-output-adapter.js";

/**
 * DashScope OpenAI-compatible chat supports `response_format.type: "json_object"`
 * only — not OpenAI `json_schema`. Schema conformance uses forced function
 * calling (`tools[].function.parameters` as JSON Schema), then JSON Object mode,
 * then prompt-json.
 *
 * Function-calling streams emit the tool name first, then incremental argument
 * deltas that must be aggregated before JSON parse — the shared OpenAI-compatible
 * tool stream does that so JIT item-array previews work like DeepSeek.
 *
 * @see https://docs.qwencloud.com/api-reference/toolkitframework/openai-compatible/overview
 * @see https://docs.qwencloud.com/developer-guides/text-generation/structured-output
 * @see https://docs.qwencloud.com/developer-guides/text-generation/function-calling
 */
export function createQwenStructuredOutputAdapter(params: {
  getModel: (options?: { maxTokens?: number }) => StructuredOutputCapableModel;
  thinkingEnabled?: boolean;
}): StructuredOutputAdapter {
  return createOpenAiCompatibleStructuredOutputAdapter({
    getModel: params.getModel,
    methods: ["functionCalling", "jsonMode"],
    // Thinking mode 400s on named/required tool_choice; a single bound tool
    // still produces the structured_response call with `auto`.
    ...(params.thinkingEnabled ? { toolChoice: "auto" as const } : {}),
  });
}
