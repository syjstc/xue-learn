import {sampleImageBoard} from './image-board-sampling.js';
import type {RemotionLessonSceneV1} from './types.js';

const image = {sha256: 'a'.repeat(64), width: 1920, height: 1080,
  segmentation: {geometryVersion: 'simple-shapes-v1' as const, missingPartIds: [], imageIssues: [],
    regions: ['leaf', 'root'].map((id, index) => ({id, partId: id, label: id, observedDescription: id,
      polygons: [{holes: [], outer: [{x: .2 + index * .4, y: .2}, {x: .3 + index * .4, y: .2},
        {x: .3 + index * .4, y: .4}, {x: .2 + index * .4, y: .4}]}]}))}};
const intervals = [[], ['image:leaf'], ['image:leaf'], ['image:root'], ['whole']].map((targetIds, index) => ({
  targetIds, startTick: index * 96_000, durationTicks: 96_000,
}));
const scene = (host: Record<string, unknown> = {}): RemotionLessonSceneV1 => ({id: 'picture', title: 'Plant',
  component: {type: 'image.v1', props: {id: 'plant', prompt: 'Plant', alt: 'Plant', caption: 'Inputs', guidedImage: image, ...host}},
  beats: intervals.map((interval, index) => ({id: `cue-${index}`, text: 'Accepted narration',
    action: interval.targetIds.length ? 'focus' : 'overview', targetIds: [`source_cue_${index + 1}`]}))});
const timeline = {durationTicks: 480_000, scenes: [{id: 'picture', startTick: 0, endTick: 480_000}],
  tracks: intervals.map((interval, index) => ({kind: 'caption', beatId: `cue-${index}`, startTick: interval.startTick, durationTicks: interval.durationTicks}))};

it('uses the original course region intervals instead of source-cue speech IDs, including reverse seeks', () => {
  const sample = (tick: number) => sampleImageBoard(scene({teachingTimeline: {intervals, tick}}), timeline, tick)!;
  const leaf = sample(144_000);
  expect(leaf.targets).toEqual(['leaf']);
  expect(leaf.frame.highlights.map(highlight => highlight.region.id)).toEqual(['leaf']);
  expect(leaf.camera.zoom).toBeGreaterThan(1);
  expect(leaf.frame.backgroundOpacity).toBeLessThan(1);
  expect(sample(240_000)).toEqual(leaf);
  expect(sample(336_000).targets).toEqual(['root']);
  expect(sample(432_000)).toMatchObject({targets: [], camera: {zoom: 1}, frame: {highlights: [], backgroundOpacity: 1}});
  expect(sample(144_000)).toEqual(leaf);
  expect(sample(96_000).camera.zoom).toBe(1);
  expect(sample(96_000).frame.highlights).toEqual([]);
});

it('uses explicit chat focus, transitions from the previous region, and clears it for a whole-image cue', () => {
  const sample = (activeTargetIds: string[], progress: number) => sampleImageBoard(scene({
    activeTargetIds, previousActiveTargetIds: ['image:leaf'], progress,
  }), timeline, 144_000)!;
  expect(sample(['image:root'], 0).frame.highlights[0]!.region.polygons).toEqual(sample(['image:leaf'], 1).frame.highlights[0]!.region.polygons);
  const halfway = sample(['image:root'], .5);
  expect(halfway.frame.highlights.length).toBeGreaterThan(0);
  expect(sample(['image:root'], 1).frame.highlights.map(highlight => highlight.region.id)).toEqual(['root']);
  expect(sample([], 1)).toMatchObject({targets: [], camera: {zoom: 1}, frame: {highlights: []}});
});

it('retains native film region cues and their deterministic timing', () => {
  const native = scene();
  const accepted = {...native, beats: native.beats.map((beat, index) => ({...beat,
    targetIds: intervals[index]!.targetIds.map(target => target.replace(/^image:/, ''))}))};
  const nativeSample = sampleImageBoard(accepted, timeline, 144_000)!;
  const courseSample = sampleImageBoard(scene({teachingTimeline: {intervals, tick: 144_000}}), timeline, 144_000)!;
  expect(nativeSample).toEqual(courseSample);
});

