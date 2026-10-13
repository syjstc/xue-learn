import type {
  GuidedImageAsset,
  GuidedImageIntent,
  GuidedImageSegmentation,
} from "../../../../../../domain/src/guided-image.js";
import {
  guidedImageFingerprint,
  runGuidedImageDisplay,
  type GuidedImageCheckpoint,
  type GuidedImagePorts,
} from "./runner.js";

const intent: GuidedImageIntent = {
  id: "changes",
  title: "Observe the change",
  language: "en",
  learningGoal: "Describe the observed height change.",
  assumedKnowledge: "Recognize a weight and a ruler.",
  composition: "One weight beside a ruler, before and after lifting.",
  parts: [{
    id: "weight", label: "Weight", visualDescription: "The lifted weight",
    teachingPoints: ["The weight is higher after lifting."], required: true,
  }],
  relationships: [],
};
const persona = { ref: "teacher", name: "Teacher", avatarCode: "teacher" };
const asset = (digit: string): GuidedImageAsset => ({
  src: `/images/${digit}.png`, sha256: digit.repeat(64), width: 800, height: 600,
});
const observation: GuidedImageSegmentation = {
  regions: [{
    id: "weight_region", partId: "weight", label: "Weight",
    observedDescription: "The weight is visibly higher beside the ruler.",
    polygons: [{ outer: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.1 }, { x: 0.4, y: 0.5 }], holes: [] }],
  }],
  missingPartIds: [], imageIssues: [],
};
const rejectedObservation = { ...observation, imageIssues: ["Labels are unreadable on a dark background."] };
const beats = [{
  id: "observe", text: "Look at the weight beside the ruler. Its height has increased after lifting, which is the change we can observe directly.",
  regionIds: ["weight_region"], partIds: ["weight"],
}];
const failedCheckpoint = (): GuidedImageCheckpoint => ({
  schemaVersion: 1, fingerprint: guidedImageFingerprint(intent, persona),
  phase: "segmentation", status: "error", image: asset("2"),
  segmentation: rejectedObservation,
  rejectedImages: [{ image: asset("1"), segmentation: rejectedObservation }],
  error: "Image needs review before narration: Labels are unreadable on a dark background.",
});
function setup(checkpoint?: GuidedImageCheckpoint) {
  let saved = checkpoint;
  const ports: GuidedImagePorts = {
    generateImage: jest.fn(async () => asset("3")),
    verifyImage: jest.fn(async () => {}),
    segment: jest.fn(async () => observation),
    cut: jest.fn(async () => [{ regionId: "weight_region", src: "/cutout.png" }]),
    narrate: jest.fn(async () => beats),
  };
  return {
    ports, latest: () => saved!,
    input: {
      runId: "test-run", intent, persona, ports, checkpoint,
      signal: new AbortController().signal,
      save: async (next: GuidedImageCheckpoint) => { saved = next; },
    },
  };
}

it("repairs an exhausted checkpoint on a new request and retains its rejection feedback", async () => {
  const test = setup(failedCheckpoint());
  const result = await runGuidedImageDisplay({ ...test.input, imageRepairRetryKey: "request-1" });
  expect(result.image).toEqual(asset("3"));
  expect(test.ports.generateImage).toHaveBeenCalledTimes(1);
  expect(test.ports.generateImage).toHaveBeenCalledWith(intent, test.input.signal, {
    image: asset("2"), issues: rejectedObservation.imageIssues,
  });
  expect(test.latest().rejectedImages?.map(item => item.image)).toEqual([asset("1"), asset("2")]);
});

it("keeps the repair budget bounded across automatic retries and renews it for the next request", async () => {
  const test = setup();
  jest.mocked(test.ports.segment).mockResolvedValue(rejectedObservation);
  const input = { ...test.input, imageRepairRetryKey: "request-1", maxImageRepairs: 3 };
  await expect(runGuidedImageDisplay(input)).rejects.toThrow("Image needs review");
  expect(test.ports.generateImage).toHaveBeenCalledTimes(4);
  expect(test.ports.narrate).not.toHaveBeenCalled();
  await expect(runGuidedImageDisplay({ ...input, checkpoint: test.latest() })).rejects.toThrow("Image needs review");
  expect(test.ports.generateImage).toHaveBeenCalledTimes(4);
  jest.mocked(test.ports.segment).mockResolvedValue(observation);
  await runGuidedImageDisplay({ ...input, checkpoint: test.latest(), imageRepairRetryKey: "request-2" });
  expect(test.ports.generateImage).toHaveBeenCalledTimes(5);
  expect(test.latest().status).toBe("ready");
});

it("resumes a stopped repair from the newly saved image without drawing it twice", async () => {
  const test = setup(failedCheckpoint());
  const controller = new AbortController();
  jest.mocked(test.ports.generateImage).mockImplementation(async () => {
    controller.abort(new Error("Stopped by user"));
    return asset("3");
  });
  await expect(runGuidedImageDisplay({
    ...test.input, signal: controller.signal, imageRepairRetryKey: "request-1",
  })).rejects.toThrow("Stopped by user");
  expect(test.latest().image).toEqual(asset("3"));
  expect(test.latest().status).toBe("stopped");
  await runGuidedImageDisplay({ ...test.input, checkpoint: test.latest(), imageRepairRetryKey: "request-1" });
  expect(test.ports.generateImage).toHaveBeenCalledTimes(1);
});

it("rechecks a stale rejection using the new observation version before spending on a redraw", async () => {
  const test = setup(failedCheckpoint());
  const result = await runGuidedImageDisplay({ ...test.input, observationVersion: "light-matte-v1" });
  expect(result.image).toEqual(asset("2"));
  expect(test.ports.segment).toHaveBeenCalledTimes(1);
  expect(test.ports.generateImage).not.toHaveBeenCalled();
  expect(test.latest().observationVersion).toBe("light-matte-v1");
});

it("reuses accepted pixels, regions and narration when the observation version changes", async () => {
  const checkpoint = { ...failedCheckpoint(), status: "ready" as const, segmentation: observation, beats };
  const test = setup(checkpoint);
  await runGuidedImageDisplay({ ...test.input, observationVersion: "light-matte-v1", imageRepairRetryKey: "request-2" });
  expect(test.ports.generateImage).not.toHaveBeenCalled();
  expect(test.ports.segment).not.toHaveBeenCalled();
  expect(test.ports.narrate).not.toHaveBeenCalled();
  expect(test.latest().image).toEqual(checkpoint.image);
});
