import { createHash } from "node:crypto";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { ChatGenerationChunk, ChatResult } from "@langchain/core/outputs";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { LLM_REQUEST_TIMEOUT_MS } from "../../chat-openai-defaults.js";

const CONTEXT_CACHE_TTL_SECONDS = 60 * 60;
const CONTEXT_CACHE_FAILURE_BACKOFF_MS = 5 * 60 * 1000;
const MIN_CACHE_PREFIX_CHARS = 4_096;

type AsyncRelease = () => void;

class AsyncMutex {
  private tail = Promise.resolve();

  async acquire(): Promise<AsyncRelease> {
    let release!: AsyncRelease;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(() => next);
    await previous;
    return release;
  }
}

type ContextCacheEntry = {
  contextId: string;
  mutex: AsyncMutex;
  cacheKey: string;
};

const contextEntries = new Map<string, Promise<ContextCacheEntry>>();
const disabledCacheKeys = new Map<string, number>();

export function resetDoubaoContextCacheForTests(): void {
  contextEntries.clear();
  disabledCacheKeys.clear();
}

type ChatModelFields = ConstructorParameters<typeof ChatOpenAI>[0];

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function cacheKeyFor(input: {
  baseUrl: string;
  model: string;
  reasoning: string;
  prefixVersion: string;
  prefixHash: string;
}): string {
  return createHash("sha256")
    .update(input.baseUrl)
    .update("\0")
    .update(input.model)
    .update("\0")
    .update(input.reasoning)
    .update("\0")
    .update(input.prefixVersion)
    .update("\0")
    .update(input.prefixHash)
    .digest("hex");
}

async function createContext(
  baseUrl: string,
  apiKey: string,
  model: string,
  prefix: string,
): Promise<string> {
  const response = await fetch(`${baseUrl}/context/create`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      mode: "common_prefix",
      ttl: CONTEXT_CACHE_TTL_SECONDS,
      messages: [{ role: "system", content: prefix }],
    }),
    signal: AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS),
  });
  const responseText = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    payload = undefined;
  }
  if (!response.ok) {
    throw new Error(
      `Doubao context cache creation failed (${response.status})`,
    );
  }
  const contextId =
    payload && typeof payload === "object" && "id" in payload
      ? (payload as { id?: unknown }).id
      : undefined;
  if (typeof contextId !== "string" || contextId.length === 0) {
    throw new Error("Doubao context cache creation returned no context id");
  }
  return contextId;
}

async function getContextEntry(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prefix: string;
  cacheKey: string;
}): Promise<ContextCacheEntry> {
  const existing = contextEntries.get(input.cacheKey);
  if (existing) return existing;
  const promise = createContext(
    input.baseUrl,
    input.apiKey,
    input.model,
    input.prefix,
  ).then((contextId) => ({
    contextId,
    mutex: new AsyncMutex(),
    cacheKey: input.cacheKey,
  }));
  contextEntries.set(input.cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    contextEntries.delete(input.cacheKey);
    throw error;
  }
}

function messageType(message: BaseMessage): string {
  return typeof message._getType === "function"
    ? message._getType()
    : message.getType();
}

function messagesWithCachedPrefixRemoved(
  messages: BaseMessage[],
  prefix: string,
): BaseMessage[] {
  const index = messages.findIndex(
    (message) => messageType(message) === "human",
  );
  const message = index >= 0 ? messages[index] : undefined;
  if (!message || typeof message.content !== "string") {
    throw new Error("Doubao cache request did not contain a text user prompt");
  }
  if (!message.content.startsWith(prefix)) {
    throw new Error("Doubao cache prefix did not match the request prompt");
  }
  const remainder = message.content.slice(prefix.length).replace(/^\n\n/, "");
  const replacement = new HumanMessage({
    content: remainder,
    additional_kwargs: message.additional_kwargs,
    response_metadata: message.response_metadata,
    name: message.name,
    id: message.id,
  });
  return messages.map((candidate, candidateIndex) =>
    candidateIndex === index ? replacement : candidate,
  );
}

