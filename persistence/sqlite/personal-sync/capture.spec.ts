import { runWithPersonalSyncApply, runWithPersonalSyncCapture } from "@xue-learn/core/source/libs/server/src/personal-sync/index.ts";
import Database from "better-sqlite3";
import type { EntityManager } from "@mikro-orm/core";
import {
  bindPersonalSyncCaptureToConnection,
  capturePersonalSyncInitialState,
  configurePersonalSyncCapture,
  installPersonalSyncCaptureTriggers,
  registerPersonalSyncSqliteFunctions,
  setPersonalSyncCaptureEnabled,
} from "./capture.ts";

function fixture() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE "LearningGoal" ("id" TEXT PRIMARY KEY, "title" TEXT);
    CREATE TABLE "UserSettings" (
      "userId" TEXT PRIMARY KEY,
      "llmProvider" TEXT,
      "chatModel" TEXT,
      "teachingPersonaRef" TEXT NOT NULL,
      "theme" TEXT NOT NULL,
      "uiLocale" TEXT NOT NULL,
      "clientPreferencesJson" TEXT NOT NULL,
      "localRuntimeSettingsJson" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    );
    CREATE TABLE "PersonalSyncCommit" (
      "id" TEXT PRIMARY KEY, "originDeviceId" TEXT NOT NULL, "sequence" INTEGER NOT NULL,
      "status" TEXT NOT NULL, "scopeKind" TEXT NOT NULL, "scopeId" TEXT,
      "dependenciesJson" TEXT NOT NULL, "createdAt" TEXT NOT NULL
    );
    CREATE TABLE "PersonalSyncRowChange" (
      "id" TEXT PRIMARY KEY, "commitId" TEXT NOT NULL, "tableName" TEXT NOT NULL,
      "rowId" TEXT NOT NULL, "operation" TEXT NOT NULL, "mergePolicy" TEXT NOT NULL,
      "scopeKind" TEXT NOT NULL, "scopeId" TEXT, "rowJson" TEXT, "createdAt" TEXT NOT NULL
    );
  `);
  const connection = {
    database,
    execute(sql: string, params: unknown[] = []) {
      const statement = database.prepare(sql);
      return statement.reader
        ? statement.all(...params)
        : statement.run(...params);
    },
  };
  const em = {
    getConnection: () => connection,
    getTransactionContext: () => undefined,
  } as unknown as EntityManager;
  return { database, em };
}

describe("personal sync SQLite capture", () => {
  afterEach(() => configurePersonalSyncCapture(false));

  it("captures committed writes and suppresses remote-apply echoes", async () => {
    const { database, em } = fixture();
    configurePersonalSyncCapture(true, { rejectUnscoped: true });
    registerPersonalSyncSqliteFunctions(em);
    await installPersonalSyncCaptureTriggers(em);

    runWithPersonalSyncCapture(() =>
      database
        .prepare(`INSERT INTO "LearningGoal" VALUES (?, ?)`)
        .run("g1", "First"),
    );
    runWithPersonalSyncApply(() =>
      database
        .prepare(`INSERT INTO "LearningGoal" VALUES (?, ?)`)
        .run("g2", "Remote"),
    );

    expect(
      database.prepare(`SELECT "rowId" FROM "PersonalSyncRowChange"`).all(),
    ).toEqual([{ rowId: "g1" }]);
  });

  it("keeps one collecting commit when a request writes more than one synchronized row", async () => {
    const { database, em } = fixture();
    configurePersonalSyncCapture(true, { rejectUnscoped: true });
    registerPersonalSyncSqliteFunctions(em);
    await installPersonalSyncCaptureTriggers(em);

    const commitId = "11111111-1111-4111-8111-111111111111";
    expect(() =>
      runWithPersonalSyncCapture(() => {
        database
          .prepare(`INSERT INTO "LearningGoal" VALUES (?, ?)`)
          .run("g1", "First");
        database
          .prepare(`INSERT INTO "LearningGoal" VALUES (?, ?)`)
          .run("g2", "Second");
        database
          .prepare(`UPDATE "LearningGoal" SET "title" = ? WHERE "id" = ?`)
          .run("First renamed", "g1");
      }, commitId),
    ).not.toThrow();

    expect(
      database
        .prepare(`SELECT "id", "status" FROM "PersonalSyncCommit"`)
        .all(),
    ).toEqual([{ id: commitId, status: "collecting" }]);
    expect(
      database
        .prepare(
          `SELECT "rowId", "operation" FROM "PersonalSyncRowChange" ORDER BY "rowId", "operation"`,
        )
        .all(),
    ).toEqual([
      { rowId: "g1", operation: "upsert" },
      { rowId: "g1", operation: "upsert" },
      { rowId: "g2", operation: "upsert" },
    ]);
  });

  it("can stop capture at runtime without weakening unscoped-write checks", async () => {
    const { database, em } = fixture();
    configurePersonalSyncCapture(true, { rejectUnscoped: true });
    registerPersonalSyncSqliteFunctions(em);
    await installPersonalSyncCaptureTriggers(em);

    setPersonalSyncCaptureEnabled(false);
    database
      .prepare(`INSERT INTO "LearningGoal" VALUES (?, ?)`)
      .run("g-disabled", "Local only");

    expect(
      database
        .prepare(`SELECT COUNT(*) AS count FROM "PersonalSyncRowChange"`)
        .get(),
    ).toEqual({ count: 0 });
    setPersonalSyncCaptureEnabled(true);
    expect(() =>
      database
        .prepare(`INSERT INTO "LearningGoal" VALUES (?, ?)`)
        .run("g-unscoped", "Rejected"),
    ).toThrow(/Unscoped synchronized SQLite write/);
  });

  it("captures portable user preferences and model selections", async () => {
    const { database, em } = fixture();
    configurePersonalSyncCapture(true, { rejectUnscoped: true });
    registerPersonalSyncSqliteFunctions(em);
    await installPersonalSyncCaptureTriggers(em);

    runWithPersonalSyncCapture(() =>
      database
        .prepare(
          `INSERT INTO "UserSettings"
            ("userId", "llmProvider", "chatModel", "teachingPersonaRef", "theme", "uiLocale", "clientPreferencesJson", "localRuntimeSettingsJson", "updatedAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "local-owner-v1",
          "openai",
          "gpt-5.6-luna",
          "custom:patient-teacher",
          "dark",
          "en",
          JSON.stringify({ reducedMotion: true }),
          JSON.stringify({ ragMaxChunksPerUpload: 500 }),
          "2026-08-15T00:00:00.000Z",
        ),
    );

    const change = database
      .prepare(
        `SELECT "mergePolicy", "scopeKind", "rowJson"
         FROM "PersonalSyncRowChange" WHERE "tableName" = 'UserSettings'`,
      )
      .get() as {
      mergePolicy: string;
      scopeKind: string;
      rowJson: string;
    };
    expect(change.mergePolicy).toBe("leased_replace");
    expect(change.scopeKind).toBe("workspace");
    expect(JSON.parse(change.rowJson)).toMatchObject({
      llmProvider: "openai",
      chatModel: "gpt-5.6-luna",
      teachingPersonaRef: "custom:patient-teacher",
      theme: "dark",
      uiLocale: "en",
    });
    expect(change.rowJson).not.toMatch(/api[_-]?key|credential|secret/i);
  });

  it("captures rows that existed before sync was enabled", async () => {
    const { database, em } = fixture();
    database
      .prepare(`INSERT INTO "LearningGoal" VALUES (?, ?)`)
      .run("g-existing", "Existing course");
    configurePersonalSyncCapture(true, { rejectUnscoped: true });
    registerPersonalSyncSqliteFunctions(em);
    await installPersonalSyncCaptureTriggers(em);

    await expect(capturePersonalSyncInitialState(em)).resolves.toEqual({
      totalRows: 1,
      commitCount: 1,
    });
    expect(
      database
        .prepare(`SELECT "tableName", "rowId" FROM "PersonalSyncRowChange"`)
        .all(),
    ).toEqual([{ tableName: "LearningGoal", rowId: "g-existing" }]);
  });

  it("scopes MikroORM connection writes that run outside request capture", async () => {
    const { database, em } = fixture();
    configurePersonalSyncCapture(true, { rejectUnscoped: true });
    registerPersonalSyncSqliteFunctions(em);
    await installPersonalSyncCaptureTriggers(em);
    bindPersonalSyncCaptureToConnection(em);

    expect(() =>
      em.getConnection().execute(`INSERT INTO "LearningGoal" VALUES (?, ?)`, [
        "g-worker",
        "Indexed",
      ]),
    ).not.toThrow();
    expect(
      database
        .prepare(`SELECT "rowId" FROM "PersonalSyncRowChange"`)
        .all(),
    ).toEqual([{ rowId: "g-worker" }]);
  });

  it("rolls capture back with the business transaction and rejects unscoped writes", async () => {
    const { database, em } = fixture();
    configurePersonalSyncCapture(true, { rejectUnscoped: true });
    registerPersonalSyncSqliteFunctions(em);
    await installPersonalSyncCaptureTriggers(em);

    const transaction = database.transaction(() => {
      runWithPersonalSyncCapture(() =>
        database
          .prepare(`INSERT INTO "LearningGoal" VALUES (?, ?)`)
          .run("g1", "Rollback"),
      );
      throw new Error("rollback");
    });
    expect(transaction).toThrow("rollback");
    expect(
      database
        .prepare(`SELECT COUNT(*) AS count FROM "PersonalSyncRowChange"`)
        .get(),
    ).toEqual({ count: 0 });
    expect(() =>
      database
        .prepare(`INSERT INTO "LearningGoal" VALUES (?, ?)`)
        .run("g2", "Unscoped"),
    ).toThrow(/Unscoped synchronized SQLite write/);
  });
});

