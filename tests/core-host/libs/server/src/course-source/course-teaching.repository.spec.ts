import {CourseSourceRepository} from '../../../../../../persistence/sqlite/course-source.repository.ts';
import type {EntityManager} from '@mikro-orm/core';
const {DatabaseSync} = require('node:sqlite');

function harness() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE LearningGoal(id TEXT PRIMARY KEY,userId TEXT,title TEXT,goalKind TEXT,contentLanguage TEXT);
    CREATE TABLE LearningModule(id TEXT,orderIndex INTEGER,title TEXT);
    CREATE TABLE LearningUnit(id TEXT PRIMARY KEY,goalId TEXT,moduleId TEXT,orderIndex INTEGER,title TEXT,unitKind TEXT,contentSummary TEXT,contentRevision INTEGER);
    CREATE TABLE UnitSessionState(unitId TEXT,sq3rData TEXT);
    CREATE TABLE LearningMaterial(id TEXT,unitId TEXT UNIQUE,introduction TEXT,sections TEXT,keyTakeaways TEXT,contextSources TEXT,createdAt TEXT,updatedAt TEXT);
    CREATE TABLE UnitSection(id TEXT PRIMARY KEY,unitId TEXT,orderIndex INTEGER,title TEXT,contentSummary TEXT,contentKind TEXT,generationStatus TEXT,assessmentAfter INTEGER,testGenerationStatus TEXT,contentRevision INTEGER,derivationFormat TEXT,generationError TEXT,generationToken TEXT,generationStartedAt TEXT,updatedAt TEXT);
    CREATE VIEW MainCourseSection AS SELECT * FROM UnitSection;
    CREATE TABLE AiGenerationRun(scopeId TEXT,operation TEXT,status TEXT);
    CREATE TABLE UnitSectionMaterial(id TEXT,sectionId TEXT UNIQUE,introduction TEXT,blocks TEXT,keyTakeaways TEXT,contextSources TEXT,sourceItems TEXT,createdAt TEXT,updatedAt TEXT);
    CREATE TABLE UnitSectionDerivation(sectionId TEXT,documentJson TEXT);
    CREATE TABLE UnitSectionTeachingDerivation(sectionId TEXT,documentJson TEXT,derivedJson TEXT,parserVersion TEXT,analyzerVersion TEXT,matcherVersion TEXT,compilerVersion TEXT);
    CREATE TABLE UnitLearningTarget(unitId TEXT,learningTargetId TEXT,orderIndex INTEGER,localRef TEXT,role TEXT,required INTEGER,weight REAL);
    CREATE TABLE LearningTarget(id TEXT,goalId TEXT,title TEXT,explanation TEXT,learningObjective TEXT,assessmentCriteria TEXT,language TEXT,definitionVersion INTEGER);
    INSERT INTO LearningGoal VALUES ('goal','owner','Physics','full','en');
    INSERT INTO LearningUnit VALUES ('unit','goal',NULL,0,'Motion','lesson','Motion',7);
    INSERT INTO UnitSessionState VALUES ('unit','{"survey":{"outline":["Motion"]}}');
    INSERT INTO UnitSection VALUES ('first','unit',0,'Move','Move','standard','pending',0,'pending',0,NULL,'',NULL,NULL,'');
    INSERT INTO UnitSection VALUES ('second','unit',1,'Rotate','Rotate','standard','pending',0,'pending',0,NULL,'',NULL,NULL,'');
  `);
  const execute = async (sql: string, params: unknown[] = []) => {
    const statement = db.prepare(sql);
    return statement.columns().length ? statement.all(...params) : statement.run(...params);
  };
  const em = {config: {getSchema: () => undefined}, getConnection: () => ({execute}), getTransactionContext: () => undefined,
    fork: () => em, transactional: async (work: (em: EntityManager) => Promise<unknown>) => {
      db.exec('BEGIN IMMEDIATE');
      try {const result = await work(em as unknown as EntityManager); db.exec('COMMIT'); return result;}
      catch (error) {db.exec('ROLLBACK'); throw error;}
    }} as unknown as EntityManager;
  return {db, repository: new CourseSourceRepository(em, async () => null), input: {workspaceId: 'workspace', ownerId: 'owner', unitId: 'unit'}};
}
const material = {introduction: '', blocks: [{type: 'paragraph', text: 'Complete accepted explanation.'}], keyTakeaways: ['Keep the same object.']};

test('accepted video teaching is atomically published in the real course tables and can be reused without rewriting it', async () => {
  const {db, repository, input} = harness();
  try {
    const before = (await repository.readTeachingDraft(input))!;
    const reuse = {expectedContentHash: before.contentHash, sections: [{sectionId: 'first', material}]};
    await repository.adoptTeachingMaterial(input, reuse);
    const ready = (await repository.readUnit(input))!;
    expect(ready.sections[0]!.material).toEqual(material);
    expect(ready.sections[0]).toMatchObject({availability: 'published', generationStatus: 'ready', publishedRevision: 1});
    expect(ready.metadata.publishedRevision).toBe(8);
    await repository.adoptTeachingMaterial(input, reuse);
    expect((await repository.readUnit(input))!.contentHash).toBe(ready.contentHash);
    expect(db.prepare('SELECT COUNT(*) AS count FROM UnitSectionMaterial').get().count).toBe(1);
  } finally {db.close();}
});

test('existing learner material is retained when missing neighbor sections adopt accepted teaching', async () => {
  const {db, repository, input} = harness();
  try {
    const original = {...material, introduction: 'Learner-owned introduction'};
    db.prepare('INSERT INTO UnitSectionMaterial VALUES (?,?,?,?,?,?,?,?,?)').run('original','first',original.introduction,JSON.stringify(original.blocks),JSON.stringify(original.keyTakeaways),'[]','[]','','');
    const before = (await repository.readTeachingDraft(input))!;
    await repository.adoptTeachingMaterial(input, {expectedContentHash: before.contentHash, sections: [{sectionId: 'first', material}, {sectionId: 'second', material}]});
    const after = (await repository.readUnit(input))!;
    expect(after.sections[0]!.material).toEqual(original);
    expect(after.sections[1]!.material).toEqual(material);
  } finally {db.close();}
});

test('owner changes, stale sources and an active course generator cannot overwrite or partially adopt teaching', async () => {
  const {db, repository, input} = harness();
  try {
    const before = (await repository.readTeachingDraft(input))!;
    const reuse = {expectedContentHash: before.contentHash, sections: [{sectionId: 'first', material}, {sectionId: 'second', material}]};
    await expect(repository.adoptTeachingMaterial({...input, ownerId: 'other'}, reuse)).rejects.toThrow('not found');
    db.exec("UPDATE LearningUnit SET title='Updated source'");
    await expect(repository.adoptTeachingMaterial(input, reuse)).rejects.toThrow('changed');
    const current = (await repository.readTeachingDraft(input))!;
    db.exec("UPDATE UnitSection SET generationStatus='building' WHERE id='second'");
    await expect(repository.adoptTeachingMaterial(input, {...reuse, expectedContentHash: current.contentHash})).rejects.toThrow('already being prepared');
    expect(db.prepare('SELECT COUNT(*) AS count FROM UnitSectionMaterial').get().count).toBe(0);
    expect(db.prepare('SELECT contentRevision FROM LearningUnit').get().contentRevision).toBe(7);
  } finally {db.close();}
});

test('a historical whole-unit film is adopted into the legacy course reader without creating or generating a second section spine', async () => {
  const {db, repository, input} = harness();
  try {
    db.exec('DELETE FROM UnitSection');
    const source = (await repository.readTeachingDraft(input))!;
    await repository.adoptTeachingMaterial(input, {expectedContentHash: source.contentHash, sections: [{sectionId: 'unit', material}]});
    const after = (await repository.readUnit(input))!;
    expect(after.sections).toEqual([]);
    expect(after.legacyMaterial).toEqual({introduction: '', sections: material.blocks, keyTakeaways: material.keyTakeaways});
  } finally {db.close();}
});
