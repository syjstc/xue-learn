import {z} from "zod";
import {readingBlockSchema} from "../../../domain/src/reading-document.js";
import {JsonArrayStreamAccumulator} from "../llm/json-array-stream.js";
import {normalizeReadingBlock} from "./normalize-block.js";

it("publishes the observed prose/content and heading/content forms before the array finishes", () => {
  const stream = new JsonArrayStreamAccumulator(z.preprocess(normalizeReadingBlock, readingBlockSchema));
  const first = stream.append('[{"type":"prose","content":"温度读数不是能量余额。"}');
  expect(first.closed).toBe(false);
  expect(first.items).toEqual([{index: 0, value: {type: "paragraph", text: "温度读数不是能量余额。"}}]);
  const next = stream.append(',{"type":"heading","content":"热与功"},{"type":"component_slot","title":"图示","description":"解释热交换"},'
    + '{"type":"paragraph","text":"后面的正文仍然可以阅读。"}');
  expect(next.items.map(item => item.index)).toEqual([0, 1, 3]);
  expect(next.issues).toHaveLength(1);
  // A missing component kind cannot be guessed from the title.
  expect(next.issues[0].index).toBe(2);
});

it("preserves explicit canonical fields and rejects answers outside their options before publication", () => {
  expect(readingBlockSchema.parse(normalizeReadingBlock({type: "paragraph", text: "Canonical", content: "Other"})))
    .toEqual({type: "paragraph", text: "Canonical"});
  expect(readingBlockSchema.safeParse({type: "check", question: "Which?", options: ["A", "B"],
    correctIndex: 2, explanation: "An invalid answer"}).success).toBe(false);
});