it("never captures non-null retired identity fields, including initial snapshots, while retaining original row values",async()=>{
 const {database,em}=fixture();
 database.exec(`CREATE TABLE "User" ("id" TEXT PRIMARY KEY,"name" TEXT,"password" TEXT,"passwordHash" TEXT,"tenantId" TEXT);`);
 configurePersonalSyncCapture(true,{rejectUnscoped:true});registerPersonalSyncSqliteFunctions(em);
 await installPersonalSyncCaptureTriggers(em);
 runWithPersonalSyncCapture(()=>database.prepare('INSERT INTO "User" VALUES (?,?,?,?,?)').run("owner","Synthetic","fake-password","fake-hash","fake-tenant"));
 await capturePersonalSyncInitialState(em);
 const changes=database.prepare(`SELECT "rowJson" FROM "PersonalSyncRowChange" WHERE "tableName"='User'`).all() as Array<{rowJson:string}>;
 expect(changes.length).toBeGreaterThan(1);
 for(const change of changes){expect(JSON.parse(change.rowJson)).toEqual({id:"owner",name:"Synthetic"});expect(change.rowJson).not.toMatch(/fake-password|fake-hash|fake-tenant/);}
 expect(database.prepare('SELECT "password","passwordHash","tenantId" FROM "User"').get()).toEqual({password:"fake-password",passwordHash:"fake-hash",tenantId:"fake-tenant"});
 database.close();configurePersonalSyncCapture(false);
});

