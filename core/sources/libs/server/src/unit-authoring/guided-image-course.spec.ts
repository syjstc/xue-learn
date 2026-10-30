import { createHash } from "node:crypto";
import sharp from "sharp";
import type { GuidedImageAsset, GuidedImageIntent } from "../../../domain/src/guided-image.js";
import type { ImageProvider } from "../providers/image/types.js";
import { requireAgentConversationPersistence } from "../agents/core/checkpoint.js";
import { getImageProvider } from "../providers/image/resolve.js";
import { readUnitImage, saveGuidedUnitImage } from "../images/storage.js";
import {
  GUIDED_IMAGE_OBSERVATION_VERSION,
} from "../learning-systems/capabilities/material-components/guided-image/assets.js";
import {
  guidedImageFingerprint,
  type GuidedImageCheckpoint,
} from "../learning-systems/capabilities/material-components/guided-image/runner.js";
import {
  guidedImagePrompt, segmentGuidedImage, narrateGuidedImage,
} from "../learning-systems/capabilities/material-components/guided-image/provider.js";
import { generateCourseGuidedImage } from "./guided-image-course.js";
import { readStagedGuidedImageCandidate } from "./guided-image-repair-candidate.js";

// Keep the real checkpoint runner, hash checks, PNG processing and schemas.
// Replace all provider, persistence, configuration and observability boundaries.
jest.mock("../agents/core/checkpoint.js", () => ({ requireAgentConversationPersistence: jest.fn() }));
jest.mock("../images/runtime-config.js", () => ({ ensureImageRuntimeConfig: jest.fn(async () => {}) }));
jest.mock("../images/availability.js", () => ({ assertImageGenerationConfigured: jest.fn() }));
jest.mock("../providers/image/resolve.js", () => ({ getImageProvider: jest.fn() }));
jest.mock("../images/storage.js", () => ({ readUnitImage: jest.fn(), saveGuidedUnitImage: jest.fn() }));
jest.mock("../env.js", () => ({ getEnv: () => ({ IMAGE_STORAGE_DIR: "/workspace/images" }), getRuntimeEnvironment: () => ({ XUELEARN_DESKTOP_LOCAL: "1" }) }));
jest.mock("./guided-image-repair-candidate.js", () => ({ readStagedGuidedImageCandidate: jest.fn() }));
jest.mock("../teaching-personas/index.js", () => ({
  getBuiltinTeachingPersona: jest.fn(() => ({ ref: "teacher", name: "Teacher", avatarCode: "teacher" })),
}));
jest.mock("../teaching-personas/prompt.js", () => ({ formatTeachingPersonaPromptPart: jest.fn(() => "Teach each request separately.") }));
jest.mock("../llm/logger.js", () => ({ beginLlmRequestLog: jest.fn(async () => undefined) }));
jest.mock("../llm/trace-context.js", () => ({
  getLlmTrace: jest.fn(() => undefined),
  runWithLlmTraceAsync: jest.fn((_trace, work) => work()),
}));
jest.mock("../observability/backend-error-log.js", () => ({ sanitizeBackendErrorText: jest.fn(String) }));
jest.mock("../learning-systems/capabilities/material-components/guided-image/provider.js", () => ({
  guidedImagePrompt: jest.fn((intent, issues) => JSON.stringify({ intent, issues })),
  segmentGuidedImage: jest.fn(),
  narrateGuidedImage: jest.fn(),
}));

const persona = { ref: "teacher", name: "Teacher", avatarCode: "teacher" };
const intent: GuidedImageIntent = {
  id: "request-paths", title: "Three independent requests", language: "en",
  learningGoal: "Follow each request through its own row.",
  assumedKnowledge: "Recognize an input and an output.",
  composition: "Three separate request rows share one weight block.",
  parts: [{ id: "paths", label: "Request paths", visualDescription: "Three independent input and output paths",
    teachingPoints: ["Each input belongs to its matching result row."], required: true }],
  relationships: [],
};
const observation = {
  regions: [{ id: "paths-region", partId: "paths", label: "Request paths",
    observedDescription: "Each request has a separate input and output row.",
    polygons: [{ outer: [{ x: 0.1, y: 0.1 }, { x: 0.8, y: 0.1 }, { x: 0.8, y: 0.8 }], holes: [] }] }],
  missingPartIds: [], imageIssues: [],
};
const issues = ["请求甲蓝色输入箭头必须终止于蓝色顶行。", "保留其余两条独立请求路径。"];
const beats = [{ id: "follow-paths", regionIds: ["paths-region"], partIds: ["paths"],
  text: "Each request has its own input and result row. Follow the three arrows separately; sharing a weight block does not merge the requests or their results." }];
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const asset = (data: Buffer): GuidedImageAsset => ({
  src: `/api/units/unit/images/ill-guided-${sha256(data)}.png?aigc=v1`,
  sha256: sha256(data), width: 64, height: 48,
});

