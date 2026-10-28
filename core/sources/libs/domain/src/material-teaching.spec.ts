import {
  materialTeachingSchema, materialTeachingBindingSchema, materialTeachingAuthoringSchema,
  materialTeachingSteps, materialTeachingCueIssues, materialTeachingSortOperations,
  materialTeachingTarget, type MaterialTeaching,
} from "./material-teaching.js";
import {sampleMaterialTeaching, sampleMaterialTeachingTimeline} from "./material-teaching-motion.js";
import {compileMusicTeachingClip, resolveMusicCue} from "./material-music-teaching.js";
import {teachingTemplateMusicBlock} from "./material-teaching-content.js";

const sorting: MaterialTeaching = {type: "teaching", version: 1, id: "sort_example", title: "比较后再交换", templateId: "cs-sorting", content: {values: [3, 1, 2]}};
const flow: MaterialTeaching = {type: "teaching", version: 1, id: "process_example", title: "输入到结果", templateId: "general-flow", content: {nodes: ["输入", "处理", "输出"], caption: "依次观察各环节"}};

test("shared display has 37 strict typed content branches without authored stages, timing or asset data", () => {
  expect(materialTeachingBindingSchema.options).toHaveLength(37);
  expect(materialTeachingSchema.parse(sorting)).toEqual(sorting);
  expect(materialTeachingAuthoringSchema.parse(flow)).toEqual(flow);
  for (const extra of [{stages: []}, {seconds: 12}, {frame: 10}, {variant: 1}, {src: "https://example.org"}])
    expect(materialTeachingSchema.safeParse({...sorting, ...extra}).success).toBe(false);
  expect(materialTeachingSchema.safeParse({...flow, id: "node-1"}).success).toBe(false);
  expect(materialTeachingSchema.safeParse({...flow, templateId: "math-tangent"}).success).toBe(false);
});

test("sorting executes every comparison separately, including the comparison that does not swap", () => {
  const operations = materialTeachingSortOperations([3, 1, 2]);
  expect(operations.map(item => item.id)).toEqual(["values", "compare-1", "swap-1", "compare-2", "swap-2", "compare-3", "sorted"]);
  expect(operations[1]!.before.values).toEqual([3, 1, 2]);
  expect(operations[1]!.after.values).toEqual([3, 1, 2]);
  expect(operations[2]!.after.values).toEqual([1, 3, 2]);
  expect(operations[3]!.before.values).toEqual([1, 3, 2]);
  expect(operations[4]!.after.values).toEqual([1, 2, 3]);
  expect(operations[5]!.indices).toEqual([0, 1]);
  expect(operations[5]!.sourceItemIds).toEqual(["value-2", "value-3"]);
  const duplicates = materialTeachingSortOperations([2, 1, 2]);
  expect(duplicates.filter(item => item.kind === "swap")).toHaveLength(1);
  expect(duplicates.at(-1)!.after.order).toEqual([1, 0, 2]);
  expect(materialTeachingSortOperations([1, 2, 3]).map(item => item.id)).toEqual(["values", "compare-1", "compare-2", "sorted"]);
});

test("authoring requires every operation in executed order but accepts repeated explanations", () => {
  const cues = materialTeachingSteps(sorting).map(step => ({figureId: sorting.id, targetIds: [step.id]}));
  expect(materialTeachingCueIssues(sorting, cues)).toEqual([]);
  const repeated = [...cues]; repeated.splice(2, 0, cues[1]!);
  expect(materialTeachingCueIssues(sorting, repeated)).toEqual([]);
  const skipped = cues.filter(cue => cue.targetIds[0] !== "compare-3");
  expect(materialTeachingCueIssues(sorting, skipped).join(" ")).toMatch(/compare-3/);
  const reordered = [...cues]; [reordered[1], reordered[2]] = [reordered[2]!, reordered[1]!];
  expect(materialTeachingCueIssues(sorting, reordered).join(" ")).toMatch(/order/);
  expect(materialTeachingCueIssues(sorting, [{targetIds: ["compare-1", "swap-1"]}]).join(" ")).toMatch(/one teaching operation/);
});

test("long narration never advances an unspoken flow node; repeated cue holds; reverse seek is exact", () => {
  const intervals = [
    {targetIds: [materialTeachingTarget(flow.id, "node-1")], startTick: 0, durationTicks: 480_000},
    {targetIds: [materialTeachingTarget(flow.id, "node-1")], startTick: 480_000, durationTicks: 96_000},
    {targetIds: [materialTeachingTarget(flow.id, "node-2")], startTick: 576_000, durationTicks: 192_000},
    {targetIds: [materialTeachingTarget(flow.id, "node-3")], startTick: 768_000, durationTicks: 96_000},
  ];
  const at = (tick: number) => sampleMaterialTeachingTimeline(flow, intervals, tick);
  expect(at(500_000)).toMatchObject({stepId: "node-1", progress: 1, items: [{reveal: 1}, {reveal: 0}, {reveal: 0}]});
  expect(at(575_999).grammarSeconds).toBeCloseTo(.9);
  const halfway = at(645_120);
  expect(halfway).toMatchObject({stepId: "node-2", progress: .5, items: [{reveal: 1}, {reveal: .5}, {reveal: 0}]});
  at(900_000); at(0);
  expect(at(645_120)).toEqual(halfway);
  expect(at(-1)).toMatchObject({stepIndex: -1, items: [{reveal: 0}, {reveal: 0}, {reveal: 0}]});
});

test("each recursion call and return has a separate stable operation", () => {
  const recursion: MaterialTeaching = {...sorting, templateId: "cs-recursion", content: {operation: "product", start: 3}};
  expect(materialTeachingSteps(recursion).map(step => step.id)).toEqual(["call-3", "call-2", "call-1", "return-1", "return-2", "return-3"]);
  const call = sampleMaterialTeaching(recursion, {activeTargetIds: ["call-1"], progress: 1});
  expect(call.stepIndex).toBe(2);
  expect(call.items.slice(3).every(item => item.reveal === 0)).toBe(true);
});

test("explicit music cues compile the shared score and retain the outer display address", () => {
  const music: MaterialTeaching = {...sorting, id: "TeachingScore", templateId: "music-score", content: {id: "scale", title: "三个音", groups: [["C4"], ["D4"], ["E4"]], labels: [], beats: 1, range: ["C4", "G4"], tempo: 120}};
  const original = JSON.stringify(music);
  const score = teachingTemplateMusicBlock(music)!;
  const expected = compileMusicTeachingClip(score, "phrase");
  expect(resolveMusicCue(music, {figureId: music.id, clipId: "phrase"})).toEqual({...expected, figureId: music.id});
  expect(resolveMusicCue({type: "stage", figures: [flow, music]}, {figureId: music.id, clipId: "phrase", repeat: 2})?.durationTicks).toBe(expected.durationTicks * 2);
  expect(() => resolveMusicCue(music, {figureId: music.id, clipId: "missing"})).toThrow();
  expect(() => resolveMusicCue({...music, content: {...music.content, groups: [["bad"]]}}, {figureId: music.id, clipId: "phrase"})).toThrow();
  expect(JSON.stringify(music)).toBe(original);
});
