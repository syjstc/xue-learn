import { Embeddings } from "@langchain/core/embeddings";
import { AIMessage, AIMessageChunk, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getEnv } from "../../env.js";
import {
  createHostLlmProvider,
  registerHostLlmProvider,
  type HostLlmStreamRequest,
} from "./host-provider.js";
import { getLlmProvider, hasLlmProviderCredentials, resolveLlmProvider } from "./resolve.js";

class HostEmbeddings extends Embeddings {
  constructor() { super({}); }
  async embedDocuments(texts: string[]): Promise<number[][]> { return texts.map(text => [text.length]); }
  async embedQuery(text: string): Promise<number[]> { return [text.length]; }
}

const embeddings = new HostEmbeddings();
function provider(text = "hello") {
  return createHostLlmProvider({
    id: "custom",
    async *stream() { yield text; },
    getEmbeddings: () => embeddings,
    getEmbeddingProviderId: () => "builtin",
  });
}

describe("host-owned LLM transport", () => {
  it("preserves message roles, token boundaries, limits and separate embeddings", async () => {
    const requests: HostLlmStreamRequest[] = [];
    const host = createHostLlmProvider({
      id: "custom",
      async *stream(request) {
        requests.push(request);
        yield "one";
        yield "";
        yield " two";
      },
      getEmbeddings: () => embeddings,
      getEmbeddingProviderId: () => "builtin",
    });
    const model = host.getChatModel({ maxTokens: 256 });
    const messages = [new SystemMessage("teach"), new HumanMessage("question"), new AIMessage("history")];
    const deltas = [];
    for await (const chunk of await model.stream(messages, { stop: ["END"] })) deltas.push(chunk.content);
    expect(deltas.filter(Boolean)).toEqual(["one", " two"]);
    expect(requests[0]).toMatchObject({
      messages: [{ role: "system", content: "teach" }, { role: "user", content: "question" }, { role: "assistant", content: "history" }],
      maxTokens: 256, stop: ["END"],
    });
    expect((await model.invoke("another")).content).toBe("one two");
    expect(host.getEmbeddings()).toBe(embeddings);
    expect(host.getEmbeddingProviderId?.()).toBe("builtin");
    expect(host.structuredOutput.createAttemptPlan({ mode: "object" })).toEqual([{ id: "prompt-json", transport: "prompt-json" }]);
    expect(host.structuredOutput.createAttemptPlan({ mode: "root-array" })).toEqual([{ id: "raw", transport: "raw" }]);
  });

  it("passes cancellation to the host and closes a cancelled stream", async () => {
    const controller = new AbortController();
    let closed = false;
    let requestSignal: AbortSignal | undefined;
    const host = createHostLlmProvider({
      id: "custom",
      async *stream(request) {
        requestSignal = request.signal;
        try { yield "first"; controller.abort(); yield "discarded"; }
        finally { closed = true; }
      },
      getEmbeddings: () => embeddings,
    });
    const read = async () => {
      for await (const _chunk of await host.getChatModel().stream("cancel me", { signal: controller.signal })) { /* drain */ }
    };
    await expect(read()).rejects.toThrow();
    expect(requestSignal?.aborted).toBe(true);
    expect(closed).toBe(true);
  });

  it("does not silently lose image inputs or host errors", async () => {
    const host = provider();
    await expect(host.getChatModel().invoke([new HumanMessage({ content: [{ type: "image_url", image_url: "https://example.test/image.png" }] })]))
      .rejects.toThrow("non-text");
    const failure = new Error("host model is unavailable");
    const failing = createHostLlmProvider({ id: "custom", async *stream() { throw failure; }, getEmbeddings: () => embeddings });
    await expect(failing.getChatModel().invoke("question")).rejects.toBe(failure);
  });

  it("preserves Core tool schemas, streamed arguments and correlated tool-result history", async () => {
    const requests: HostLlmStreamRequest[] = [];
    const host = createHostLlmProvider({
      id: "custom", getEmbeddings: () => embeddings,
      async *stream(request) {
        requests.push(request);
        if (request.messages.some(message => message.role === "tool")) { yield "saved"; return; }
        yield "planning";
        yield { type: "tool-call" as const, id: "call-1", name: "commit_plan", args: { title: "equations" } };
        yield { type: "tool-call" as const, id: "call-2", name: "commit_plan", args: { title: "review" } };
      },
    });
    const model = host.getChatModel().bindTools!([tool(async () => "unused", {
      name: "commit_plan", description: "Save the plan", schema: z.object({ title: z.string() }),
    })], { tool_choice: "required" });
    let gathered: AIMessageChunk | undefined;
    for await (const chunk of await model.stream([new HumanMessage("plan")])) gathered = gathered ? gathered.concat(chunk) : chunk;
    expect(gathered?.content).toBe("planning");
    expect(gathered?.tool_calls).toEqual([
      { type: "tool_call", id: "call-1", name: "commit_plan", args: { title: "equations" } },
      { type: "tool_call", id: "call-2", name: "commit_plan", args: { title: "review" } },
    ]);
    expect(requests[0]).toMatchObject({ toolChoice: "required", tools: [{ name: "commit_plan", description: "Save the plan",
      parameters: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } }] });
    const reply = await model.invoke([new HumanMessage("plan"), gathered!, new ToolMessage({ content: "accepted", tool_call_id: "call-1" })]);
    expect(reply.content).toBe("saved");
    expect(requests[1]?.messages).toEqual([
      { role: "user", content: "plan" },
      { role: "assistant", content: "planning", toolCalls: [
        { id: "call-1", name: "commit_plan", args: { title: "equations" } },
        { id: "call-2", name: "commit_plan", args: { title: "review" } },
      ] },
      { role: "tool", content: "accepted", toolCallId: "call-1" },
    ]);
    const invoked = await model.invoke("plan");
    expect(invoked.tool_calls).toEqual(gathered?.tool_calls);
  });

  it("exposes partial Survey arguments before completion and assembles them exactly once", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;});
    let finished = false;
    const host = createHostLlmProvider({id: "custom", getEmbeddings: () => embeddings,
      async *stream() {
        yield {type: "tool-call-delta" as const, index: 0, id: "survey", name: "commit_survey", args: '{"items":[{"text":"第一段预习"}'};
        await gate;
        yield {type: "tool-call-delta" as const, index: 0, args: ',{"text":"后一段"}]}'};
        yield {type: "tool-call" as const, id: "survey", name: "commit_survey", args: {items: [{text: "第一段预习"}, {text: "后一段"}]}};
        finished = true;
      },
    });
    const stream = await host.getChatModel().stream("preview");
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(finished).toBe(false);
    expect(first.value.tool_call_chunks[0].args).toContain("第一段预习");
    let result = first.value as AIMessageChunk;
    release();
    while (true) {const next = await iterator.next(); if (next.done) break; result = result.concat(next.value);}
    expect(result.tool_calls).toEqual([{type: "tool_call", id: "survey", name: "commit_survey", args: {items: [{text: "第一段预习"}, {text: "后一段"}]}}]);
  });

  it("normalizes named and any tool choices without claiming strict schema support", async () => {
    const requests: HostLlmStreamRequest[] = [];
    const host = createHostLlmProvider({ id: "custom", getEmbeddings: () => embeddings,
      async *stream(request) { requests.push(request); yield { type: "tool-call" as const, id: "call-1", name: "commit_plan", args: {} }; },
    });
    const tools = [{ type: "function", function: { name: "commit_plan", parameters: { type: "object", properties: {} }, strict: true } }];
    await host.getChatModel().bindTools!(tools, { tool_choice: { type: "function", function: { name: "commit_plan" } } }).invoke("plan");
    await host.getChatModel().bindTools!(tools, { tool_choice: "any" }).invoke("plan");
    expect(requests[0]?.toolChoice).toEqual({ name: "commit_plan" });
    expect(requests[0]?.tools?.[0]).not.toHaveProperty("strict");
    expect(requests[1]?.toolChoice).toBe("required");
  });
});

