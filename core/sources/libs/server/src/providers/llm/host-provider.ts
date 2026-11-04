import type { Embeddings } from "@langchain/core/embeddings";
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import type { Env } from "../../env.js";
import { createOpenAiCompatibleStructuredOutputAdapter } from "./openai-compatible-structured-output.js";
import type { EmbeddingProviderId, LlmProvider, LlmProviderId, LlmProviderSelection } from "./types.js";

export type HostLlmToolCall = { id: string; name: string; args: Record<string, unknown> };
export type HostLlmTool = { name: string; description?: string; parameters: Record<string, unknown> };
export type HostLlmToolChoice = "auto" | "required" | "none" | { name: string };
export type HostLlmStreamDelta = string | ({ type: "tool-call" } & HostLlmToolCall) | {
  type: "tool-call-delta";
  index: number;
  id?: string;
  name?: string;
  args: string;
};

/** Serializable chat/tool contract; embedding and model credentials stay with the host. */
export type HostLlmMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: HostLlmToolCall[];
  toolCallId?: string;
};

export type HostLlmStreamRequest = {
  messages: HostLlmMessage[];
  maxTokens?: number;
  stop?: string[];
  tools?: HostLlmTool[];
  toolChoice?: HostLlmToolChoice;
  signal?: AbortSignal;
};

export type HostLlmProviderOptions = {
  id: LlmProviderId;
  stream(request: HostLlmStreamRequest): AsyncIterable<HostLlmStreamDelta>;
  getEmbeddings(): Embeddings;
  getEmbeddingProviderId?(): EmbeddingProviderId;
};

/** A host may handle selected routes and return undefined to keep built-in routing. */
export type HostLlmProviderResolver = (
  selection: LlmProviderSelection,
  env: Env,
) => LlmProvider | undefined;

const hostProviders: Array<{ resolve: HostLlmProviderResolver }> = [];

/**
 * Install a process-local host route before Core's credential-backed providers.
 * The newest matching registration wins. Keep the disposer in the host lifecycle;
 * disposing an older registration never removes a newer host's route. Host
 * results are deliberately not cached, so model switches take effect immediately.
 */
export function registerHostLlmProvider(resolve: HostLlmProviderResolver): () => void {
  const entry = { resolve };
  hostProviders.push(entry);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const index = hostProviders.indexOf(entry);
    if (index !== -1) hostProviders.splice(index, 1);
  };
}

/** Internal lookup shared by normal resolution and credential availability checks. */
export function resolveHostLlmProvider(selection: LlmProviderSelection, env: Env): LlmProvider | undefined {
  for (let index = hostProviders.length - 1; index >= 0; index -= 1) {
    const provider = hostProviders[index]!.resolve(selection, env);
    if (provider) return provider;
  }
  return undefined;
}

function hostMessages(messages: BaseMessage[]): HostLlmMessage[] {
  return messages.map(message => {
    const kind = message._getType();
    const role = kind === "human" ? "user" : kind === "ai" ? "assistant" : kind === "system" ? "system" : kind === "tool" ? "tool" : undefined;
    if (!role) {
      throw new Error(`The host model does not support ${kind} messages`);
    }
    let content: string;
    if (typeof message.content === "string") content = message.content;
    else {
      const text: string[] = [];
      for (const block of message.content) {
        if (block.type !== "text" || typeof block.text !== "string") {
          throw new Error("The host model does not support non-text message content");
        }
        text.push(block.text);
      }
      content = text.join("");
    }
    const result: HostLlmMessage = { role, content };
    if (kind === "ai" && "tool_calls" in message && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      result.toolCalls = message.tool_calls.map(call => validatedToolCall(call));
    }
    if (kind === "tool") {
      const toolCallId = "tool_call_id" in message ? message.tool_call_id : undefined;
      if (typeof toolCallId !== "string" || !toolCallId) throw new Error("Host tool result requires its tool call ID");
      result.toolCallId = toolCallId;
    }
    return result;
  });
}

function validatedToolCall(value: unknown): HostLlmToolCall {
  const call = value as Partial<HostLlmToolCall> | null;
  if (!call || typeof call.id !== "string" || !call.id || typeof call.name !== "string" || !call.name ||
      !call.args || typeof call.args !== "object" || Array.isArray(call.args)) {
    throw new Error("Host tool call requires an ID, name and object arguments");
  }
  return { id: call.id, name: call.name, args: call.args };
}

function hostToolChoice(value: BaseChatModelCallOptions["tool_choice"]): HostLlmToolChoice | undefined {
  if (value === undefined) return undefined;
  if (value === "any" || value === "required") return "required";
  if (value === "auto" || value === "none") return value;
  if (typeof value === "string" && value) return { name: value };
  if (value && typeof value === "object") {
    const choice = value as { name?: unknown; function?: { name?: unknown } };
    const name = choice.function?.name ?? choice.name;
    if (typeof name === "string" && name) return { name };
  }
  throw new Error("Unsupported host tool choice");
}

type HostChatModelCallOptions = BaseChatModelCallOptions & { tools?: HostLlmTool[] };

