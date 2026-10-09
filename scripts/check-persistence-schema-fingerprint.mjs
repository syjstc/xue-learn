import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const root=process.cwd(),baseline=JSON.parse(await fs.readFile(path.join(root,'persistence/sqlite/learning-schema.v1.json'),'utf8'));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const record={schemaVersion:baseline.schemaVersion,schemaId:baseline.schemaId,tableCount:baseline.tableNames.length,structureFingerprint:baseline.structureFingerprint,legacyHistoryFingerprint:baseline.legacyHistoryFingerprint,legacyExtensionFingerprint:baseline.legacyExtensionFingerprint,statementsSha256:digest(baseline.statements),coreObjectsSha256:digest(baseline.coreObjects)};
const output=path.join(root,'docs/architecture/electron-learning-schema-fingerprint.json');
if(process.argv.includes('--write')){await fs.writeFile(output,JSON.stringify(record,null,2)+'\n');console.log('Recorded reviewed Electron learning schema inputs');process.exit(0);}
assert.deepEqual(record,JSON.parse(await fs.readFile(output,'utf8')),'Reviewed Electron learning schema inputs changed');
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'xue-learning-schema-check-'));
const db=new DatabaseSync(':memory:');
try{
 const file=path.join(directory,'schema.cjs');await build({entryPoints:[path.join(root,'persistence/sqlite/learning-schema.ts')],outfile:file,bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent'});
 const {migrateElectronLearningSchema,assertElectronLearningSchema}=createRequire(import.meta.url)(file);
 const em={getTransactionContext:()=>undefined,getConnection:()=>({execute:async(sql,params=[])=>{const statement=db.prepare(sql);if(/^\s*(SELECT|PRAGMA)/i.test(sql))return statement.all(...params);statement.run(...params);return [];}})};
 em.fork=()=>({transactional:async work=>{db.exec('BEGIN IMMEDIATE');try{const value=await work(em);db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}});
 const report=await migrateElectronLearningSchema(em);assert.equal(report.kind,'fresh');assert.equal(report.structureFingerprint,baseline.structureFingerprint);await assertElectronLearningSchema(em);assert.deepEqual(await migrateElectronLearningSchema(em),report);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 console.log(`Electron learning schema fingerprint OK (${record.tableCount} owned tables; fresh migration and repeated adoption passed)`);
}finally{db.close();await fs.rm(directory,{recursive:true,force:true});}
