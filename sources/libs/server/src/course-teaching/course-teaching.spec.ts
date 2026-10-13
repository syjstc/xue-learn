import {CourseTeachingContentService} from './index.js';
import type {CourseSourceSnapshotV1} from '../../../runtime-contracts/src/course-source.js';
import {configureDisplayBuildRuntime, type DisplayBuildRuntime} from '../display-build/service.js';

function fixture(): CourseSourceSnapshotV1 {
  return {contractVersion: 'course-source.v1', snapshotId: 'source', capturedAt: new Date().toISOString(), contentHash: 'a'.repeat(64),
    source: {workspaceId: 'workspace', ownerId: 'owner', unitId: 'unit', goalId: 'goal', moduleId: null, moduleOrderIndex: null, unitOrderIndex: 0},
    metadata: {goalTitle: 'Physics', goalKind: 'full', title: 'Energy', unitKind: 'lesson', contentLanguage: 'en', scope: 'Energy', publishedRevision: 1, learningTargets: []},
    preview: {status: 'ready', data: {survey: {outline: ['Energy', 'Force']}}}, assets: [], legacyMaterial: null,
    sections: ['first', 'second'].map((id, orderIndex) => ({id, orderIndex, title: id, scope: id, contentKind: 'standard', availability: 'missing',
      assessmentAfter: false, generationStatus: 'pending', testGenerationStatus: 'pending', publishedRevision: 0, derivationFormat: null,
      material: null, derivationDocument: null, teachingDerivationDocument: null, teachingDerivationDerived: null, presentationVersions: {}})),
  };
}
const material = {introduction: '', blocks: [{type: 'paragraph', text: 'A complete original explanation.'}], keyTakeaways: []};
function harness(source = fixture()) {
  const read = jest.fn(async (userId: string) => userId === 'owner' ? structuredClone(source) : null);
  const generate = jest.fn(async ({sectionId}: {sectionId: string}) => {
    const section = source.sections.find(section => section.id === sectionId)!;
    section.material = structuredClone(material); section.availability = 'published'; section.generationStatus = 'ready';
    source.metadata.publishedRevision++;
  });
  const ensurePlan = jest.fn(async () => undefined);
  const service = new CourseTeachingContentService({readDraft: read, readReady: read, ensurePlan, generateSection: generate});
  return {source, read, generate, ensurePlan, service};
}
afterEach(() => configureDisplayBuildRuntime(undefined));

test('concurrent learning/video preparation publishes each missing section once and reuses it on every later request', async () => {
  const h = harness();
  const [a, b] = await Promise.all([h.service.ensure('owner', 'unit'), h.service.ensure('owner', 'unit')]);
  expect(a).toEqual(b);
  expect(h.generate.mock.calls.map(([input]) => input.sectionId)).toEqual(['first', 'second']);
  expect(h.generate).toHaveBeenCalledWith({userId: 'owner', unitId: 'unit', sectionId: 'first', generationPurpose: 'course-production'});
  await h.service.ensure('owner', 'unit');
  expect(h.generate).toHaveBeenCalledTimes(2);
  expect(a.sections[0]!.material).toEqual(material);
});

test('a failed later section leaves prior course publication usable and retries only missing teaching', async () => {
  const h = harness();
  h.generate.mockImplementationOnce(async () => {h.source.sections[0]!.material = material; h.source.sections[0]!.availability = 'published';});
  h.generate.mockRejectedValueOnce(Error('provider interrupted'));
  await expect(h.service.ensure('owner', 'unit')).rejects.toThrow('provider interrupted');
  expect(h.source.sections[0]!.material).toEqual(material);
  await h.service.ensure('owner', 'unit');
  expect(h.generate.mock.calls.map(([input]) => input.sectionId)).toEqual(['first', 'second', 'second']);
});

test('old whole-unit content and already-published sections do not trigger a second body generation', async () => {
  const legacy = fixture(); legacy.sections = []; legacy.legacyMaterial = {introduction: 'Original intro', sections: material.blocks, keyTakeaways: []};
  const h = harness(legacy);
  expect((await h.service.ensure('owner', 'unit')).legacyMaterial).toEqual(legacy.legacyMaterial);
  expect(h.ensurePlan).not.toHaveBeenCalled(); expect(h.generate).not.toHaveBeenCalled();
  await expect(h.service.ensure('other', 'unit')).rejects.toThrow('not found');
});

test('existing course builders are awaited without starting a video-owned duplicate', async () => {
  const h = harness(); h.source.sections = [h.source.sections[0]!];
  h.source.sections[0]!.availability = 'published';
  const pending = {type: 'display', id: 'proof', title: 'Proof', document: {version: 1, id: 'proof', plugins: [], root: {
    id: 'proof', kind: 'general:text', version: 1, payload: {title: 'Pending'}, build: {jobId: 'job', status: 'pending', sourceHash: 'hash', revision: 1}}}};
  h.source.sections[0]!.material = {introduction: '', blocks: [pending], keyTakeaways: []};
  let ready = false;
  configureDisplayBuildRuntime({getOwned: async () => ({sourceHash: 'hash', inputRevision: 1, kind: 'general:text', componentVersion: 1,
    status: ready ? 'ready' : 'running', artifact: {text: 'Complete proof'}})} as unknown as DisplayBuildRuntime);
  const wait = jest.fn(async () => {ready = true;});
  const service = new CourseTeachingContentService({readDraft: h.read, readReady: async userId => {
    const source = await h.read(userId); const {prepareDisplayBuildSnapshot} = await import('../display-build/material.js');
    return source ? prepareDisplayBuildSnapshot(source, userId) : null;
  }, ensurePlan: h.ensurePlan, generateSection: h.generate, wait});
  const source = await service.ensure('owner', 'unit');
  expect(source.sections[0]!.material!.blocks).toMatchObject([{document: {root: {payload: {text: 'Complete proof'}, build: {status: 'ready'}}}}]);
  expect(wait).toHaveBeenCalledTimes(1); expect(h.generate).not.toHaveBeenCalled();
  expect(pending.document.root.build.status).toBe('pending');
});

test('owner identity and a publishing preview are checked before course writes', async () => {
  const h = harness(); h.source.preview.status = 'pending';
  await expect(h.service.ensure('owner', 'unit')).rejects.toThrow('preview');
  expect(h.generate).not.toHaveBeenCalled(); expect(h.ensurePlan).not.toHaveBeenCalled();
});
