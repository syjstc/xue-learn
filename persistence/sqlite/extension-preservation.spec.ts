import { DatabaseSync } from "node:sqlite";
import type { EntityManager } from "@mikro-orm/core";
import { installLearningExtensionPreservationGuards } from "./extension-preservation.ts";

it("blocks destructive cascades atomically without reading extension rows, allowing ordinary content and sync no-op updates", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`PRAGMA foreign_keys=ON; CREATE TABLE LearningUnit(id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE HistoricalArtifact(id TEXT PRIMARY KEY, unitId TEXT REFERENCES LearningUnit(id) ON DELETE CASCADE ON UPDATE CASCADE, acceptedPayload TEXT);
    INSERT INTO LearningUnit VALUES ('unit','Published source'); INSERT INTO HistoricalArtifact VALUES ('artifact','unit','Original accepted private facts');`);
  const observed: string[] = [];
  const em = {getTransactionContext: () => undefined, getConnection: () => ({execute: async (sql: string) => {
    observed.push(sql); const statement = database.prepare(sql);
    if (/^\s*(SELECT|PRAGMA)/i.test(sql)) return statement.all(); statement.run(); return [];
  }})} as unknown as EntityManager;
  expect(await installLearningExtensionPreservationGuards(em, ["LearningUnit"], ["HistoricalArtifact"])).toEqual({protectedTables:1,retainedExtensionTables:1});
  expect(observed.some(sql => /SELECT.+FROM\s+"HistoricalArtifact"/is.test(sql))).toBe(false);
  database.prepare("UPDATE LearningUnit SET title='Updated accepted source', id=id").run();
  const deleteWithEarlierWrite = () => {
    database.exec("BEGIN IMMEDIATE");
    try { database.exec("UPDATE LearningUnit SET title='Uncommitted replacement'; DELETE FROM LearningUnit WHERE id='unit'; COMMIT"); }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  };
  expect(deleteWithEarlierWrite).toThrow("ELECTRON_LEARNING_EXTENSIONS_ATTACHED");
  expect(database.prepare('SELECT * FROM HistoricalArtifact').all()).toEqual([{id:"artifact",unitId:"unit",acceptedPayload:"Original accepted private facts"}]);
  expect(database.prepare('SELECT title FROM LearningUnit').get()).toEqual({title:"Updated accepted source"});
  expect(() => database.exec("UPDATE LearningUnit SET id='replacement'")).toThrow("ELECTRON_LEARNING_EXTENSIONS_ATTACHED");
  database.close();
});

it("does not change fresh learning deletion semantics", async () => {
  const database = new DatabaseSync(":memory:"); database.exec("CREATE TABLE LearningUnit(id TEXT PRIMARY KEY); INSERT INTO LearningUnit VALUES ('unit')");
  const em = {getTransactionContext:()=>undefined,getConnection:()=>({execute:async(sql:string)=>{const statement=database.prepare(sql);return /^\s*(SELECT|PRAGMA)/i.test(sql)?statement.all():(statement.run(),[]);}})} as unknown as EntityManager;
  expect(await installLearningExtensionPreservationGuards(em,["LearningUnit"],[])).toEqual({protectedTables:0,retainedExtensionTables:0});
  expect(() => database.exec("DELETE FROM LearningUnit")).not.toThrow(); database.close();
});
