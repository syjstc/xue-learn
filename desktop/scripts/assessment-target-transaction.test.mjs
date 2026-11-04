import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

// A process boundary makes the former single-connection deadlock fail within
// a bounded time instead of leaving the test runner's SQLite transaction open.
if (process.argv.includes('--sqlite-worker')) {
  await exerciseRealSqlite();
} else {
  test('quiz-target repair commits and rolls back on the active SQLite transaction', () => {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--sqlite-worker'], {
      encoding: 'utf8', timeout: 8000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /committed, idempotent, rolled back, owner protected/);
  });
}

async function exerciseRealSqlite() {
  const {build} = await import('esbuild');
  const {MikroORM} = await import('@mikro-orm/sqlite');
  const {EntitySchema} = await import('@mikro-orm/core');
  const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const built = await build({
    stdin: {contents: `export {MikroOrmAssessmentTargetRepository} from './persistence/sqlite/reference/assessment-target.repository.ts';
      export {MikroOrmAssessmentTargetRuntimeAdapter} from './persistence/sqlite/reference/assessment-target.runtime.ts';
      export {installSqliteExclusiveGate} from './persistence/sqlite/reference/sqlite-exclusive-gate.ts';`,
      resolveDir: desktop, loader: 'ts'},
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'node24',
  });
  const {MikroOrmAssessmentTargetRepository, MikroOrmAssessmentTargetRuntimeAdapter, installSqliteExclusiveGate} =
    await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
  const orm = await MikroORM.init({dbName: ':memory:',
    entities: [new EntitySchema({name: 'TestEntity', properties: {id: {type: 'string', primary: true}}})]});
  try {
    const em = orm.em.fork(), connection = em.getConnection();
    installSqliteExclusiveGate(em);
    const execute = (sql, params = []) => connection.execute(sql, params);
    for (const sql of [
      'CREATE TABLE LearningGoal (id TEXT PRIMARY KEY, userId TEXT)',
      'CREATE TABLE LearningUnit (id TEXT PRIMARY KEY, goalId TEXT)',
      'CREATE TABLE CognitiveEntity (id TEXT PRIMARY KEY, kind TEXT, definitionVersion INTEGER, status TEXT)',
      'CREATE TABLE LearningTarget (id TEXT PRIMARY KEY, goalId TEXT, title TEXT, explanation TEXT, learningObjective TEXT, assessmentCriteria TEXT, importance TEXT, importanceWeight REAL, difficulty TEXT, targetCognitiveLevel TEXT, status TEXT)',
      'CREATE TABLE UnitLearningTarget (id TEXT PRIMARY KEY, unitId TEXT, learningTargetId TEXT, localRef TEXT, required INTEGER, weight REAL, role TEXT, isEntry INTEGER, isExit INTEGER, orderIndex INTEGER)',
      'CREATE TABLE LearningTargetRequirement (id TEXT PRIMARY KEY, learningTargetId TEXT, cognitiveEntityId TEXT, dimension TEXT, required INTEGER, threshold REAL, gate INTEGER, weight REAL, orderIndex INTEGER, rationale TEXT, UNIQUE(learningTargetId,cognitiveEntityId,dimension))',
    ]) await execute(sql);
    await execute("INSERT INTO LearningGoal VALUES ('g1','owner')");
    await execute("INSERT INTO CognitiveEntity VALUES ('e1','concept',1,'active')");
    for (const suffix of ['1', '2']) {
      await execute('INSERT INTO LearningUnit VALUES (?,?)', ['u'+suffix, 'g1']);
      await execute('INSERT INTO LearningTarget VALUES (?,?,?,?,?,?,?,?,?,?,?)', [
        't'+suffix, 'g1', 'Equality', 'Equal weights', 'Read an equality',
        JSON.stringify([{ref: 'c1', text: 'Compare both sides'}]), 'core', 1, 'easy', 'understand', 'active',
      ]);
      await execute('INSERT INTO UnitLearningTarget VALUES (?,?,?,?,?,?,?,?,?,?)', [
        'm'+suffix, 'u'+suffix, 't'+suffix, 'target_'+suffix, 1, 1, 'exit', 0, 1, 0,
      ]);
      await execute('INSERT INTO LearningTargetRequirement VALUES (?,?,?,?,?,?,?,?,?,?)', [
        'r'+suffix, 't'+suffix, 'e1', 'application', 1, 0.8, 0, 1, 0, 'Original requirement',
      ]);
    }
    const repositories = manager => ({assessmentTarget: new MikroOrmAssessmentTargetRepository(manager)});
    const adapter = new MikroOrmAssessmentTargetRuntimeAdapter({repositories: repositories(em),
      runInTransaction: work => em.transactional(tx => work(repositories(tx)))});
    const repaired = await adapter.ensureQuizAssessableForUnit({userId: 'owner', unitId: 'u1'});
    assert.deepEqual(repaired[0].requirements.map(item => item.dimension), ['application', 'understanding']);
    await adapter.ensureQuizAssessableForUnit({userId: 'owner', unitId: 'u1'});
    assert.equal((await execute("SELECT COUNT(*) n FROM LearningTargetRequirement WHERE learningTargetId='t1'"))[0].n, 2);
    await assert.rejects(em.transactional(async tx => {
      const targets = await repositories(tx).assessmentTarget.ensureQuizAssessableForUnit({userId: 'owner', unitId: 'u2'});
      assert.equal(targets[0].requirements.length, 2);
      throw Error('rollback repair');
    }), /rollback repair/);
    assert.equal((await execute("SELECT COUNT(*) n FROM LearningTargetRequirement WHERE learningTargetId='t2'"))[0].n, 1);
    await assert.rejects(adapter.ensureQuizAssessableForUnit({userId: 'stranger', unitId: 'u1'}), /Unit not found/);
    console.log('committed, idempotent, rolled back, owner protected');
  } finally { await orm.close(true); }
}
