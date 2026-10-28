/** @jest-environment jsdom */
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {createDisplayClock, type DisplayDocument, type DisplayNode} from '@xue-learn/core/display/runtime';
import {DisplayBlockHost, DisplayDocumentHost, estimateDisplayDuration} from '../features/display/display-block-host';
import {useDerivationMotion} from '../features/teaching-derivation/use-derivation-motion';

const mockSurface = jest.fn((_props: unknown) => null);
jest.mock('@xue-learn/core/display/workspace', () => ({WorkspaceDisplaySurface: (props: unknown) => mockSurface(props)}));
const makeDocument = (durationTicks?: number): DisplayDocument => ({version: 1, id: 'lesson', root: {id: 'text', kind: 'general:text', version: 1, payload: {text: 'Hello'}}, plugins: [{id: 'org.xuelearn.display.general', version: '1.0.0'}], ticksPerSecond: 48_000, durationTicks});

describe('shared display learning host', () => {
  let container: HTMLDivElement, root: Root, now: number, frames: Map<number, FrameRequestCallback>, nextFrame: number;
  const latest = () => mockSurface.mock.calls.at(-1)![0] as {document: DisplayDocument; clock: ReturnType<typeof createDisplayClock>; onDocumentResolved: (document: DisplayDocument) => void};
  beforeEach(() => {
    (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div'); document.body.append(container); root = createRoot(container); now = 0; frames = new Map(); nextFrame = 1;
    jest.spyOn(performance, 'now').mockImplementation(() => now);
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {const id = nextFrame++; frames.set(id, callback); return id;});
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {frames.delete(id);});
    Object.defineProperty(window, 'matchMedia', {configurable: true, value: jest.fn(() => ({matches: false, addEventListener() {}, removeEventListener() {}}))});
    (globalThis as any).ResizeObserver = class {observe() {} disconnect() {}};
    mockSurface.mockClear();
  });
  afterEach(async () => {await act(async () => root.unmount()); container.remove(); jest.restoreAllMocks(); delete (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT;});
  const advance = async (milliseconds: number) => {now += milliseconds; const queued = [...frames.values()]; frames.clear(); await act(async () => {for (const callback of queued) callback(now);});};

  it('bounds malformed and cyclic estimates without treating classic derivations as teaching documents', () => {
    const cyclicRoot = {...makeDocument().root, children: [] as DisplayNode[]}; cyclicRoot.children.push(cyclicRoot);
    const cyclic = {...makeDocument(), root: cyclicRoot};
    expect(estimateDisplayDuration(cyclic)).toBe(12);
    expect(estimateDisplayDuration({...makeDocument(), root: {...cyclicRoot, children: Array(200_000).fill(cyclicRoot)}})).toBe(12);
    expect(estimateDisplayDuration({...makeDocument(), root: {...makeDocument().root, kind: 'math:formal-derivation', payload: {document: {steps: [{id: 'formal-step'}]}}}})).toBe(12);
    expect(estimateDisplayDuration(null as unknown as DisplayDocument)).toBe(12);
    expect(estimateDisplayDuration({...makeDocument(), timeline: [{id: 'later', startTick: 480_000, durationTicks: 96_000, targets: []}]})).toBe(12);
  });

  it('clamps the initial settled frame to the actual duration', async () => {
    await act(async () => root.render(<DisplayDocumentHost document={makeDocument(4_800)}/>));
    expect(latest().clock.frame).toBe(5);
    expect(container.querySelector<HTMLInputElement>('input[type=range]')!.max).toBe('5');
  });

  it('holds pending work at zero then plays the resolved length and pauses on demand', async () => {
    const source = {...makeDocument(), root: {...makeDocument().root, build: {jobId: 'job', status: 'pending' as const}}};
    await act(async () => root.render(<DisplayDocumentHost document={source} autoPlay/>));
    await advance(5000);
    expect(latest().clock.frame).toBe(0);
    expect(latest().clock.playing).toBe(false);
    expect(container.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
    await act(async () => latest().onDocumentResolved({...source, durationTicks: 96_000, root: {...source.root, build: {...source.root.build!, status: 'ready'}}}));
    expect(container.querySelector<HTMLInputElement>('input')!.max).toBe('119');
    await advance(1000);
    expect(latest().clock.frame).toBe(60);
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    await advance(1000);
    expect(latest().clock.frame).toBe(60);
    expect(latest().clock.playing).toBe(false);
  });

  it('preserves caller-owned clocks without rendering competing playback controls', async () => {
    const clock = createDisplayClock(12, 24);
    await act(async () => root.render(<DisplayDocumentHost document={makeDocument()} clock={clock} autoPlay/>));
    expect(latest().clock).toBe(clock);
    expect(container.querySelector('button')).toBeNull();
    expect(frames.size).toBe(0);
  });

  it('seeks backward exactly and clamps when a resolved duration becomes shorter', async () => {
    const source = makeDocument(480_000);
    await act(async () => root.render(<DisplayDocumentHost document={source}/>));
    const slider = container.querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '30');
      slider.dispatchEvent(new Event('input', {bubbles: true}));
    });
    expect(latest().clock.frame).toBe(30);
    await act(async () => latest().onDocumentResolved({...source, durationTicks: 9_600}));
    expect(latest().clock.frame).toBe(11);
    expect(slider.max).toBe('11');
  });

  it('keeps teaching emphasis continuous when a repeated cue addresses the same target', async () => {
    const block = {type: 'teaching', version: 1, id: 'layers', title: 'Layers', templateId: 'general-layers', content: {layers: [{title: 'First', detail: 'A'}, {title: 'Second', detail: 'B'}]}};
    const render = (target: string, key: string) => root.render(<DisplayBlockHost block={block} activeTargetIds={[target]} playback={{animate: true, key, revealedTargetIds: ['layer-1', target]}}/>);
    await act(async () => render('layer-1', 'cue-1')); await advance(700);
    await act(async () => render('layer-2', 'cue-2'));
    expect(latest().document.root.payload).toMatchObject({activeTargetIds: ['layer-2'], previousActiveTargetIds: ['layer-1'], progress: 0});
    await advance(350);
    expect(latest().document.root.payload).toMatchObject({progress: .5});
    await act(async () => render('layer-2', 'cue-3'));
    expect(latest().document.root.payload).toMatchObject({progress: .5});
    await advance(350);
    expect(latest().document.root.payload).toMatchObject({progress: 1});
  });

  it('holds chat on the focused cue without preview controls or a running timeline', async () => {
    const block = {type: 'teaching', version: 1, id: 'layers', title: 'Layers', templateId: 'general-layers', content: {layers: [{title: 'First', detail: 'A'}, {title: 'Second', detail: 'B'}]}};
    const render = (target: string) => root.render(<DisplayBlockHost block={block} activeTargetIds={[target]} playback={{animate: true, key: target}}/>);
    await act(async () => render('layer-1'));
    expect(container.querySelector('.workspace-display-controls')).toBeNull();
    expect(latest().clock.playing).toBe(true);
    await advance(700);
    const settled = latest().clock;
    expect(settled.playing).toBe(false);
    expect(frames.size).toBe(0);
    await advance(12_000);
    expect(latest().clock).toBe(settled);
    await act(async () => render('layer-2'));
    await advance(700);
    await act(async () => render('layer-1'));
    expect(latest().document.root.payload).toMatchObject({activeTargetIds: ['layer-1'], previousActiveTargetIds: ['layer-2'], progress: 0});
    await advance(700);
    expect(latest().clock.playing).toBe(false);
  });

  it('projects portable chat cues without changing the saved video timeline', async () => {
    const source = {...makeDocument(), timeline: [{id: 'video-cue', startTick: 0, durationTicks: 480_000, targets: ['text/video-target']}]};
    const block = {type: 'display', document: source};
    const render = (target: string) => root.render(<DisplayBlockHost block={block} activeTargetIds={[target]} playback={{animate: true, key: target}}/>);
    await act(async () => render('text/first'));
    await advance(700);
    await act(async () => render('text/second'));
    expect(latest().document.timeline).toEqual([
      {id: 'chat-previous', startTick: 0, durationTicks: 96_000, targets: ['text/first']},
      {id: 'chat-focus', startTick: 96_000, durationTicks: 48_000, targets: ['text/second']},
    ]);
    expect(source.timeline[0].id).toBe('video-cue');
    expect(source.timeline[0].targets).toEqual(['text/video-target']);
    expect(container.querySelector('input[type=range]')).toBeNull();
  });

  it('projects a stage focus into the addressed figure and its local detail ids', async () => {
    const block = {type: 'stage', id: 'stage', layout: 'split-h', figures: [
      {type: 'callout', id: 'left-card', title: 'Left', body: 'One'},
      {type: 'callout', id: 'right-card', title: 'Right', body: 'Two'},
    ]};
    const render = (targets: string[]) => root.render(<DisplayBlockHost block={block} activeTargetIds={targets} playback={{animate: true, key: targets.join(',')}}/>);
    await act(async () => render(['stage-left']));
    expect(latest().document.root.children![0].payload).toMatchObject({activeTargetIds: ['whole']});
    expect(latest().document.root.children![1].payload).toMatchObject({activeTargetIds: []});
    await act(async () => render(['fig:right-card:detail-1']));
    expect(latest().document.root.children![0].payload).toMatchObject({activeTargetIds: [], previousActiveTargetIds: ['whole']});
    expect(latest().document.root.children![1].payload).toMatchObject({activeTargetIds: ['detail-1'], previousActiveTargetIds: []});
  });

  it('animates backward derivation navigation from the displayed step', async () => {
    let sampled!: ReturnType<typeof useDerivationMotion>;
    function Probe({ordinal}: {ordinal: number}) {sampled = useDerivationMotion(ordinal); return null;}
    await act(async () => root.render(<Probe ordinal={3}/>));
    expect(sampled).toEqual({from: 3, to: 3, progress: 1});
    await act(async () => root.render(<Probe ordinal={2}/>));
    expect(sampled).toEqual({from: 3, to: 2, progress: 0});
    await advance(0); await advance(640);
    expect(sampled).toEqual({from: 3, to: 2, progress: 1});
  });
});