class HostChatModel extends BaseChatModel<HostChatModelCallOptions> {
  constructor(private readonly options: HostLlmProviderOptions, private readonly maxTokens?: number) {
    super({});
  }

  _llmType(): string { return "xuelearn-host"; }

  bindTools(tools: BindToolsInput[], kwargs?: Partial<HostChatModelCallOptions>) {
    const schemas = tools.map(tool => {
      const converted = convertToOpenAITool(tool);
      const schema = converted.function;
      if (converted.type !== "function" || !schema || typeof schema.name !== "string" || !schema.name ||
          !schema.parameters || typeof schema.parameters !== "object" || Array.isArray(schema.parameters)) {
        throw new Error("Host model requires function tools with JSON object schemas");
      }
      return { name: schema.name, parameters: schema.parameters,
        ...(typeof schema.description === "string" ? { description: schema.description } : {}) };
    });
    return this.withConfig({ ...kwargs, tools: schemas });
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    options.signal?.throwIfAborted();
    const request: HostLlmStreamRequest = {
      messages: hostMessages(messages),
      ...(this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens }),
      ...(options.stop === undefined ? {} : { stop: options.stop }),
      ...(options.tools === undefined ? {} : { tools: options.tools }),
      ...(options.tool_choice === undefined ? {} : { toolChoice: hostToolChoice(options.tool_choice) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
    let toolIndex = 0;
    const streamedTools = new Map<number, { id?: string; name?: string; args: string }>();
    for await (const delta of this.options.stream(request)) {
      options.signal?.throwIfAborted();
      if (!delta) continue;
      if (typeof delta !== "string") {
        if (delta.type === "tool-call-delta") {
          if (!Number.isInteger(delta.index) || delta.index < 0 || typeof delta.args !== "string") {
            throw new Error("Invalid host tool argument delta");
          }
          const previous = streamedTools.get(delta.index) ?? { args: "" };
          if ((previous.id && delta.id && previous.id !== delta.id) ||
              (previous.name && delta.name && previous.name !== delta.name)) {
            throw new Error("Host tool identity changed during streaming");
          }
          streamedTools.set(delta.index, {
            id: delta.id || previous.id, name: delta.name || previous.name,
            args: previous.args + delta.args,
          });
          toolIndex = Math.max(toolIndex, delta.index + 1);
          yield new ChatGenerationChunk({ text: "", message: new AIMessageChunk({
            content: "", tool_call_chunks: [{ type: "tool_call_chunk", index: delta.index,
              ...(delta.id && !previous.id ? { id: delta.id } : {}),
              ...(delta.name && !previous.name ? { name: delta.name } : {}), args: delta.args }],
          }) });
          continue;
        }
        if (delta.type !== "tool-call") throw new Error("Unsupported host stream event");
        const call = validatedToolCall(delta);
        const streamed = [...streamedTools.values()].find((entry) => entry.id === call.id);
        if (streamed) {
          if (streamed.name !== call.name || JSON.stringify(JSON.parse(streamed.args)) !== JSON.stringify(call.args)) {
            throw new Error("Completed host tool differs from its streamed arguments");
          }
          continue;
        }
        yield new ChatGenerationChunk({ text: "", message: new AIMessageChunk({
          content: "", tool_call_chunks: [{ type: "tool_call_chunk", id: call.id, name: call.name,
            args: JSON.stringify(call.args), index: toolIndex++ }],
        }) });
        continue;
      }
      const chunk = new ChatGenerationChunk({ text: delta, message: new AIMessageChunk({ content: delta }) });
      yield chunk;
      await runManager?.handleLLMNewToken(delta);
    }
    options.signal?.throwIfAborted();
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    let gathered: ChatGenerationChunk | undefined;
    for await (const chunk of this._streamResponseChunks(messages, options, runManager)) gathered = gathered ? gathered.concat(chunk) : chunk;
    const message = gathered?.message as AIMessageChunk | undefined;
    return { generations: [{ text: gathered?.text ?? "", message: new AIMessage({
      content: message?.content ?? "", tool_calls: message?.tool_calls ?? [],
    }) }] };
  }
}

/**
 * Adapt a host-owned model stream without copying API keys or changing Core's
 * teaching generators. Structured requests retain the shared raw-stream parsing,
 * schema validation and bounded repair flow. Tool calls use the host's native
 * tool transport; this adapter claims no strict JSON schema guarantee.
 * Embeddings are an independent host choice.
 */
export function createHostLlmProvider(options: HostLlmProviderOptions): LlmProvider {
  const getModel = (request?: { maxTokens?: number }) => new HostChatModel(options, request?.maxTokens);
  return {
    id: options.id,
    getChatModel: getModel,
    structuredOutput: createOpenAiCompatibleStructuredOutputAdapter({ getModel, methods: [] }),
    getEmbeddings: options.getEmbeddings,
    ...(options.getEmbeddingProviderId ? { getEmbeddingProviderId: options.getEmbeddingProviderId } : {}),
  };
}