describe("host LLM lifecycle", () => {
  it("routes before credential-backed providers and restores built-in behavior on disposal", () => {
    const host = provider();
    const env = { ...getEnv(), DEEPSEEK_API_KEY: undefined };
    const dispose = registerHostLlmProvider(selection => selection.id === "deepseek" ? host : undefined);
    try {
      expect(resolveLlmProvider({ id: "deepseek" }, env)).toBe(host);
      expect(getLlmProvider({ id: "deepseek" })).toBe(host);
      expect(hasLlmProviderCredentials({ id: "deepseek" }, env)).toBe(true);
      expect(() => getLlmProvider({ id: "qwen" })).toThrow("disabled");
    } finally { dispose(); dispose(); }
    expect(hasLlmProviderCredentials({ id: "deepseek" }, env)).toBe(false);
  });

  it("allows dynamic model changes and removes only the owning registration", async () => {
    const first = provider("first");
    const second = provider("second");
    let selected = first;
    const resolver = () => selected;
    const disposeFirst = registerHostLlmProvider(resolver);
    const disposeSecond = registerHostLlmProvider(resolver);
    try {
      expect(getLlmProvider({ id: "deepseek" })).toBe(first);
      selected = second;
      expect(getLlmProvider({ id: "deepseek" })).toBe(second);
      disposeFirst();
      expect(getLlmProvider({ id: "deepseek" })).toBe(second);
    } finally { disposeFirst(); disposeSecond(); }
    expect(hasLlmProviderCredentials({ id: "deepseek" }, { ...getEnv(), DEEPSEEK_API_KEY: undefined })).toBe(false);
  });
});
