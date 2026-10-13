/** @jest-environment jsdom */
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {createDisplayCatalog, createDisplayClock, createDisplayRuntime, type DisplayDocument, type DisplayNode, type DisplayPluginManifest} from '../../../libs/display/src/index.js';
import {DisplayRuntimeSurface, type DisplayRenderer} from '../display-runtime/index.js';
import {builtinDisplayManifests} from './catalog.js';
import {createAnimatedDisplay} from './renderers/animated.js';
import {ImageBoard} from './film/image-board.js';
jest.mock('../display-runtime/display-runtime.css', () => ({}));
jest.mock('./film/image-board.css', () => ({}));
jest.mock('./film/stage.js', () => ({FilmStage: ({children}: {children: React.ReactNode}) => <div>{children}</div>}));
jest.mock('../markdown/inline-math-text.js', () => ({InlineMathText: ({text}: {text: string}) => <span>{text}</span>}));
jest.mock('./film/text.js', () => ({StoryText: ({text}: {text: string}) => <span>{text}</span>}));
jest.mock('../course-display/guided-image-focus-outline.js', () => ({GuidedImageFocusOutline: () => null}));

const general = builtinDisplayManifests.find(manifest => manifest.id === 'org.xuelearn.display.general')!;
const media = builtinDisplayManifests.find(manifest => manifest.id === 'org.xuelearn.display.media')!;
const lock = (manifest: DisplayPluginManifest) => ({id: manifest.id, version: manifest.version});
const imageNode = (id: string): DisplayNode => ({id, kind: 'media:image', version: 1, payload: {id, alt: id, caption: '', motion: 'still', resourceId: 'diagram'}});
const composition = (id: string, children: readonly DisplayNode[]): DisplayNode => ({id, kind: 'general:composition', version: 1, payload: {}, children});
const imagePackage = (name: string, uri: string, template: DisplayNode = imageNode('image')): DisplayPluginManifest => ({apiVersion: 1, id: `teacher.${name}`, version: '1.0.0', execution: 'declarative', resources: [{id: 'diagram', kind: 'image', uri}], dependencies: [lock(media), lock(general)], components: [{kind: `teacher:${name}`, version: 1, composition: template}]});
const instance = (name: string): DisplayNode => ({id: name, kind: `teacher:${name}`, version: 1, payload: {}});
const ImageDisplay = createAnimatedDisplay('image.v1', ({component, ...context}) => <ImageBoard key={component.props.src} props={component.props} {...context}/>);

describe('package resources reach the real shared image renderer', () => {
  let container: HTMLDivElement, root: Root;
  beforeEach(() => {(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container);});
  afterEach(async () => {await act(async () => root.unmount()); container.remove(); delete (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT;});
  function runtime(manifests: readonly DisplayPluginManifest[], failUri?: string) {
    return createDisplayRuntime<DisplayRenderer>({catalog: createDisplayCatalog([general, media, ...manifests]), resolveModule: async () => ({components: {'media:image@1': ImageDisplay, 'general:composition@1': ({children}) => <>{children}</>}}), resolveResource: resource => {if (resource.uri === failUri) throw new Error('Image unavailable'); return {uri: `blob:verified-${resource.uri.slice(1)}`};}});
  }
  it('inherits package bytes through foreign renderers, shadows nearest IDs and keeps siblings separate', async () => {
    const inner = imagePackage('inner', '/inner.png');
    const outer = imagePackage('outer', '/outer.png', composition('row', [imageNode('inherited'), instance('inner')]));
    const sibling = imagePackage('sibling', '/sibling.png');
    const displayDoc: DisplayDocument = {version: 1, id: 'resources', resources: [{id: 'diagram', kind: 'image', uri: '/document.png'}], plugins: [general, media, outer, inner, sibling].map(lock), root: composition('root', [instance('outer'), instance('sibling'), imageNode('fallback')])};
    const renderer = runtime([outer, inner, sibling]);
    try {
      expect((await renderer.preflight(displayDoc)).issues).toEqual([]);
      await act(async () => root.render(<DisplayRuntimeSurface document={displayDoc} runtime={renderer} clock={createDisplayClock(60, 60)} mode="video"/>));
      expect([...container.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual(['blob:verified-outer.png', 'blob:verified-inner.png', 'blob:verified-sibling.png', 'blob:verified-document.png']);
      await act(async () => {for (const img of container.querySelectorAll('img')) img.dispatchEvent(new Event('load'));});
      expect(container.querySelectorAll('[data-remotion-resource-status="ready"]')).toHaveLength(4);
      expect(container.querySelector('[data-display-placeholder]')).toBeNull();
    } finally {renderer.dispose();}
  });
  it('rejects unavailable package bytes without hiding a valid sibling image', async () => {
    const broken = imagePackage('broken', '/broken.png'), sibling = imagePackage('sibling', '/sibling.png');
    const displayDoc: DisplayDocument = {version: 1, id: 'failure', plugins: [general, media, broken, sibling].map(lock), root: composition('root', [instance('broken'), instance('sibling')])};
    const renderer = runtime([broken, sibling], '/broken.png');
    try {
      const preflight = await renderer.preflight(displayDoc);
      expect(preflight.ready).toBe(false);
      expect(preflight.issues).toEqual(expect.arrayContaining([expect.objectContaining({reason: 'resource-error', resourceId: 'diagram', pluginId: broken.id})]));
      await act(async () => root.render(<DisplayRuntimeSurface document={displayDoc} runtime={renderer} clock={createDisplayClock(60, 60)} mode="video"/>));
      expect([...container.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual(['blob:verified-sibling.png']);
      expect(container.querySelector('[data-display-placeholder="resource-error"]')).not.toBeNull();
    } finally {renderer.dispose();}
  });
});
