import {filmContext} from './presentation.js';
import {projectDisplayFocusTimeline} from '../adapters.js';
import {createDisplayClock} from '../../../../libs/display/src/clock.js';
import {sampleMotionScene} from './motion-scene-sampling.js';
import type {RemotionMotionSceneComponent} from './motion-scene-schema.js';

const props: RemotionMotionSceneComponent['props'] = {description: 'Move then rotate', objects: [
  {id: 'box', kind: 'shape', shape: 'rect', x: 100, y: 100, width: 80, height: 50, tone: 'primary'},
  {id: 'label', kind: 'text', text: 'Box', x: 100, y: 50, width: 100, height: 32, tone: 'primary'},
], stages: [
  {id: 'move', description: 'Translate', tracks: [{targetId: 'box', to: {x: 300}}]},
  {id: 'rotate', description: 'Rotate', tracks: [{targetId: 'box', to: {rotation: 90}}]},
]};
const document = {version: 1 as const, id: 'lesson', root: {id: 'board', kind: 'physics:motion-scene', version: 1, payload: props, targets: ['box', 'label', 'move', 'rotate']},
  plugins: [], ticksPerSecond: 48_000, timeline: [
    {id: 'first', startTick: 0, durationTicks: 96_000, targets: ['board/move']},
    {id: 'second', startTick: 96_000, durationTicks: 96_000, targets: ['board/rotate']},
  ]};

test('shared course cues execute advanced motion stages and preserve the completed preceding transform during a learner seek', () => {
  const focused = projectDisplayFocusTimeline(document, ['board/rotate'], 'second');
  const clock = createDisplayClock(162, 60, {ticksPerSecond: 48_000});
  const context = filmContext('board', 'motion-scene.v1', props, clock, focused.timeline);
  expect(context.scene.beats.map(beat => beat.action)).toEqual(['transform', 'transform']);
  const sample = sampleMotionScene(props, context.scene, context.timeline, context.tick);
  expect(sample.objects.find(object => object.id === 'box')).toMatchObject({x: 300, rotation: 90});
  expect(document.timeline[1]!.startTick).toBe(96_000);
  const earlier = filmContext('board', 'motion-scene.v1', props, createDisplayClock(60, 60), document.timeline);
  expect(sampleMotionScene(props, earlier.scene, earlier.timeline, earlier.tick).objects.find(object => object.id === 'box')!.rotation ?? 0).toBe(0);
});

test('accepted native actions retain their cue identities when a host changes only narration timing', () => {
  const payload = {...props, presentation: {beats: [{id: 'spoken', text: 'Rotate it', action: 'transform' as const, targetIds: ['rotate']}], tracks: [], startTick: 0, endTick: 1}};
  const context = filmContext('board', 'motion-scene.v1', payload, createDisplayClock(240, 60), [{id: 'spoken', startTick: 144_000, durationTicks: 96_000, targets: ['board/rotate']}]);
  expect(context.scene.beats[0]).toMatchObject({id: 'spoken', action: 'transform', targetIds: ['rotate']});
  expect(context.timeline.tracks[0]).toMatchObject({startTick: 144_000, durationTicks: 96_000});
});