let sequence = 0;
let failedPixels: Buffer;
let olderPixels: Buffer;
let repairedPixels: Buffer;
let images: Map<string, Buffer>;
let provider: ImageProvider;
let latest: GuidedImageCheckpoint | undefined;
const input = () => ({ userId: "owner", goalId: "goal", unitId: "unit", sectionId: "section",
  revisionId: "frozen-intent", intent, personaRef: "teacher", imageRepairRetryKey: "explicit-retry" });
function checkpoint(): GuidedImageCheckpoint {
  return {
    schemaVersion: 1, fingerprint: guidedImageFingerprint(intent, persona),
    phase: "segmentation", status: "error", image: asset(failedPixels),
    observationVersion: GUIDED_IMAGE_OBSERVATION_VERSION,
    segmentation: { ...observation, imageIssues: issues },
    rejectedImages: [{ image: asset(olderPixels), segmentation: { ...observation, imageIssues: ["An older issue."] } }],
    error: "Image needs review before narration",
  };
}
function useCheckpoint(saved?: GuidedImageCheckpoint) {
  latest = saved;
  const threadId = `isolated-image-repair-${++sequence}`;
  jest.mocked(requireAgentConversationPersistence).mockReturnValue({
    findOrCreateScopedThread: jest.fn(async () => ({ id: threadId,
      stateJson: JSON.stringify({ goalId: "goal", unitId: "unit", checkpoint: saved }) })),
    updateThreadState: jest.fn(async (_id, stateJson) => { latest = JSON.parse(stateJson).checkpoint; }),
  } as unknown as ReturnType<typeof requireAgentConversationPersistence>);
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(readStagedGuidedImageCandidate).mockResolvedValue(undefined);
  const png = (background: string) => sharp({ create: { width: 64, height: 48, channels: 4, background } }).png().toBuffer();
  [failedPixels, olderPixels, repairedPixels] = await Promise.all([png("#cc0000"), png("#00aa00"), png("#0000cc")]);
  images = new Map([failedPixels, olderPixels].map(data => [`ill-guided-${sha256(data)}`, data]));
  jest.mocked(readUnitImage).mockImplementation(async (unitId, imageId) => {
    if (unitId !== "unit") throw new Error("Wrong image owner");
    const data = images.get(imageId);
    return data ? { data, mimeType: "image/png" } : null;
  });
  jest.mocked(saveGuidedUnitImage).mockImplementation(async (unitId, data) => {
    if (unitId !== "unit") throw new Error("Wrong image owner");
    const image = asset(data), imageId = `ill-guided-${image.sha256}`;
    images.set(imageId, data);
    return { imageId, data, sha256: image.sha256, src: image.src };
  });
  provider = { id: "codex", model: "test-image", supportsImageEditing: true,
    generateImage: jest.fn(async () => ({ data: repairedPixels, mimeType: "image/png" })) };
  jest.mocked(getImageProvider).mockReturnValue(provider);
  jest.mocked(segmentGuidedImage).mockResolvedValue(observation);
  jest.mocked(narrateGuidedImage).mockResolvedValue(beats);
  useCheckpoint();
});

it("edits the current failed checkpoint bytes with its exact issues, rather than an older rejected image", async () => {
  const saved = checkpoint();
  useCheckpoint(saved);
  const result = await generateCourseGuidedImage(input());
  expect(provider.generateImage).toHaveBeenCalledTimes(1);
  const request = jest.mocked(provider.generateImage).mock.calls[0]![0];
  expect(request.referenceImage).toEqual({ data: failedPixels, mimeType: "image/png" });
  expect(request.textPolicy).toBe("preserve-intent");
  expect(request.referenceImage!.data.equals(olderPixels)).toBe(false);
  expect(guidedImagePrompt).toHaveBeenCalledWith(intent, issues);
  for (const issue of issues) expect(request.prompt).toContain(issue);
  expect(readUnitImage).toHaveBeenCalledWith("unit", `ill-guided-${saved.image!.sha256}`);
  expect(result.image.sha256).not.toBe(saved.image!.sha256);
  expect(jest.mocked(segmentGuidedImage).mock.calls[0]![0].image.sha256).toBe(result.image.sha256);
  expect(jest.mocked(segmentGuidedImage).mock.calls[0]![0].previousImageIssues).toEqual(["An older issue.", ...issues]);
  expect(latest!.rejectedImages?.at(-1)?.image).toEqual(saved.image);
  expect(latest!.status).toBe("ready");
});

