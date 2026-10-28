import { DatabaseSync } from "node:sqlite";
import type { EntityManager } from "@mikro-orm/core";
import {
  PersonalSyncService,
  resolvePersonalSyncCommitScope,
  resolvePersonalSyncFencingEpoch,
} from "./personal-sync.service.ts";
import {
  configureLocalPersonalSyncRuntime,
  disableLocalPersonalSyncRuntime,
} from "./runtime.ts";

const DEVICE_ID = "11111111-1111-4111-8111-111111111111";
const GOAL_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "2f551cc2-c374-4bc0-9701-b24d3890d8ab";

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE "PersonalSyncState" (
      "id" TEXT PRIMARY KEY,
      "formatVersion" INTEGER NOT NULL,
      "deviceId" TEXT NOT NULL,
      "enabled" INTEGER NOT NULL,
      "locked" INTEGER NOT NULL,
      "readOnlyReason" TEXT,
      "lastSuccessfulSyncAt" TEXT,
      "lastAttemptAt" TEXT,
      "lastError" TEXT,
      "transportState" TEXT,
      "remoteChangeToken" TEXT,
      "nextSequence" INTEGER NOT NULL,
      "lastSnapshotSequence" INTEGER NOT NULL,
      "lastSnapshotAt" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    );
    CREATE TABLE "PersonalSyncCommit" (
      "id" TEXT PRIMARY KEY,
      "originDeviceId" TEXT NOT NULL,
      "sequence" INTEGER NOT NULL,
      "status" TEXT NOT NULL,
      "scopeKind" TEXT NOT NULL,
      "scopeId" TEXT,
      "fencingEpoch" INTEGER,
      "dependenciesJson" TEXT NOT NULL DEFAULT '{}',
      "payloadJson" TEXT,
      "ciphertextHash" TEXT,
      "remoteRecordName" TEXT,
      "createdAt" TEXT NOT NULL,
      "uploadedAt" TEXT,
      "appliedAt" TEXT,
      "quarantinedAt" TEXT,
      "lastError" TEXT
    );
    CREATE TABLE "PersonalSyncRowChange" (
      "id" TEXT PRIMARY KEY,
      "commitId" TEXT NOT NULL,
      "tableName" TEXT NOT NULL,
      "rowId" TEXT NOT NULL,
      "operation" TEXT NOT NULL,
      "mergePolicy" TEXT NOT NULL,
      "scopeKind" TEXT NOT NULL,
      "scopeId" TEXT,
      "rowJson" TEXT,
      "createdAt" TEXT NOT NULL
    );
    CREATE TABLE "PersonalSyncLeaseCache" (
      "scopeKey" TEXT PRIMARY KEY,
      "holderDeviceId" TEXT NOT NULL,
      "holderDisplayName" TEXT,
      "fencingEpoch" INTEGER NOT NULL,
      "serverModifiedAt" TEXT NOT NULL,
      "expiresAt" TEXT NOT NULL,
      "recordChangeTag" TEXT NOT NULL,
      "transferRequestedByDeviceId" TEXT,
      "updatedAt" TEXT NOT NULL
    );
    CREATE TABLE "PersonalSyncDeviceCounter" (
      "counterKey" TEXT NOT NULL,
      "deviceId" TEXT NOT NULL,
      "value" INTEGER NOT NULL,
      "lastAggregateSeen" INTEGER NOT NULL,
      "updatedAt" TEXT NOT NULL,
      PRIMARY KEY ("counterKey", "deviceId")
    );
  `);
  const connection = {
    database,
    execute(sql: string, params: unknown[] = []) {
      const statement = database.prepare(sql);
      const trimmed = sql.trimStart().toUpperCase();
      if (
        trimmed.startsWith("SELECT") ||
        trimmed.startsWith("PRAGMA") ||
        trimmed.startsWith("WITH")
      ) {
        return statement.all(...(params as never[]));
      }
      statement.run(...(params as never[]));
      return [];
    },
  };
  const em = {
    getConnection: () => connection,
    getTransactionContext: () => undefined,
    transactional: async <T>(work: (inner: EntityManager) => Promise<T>) =>
      work(em as unknown as EntityManager),
  } as unknown as EntityManager;
  return { database, em };
}

describe("personal sync finalize", () => {
  afterEach(() => {
    try {
      disableLocalPersonalSyncRuntime();
    } catch {
      // Runtime may be unset for pure helper cases.
    }
  });

  it("requires a live matching lease scope before fencing leased commits", () => {
    const liveLeases = new Map([
      [
        "goal:" + GOAL_ID,
        { fencingEpoch: 3, expiresAtMs: Date.now() + 60_000 },
      ],
    ]);
    expect(
      resolvePersonalSyncFencingEpoch({
        scopeKind: "goal",
        scopeId: GOAL_ID,
        requiresLease: true,
        liveLeases,
      }),
    ).toBe(3);
    expect(
      resolvePersonalSyncFencingEpoch({
        scopeKind: "workspace",
        scopeId: null,
        requiresLease: true,
        liveLeases,
      }),
    ).toBeNull();
  });

  it("keeps single-goal leased changes on the goal lease scope", () => {
    expect(
      resolvePersonalSyncCommitScope([
        {
          tableName: "LearningUnit",
          scopeKind: "goal",
          scopeId: GOAL_ID,
          mergePolicy: "leased_replace",
        },
      ]),
    ).toEqual({
      scopeKind: "goal",
      scopeId: GOAL_ID,
      requiresLease: true,
    });
  });

  it("finalizes lease-held goal commits and skips workspace backlog without a workspace lease", async () => {
    const { database, em } = fixture();
    configureLocalPersonalSyncRuntime({
      workspaceId: WORKSPACE_ID,
      syncEnabled: true,
      workspaceKey: Buffer.alloc(32, 7),
      em,
    });
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO "PersonalSyncState"
          ("id","formatVersion","deviceId","enabled","locked","nextSequence","lastSnapshotSequence","createdAt","updatedAt")
         VALUES ('primary', 1, ?, 1, 0, 1, 0, ?, ?)`,
      )
      .run(DEVICE_ID, now, now);
    database
      .prepare(
        `INSERT INTO "PersonalSyncLeaseCache"
          ("scopeKey","holderDeviceId","fencingEpoch","serverModifiedAt","expiresAt","recordChangeTag","updatedAt")
         VALUES (?, ?, 4, ?, ?, 'tag', ?)`,
      )
      .run(
        `goal:${GOAL_ID}`,
        DEVICE_ID,
        now,
        new Date(Date.now() + 60_000).toISOString(),
        now,
      );

    const goalCommit = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const workspaceCommit = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    database
      .prepare(
        `INSERT INTO "PersonalSyncCommit"
          ("id","originDeviceId","sequence","status","scopeKind","scopeId","dependenciesJson","createdAt")
         VALUES (?, 'local-pending', 0, 'collecting', 'goal', ?, '{}', ?)`,
      )
      .run(goalCommit, GOAL_ID, now);
    database
      .prepare(
        `INSERT INTO "PersonalSyncCommit"
          ("id","originDeviceId","sequence","status","scopeKind","scopeId","dependenciesJson","createdAt")
         VALUES (?, 'local-pending', 0, 'collecting', 'workspace', NULL, '{}', ?)`,
      )
      .run(workspaceCommit, now);
    database
      .prepare(
        `INSERT INTO "PersonalSyncRowChange"
          ("id","commitId","tableName","rowId","operation","mergePolicy","scopeKind","scopeId","rowJson","createdAt")
         VALUES (?, ?, 'LearningUnit', 'u1', 'upsert', 'leased_replace', 'goal', ?, '{}', ?)`,
      )
      .run("c1", goalCommit, GOAL_ID, now);
    database
      .prepare(
        `INSERT INTO "PersonalSyncRowChange"
          ("id","commitId","tableName","rowId","operation","mergePolicy","scopeKind","scopeId","rowJson","createdAt")
         VALUES (?, ?, 'UserSettings', ?, 'upsert', 'leased_replace', 'workspace', NULL, '{}', ?)`,
      )
      .run("c2", workspaceCommit, DEVICE_ID, now);

    const service = new PersonalSyncService();
    const outgoing = await service.finalizeAndListOutgoing(100);

    expect(outgoing.map((item) => item.commitId)).toEqual([goalCommit]);
    expect(outgoing[0]?.fencingEpoch).toBe(4);
    expect(
      database
        .prepare(`SELECT "status" FROM "PersonalSyncCommit" WHERE "id" = ?`)
        .get(goalCommit),
    ).toEqual({ status: "pending_upload" });
    expect(
      database
        .prepare(`SELECT "status" FROM "PersonalSyncCommit" WHERE "id" = ?`)
        .get(workspaceCommit),
    ).toEqual({ status: "collecting" });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS n FROM "PersonalSyncRowChange" WHERE "commitId" = ?`,
        )
        .get(workspaceCommit),
    ).toEqual({ n: 1 });
  });

  it("bounds a lease-blocked collecting backlog to the requested batch", async () => {
    const { database, em } = fixture();
    configureLocalPersonalSyncRuntime({
      workspaceId: WORKSPACE_ID,
      syncEnabled: true,
      workspaceKey: Buffer.alloc(32, 7),
      em,
    });
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO "PersonalSyncState"
          ("id","formatVersion","deviceId","enabled","locked","nextSequence","lastSnapshotSequence","createdAt","updatedAt")
         VALUES ('primary', 1, ?, 1, 0, 1, 0, ?, ?)`,
      )
      .run(DEVICE_ID, now, now);

    for (let index = 0; index < 12; index += 1) {
      const commitId = `blocked-${String(index).padStart(2, "0")}`;
      database
        .prepare(
          `INSERT INTO "PersonalSyncCommit"
            ("id","originDeviceId","sequence","status","scopeKind","scopeId","dependenciesJson","createdAt")
           VALUES (?, 'local-pending', 0, 'collecting', 'goal', ?, '{}', ?)`,
        )
        .run(
          commitId,
          `goal-${index}`,
          `${now}-${String(index).padStart(2, "0")}`,
        );
      database
        .prepare(
          `INSERT INTO "PersonalSyncRowChange"
            ("id","commitId","tableName","rowId","operation","mergePolicy","scopeKind","scopeId","rowJson","createdAt")
           VALUES (?, ?, 'LearningUnit', ?, 'upsert', 'leased_replace', 'goal', ?, '{}', ?)`,
        )
        .run(
          `change-${index}`,
          commitId,
          `unit-${index}`,
          `goal-${index}`,
          `${now}-${String(index).padStart(2, "0")}`,
        );
    }

    const eligibleCommit = "zzzz-eligible";
    database
      .prepare(
        `INSERT INTO "PersonalSyncCommit"
          ("id","originDeviceId","sequence","status","scopeKind","scopeId","dependenciesJson","createdAt")
         VALUES (?, 'local-pending', 0, 'collecting', 'workspace', NULL, '{}', ?)`,
      )
      .run(eligibleCommit, `${now}-99`);
    database
      .prepare(
        `INSERT INTO "PersonalSyncRowChange"
          ("id","commitId","tableName","rowId","operation","mergePolicy","scopeKind","scopeId","rowJson","createdAt")
         VALUES ('eligible-change', ?, 'LearnerDailyActivity', 'day-1', 'upsert', 'merge_by_key', 'workspace', NULL, '{}', ?)`,
      )
      .run(eligibleCommit, `${now}-99`);

    const service = new PersonalSyncService();
    await expect(service.finalizeAndListOutgoing(5)).resolves.toEqual([]);
    expect(
      database
        .prepare(`SELECT "status" FROM "PersonalSyncCommit" WHERE "id" = ?`)
        .get(eligibleCommit),
    ).toEqual({ status: "collecting" });
  });
});