class DoubaoContextChatModel extends ChatOpenAI {
  constructor(
    fields: ChatModelFields,
    private readonly cachePrefix: string,
    private readonly mutex: AsyncMutex,
    private readonly fallbackModel: ChatOpenAI,
    private readonly onContextFailure: () => void,
  ) {
    super(fields);
  }

  override async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const cachedMessages = messagesWithCachedPrefixRemoved(
      messages,
      this.cachePrefix,
    );
    try {
      return await super._generate(cachedMessages, options, runManager);
    } catch (error) {
      this.onContextFailure();
      return this.fallbackModel._generate(messages, options, runManager);
    }
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const release = await this.mutex.acquire();
    let yieldedChunk = false;
    try {
      const cachedMessages = messagesWithCachedPrefixRemoved(
        messages,
        this.cachePrefix,
      );
      try {
        for await (const chunk of super._streamResponseChunks(
          cachedMessages,
          options,
          runManager,
        )) {
          yieldedChunk = true;
          yield chunk;
        }
      } catch (error) {
        // A gateway may expose the regular OpenAI-compatible endpoint while
        // rejecting ContextChatCompletions. Retry only before any chunk was
        // emitted, so a partial cached response is never duplicated.
        if (yieldedChunk) throw error;
        this.onContextFailure();
        for await (const chunk of this.fallbackModel._streamResponseChunks(
          messages,
          options,
          runManager,
        )) {
          yield chunk;
        }
      }
    } finally {
      release();
    }
  }
}

export async function createDoubaoContextCachedChatModel(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  cachePrefix: string;
  prefixVersion?: string;
  modelKwargs?: Record<string, unknown>;
  createFallbackModel: () => ChatOpenAI;
}): Promise<BaseChatModel | undefined> {
  if (
    !input.apiKey.trim() ||
    input.cachePrefix.length < MIN_CACHE_PREFIX_CHARS
  ) {
    return undefined;
  }

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const cacheKey = cacheKeyFor({
    baseUrl,
    model: input.model,
    reasoning: JSON.stringify(input.modelKwargs ?? {}),
    prefixVersion: input.prefixVersion ?? "v2",
    prefixHash: createHash("sha256").update(input.cachePrefix).digest("hex"),
  });
  const disabledUntil = disabledCacheKeys.get(cacheKey);
  if (disabledUntil !== undefined) {
    if (disabledUntil > Date.now()) return undefined;
    disabledCacheKeys.delete(cacheKey);
  }

  let entry: ContextCacheEntry;
  try {
    entry = await getContextEntry({
      baseUrl,
      apiKey: input.apiKey,
      model: input.model,
      prefix: input.cachePrefix,
      cacheKey,
    });
  } catch {
    disabledCacheKeys.set(
      cacheKey,
      Date.now() + CONTEXT_CACHE_FAILURE_BACKOFF_MS,
    );
    return undefined;
  }

  const fallbackModel = input.createFallbackModel();
  return new DoubaoContextChatModel(
    {
      streaming: true,
      streamUsage: true,
      model: input.model,
      temperature: 0.7,
      apiKey: input.apiKey,
      timeout: LLM_REQUEST_TIMEOUT_MS,
      ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}),
      ...(Object.keys(input.modelKwargs ?? {}).length > 0
        ? {
            modelKwargs: {
              ...input.modelKwargs,
              context_id: entry.contextId,
            },
          }
        : { modelKwargs: { context_id: entry.contextId } }),
      configuration: { baseURL: `${baseUrl}/context` },
    },
    input.cachePrefix,
    entry.mutex,
    fallbackModel,
    () => {
      disabledCacheKeys.set(
        cacheKey,
        Date.now() + CONTEXT_CACHE_FAILURE_BACKOFF_MS,
      );
      contextEntries.delete(cacheKey);
    },
  );
}