it("generates the first image without a reference or rejection feedback", async () => {
  await generateCourseGuidedImage(input());
  expect(provider.generateImage).toHaveBeenCalledTimes(1);
  expect(jest.mocked(provider.generateImage).mock.calls[0]![0]).not.toHaveProperty("referenceImage");
  expect(jest.mocked(provider.generateImage).mock.calls[0]![0].textPolicy).toBe("preserve-intent");
  expect(guidedImagePrompt).toHaveBeenCalledWith(intent, undefined);
  expect(jest.mocked(segmentGuidedImage).mock.calls[0]![0]).not.toHaveProperty("previousImageIssues");
  expect(readStagedGuidedImageCandidate).not.toHaveBeenCalled();
});

it("reviews a staged candidate bound to the actual failed image and preserves rejected history", async () => {
  const saved = checkpoint();
  useCheckpoint(saved);
  jest.mocked(readStagedGuidedImageCandidate).mockResolvedValueOnce(repairedPixels);
  const result = await generateCourseGuidedImage(input());
  expect(provider.generateImage).not.toHaveBeenCalled();
  expect(readStagedGuidedImageCandidate).toHaveBeenCalledWith(expect.objectContaining({
    unitId: "unit", imageStorageDir: "/workspace/images", fingerprint: saved.fingerprint,
    rejectedSha256: saved.image!.sha256, scopeId: expect.stringMatching(/^[a-f0-9]{64}$/),
  }));
  expect(jest.mocked(segmentGuidedImage).mock.calls[0]![0].image.sha256).toBe(result.image.sha256);
  expect(jest.mocked(segmentGuidedImage).mock.calls[0]![0].previousImageIssues).toEqual(["An older issue.", ...issues]);
  expect(latest!.rejectedImages?.at(-1)?.image).toEqual(saved.image);
  expect(latest!.status).toBe("ready");
});

it("does not narrate or accept a staged candidate when the ordinary pixel review rejects it", async () => {
  useCheckpoint(checkpoint());
  jest.mocked(readStagedGuidedImageCandidate).mockResolvedValueOnce(repairedPixels);
  jest.mocked(segmentGuidedImage).mockResolvedValue({ ...observation, imageIssues: ["The geometry is still wrong."] });
  await expect(generateCourseGuidedImage(input())).rejects.toThrow("Image needs review before narration");
  expect(narrateGuidedImage).not.toHaveBeenCalled();
  expect(latest!.status).toBe("error");
  expect(latest!.rejectedImages?.some(({ image }) => image.sha256 === sha256(repairedPixels))).toBe(true);
});

it("redraws from the same frozen intent after an exhausted prior edit grant", async () => {
  const saved = checkpoint();
  saved.rejectedImages = [1, 2, 3].map(() => ({ image: asset(olderPixels), segmentation: { ...observation, imageIssues: issues } }));
  saved.imageRepairRetry = { key: "previous-request", rejectedImagesOffset: 0 };
  useCheckpoint(saved);
  await generateCourseGuidedImage(input());
  const request = jest.mocked(provider.generateImage).mock.calls[0]![0];
  expect(request).not.toHaveProperty("referenceImage");
  expect(request.prompt).toContain("fresh layout");
  expect(request.textPolicy).toBe("preserve-intent");
  expect(guidedImagePrompt).toHaveBeenCalledWith(intent, issues);
  expect(segmentGuidedImage).toHaveBeenCalledTimes(1);
  expect(latest!.status).toBe("ready");
});

it.each([false, undefined])("keeps feedback-guided redraw and review when edit support is %s", async supportsImageEditing => {
  provider.supportsImageEditing = supportsImageEditing;
  useCheckpoint(checkpoint());
  await generateCourseGuidedImage(input());
  expect(provider.generateImage).toHaveBeenCalledTimes(1);
  expect(jest.mocked(provider.generateImage).mock.calls[0]![0]).not.toHaveProperty("referenceImage");
  expect(guidedImagePrompt).toHaveBeenCalledWith(intent, issues);
  expect(segmentGuidedImage).toHaveBeenCalledTimes(1);
  expect(latest!.status).toBe("ready");
});

it("rejects a checkpoint whose saved pixels no longer match its hash before calling the image provider", async () => {
  const saved = checkpoint();
  useCheckpoint(saved);
  images.set(`ill-guided-${saved.image!.sha256}`, olderPixels);
  await expect(generateCourseGuidedImage(input())).rejects.toThrow("saved image is missing or changed");
  expect(provider.generateImage).not.toHaveBeenCalled();
  expect(latest!.status).toBe("error");
});
