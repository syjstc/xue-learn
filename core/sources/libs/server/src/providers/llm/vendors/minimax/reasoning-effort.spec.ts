import { createServer, type Server } from "node:http";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { MINIMAX_REASONING_EFFORTS, minimaxReasoningEffortSchema } from "@cognilearn/runtime-contracts";
import type { Env } from "../../../../env.js";
import { createMinimaxLlmProvider } from "./provider.js";
import { customThinkingModelKwargs } from "../custom/options.js";
import {createCustomLlmProvider} from "../custom/provider.js";
import {extractTokenUsage, usageLogFields} from "../../../../llm/token-usage.js";
import {createOpenAiCompatibleLlmProvider} from "../../openai-compatible-provider.js";

// This suite starts a real HTTP transport; leave room for a cold SDK load on CI.
jest.setTimeout(15_000);

describe("MiniMax Flash reasoning effort on the wire", () => {
  let server: Server;
  let env: Env;
  let requests: Record<string, unknown>[];
  beforeAll(async () => {
    requests = [];
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", chunk => chunks.push(chunk));
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        requests.push(body);
        if (body.stream) {
          response.writeHead(200, { "Content-Type": "text/event-stream" });
          for (const [delta, finish_reason] of [[{ role: "assistant", content: "OK" }, null], [{}, "stop"]]) {
            response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: body.model,
              choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
          }
          if (body.stream_options?.include_usage) {
            response.write(`data: ${JSON.stringify({id: "fixture", object: "chat.completion.chunk", created: 1, model: body.model,
              choices: [], usage: {prompt_tokens: 120, completion_tokens: 30, total_tokens: 150,
                prompt_tokens_details: {cached_tokens: 40}, completion_tokens_details: {reasoning_tokens: 20}}})}\n\n`);
          }
          response.end("data: [DONE]\n\n");
          return;
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ id: "fixture", object: "chat.completion", created: 1,
          model: "MiniMax-M3.1-Flash", choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }] }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    env = { MINIMAX_API_KEY: "fixture", MINIMAX_GROUP_ID: "fixture", MINIMAX_BASE_URL: `http://127.0.0.1:${port}/v1` } as Env;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it.each(MINIMAX_REASONING_EFFORTS)("sends %s at the request root without disabling Flash thinking", async effort => {
    const provider = createMinimaxLlmProvider(env, { id: "minimax", model: "MiniMax-M3.1-Flash",
      options: { minimaxThinkingEnabled: false, minimaxReasoningEffort: effort } });
    const model = provider.getChatModel({ maxTokens: 128 });
    await model.invoke("Reply OK");
    expect(requests.at(-1)).toMatchObject({ model: "MiniMax-M3.1-Flash", reasoning_effort: effort, reasoning_split: true, max_completion_tokens: 128 });
    expect(requests.at(-1)).not.toHaveProperty("thinking");
    expect(requests.at(-1)).not.toHaveProperty("extra_body");
  });

  it("keeps M3's disable switch and excludes Flash effort from older models", async () => {
    const model = createMinimaxLlmProvider(env, { id: "minimax", model: "MiniMax-M3",
      options: { minimaxThinkingEnabled: false, minimaxReasoningEffort: "low" } }).getChatModel();
    await model.invoke("Reply OK");
    expect(requests.at(-1)).toHaveProperty("thinking", { type: "disabled" });
    expect(requests.at(-1)).not.toHaveProperty("reasoning_effort");
  });

  it("supports the same effort through a custom MiniMax endpoint", () => {
    expect(customThinkingModelKwargs({ chatModel: "MiniMax-M3.1-Flash", customThinkingProtocol: "minimax",
      minimaxThinkingEnabled: false, minimaxReasoningEffort: "high" })).toEqual({ reasoning_split: true, reasoning_effort: "high" });
  });

  const history = (marker: string) => [
    new AIMessage({ content: "", additional_kwargs: { reasoning_content: `reason-${marker}` },
      tool_calls: [{ id: `call-${marker}`, name: "previous_tool", args: {}, type: "tool_call" }] }),
    new ToolMessage({ content: "accepted", tool_call_id: `call-${marker}` }),
    new HumanMessage(marker),
  ];

  it("preserves reasoning_content in native tool history after bindTools clones the model", async () => {
    const model = createMinimaxLlmProvider(env, { id: "minimax", model: "MiniMax-M3.1-Flash" }).getChatModel();
    const bound = model.bindTools!([{ type: "function", function: { name: "commit_probe", parameters: { type: "object", properties: {} } } }]);
    await bound.invoke(history("invoke"));
    expect((requests.at(-1)!.messages as Array<Record<string, unknown>>)[0]).toMatchObject({ role: "assistant", reasoning_content: "reason-invoke" });
  });

  it("keeps concurrent streamed reasoning histories isolated", async () => {
    const model = createMinimaxLlmProvider(env, { id: "minimax", model: "MiniMax-M3.1-Flash" }).getChatModel();
    await Promise.all(["stream-A", "stream-B"].map(async marker => {
      const stream = await model.stream(history(marker));
      for await (const _chunk of stream) { /* Drain the real SSE transport. */ }
    }));
    for (const marker of ["stream-A", "stream-B"]) {
      const request = requests.find(request => (request.messages as Array<{ content: string }>).at(-1)?.content === marker)!;
      expect((request.messages as Array<Record<string, unknown>>)[0]!.reasoning_content).toBe(`reason-${marker}`);
    }
  });

  it("requests and retains streaming usage for token counts, cache hits, reasoning and TPS", async () => {
    const model = createMinimaxLlmProvider(env, {id: "minimax", model: "MiniMax-M3.1-Flash"}).getChatModel();
    const chunks = [];
    for await (const chunk of await model.stream("Usage probe")) chunks.push(chunk);
    expect(requests.at(-1)).toHaveProperty("stream_options.include_usage", true);
    expect(chunks[0]!.content).toBe("OK");
    expect(chunks[0]!.usage_metadata).toBeUndefined();
    const usage = extractTokenUsage(chunks.at(-1));
    expect(usage).toMatchObject({input_tokens: 120, output_tokens: 30, total_tokens: 150,
      input_token_details: {cache_read: 40}, output_token_details: {reasoning: 20}});
    expect(usageLogFields(usage, 2000)).toMatchObject({outputTps: 15, totalTps: 75});
  });

  it("retains usage through invoke and through custom MiniMax bindTools clones", async () => {
    const official = createMinimaxLlmProvider(env, {id: "minimax", model: "MiniMax-M3.1-Flash"}).getChatModel();
    expect(extractTokenUsage(await official.invoke("Invoke usage probe"))?.output_tokens).toBe(30);
    const customEnv = {...env, CUSTOM_OPENAI_API_KEY: "fixture", CUSTOM_OPENAI_BASE_URL: env.MINIMAX_BASE_URL} as Env;
    const custom = createCustomLlmProvider(customEnv, {id: "custom", model: "MiniMax-M3.1-Flash",
      options: {customThinkingProtocol: "minimax"}}).getChatModel();
    const bound = custom.bindTools!([{type: "function", function: {name: "commit_probe", parameters: {type: "object", properties: {}}}}]);
    const chunks = [];
    for await (const chunk of await bound.stream("Custom usage probe")) chunks.push(chunk);
    expect(requests.at(-1)).toHaveProperty("stream_options.include_usage", true);
    expect(extractTokenUsage(chunks.at(-1))?.output_tokens).toBe(30);
  });

  it("still honors an explicit stream-usage opt-out on a compatible endpoint", async () => {
    const model = createOpenAiCompatibleLlmProvider({id: "custom", model: "fixture", apiKey: "fixture", baseUrl: env.MINIMAX_BASE_URL,
      streamUsage: false, getEmbeddings: () => ({} as never)}).getChatModel();
    for await (const _chunk of await model.stream("Opt-out probe")) { /* Drain the stream. */ }
    expect(requests.at(-1)).not.toHaveProperty("stream_options");
  });

  it("rejects disabling and unsupported effort levels", () => {
    for (const value of ["none", "minimal", "ultra", "", null]) expect(minimaxReasoningEffortSchema.safeParse(value).success).toBe(false);
  });
});
