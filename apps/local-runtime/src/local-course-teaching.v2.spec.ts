import 'reflect-metadata';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {CourseTeachingContentService} from '@xue-learn/core/server/course-teaching';
import {LOCAL_OWNER_ID} from '@xue-learn/core/runtime-contracts';
import type {CourseSourceSnapshotV1} from '@xue-learn/core/runtime-contracts';
import {LocalCourseSourceController, LOCAL_COURSE_SOURCE_CONTEXT} from './local-course-source.controller.ts';
import {createLocalIngressMiddleware} from './local-ingress.ts';
import {courseTeachingBodyParser} from './course-teaching-ingress.ts';

test('the real host HTTP route publishes shared teaching once and rejects overwrite or owner overrides', async () => {
  const source: CourseSourceSnapshotV1 = {contractVersion: 'course-source.v1', snapshotId: 'snapshot', contentHash: 'a'.repeat(64), capturedAt: new Date().toISOString(),
    source: {workspaceId: 'workspace', ownerId: LOCAL_OWNER_ID, goalId: 'goal', unitId: 'unit', moduleId: null, moduleOrderIndex: null, unitOrderIndex: 0},
    metadata: {goalTitle: 'Physics', goalKind: 'full', title: 'Motion', unitKind: 'lesson', contentLanguage: 'en', scope: 'Motion', publishedRevision: 1, learningTargets: []},
    preview: {status: 'ready', data: {survey: {outline: ['Motion']}}}, assets: [], legacyMaterial: null,
    sections: [{id: 'section', orderIndex: 0, title: 'Motion', scope: 'Motion', contentKind: 'standard', availability: 'missing',
      assessmentAfter: false, generationStatus: 'pending', testGenerationStatus: 'pending', publishedRevision: 0, derivationFormat: null,
      material: null, derivationDocument: null, teachingDerivationDocument: null, teachingDerivationDerived: null, presentationVersions: {}}]};
  const read = async (ownerId: string) => ownerId === LOCAL_OWNER_ID ? structuredClone(source) : null;
  const generate = jest.fn(async (input: {userId: string}) => {
    expect(input.userId).toBe(LOCAL_OWNER_ID);
    source.sections[0]!.availability = 'published'; source.sections[0]!.material = {introduction: '', blocks: [{type: 'paragraph', text: 'Original shared explanation'}], keyTakeaways: []};
  });
  const teaching = new CourseTeachingContentService({readDraft: read, readReady: read, ensurePlan: async () => undefined, generateSection: generate, adopt: async () => undefined});
  class TestModule {}
  Module({controllers: [LocalCourseSourceController], providers: [{provide: LOCAL_COURSE_SOURCE_CONTEXT, useValue: {
    workspaceId: 'workspace', teaching, repository: {readUnit: ({ownerId}) => read(ownerId)},
  }}]})(TestModule);
  const app = await NestFactory.create(TestModule, {logger: false});
  app.use(createLocalIngressMiddleware('teaching-test-token'));
  app.use(courseTeachingBodyParser());
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const request = (body: unknown = {}, authenticated = true) => fetch(`${base}/api/course-sources/units/unit/teaching/ensure`, {
      method: 'POST', headers: {'content-type': 'application/json', ...(authenticated ? {authorization: 'Bearer teaching-test-token'} : {}), 'x-user-id': 'forged'}, body: JSON.stringify(body),
    });
    expect((await request({}, false)).status).toBe(401);
    const results = await Promise.all([request(), request()]);
    expect(results.map(result => result.status)).toEqual([201, 201]);
    expect((await results[0]!.json()).sections[0].material.blocks[0].text).toBe('Original shared explanation');
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await request({force: true})).status).toBe(400);
    expect((await request({ownerId: 'forged'})).status).toBe(400);
    expect((await request({reuse: {force: true}})).status).toBe(400);
    const largeImage = Buffer.alloc(160_000, 1).toString('base64');
    expect((await request({reuse: {expectedContentHash: source.contentHash, sections: [{sectionId: 'section', material: source.sections[0]!.material}],
      assets: [{imageId: 'ill-0-a', mediaType: 'image/png', sha256: 'b'.repeat(64), data: largeImage}]}})).status).toBe(201);
    expect(generate).toHaveBeenCalledTimes(1);
  } finally {await app.close();}
}, 20000);
