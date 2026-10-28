/** @jest-environment jsdom */
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {createDisplayCatalog, createDisplayClock, createDisplayRuntime, type DisplayDocument, type DisplayNode, type DisplayPluginManifest} from '../../../libs/display/src/index.js';
import {sampleMaterialTeachingTimeline, type MaterialTeaching, type MaterialTeachingSample} from '../../../libs/domain/src/index.js';
import {DisplayRuntimeSurface, type DisplayRenderer} from '../display-runtime/index.js';
import {builtinDisplayManifests} from './catalog.js';
import {TeachingDisplay} from './renderers/teaching.js';
jest.mock('../display-runtime/display-runtime.css', () => ({}));
jest.mock('./film/stage.js', () => ({FilmStage: ({children}: {children: React.ReactNode}) => <div>{children}</div>}));
jest.mock('../course-display/teaching/teaching-art.js', () => ({TeachingArt: ({props, sample}: {props: MaterialTeaching; sample: MaterialTeachingSample}) => <pre data-sampled={props.id}>{JSON.stringify(sample)}</pre>}));

const block: MaterialTeaching = {type: 'teaching', version: 1, id: 'layers', title: 'Native layers', templateId: 'general-layers', content: {layers: [{title: 'First', detail: 'A'}, {title: 'Second', detail: 'B'}, {title: 'Third', detail: 'C'}]}};
const general = builtinDisplayManifests.find(manifest => manifest.id === 'org.xuelearn.display.general')!;
const teachingNode = (id: string, source = block): DisplayNode => ({id, kind: 'general:teaching', version: 1, payload: {block: source}, targets: ['layer-1', 'layer-2', 'layer-3']});
const cues = (id: string) => [1, 2, 3].map((number, index) => ({id: `${id}-cue-${number}`, startTick: index * 1_000, durationTicks: 1_000, targets: [`${id}/layer-${number}`]}));
const expected = (tick: number) => sampleMaterialTeachingTimeline(block, [1, 2, 3].map((number, index) => ({startTick: index * 48_000, durationTicks: 48_000, targetIds: [`layer-${number}`]})), tick);

describe('native document narration reaches the shared domain renderer', () => {
  let container: HTMLDivElement, root: Root;
  beforeEach(() => {(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container);});
  afterEach(async () => {await act(async () => root.unmount()); container.remove(); delete (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT;});
  const sample = (id = 'layers') => JSON.parse(container.querySelector(`[data-sampled="${id}"]`)!.textContent!) as MaterialTeachingSample;
  function runtime(manifests: readonly DisplayPluginManifest[] = [general]) {
    return createDisplayRuntime<DisplayRenderer>({catalog: createDisplayCatalog(manifests), resolveModule: async () => ({components: {'general:teaching@1': TeachingDisplay, 'general:composition@1': ({children}) => <>{children}</>}})});
  }
  it('uses namespaced targets and narration time directly, including reverse seeks and nondefault ticks', async () => {
    const document: DisplayDocument = {version: 1, id: 'native', root: teachingNode('board'), plugins: [{id: general.id, version: general.version}], ticksPerSecond: 1_000, timeline: cues('board')};
    const renderer = runtime();
    try {
      const render = (seconds: number) => root.render(<DisplayRuntimeSurface document={document} runtime={renderer} clock={createDisplayClock(seconds * 60, 60)} mode="video"/>);
      await act(async () => render(1.5));
      expect(sample()).toEqual(expected(72_000));
      await act(async () => render(2.8));
      expect(sample().stepId).toBe('layer-3');
      await act(async () => render(1.5));
      expect(sample()).toEqual(expected(72_000));
    } finally {renderer.dispose();}
  });
  it('strips the complete declarative expansion prefix while keeping sibling targets separate', async () => {
    const kit: DisplayPluginManifest = {apiVersion: 1, id: 'teacher.layers', version: '1.0.0', execution: 'declarative', dependencies: [{id: general.id, version: general.version}], components: [{kind: 'teacher:layers', version: 1, composition: teachingNode('inner')}]};
    const document: DisplayDocument = {version: 1, id: 'nested', plugins: [{id: general.id, version: general.version}, {id: kit.id, version: kit.version}], ticksPerSecond: 1_000,
      root: {id: 'row', kind: 'general:composition', version: 1, payload: {}, children: [{id: 'card', kind: 'teacher:layers', version: 1, payload: {}}, teachingNode('sibling', {...block, id: 'sibling-layers'})]},
      timeline: [...cues('card/inner'), {id: 'sibling-focus', startTick: 0, durationTicks: 3_000, targets: ['sibling/layer-3']}]};
    const renderer = runtime([general, kit]);
    try {
      expect((await renderer.preflight(document)).ready).toBe(true);
      await act(async () => root.render(<DisplayRuntimeSurface document={document} runtime={renderer} clock={createDisplayClock(90, 60)} mode="video"/>));
      expect(sample()).toEqual(expected(72_000));
      expect(sample('sibling-layers').stepId).toBe('layer-3');
    } finally {renderer.dispose();}
  });
});