it('keeps the full diagram for widely separated vertically stacked comparison targets', () => {
  // Geometry from the actual 3.2 block-table comparison: the selected entry
  // groups occupy the right side; their source blocks and connecting arrows
  // extend across the rest of the diagram. Both must remain visible.
  const comparisonImage = {...image, width: 1536, height: 1024, segmentation: {
    ...image.segmentation, regions: [
      {id: 'three-entries', partId: 'three-entries', label: 'three entries', observedDescription: 'three entries',
        polygons: [{holes: [], outer: [{x: .793, y: .147}, {x: .926, y: .147}, {x: .926, y: .309}, {x: .793, y: .309}]}]},
      {id: 'five-entries', partId: 'five-entries', label: 'five entries', observedDescription: 'five entries',
        polygons: [{holes: [], outer: [{x: .793, y: .412}, {x: .926, y: .412}, {x: .926, y: .662}, {x: .793, y: .662}]}]},
    ],
  }};
  const targetIds = ['image:three-entries', 'image:five-entries'];
  const comparison = {...scene(), component: {type: 'image.v1', props: {
    ...(scene().component.props as any), guidedImage: comparisonImage,
    teachingTimeline: {intervals: [{targetIds, startTick: 0, durationTicks: 96_000}], tick: 96_000},
  }}} as RemotionLessonSceneV1;
  const result = sampleImageBoard(comparison, timeline, 96_000)!;
  expect(result.targets).toEqual(['three-entries', 'five-entries']);
  expect(result.frame.highlights.map(entry => entry.region.id)).toEqual(['three-entries', 'five-entries']);
  expect(result.camera.zoom).toBe(1);
  expect(result.camera.y).toBeLessThanOrEqual(0);
  expect(result.camera.y + result.camera.height).toBeGreaterThanOrEqual(1024);
  const explicit = {...comparison, component: {type: 'image.v1', props: {
    ...(comparison.component.props as any), teachingTimeline: undefined,
    activeTargetIds: targetIds, previousActiveTargetIds: [], progress: 1,
  }}} as RemotionLessonSceneV1;
  const direct = sampleImageBoard(explicit, timeline, 96_000)!;
  expect(direct.targets).toEqual(result.targets);
  expect(direct.frame.highlights.map(entry => entry.region.id)).toEqual(result.targets);
  expect(direct.camera.zoom).toBe(1);
});

it('keeps zooming on nearby selected regions without changing their highlights', () => {
  const nearby = {...image, segmentation: {...image.segmentation, regions: image.segmentation.regions.map((region, i) => ({
    ...region, polygons: [{holes: [], outer: [{x: .2 + i*.06, y: .2}, {x: .25 + i*.06, y: .2},
      {x: .25 + i*.06, y: .3}, {x: .2 + i*.06, y: .3}]}],
  }))}};
  const targetIds = ['image:leaf', 'image:root'];
  const s = {...scene(), component: {type: 'image.v1', props: {
    ...(scene().component.props as any), guidedImage: nearby,
    teachingTimeline: {intervals: [{targetIds, startTick: 0, durationTicks: 96_000}], tick: 96_000},
  }}} as RemotionLessonSceneV1;
  const result = sampleImageBoard(s, timeline, 96_000)!;
  expect(result.targets).toEqual(['leaf', 'root']);
  expect(result.frame.highlights.map(entry => entry.region.id)).toEqual(result.targets);
  expect(result.camera.zoom).toBeGreaterThan(1);
});

it.each([
  [[.326, .222, .630, .320], [.326, .530, .630, .628]],
  [[.545, .309, .659, .402], [.662, .518, .769, .814]],
])('preserves focused cameras for the other actual course target pairs', (first, second) => {
  const regions = [first, second].map(([left, top, right, bottom], i) => ({
    id: `region-${i}`, partId: `region-${i}`, label: `region-${i}`, observedDescription: `region-${i}`,
    polygons: [{holes: [], outer: [{x: left, y: top}, {x: right, y: top},
      {x: right, y: bottom}, {x: left, y: bottom}]}],
  }));
  const actual = {...image, width: 1536, height: 1024,
    segmentation: {...image.segmentation, regions}};
  const targetIds = ['image:region-0', 'image:region-1'];
  const s = {...scene(), component: {type: 'image.v1', props: {
    ...(scene().component.props as any), guidedImage: actual,
    activeTargetIds: targetIds, previousActiveTargetIds: [], progress: 1,
  }}} as RemotionLessonSceneV1;
  const result = sampleImageBoard(s, timeline, 0)!;
  expect(result.targets).toEqual(['region-0', 'region-1']);
  expect(result.camera.zoom).toBeGreaterThan(1);
});
