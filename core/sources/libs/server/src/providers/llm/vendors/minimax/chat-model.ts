import { AsyncLocalStorage } from "node:async_hooks";
import type { BaseMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";

const requestMessages = new AsyncLocalStorage<readonly BaseMessage[]>();

/**
 * ChatOpenAI reads MiniMax reasoning_content but omits it when serializing
 * assistant history. MiniMax requires that field on subsequent tool turns.
 * Restore it at the vendor HTTP boundary, without placing it in visible text.
 */
const minimaxFetch: typeof globalThis.fetch = (input, init) => {
  const assistants = requestMessages.getStore()?.filter(message => message._getType() === "ai");
  if (!assistants?.some(message => typeof message.additional_kwargs.reasoning_content === "string") ||
      typeof init?.body !== "string") return globalThis.fetch(input, init);
  const body = JSON.parse(init.body) as { messages?: Array<Record<string, unknown>> };
  let assistantIndex = 0;
  let changed = false;
  for (const message of body.messages ?? []) {
    if (message.role !== "assistant") continue;
    const source = assistants[assistantIndex++];
    const reasoning = source?.additional_kwargs.reasoning_content;
    if (typeof reasoning === "string" && message.reasoning_content === undefined) {
      message.reasoning_content = reasoning;
      changed = true;
    }
  }
  if (!changed) return globalThis.fetch(input, init);
  const headers = new Headers(init.headers);
  headers.delete("content-length");
  return globalThis.fetch(input, { ...init, headers, body: JSON.stringify(body) });
};

async function* withRequestMessages<T>(messages: readonly BaseMessage[], stream: AsyncIterable<T>): AsyncGenerator<T> {
  const iterator = stream[Symbol.asyncIterator]();
  let completed = false;
  try {
    while (true) {
      const next = await requestMessages.run(messages, () => iterator.next());
      if (next.done) { completed = true; return; }
      yield next.value;
    }
  } finally {
    if (!completed && iterator.return) await requestMessages.run(messages, () => iterator.return!());
  }
}

export class MiniMaxChatOpenAI extends ChatOpenAI {
  constructor(fields: NonNullable<ConstructorParameters<typeof ChatOpenAI>[0]>) {
    super({ ...fields, configuration: { ...fields.configuration, fetch: minimaxFetch } });
  }

  // bindTools uses withConfig; retain this vendor transport on the clone.
  override withConfig(config: Partial<this["ParsedCallOptions"]>): MiniMaxChatOpenAI {
    const model = new MiniMaxChatOpenAI(this.fields!);
    model.defaultOptions = { ...this.defaultOptions, ...config };
    return model;
  }

  override _generate(...args: Parameters<ChatOpenAI["_generate"]>) {
    return requestMessages.run(args[0], () => super._generate(...args));
  }

  override async *_streamResponseChunks(...args: Parameters<ChatOpenAI["_streamResponseChunks"]>) {
    yield* withRequestMessages(args[0], super._streamResponseChunks(...args));
  }
}
