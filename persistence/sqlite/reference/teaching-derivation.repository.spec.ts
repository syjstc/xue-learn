import type {EntityManager} from "@mikro-orm/core";
import {MikroOrmTeachingDerivationRepository as Repository} from "./teaching-derivation.repository.ts";

type Statement = {all(...params: unknown[]): Record<string, unknown>[]; get(...params: unknown[]): Record<string, unknown> | undefined; run(...params: unknown[]): unknown};
type SqlDatabase = {exec(sql: string): void; prepare(sql: string): Statement; close(): void};
const {DatabaseSync} = require("node:sqlite") as {DatabaseSync: new (path: string) => SqlDatabase};
const now = new Date("2026-10-10T00:00:00.000Z");

function fixture(token: string | null = "current") {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE "TeachingDerivationRun" (
    "id" TEXT PRIMARY KEY, "generationToken" TEXT, "revision" INTEGER NOT NULL,
    "documentJson" TEXT, "derivedJson" TEXT, "repairAttempts" INTEGER,
    "status" TEXT, "updatedAt" TEXT);
    CREATE TABLE "TeachingDerivationStep" (
    "id" TEXT PRIMARY KEY, "runId" TEXT, "ordinal" INTEGER, "stepJson" TEXT,
    "derivedJson" TEXT, "createdAt" TEXT, UNIQUE("runId", "ordinal"));`);
  db.prepare('INSERT INTO "TeachingDerivationRun" VALUES (?, ?, 0, ?, ?, 0, ?, ?)').run("run", token, "original", "original-derived", "running", now.toISOString());
  const calls: string[] = [];
  const execute = async (sql: string, params: unknown[] = []) => {
    calls.push(sql);
    const statement = db.prepare(sql), bound = params.map(value => value instanceof Date ? value.toISOString() : value);
    if (/^\s*SELECT|RETURNING/i.test(sql)) {const result = statement.all(...bound); return result;}
    return statement.run(...bound);
  };
  const manager = {
    getConnection: () => ({execute, getPlatform: () => ({constructor: {name: "SqlitePlatform"}})}),
    getTransactionContext: () => undefined,
    transactional: async <T>(work: (em: EntityManager) => Promise<T>) => {
      db.exec("BEGIN");
      try {const result = await work(manager as unknown as EntityManager); db.exec("COMMIT"); return result;}
      catch (error) {db.exec("ROLLBACK"); throw error;}
    },
  };
  return {db, calls, repository: new Repository(manager as unknown as EntityManager),
    run: () => db.prepare('SELECT * FROM "TeachingDerivationRun"').get()!,
    steps: () => db.prepare('SELECT * FROM "TeachingDerivationStep"').all()};
}
const append = (overrides: Partial<Parameters<Repository["appendStep"]>[0]> = {}) => ({
  runId: "run", expectedRevision: 0, expectedGenerationToken: "current", revision: 1,
  repairAttempts: 0, documentJson: "accepted", derivedJson: "accepted-derived", now,
  step: {id: "step", runId: "run", ordinal: 1, stepJson: "step-body", derivedJson: "step-derived"}, ...overrides,
});

describe("teaching derivation generation fencing on real SQLite", () => {
  it("rejects stale generation writes while permitting the current token and existing callers", async () => {
    const f = fixture();
    try {
      expect(await f.repository.updateRun({id: "run", expectedGenerationToken: "stale", documentJson: "late", generationToken: null, now})).toBe(false);
      expect(f.run()).toMatchObject({documentJson: "original", generationToken: "current"});
      expect(await f.repository.updateRun({id: "run", expectedGenerationToken: "current", documentJson: "current-result", now})).toBe(true);
      expect(await f.repository.updateRun({id: "run", documentJson: "legacy-result", now})).toBe(true);
      expect(f.run().documentJson).toBe("legacy-result");
      expect(await f.repository.updateRun({id: "missing", documentJson: "missing", now})).toBe(false);
    } finally {f.db.close();}
  });
  it("claims revision and token atomically before insert, rejecting either stale condition without a step", async () => {
    const f = fixture();
    try {
      expect(await f.repository.appendStep(append({expectedGenerationToken: "stale"}))).toBe(false);
      expect(await f.repository.appendStep(append({expectedRevision: 9}))).toBe(false);
      expect(f.steps()).toEqual([]); expect(f.run().revision).toBe(0);
      expect(await f.repository.appendStep(append())).toBe(true);
      expect(f.run()).toMatchObject({revision: 1, documentJson: "accepted"});
      expect(f.steps()).toHaveLength(1);
      expect(f.calls[0]).toMatch(/WHERE "id" = \? AND "revision" = \? AND "generationToken" = \? RETURNING/);
      expect(f.calls.some(sql => /^\s*SELECT/.test(sql))).toBe(false);
      expect(f.calls.at(-1)).toMatch(/^INSERT/);
      expect(await f.repository.appendStep(append({step: {id: "late-step", runId: "run", ordinal: 2, stepJson: "late", derivedJson: "late"}}))).toBe(false);
      expect(f.steps()).toHaveLength(1);
    } finally {f.db.close();}
  });
  it("rolls the run revision and document back if step insertion fails", async () => {
    const f = fixture();
    try {
      expect(await f.repository.appendStep(append())).toBe(true);
      await expect(f.repository.appendStep(append({expectedRevision: 1, revision: 2, documentJson: "must-rollback"}))).rejects.toThrow();
      expect(f.run()).toMatchObject({revision: 1, documentJson: "accepted"});
      expect(f.steps()).toHaveLength(1);
    } finally {f.db.close();}
  });
  it("allows a step whose explicit null token still owns the run", async () => {
    const f = fixture(null);
    try {
      expect(await f.repository.appendStep(append({expectedGenerationToken: null}))).toBe(true);
      expect(f.run()).toMatchObject({generationToken: null, revision: 1});
      expect(f.steps()).toHaveLength(1);
    } finally {f.db.close();}
  });
  it("distinguishes an explicit null fence from an omitted fence", async () => {
    const f = fixture(null);
    try {
      expect(await f.repository.updateRun({id: "run", expectedGenerationToken: null, generationToken: "claimed", now})).toBe(true);
      expect(await f.repository.updateRun({id: "run", expectedGenerationToken: null, documentJson: "late", now})).toBe(false);
      expect(await f.repository.appendStep(append({expectedGenerationToken: null}))).toBe(false);
      expect(await f.repository.appendStep(append({expectedGenerationToken: undefined}))).toBe(true);
      expect(f.calls[0]).toContain('"generationToken" IS NULL');
      expect(f.run()).toMatchObject({generationToken: "claimed", revision: 1});
    } finally {f.db.close();}
  });
});
