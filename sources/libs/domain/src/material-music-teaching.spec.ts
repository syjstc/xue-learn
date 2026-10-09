import topics from "../../../scripts/fixtures/music-teaching/topics.json";
import scoreTopic from "../../../scripts/fixtures/music-integration/topic.json";
import meterPreparation from "../../../scripts/fixtures/music-teaching/meter-preparation-regression.json";
import {
  compileMusicTeachingClip,
  validateMusicTeaching,
  resolveMusicCue,
  type MaterialMusicTeaching,
} from "./material-music-teaching.js";
const source = (index = 0) =>
  structuredClone(topics[index]!.display) as MaterialMusicTeaching;
test("unmetered objects and independently composed views have real shared pitches", () => {
  topics.forEach((topic) =>
    validateMusicTeaching(topic.display as MaterialMusicTeaching),
  );
  const c = compileMusicTeachingClip(source(2), "central-listen");
  expect(c.notes.map((n) => n.midi)).toEqual([60]); // three views, only one sounding note
  expect(c.durationTicks).toBe(32_000);
  const pair = compileMusicTeachingClip(source(), "half-tone", 2);
  expect(pair.notes.map((n) => n.midi)).toEqual([64, 65, 64, 65]);
  expect(pair.durationTicks).toBe(128_000);
});
test("metered V1 scores can explicitly schedule real steps without rewriting saved music", () => {
  const original = JSON.stringify(scoreTopic.display);
  const plan = resolveMusicCue(scoreTopic.display, { figureId: scoreTopic.display.id, clipId: scoreTopic.display.steps[0]!.id });
  expect(plan!.notes.length).toBeGreaterThan(0); expect(plan!.durationTicks).toBeGreaterThan(0);
  expect(plan!.notes[0]!.targetId).toMatch(/^[a-z]+:\d+\.\d+$/);
  expect(JSON.stringify(scoreTopic.display)).toBe(original);
});
test("rejects missing anchors, invisible keyboard pitches, duplicate notes and unknown actions", () => {
  const a = source();
  a.marks![0]!.anchors[0]!.noteId = "absent";
  expect(() => validateMusicTeaching(a)).toThrow("anchor");
  const b = source();
  b.views[0]!.range = ["C5", "C6"];
  expect(() => validateMusicTeaching(b)).toThrow("omits");
  const c = source();
  c.clips![0]!.events[0]!.notes = ["e", "e"];
  expect(() => validateMusicTeaching(c)).toThrow();
  expect(() =>
    resolveMusicCue(source(), { figureId: "intervals", clipId: "unknown" }),
  ).toThrow("Unknown music clip");
});
test.each([false, true])("invalid V2 playback preserves the real duration error (nested=%s)", (nested) => {
  const block = structuredClone(meterPreparation.display) as MaterialMusicTeaching;
  const original = JSON.stringify(block);
  const display = nested ? {type: "stage", id: "board", figures: [block]} : block;
  for (const clipId of ["mt-supported", "mt-alone"]) {
    expect(() => resolveMusicCue(display, {figureId: block.id, clipId})).toThrow(
      "music figure meter-demo, clip mt-supported, events[0] has beats=1, but note mt-bass-a has beats=3",
    );
  }
  expect(JSON.stringify(block)).toBe(original);
  expect(() => resolveMusicCue(display, {figureId: "absent", clipId: "mt-alone"})).toThrow("Music action must reference a music figure: absent");
});
test("consistent bass accents preserve both real six-beat performances without changing the failed input", () => {
  const block = structuredClone(meterPreparation.display) as MaterialMusicTeaching;
  block.notes.filter(note => note.id.startsWith("mt-bass-")).forEach(note => {note.beats = 1;});
  const supported = resolveMusicCue(block, {figureId: block.id, clipId: "mt-supported"})!;
  const alone = resolveMusicCue(block, {figureId: block.id, clipId: "mt-alone"})!;
  expect(supported.durationTicks).toBe(192_000);
  expect(alone.durationTicks).toBe(192_000);
  expect(supported.notes.filter(note => note.targetId.startsWith("mt-bass-"))).toEqual([
    expect.objectContaining({targetId: "mt-bass-a", startTick: 0, durationTicks: 32_000, midi: 48}),
    expect.objectContaining({targetId: "mt-bass-b", startTick: 96_000, durationTicks: 32_000, midi: 43}),
  ]);
  expect(supported.notes.filter(note => !note.targetId.startsWith("mt-bass-"))).toEqual(alone.notes);
  expect(meterPreparation.display.notes.find(note => note.id === "mt-bass-a")!.beats).toBe(3);
});
test("one pitch can use distinct notated durations while pitch-only objects retain optional duration", () => {
  const block = source(2);
  const note = block.notes[0]!;
  note.beats = 1;
  block.notes.push({...note, id: "long", beats: 2});
  block.views[0]!.notes.push("long");
  block.clips![0]!.events = [{notes: [note.id], beats: 1}, {notes: ["long"], beats: 2}];
  const plan = compileMusicTeachingClip(block, block.clips![0]!.id);
  expect(plan.notes.map(note => note.durationTicks)).toEqual([32_000, 64_000]);
  block.clips![0]!.events[1]!.notes = [note.id];
  expect(() => validateMusicTeaching(block)).toThrow(`note ${note.id} has beats=1`);
  delete note.beats;
  expect(() => validateMusicTeaching(block)).not.toThrow();
});
