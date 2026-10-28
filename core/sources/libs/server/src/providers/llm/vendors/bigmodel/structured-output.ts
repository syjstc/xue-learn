import { createOpenAiCompatibleStructuredOutputAdapter } from "../../openai-compatible-structured-output.js";
import type {
  StructuredOutputAdapter,
  StructuredOutputCapableModel,
} from "../../structured-output-adapter.js";

/**
 * BigModel's published Chat Completions schema documents `json_object` for
 * structured responses. Its function-calling API documents `tool_choice` as
 * `auto` only, so the generic named/forced function-calling transport is not
 * safe for this adapter. Unit authoring has its own provider-specific tool
 * bind because it needs a commit tool rather than a JSON response object.
 *
 * @see https://docs.bigmodel.cn/cn/guide/capabilities/struct-output
 * @see https://docs.bigmodel.cn/api-reference/模型-api/对话补全
 */
export function createBigModelStructuredOutputAdapter(params: {
  getModel: (options?: { maxTokens?: number }) => StructuredOutputCapableModel;
}): StructuredOutputAdapter {
  return createOpenAiCompatibleStructuredOutputAdapter({
    getModel: params.getModel,
    methods: ["jsonMode"],
  });
}
