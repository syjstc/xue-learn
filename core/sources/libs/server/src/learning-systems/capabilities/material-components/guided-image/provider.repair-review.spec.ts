import { invokeMultimodalStructured } from "../../../../llm/multimodal-structured-native.js";
import { guidedImagePrompt, segmentGuidedImage } from "./provider.js";
import type { GuidedImageIntent } from "../../../../../../domain/src/guided-image.js";

jest.mock("../../../../llm/multimodal-structured-native.js", () => ({ invokeMultimodalStructured: jest.fn() }));
jest.mock("../../../../llm/validated-structured-generation.js", () => ({
  runValidatedStructuredGeneration: jest.fn(async (options, { signal }) => options.invoke({ signal })),
}));
jest.mock("../../../../llm/guided-image-model.js", () => ({
  resolveGuidedImageModelRoute: jest.fn(async () => ({ selection: { id: "codex", model: "test" }, imageDetail: "original", source: "current" })),
}));

const intent: GuidedImageIntent = {
  id: "cache", title: "Count cache cells", language: "en",
  learningGoal: "Count the drawn cells, not merely their labels.",
  assumedKnowledge: "Addition", composition: "Five used, seven unused and four free cells.",
  parts: [{ id: "cells", label: "Cells", visualDescription: "Sixteen equal cells", teachingPoints: ["5 + 7 + 4 = 16"], required: true }],
  relationships: [],
};
const selection = {
  regions: [{ id: "cells-region", partId: "cells", label: "Cells", observedDescription: "The visible cells.", shapes: [{ type: "rect", x: 0.1, y: 0.1, width: 0.8, height: 0.5 }] }],
  missingPartIds: [], imageIssues: [],
};
const input = () => ({ intent,
  image: { src: "/image.png", sha256: "a".repeat(64), width: 1600, height: 1200 },
  dataUrl: "data:image/png;base64,exact-current-pixels", signal: new AbortController().signal,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(invokeMultimodalStructured).mockResolvedValue(selection as never);
});

it("tells image editing to repair actual geometry and retain required teaching labels", () => {
  const prompt = guidedImagePrompt(intent, ["Only fifteen cells are drawn."]);
  expect(prompt).toContain("attached reference");
  expect(prompt).toContain("actual positions, counts and connector endpoints");
  expect(prompt).toContain("Only fifteen cells are drawn.");
  expect(prompt).toContain("Sixteen equal cells");
});

it("sends the complete prior findings with the current image to the real segmentation invocation", async () => {
  const previousImageIssues = ["Only fifteen cells are drawn.", "The green value arrow ends at key matching."];
  const request = input();
  await segmentGuidedImage({ ...request, previousImageIssues });
  const call = jest.mocked(invokeMultimodalStructured).mock.calls[0]![0];
  const prompt = JSON.parse(call.prompt);
  expect(prompt.repairReview.previousFindings).toEqual(previousImageIssues);
  expect(prompt.repairReview.instruction).toContain("current pixels");
  expect(prompt.intent).toEqual(intent);
  expect(call.imageDataUrl).toBe(request.dataUrl);
  expect(call.meta).toMatchObject({ imageHash: request.image.sha256, previousImageIssueCount: 2 });
});

it("does not invent a repair history for a first-generation image", async () => {
  await segmentGuidedImage(input());
  const call = jest.mocked(invokeMultimodalStructured).mock.calls[0]![0];
  expect(JSON.parse(call.prompt)).not.toHaveProperty("repairReview");
  expect(call.meta).toMatchObject({ previousImageIssueCount: 0 });
});