it("never reads or captures a fingerprint-validated historical extension during the fresh learning snapshot", async () => {
  const { database, em } = fixture();
  database.exec(`CREATE TABLE "HistoricalExtension" ("id" TEXT PRIMARY KEY, "opaquePrivatePayload" TEXT);
    INSERT INTO "HistoricalExtension" VALUES ('saved-extension', 'preserve-exact-original');`);
  configurePersonalSyncCapture(true, { rejectUnscoped: true, validatedLegacyTables: ["HistoricalExtension"] });
  registerPersonalSyncSqliteFunctions(em);
  const connection = em.getConnection();
  const execute = connection.execute.bind(connection);
  const forbiddenReads: string[] = [];
  connection.execute = ((sql: string, ...args: unknown[]) => {
    if (/SELECT.+FROM\s+"HistoricalExtension"/is.test(sql)) forbiddenReads.push(sql);
    return (execute as (...values: unknown[]) => unknown)(sql, ...args);
  }) as typeof connection.execute;
  await installPersonalSyncCaptureTriggers(em);
  runWithPersonalSyncCapture(() => database.prepare('INSERT INTO "LearningGoal" VALUES (?,?)').run("g-safe", "Learning facts"));
  await capturePersonalSyncInitialState(em);
  expect(forbiddenReads).toEqual([]);
  expect(database.prepare('SELECT "tableName" FROM "PersonalSyncRowChange"').all()).toEqual([
    { tableName: "LearningGoal" }, { tableName: "LearningGoal" },
  ]);
  expect(database.prepare('SELECT "opaquePrivatePayload" FROM "HistoricalExtension"').get()).toEqual({ opaquePrivatePayload: "preserve-exact-original" });
  database.close();
  configurePersonalSyncCapture(false);
});
