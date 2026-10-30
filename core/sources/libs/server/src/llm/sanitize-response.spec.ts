import {extractAssistantStreamChunk, ThinkingTagStreamFilter} from "./sanitize-response.js";

it.each([
  {content: "", additional_kwargs: {reasoning_content: "先核对条件。"}},
  {content: "", additional_kwargs: {reasoning_details: [{type: "reasoning.text", text: "先核对条件。"}]}},
  {content: [{type: "thinking", thinking: "先核对条件。"}]},
  {content: [{type: "reasoning", summary: [{type: "summary_text", text: "先核对条件。"}]}]},
])("extracts provider reasoning separately from the answer: %j", chunk => {
  expect(extractAssistantStreamChunk(chunk)).toEqual({
    delta: "", thinking: true, thinkingDelta: "先核对条件。",
  });
});

it("keeps both parts of a mixed answer/reasoning chunk and never displays redacted data", () => {
  expect(extractAssistantStreamChunk({
    content: [{type: "text", text: "答案"}, {type: "reasoning", text: "核对完成"}],
  })).toEqual({delta: "答案", thinking: true, thinkingDelta: "核对完成"});
  expect(extractAssistantStreamChunk({
    content: [{type: "redacted_thinking", data: "encrypted", text: "opaque"}],
  })).toEqual({delta: "", thinking: true});
  expect(extractAssistantStreamChunk({content: "答案"})).toEqual({delta: "答案", thinking: false});
});

it("releases the closing brace of a complete reading block without waiting for more tokens", async () => {
  const output: string[] = [];
  const filter = new ThinkingTagStreamFilter();
  const first = '[{"type":"paragraph","text":"Read this now."}';
  await filter.push(first, {onVisible: delta => {output.push(delta);}});
  expect(output.join("")).toBe(first);
});

it.each(["</think>", "</thinking>", "</redacted_thinking>"])("separates reasoning across every split of %s", async close => {
  const source = `<ThInKiNg>hidden reasoning${close}{"text":"visible"}`;
  for (let split = 1; split < source.length; split++) {
    const output: string[] = [];
    const thinking: string[] = [];
    const filter = new ThinkingTagStreamFilter();
    const handlers = {
      onVisible: (delta: string) => {output.push(delta);},
      onThinking: (delta?: string) => {if (delta) thinking.push(delta);},
    };
    await filter.push(source.slice(0, split), handlers);
    await filter.push(source.slice(split), handlers);
    await filter.flush(handlers);
    expect(output.join("")).toBe('{"text":"visible"}');
    expect(thinking.join("")).toBe("hidden reasoning");
  }
});

it("preserves ordinary less-than text and suppresses unfinished reasoning", async () => {
  let output = "";
  const filter = new ThinkingTagStreamFilter();
  const handlers = {onVisible: (delta: string) => {output += delta;}};
  await filter.push("x < 2; <thi", handlers);
  expect(output).toBe("x < 2; ");
  await filter.push("nk>unfinished", handlers);
  await filter.flush(handlers);
  expect(output).toBe("x < 2; ");
});
