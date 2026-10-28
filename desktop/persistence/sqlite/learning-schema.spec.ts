import type { EntityManager } from "@mikro-orm/core";
import { migrateElectronLearningSchema, assertElectronLearningSchema, ELECTRON_LEARNING_SCHEMA_TABLES } from "./learning-schema.ts";
import baseline from "./learning-schema.v1.json";
const { DatabaseSync } = require("node:sqlite");
function adapter(db: any): EntityManager {
  const em = {getTransactionContext: () => undefined, getConnection: () => ({execute: async (sql: string, params: unknown[] = []) => {
    const statement = db.prepare(sql);
    if (/^\s*(?:SELECT|PRAGMA)/i.test(sql)) return statement.all(...params);
    statement.run(...params); return [];
  }})} as unknown as EntityManager;
  return { ...em, fork: () => ({transactional: async (fn: (tx: EntityManager) => unknown) => {
    db.exec("BEGIN IMMEDIATE"); try { const value = await fn(em); db.exec("COMMIT"); return value; }
    catch (error) {db.exec("ROLLBACK"); throw error;}
  }})} as unknown as EntityManager;
}
it("creates only the reviewed learning schema and keeps initialization idempotent", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const em = adapter(db);
    const report = await migrateElectronLearningSchema(em);
    expect(report.kind).toBe("fresh");
    expect(report.structureFingerprint).toBe(baseline.structureFingerprint);
    expect(db.prepare('PRAGMA table_info("User")').all().map((row: {name: string}) => row.name)).toEqual(["id", "email", "name", "createdAt", "updatedAt"]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'LessonPerformance%' OR name LIKE 'ProductRelease%' OR name IN ('UserCreditAccount','SharedPath','PushDeviceToken'))").all()).toEqual([]);
    db.exec(`INSERT INTO "User" ("id","name","createdAt","updatedAt") VALUES ('owner','Synthetic learner',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);`);
    const before = db.prepare('SELECT * FROM "User"').all();
    expect(await migrateElectronLearningSchema(em)).toEqual(report);
    expect(db.prepare('SELECT * FROM "User"').all()).toEqual(before);
    await assertElectronLearningSchema(em);
    expect(ELECTRON_LEARNING_SCHEMA_TABLES).toHaveLength(125);
  } finally {db.close();}
});
it("rejects an incomplete old library before recording adoption or changing data", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE "LearningUnit" ("id" TEXT PRIMARY KEY); INSERT INTO "LearningUnit" VALUES ('kept');
      CREATE TABLE "mikro_orm_migrations" ("name" TEXT); INSERT INTO "mikro_orm_migrations" VALUES ('pretend-complete');`);
    const before = db.prepare('SELECT * FROM "LearningUnit"').all();
    await expect(migrateElectronLearningSchema(adapter(db))).rejects.toThrow("SCHEMA_UNSUPPORTED");
    expect(db.prepare('SELECT * FROM "LearningUnit"').all()).toEqual(before);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='ElectronLearningSchemaAdoption'").all()).toEqual([]);
  } finally {db.close();}
});
it("fences modified constraints even when adoption metadata still claims success", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const em = adapter(db); await migrateElectronLearningSchema(em);
    db.exec('DROP INDEX "User_name_key"');
    await expect(migrateElectronLearningSchema(em)).rejects.toThrow("keys or indexes");
    await expect(assertElectronLearningSchema(em)).rejects.toThrow("keys or indexes");
  } finally {db.close();}
});

it("rejects a forged retired identity expression index and fresh extension drift without modifying rows", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const em=adapter(db);await migrateElectronLearningSchema(em);
    db.exec('CREATE UNIQUE INDEX "User_tenantId_idx" ON "User" (length("name"))');
    await expect(migrateElectronLearningSchema(em)).rejects.toThrow("Retired identity index");
    db.exec('DROP INDEX "User_tenantId_idx"; CREATE TABLE "UnreviewedExtension" ("id" TEXT PRIMARY KEY)');
    await expect(assertElectronLearningSchema(em)).rejects.toThrow("unreviewed extension");
    expect(db.prepare('SELECT count(*) AS count FROM "User"').get()).toEqual({count:0});
  } finally {db.close();}
});
it("does not mistake a fabricated shadow-prefix table for SQLite managed metadata", async () => {
 const db=new DatabaseSync(":memory:");try{const em=adapter(db);await migrateElectronLearningSchema(em);db.exec('CREATE TABLE "RagChunkFts_unreviewed" ("id" TEXT PRIMARY KEY)');await expect(assertElectronLearningSchema(em)).rejects.toThrow("unreviewed extension");}finally{db.close();}
});
