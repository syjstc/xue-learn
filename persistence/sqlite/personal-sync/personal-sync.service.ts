import { portablePersonalSyncRow } from "@xue-learn/core/server/personal-sync";
import { capturePersonalSyncInitialState, isValidatedLegacySyncTable } from "./capture.ts";
import { createHash, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { EntityManager } from "@mikro-orm/core";
import {
  PERSONAL_SYNC_FORMAT_VERSION,
  LOCAL_OWNER_ID,
  personalSyncStatusSchema,
  type PersonalSyncStatus,
} from "@xue-learn/core/runtime-contracts";
import {
  decryptSyncPayload,
  encryptSyncPayload,
  encryptedSyncEnvelopeSchema,
  personalSyncTableManifest,
  runWithPersonalSyncApply,
  type EncryptedSyncEnvelope,
  type SyncMergePolicy,
} from "@xue-learn/core/server/personal-sync";
import {
  disableLocalPersonalSyncRuntime,
  getLocalPersonalSyncRuntime,
} from "./runtime.ts";
import { personalSyncTimestampIso } from "./timestamp.ts";

type Row = Record<string, unknown>;
type SyncRowChange = {
  tableName: string;
  rowId: string;
  operation: "upsert" | "delete";
  mergePolicy: SyncMergePolicy;
  scopeKind: "workspace" | "goal";
  scopeId: string | null;
  row: Row | null;
  activeTimeCounter?: number;
};
type SyncCommitPayload = Readonly<{
  formatVersion: 1;
  commitId: string;
  workspaceId: string;
  originDeviceId: string;
  sequence: number;
  dependencies: Record<string, number>;
  scopeKind: "workspace" | "goal";
  scopeId: string | null;
  fencingEpoch: number | null;
  createdAt: string;
  changes: SyncRowChange[];
}>;

export type OutgoingSyncCommit = Readonly<{
  commitId: string;
  originDeviceId: string;
  sequence: number;
  scopeKind: "workspace" | "goal";
  scopeId: string | null;
  fencingEpoch: number | null;
  ciphertextHash: string;
  envelope: EncryptedSyncEnvelope;
  createdAt: string;
}>;

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

function value(row: Row, key: string): unknown {
  return row[key] ?? row[key.toLowerCase()];
}

function json<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return raw as T;
}

function quote(identifier: string): string {
  if (!personalSyncTableManifest[identifier])
    throw new Error(`Unclassified sync table: ${identifier}`);
  return `"${identifier.replaceAll('"', '""')}"`;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const WORKSPACE_LEASE_TABLES = new Set([
  "User",
  "LearningProfile",
  "LearnerPlanningSettings",
  "UserSettings",
  "TeachingPersona",
  "TeachingSkill",
  "TeachingSkillVersion",
  "TeachingSkillFile",
  "LearningSpace",
  "LearningSpaceItem",
  "LearningSpaceItemRelation",
  "GoalCreationSession",
  "GoalCreationSessionResource",
]);

type LiveSyncLease = Readonly<{
  fencingEpoch: number;
  expiresAtMs: number;
}>;

/** Pure helper for tests and finalize: which lease fence a change set needs. */
export function resolvePersonalSyncCommitScope(
  changes: readonly Pick<
    SyncRowChange,
    "scopeKind" | "scopeId" | "mergePolicy" | "tableName"
  >[],
): {
  scopeKind: "workspace" | "goal";
  scopeId: string | null;
  requiresLease: boolean;
} {
  const goals = new Set(
    changes
      .filter((change) => change.scopeKind === "goal" && change.scopeId)
      .map((change) => change.scopeId as string),
  );
  const requiresWorkspaceScope = changes.some(
    (change) =>
      change.scopeKind === "workspace" &&
      change.mergePolicy === "leased_replace" &&
      WORKSPACE_LEASE_TABLES.has(change.tableName),
  );
  const scopeKind =
    !requiresWorkspaceScope && goals.size === 1 ? "goal" : "workspace";
  return {
    scopeKind,
    scopeId: scopeKind === "goal" ? [...goals][0]! : null,
    requiresLease: changes.some(
      (change) => change.mergePolicy === "leased_replace",
    ),
  };
}

/** Pure helper for tests: live fencing epoch when this device holds the lease. */
export function resolvePersonalSyncFencingEpoch(input: {
  scopeKind: "workspace" | "goal";
  scopeId: string | null;
  requiresLease: boolean;
  liveLeases: ReadonlyMap<string, LiveSyncLease>;
  nowMs?: number;
}): number | null {
  if (!input.requiresLease) return null;
  const scopeKey =
    input.scopeKind === "goal" && input.scopeId
      ? `goal:${input.scopeId}`
      : "workspace";
  const lease = input.liveLeases.get(scopeKey);
  const nowMs = input.nowMs ?? Date.now();
  if (!lease || lease.expiresAtMs <= nowMs) return null;
  return lease.fencingEpoch;
}

@Injectable()
export class PersonalSyncService {
  private get runtime() {
    return getLocalPersonalSyncRuntime();
  }

  async disableRuntime(): Promise<PersonalSyncStatus> {
    disableLocalPersonalSyncRuntime();
    return this.getStatus();
  }

  private async execute(
    sql: string,
    params: unknown[] = [],
    em?: EntityManager,
  ) {
    const manager = em ?? this.runtime.em;
    return manager
      .getConnection()
      .execute(sql, params, undefined, manager.getTransactionContext());
  }

  private async state(em?: EntityManager): Promise<Row> {
    const found = rows(
      await this.execute(
        `SELECT * FROM "PersonalSyncState" WHERE "id" = 'primary' LIMIT 1`,
        [],
        em,
      ),
    )[0];
    if (found) {
      await this.execute(
        `UPDATE "PersonalSyncState" SET "enabled" = ?, "locked" = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = 'primary'`,
        [
          this.runtime.syncEnabled ? 1 : 0,
          this.runtime.syncEnabled && !this.runtime.workspaceKey ? 1 : 0,
        ],
        em,
      );
      return {
        ...found,
        enabled: this.runtime.syncEnabled ? 1 : 0,
        locked: this.runtime.syncEnabled && !this.runtime.workspaceKey ? 1 : 0,
      };
    }
    const deviceId = randomUUID();
    await this.execute(
      `INSERT INTO "PersonalSyncState"
        ("id", "formatVersion", "deviceId", "enabled", "locked", "nextSequence", "createdAt", "updatedAt")
       VALUES ('primary', ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        PERSONAL_SYNC_FORMAT_VERSION,
        deviceId,
        this.runtime.syncEnabled ? 1 : 0,
        this.runtime.syncEnabled && !this.runtime.workspaceKey ? 1 : 0,
      ],
      em,
    );
    return rows(
      await this.execute(
        `SELECT * FROM "PersonalSyncState" WHERE "id" = 'primary' LIMIT 1`,
        [],
        em,
      ),
    )[0]!;
  }

  async getStatus(): Promise<PersonalSyncStatus> {
    const state = await this.state();
    const counts =
      rows(
        await this.execute(`SELECT
        (SELECT COUNT(*) FROM "PersonalSyncCommit" WHERE "status" IN ('collecting','pending_upload','uploading')) AS "pendingUploadCount",
        (SELECT COUNT(*) FROM "PersonalSyncCommit" WHERE "status" = 'downloaded') AS "pendingDownloadCount",
        (SELECT COUNT(*) FROM "PersonalSyncConflict" WHERE "resolvedAt" IS NULL) AS "conflictCount"`),
      )[0] ?? {};
    const enabled = Number(value(state, "enabled")) === 1;
    const locked =
      Number(value(state, "locked")) === 1 || !this.runtime.workspaceKey;
    const conflictCount = Number(value(counts, "conflictCount") ?? 0);
    const pendingUploadCount = Number(value(counts, "pendingUploadCount") ?? 0);
    const pendingDownloadCount = Number(
      value(counts, "pendingDownloadCount") ?? 0,
    );
    const readOnlyReason = value(state, "readOnlyReason");
    const lastError = value(state, "lastError");
    const transportState = value(state, "transportState");
    const status: PersonalSyncStatus = {
      formatVersion: PERSONAL_SYNC_FORMAT_VERSION,
      workspaceId: this.runtime.workspaceId,
      state: !enabled
        ? "disabled"
        : locked
          ? "locked"
          : readOnlyReason
            ? "read_only"
            : conflictCount > 0
              ? "conflict"
              : transportState === "offline"
                ? "offline"
                : transportState === "authentication_required"
                  ? "authentication_required"
                  : lastError
                    ? "error"
                    : pendingUploadCount > 0 || pendingDownloadCount > 0
                      ? "syncing"
                      : "synced",
      pendingUploadCount,
      pendingDownloadCount,
      conflictCount,
      lastSuccessfulSyncAt: this.iso(value(state, "lastSuccessfulSyncAt")),
      lastAttemptAt: this.iso(value(state, "lastAttemptAt")),
      lastError: lastError == null ? null : String(lastError),
    };
    return personalSyncStatusSchema.parse(status);
  }

  async ensureInitialSnapshot(): Promise<{
    created: boolean;
    totalRows: number;
    commitCount: number;
  }> {
    if (!this.runtime.workspaceKey) throw new Error("The workspace is locked");
    return this.runtime.em.transactional(async (em) => {
      const existing = rows(
        await this.execute(
          `SELECT "id" FROM "PersonalSyncSnapshot" WHERE "id" = 'initial-state-v1' LIMIT 1`,
          [],
          em,
        ),
      )[0];
      if (existing) return { created: false, totalRows: 0, commitCount: 0 };
      const result = await capturePersonalSyncInitialState(em);
      const digest = hash(
        JSON.stringify({
          workspaceId: this.runtime.workspaceId,
          totalRows: result.totalRows,
          commitCount: result.commitCount,
        }),
      );
      await this.execute(
        `INSERT INTO "PersonalSyncSnapshot"
          ("id", "frontierJson", "ciphertextHash", "createdAt")
         VALUES ('initial-state-v1', '{}', ?, CURRENT_TIMESTAMP)`,
        [digest],
        em,
      );
      return { created: true, ...result };
    });
  }

  async getLocalDevice(): Promise<{ deviceId: string }> {
    const state = await this.state();
    return { deviceId: String(value(state, "deviceId")) };
  }

  async cacheLease(input: {
    scopeKey: string;
    holderDeviceId: string;
    holderDisplayName?: string | null;
    fencingEpoch: number;
    serverModifiedAt: string;
    expiresAt: string;
    recordChangeTag: string;
    transferRequestedByDeviceId?: string | null;
  }): Promise<void> {
    await this.execute(
      `INSERT INTO "PersonalSyncLeaseCache"
        ("scopeKey", "holderDeviceId", "holderDisplayName", "fencingEpoch", "serverModifiedAt", "expiresAt", "recordChangeTag", "transferRequestedByDeviceId", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT ("scopeKey") DO UPDATE SET
         "holderDeviceId" = excluded."holderDeviceId",
         "holderDisplayName" = excluded."holderDisplayName",
         "fencingEpoch" = excluded."fencingEpoch",
         "serverModifiedAt" = excluded."serverModifiedAt",
         "expiresAt" = excluded."expiresAt",
         "recordChangeTag" = excluded."recordChangeTag",
         "transferRequestedByDeviceId" = excluded."transferRequestedByDeviceId",
         "updatedAt" = CURRENT_TIMESTAMP`,
      [
        input.scopeKey,
        input.holderDeviceId,
        input.holderDisplayName ?? null,
        input.fencingEpoch,
        input.serverModifiedAt,
        input.expiresAt,
        input.recordChangeTag,
        input.transferRequestedByDeviceId ?? null,
      ],
    );
  }

  async listLeases(): Promise<Row[]> {
    return rows(
      await this.execute(
        `SELECT * FROM "PersonalSyncLeaseCache" ORDER BY "scopeKey"`,
      ),
    );
  }

  async resolveUnitGoal(unitId: string): Promise<{ goalId: string }> {
    const unit = rows(
      await this.execute(
        `SELECT "goalId" FROM "LearningUnit" WHERE "id" = ? LIMIT 1`,
        [unitId],
      ),
    )[0];
    const goalId = value(unit ?? {}, "goalId");
    if (!goalId) throw new Error("The learning unit has no goal scope");
    return { goalId: String(goalId) };
  }

  async cacheDevice(input: {
    deviceId: string;
    appVersion: string;
    lastSeenAt: string;
    acknowledgedFrontier: Record<string, number>;
  }): Promise<void> {
    await this.execute(
      `INSERT INTO "PersonalSyncDevice" ("deviceId", "appVersion", "lastSeenAt", "acknowledgedFrontierJson", "updatedAt")
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT ("deviceId") DO UPDATE SET "appVersion" = excluded."appVersion", "lastSeenAt" = excluded."lastSeenAt", "acknowledgedFrontierJson" = excluded."acknowledgedFrontierJson", "updatedAt" = CURRENT_TIMESTAMP`,
      [
        input.deviceId,
        input.appVersion,
        input.lastSeenAt,
        JSON.stringify(input.acknowledgedFrontier),
      ],
    );
  }

  async listDevices(): Promise<Row[]> {
    return rows(
      await this.execute(
        `SELECT * FROM "PersonalSyncDevice" ORDER BY "lastSeenAt" DESC`,
      ),
    );
  }

  async finalizeAndListOutgoing(limit = 100): Promise<OutgoingSyncCommit[]> {
    const workspaceKey = this.runtime.workspaceKey;
    if (!workspaceKey) return [];
    const maxFinalize = Math.max(1, Math.min(200, Math.trunc(limit)));
    const state = await this.state();
    const deviceId = String(value(state, "deviceId"));
    let sequence = Number(value(state, "nextSequence") ?? 1);
    const nowMs = Date.now();

    const liveLeases = new Map<string, LiveSyncLease>();
    for (const lease of rows(
      await this.execute(
        `SELECT "scopeKey", "holderDeviceId", "fencingEpoch", "expiresAt"
         FROM "PersonalSyncLeaseCache"`,
      ),
    )) {
      const holder = String(value(lease, "holderDeviceId") ?? "");
      const expiresAtMs = Date.parse(String(value(lease, "expiresAt") ?? ""));
      if (
        holder !== deviceId ||
        !Number.isFinite(expiresAtMs) ||
        expiresAtMs <= nowMs
      )
        continue;
      liveLeases.set(String(value(lease, "scopeKey")), {
        fencingEpoch: Number(value(lease, "fencingEpoch") ?? 0),
        expiresAtMs,
      });
    }
    const workspaceLeaseLive = liveLeases.has("workspace");

    const dependencies = Object.fromEntries(
      rows(
        await this.execute(
          `SELECT "originDeviceId", MAX("sequence") AS "sequence"
           FROM "PersonalSyncCommit" WHERE "status" IN ('uploaded','applied')
           GROUP BY "originDeviceId"`,
        ),
      ).map((row) => [
        String(value(row, "originDeviceId")),
        Number(value(row, "sequence")),
      ]),
    );

    // When the workspace lease is missing, skip pure workspace leased commits
    // in SQL so a multi-thousand backlog cannot dominate every sync poll.
    const collecting = rows(
      await this.execute(
        workspaceLeaseLive
          ? `SELECT "id", "createdAt" FROM "PersonalSyncCommit"
             WHERE "status" = 'collecting' ORDER BY "createdAt", "id" LIMIT ?`
          : `SELECT c."id", c."createdAt" FROM "PersonalSyncCommit" c
             WHERE c."status" = 'collecting'
               AND (
                 EXISTS (
                   SELECT 1 FROM "PersonalSyncRowChange" rc
                   WHERE rc."commitId" = c."id" AND rc."scopeKind" = 'goal'
                 )
                 OR NOT EXISTS (
                   SELECT 1 FROM "PersonalSyncRowChange" rc
                   WHERE rc."commitId" = c."id"
                     AND rc."mergePolicy" = 'leased_replace'
                 )
               )
             ORDER BY c."createdAt", c."id" LIMIT ?`,
        [maxFinalize],
      ),
    );

    type PreparedCommit = {
      commitId: string;
      sequence: number;
      scopeKind: "workspace" | "goal";
      scopeId: string | null;
      fencingEpoch: number | null;
      createdAt: string;
      changes: SyncRowChange[];
    };
    const prepared: PreparedCommit[] = [];

    for (const commit of collecting) {
      if (prepared.length >= maxFinalize) break;
      const commitId = String(value(commit, "id"));
      const rawChanges = rows(
        await this.execute(
          `SELECT * FROM "PersonalSyncRowChange" WHERE "commitId" = ? ORDER BY "createdAt", "id"`,
          [commitId],
        ),
      );
      if (!rawChanges.length) continue;

      const compacted = new Map<string, SyncRowChange>();
      for (const change of rawChanges) {
        if(isValidatedLegacySyncTable(String(value(change,"tableName"))))continue;
        const item: SyncRowChange = {
          tableName: String(value(change, "tableName")),
          rowId: String(value(change, "rowId")),
          operation: String(value(change, "operation")) as "upsert" | "delete",
          mergePolicy: String(value(change, "mergePolicy")) as SyncMergePolicy,
          scopeKind: String(value(change, "scopeKind")) as "workspace" | "goal",
          scopeId:
            value(change, "scopeId") == null
              ? null
              : String(value(change, "scopeId")),
          row: portablePersonalSyncRow(String(value(change,"tableName")),json<Row | null>(value(change, "rowJson"), null)),
        };
        compacted.set(`${item.tableName}\0${item.rowId}`, item);
      }
      const changes = [...compacted.values()];
      if(!changes.length)continue;
      const scope = resolvePersonalSyncCommitScope(changes);
      const fencingEpoch = resolvePersonalSyncFencingEpoch({
        ...scope,
        liveLeases,
        nowMs,
      });
      // Lease-blocked commits stay collecting until the matching lease is held.
      // Do not mutate counters or encrypt them on every poll.
      if (scope.requiresLease && fencingEpoch == null) continue;

      for (const change of changes) {
        if (
          change.tableName !== "UnitSessionState" ||
          change.operation !== "upsert" ||
          !change.row
        )
          continue;
        const counterKey = `UnitSessionState:${change.rowId}:activeSeconds`;
        const counter = rows(
          await this.execute(
            `SELECT "value", "lastAggregateSeen" FROM "PersonalSyncDeviceCounter" WHERE "counterKey" = ? AND "deviceId" = ?`,
            [counterKey, deviceId],
          ),
        )[0];
        const aggregate = Number(change.row.cumulativeActiveSeconds ?? 0);
        const previousAggregate = Number(
          value(counter ?? {}, "lastAggregateSeen") ?? 0,
        );
        change.activeTimeCounter =
          Number(value(counter ?? {}, "value") ?? 0) +
          Math.max(0, aggregate - previousAggregate);
      }

      prepared.push({
        commitId,
        sequence,
        scopeKind: scope.scopeKind,
        scopeId: scope.scopeId,
        fencingEpoch,
        createdAt:
          this.iso(value(commit, "createdAt")) ?? new Date().toISOString(),
        changes,
      });
      sequence += 1;
    }

    // Encrypt outside the SQLite write transaction so API reads are not blocked
    // on AES work for the whole batch.
    const sealed: Array<
      PreparedCommit & { serialized: string; ciphertextHash: string }
    > = [];
    for (const item of prepared) {
      const payload: SyncCommitPayload = {
        formatVersion: 1,
        commitId: item.commitId,
        workspaceId: this.runtime.workspaceId,
        originDeviceId: deviceId,
        sequence: item.sequence,
        dependencies,
        scopeKind: item.scopeKind,
        scopeId: item.scopeId,
        fencingEpoch: item.fencingEpoch,
        createdAt: item.createdAt,
        changes: item.changes,
      };
      const envelope = await encryptSyncPayload({
        workspaceId: this.runtime.workspaceId,
        valueId: item.commitId,
        purpose: "commit",
        workspaceKey,
        plaintext: Buffer.from(JSON.stringify(payload), "utf8"),
      });
      const serialized = JSON.stringify(envelope);
      sealed.push({
        ...item,
        serialized,
        ciphertextHash: hash(serialized),
      });
    }

    if (sealed.length) {
      await this.runtime.em.transactional(async (em) => {
        for (const item of sealed) {
          await this.execute(
            `UPDATE "PersonalSyncCommit" SET
              "originDeviceId" = ?, "sequence" = ?, "status" = ?,
              "scopeKind" = ?, "scopeId" = ?, "fencingEpoch" = ?,
              "dependenciesJson" = ?, "payloadJson" = ?, "ciphertextHash" = ?
             WHERE "id" = ? AND "status" = 'collecting'`,
            [
              deviceId,
              item.sequence,
              "pending_upload",
              item.scopeKind,
              item.scopeId,
              item.fencingEpoch,
              JSON.stringify(dependencies),
              item.serialized,
              item.ciphertextHash,
              item.commitId,
            ],
            em,
          );
          const claimed = rows(
            await this.execute(
              `SELECT "id" FROM "PersonalSyncCommit" WHERE "id" = ? AND "status" = 'pending_upload' LIMIT 1`,
              [item.commitId],
              em,
            ),
          );
          if (!claimed.length) continue;
          for (const change of item.changes) {
            if (
              change.tableName !== "UnitSessionState" ||
              change.operation !== "upsert" ||
              !change.row ||
              change.activeTimeCounter == null
            )
              continue;
            const counterKey = `UnitSessionState:${change.rowId}:activeSeconds`;
            const aggregate = Number(change.row.cumulativeActiveSeconds ?? 0);
            await this.execute(
              `INSERT INTO "PersonalSyncDeviceCounter" ("counterKey", "deviceId", "value", "lastAggregateSeen", "updatedAt")
               VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT ("counterKey", "deviceId") DO UPDATE SET "value" = excluded."value", "lastAggregateSeen" = excluded."lastAggregateSeen", "updatedAt" = CURRENT_TIMESTAMP`,
              [counterKey, deviceId, change.activeTimeCounter, aggregate],
              em,
            );
          }
          await this.execute(
            `DELETE FROM "PersonalSyncRowChange" WHERE "commitId" = ?`,
            [item.commitId],
            em,
          );
        }
        await this.execute(
          `UPDATE "PersonalSyncState" SET "nextSequence" = ?, "lastAttemptAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = 'primary'`,
          [sequence],
          em,
        );
      });
      try {
        await this.execute("PRAGMA wal_checkpoint(PASSIVE)");
      } catch {
        // Checkpoint is best-effort; never fail upload preparation on it.
      }
    } else {
      await this.execute(
        `UPDATE "PersonalSyncState" SET "lastAttemptAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = 'primary'`,
      );
    }

    return rows(
      await this.execute(
        `SELECT * FROM "PersonalSyncCommit" WHERE "status" = 'pending_upload' ORDER BY "sequence" LIMIT ?`,
        [maxFinalize],
      ),
    ).map((row) => ({
      commitId: String(value(row, "id")),
      originDeviceId: String(value(row, "originDeviceId")),
      sequence: Number(value(row, "sequence")),
      scopeKind: String(value(row, "scopeKind")) as "workspace" | "goal",
      scopeId:
        value(row, "scopeId") == null ? null : String(value(row, "scopeId")),
      fencingEpoch:
        value(row, "fencingEpoch") == null
          ? null
          : Number(value(row, "fencingEpoch")),
      ciphertextHash: String(value(row, "ciphertextHash")),
      envelope: encryptedSyncEnvelopeSchema.parse(
        json(value(row, "payloadJson"), null),
      ),
      createdAt: this.iso(value(row, "createdAt")) ?? new Date().toISOString(),
    }));
  }

  async listPublishedManifest(limit = 50_000): Promise<
    Array<{
      commitId: string;
      originDeviceId: string;
      sequence: number;
    }>
  > {
    return rows(
      await this.execute(
        `SELECT "id", "originDeviceId", "sequence"
         FROM "PersonalSyncCommit"
         WHERE "status" = 'uploaded' AND "payloadJson" IS NOT NULL
         ORDER BY "sequence" LIMIT ?`,
        [Math.max(1, Math.min(50_000, Math.trunc(limit)))],
      ),
    ).map((row) => ({
      commitId: String(value(row, "id")),
      originDeviceId: String(value(row, "originDeviceId")),
      sequence: Number(value(row, "sequence")),
    }));
  }

  async recoverPublishedOutgoing(
    commitIds: readonly string[],
  ): Promise<OutgoingSyncCommit[]> {
    if (!commitIds.length) return [];
    const boundedIds = commitIds.slice(0, 200);
    return rows(
      await this.execute(
        `SELECT * FROM "PersonalSyncCommit"
         WHERE "status" = 'uploaded' AND "payloadJson" IS NOT NULL
           AND "id" IN (${boundedIds.map(() => "?").join(",")})
         ORDER BY "sequence"`,
        [...boundedIds],
      ),
    ).map((row) => ({
      commitId: String(value(row, "id")),
      originDeviceId: String(value(row, "originDeviceId")),
      sequence: Number(value(row, "sequence")),
      scopeKind: String(value(row, "scopeKind")) as "workspace" | "goal",
      scopeId:
        value(row, "scopeId") == null ? null : String(value(row, "scopeId")),
      fencingEpoch:
        value(row, "fencingEpoch") == null
          ? null
          : Number(value(row, "fencingEpoch")),
      ciphertextHash: String(value(row, "ciphertextHash")),
      envelope: encryptedSyncEnvelopeSchema.parse(
        json(value(row, "payloadJson"), null),
      ),
      createdAt: this.iso(value(row, "createdAt")) ?? new Date().toISOString(),
    }));
  }

  async markUploaded(
    commitId: string,
    remoteRecordName: string,
  ): Promise<void> {
    await this.execute(
      `UPDATE "PersonalSyncCommit" SET "status" = 'uploaded', "remoteRecordName" = ?, "uploadedAt" = CURRENT_TIMESTAMP WHERE "id" = ? AND "status" = 'pending_upload'`,
      [remoteRecordName, commitId],
    );
    await this.execute(
      `UPDATE "PersonalSyncState" SET "lastSuccessfulSyncAt" = CURRENT_TIMESTAMP, "transportState" = NULL, "lastError" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = 'primary'`,
    );
  }

  async quarantineStaleCommit(commitId: string): Promise<void> {
    await this.runtime.em.transactional(async (em) => {
      const commit = rows(
        await this.execute(
          `SELECT "scopeKind", "scopeId" FROM "PersonalSyncCommit" WHERE "id" = ? AND "status" = 'pending_upload' LIMIT 1`,
          [commitId],
          em,
        ),
      )[0];
      if (!commit) return;
      await this.execute(
        `UPDATE "PersonalSyncCommit" SET "status" = 'quarantined', "quarantinedAt" = CURRENT_TIMESTAMP, "lastError" = 'stale_lease_commit' WHERE "id" = ?`,
        [commitId],
        em,
      );
      await this.execute(
        `INSERT INTO "PersonalSyncConflict"
          ("id", "kind", "scopeKind", "scopeId", "localCommitId", "summary", "detailJson", "detectedAt")
         VALUES (?, 'stale_lease_commit', ?, ?, ?, ?, '{}', CURRENT_TIMESTAMP)`,
        [
          randomUUID(),
          value(commit, "scopeKind"),
          value(commit, "scopeId"),
          commitId,
          "A structural commit lost its lease fence and was not uploaded",
        ],
        em,
      );
    });
  }

  async applyIncoming(input: {
    commitId: string;
    ciphertextHash: string;
    envelope: EncryptedSyncEnvelope;
  }): Promise<void> {
    const workspaceKey = this.runtime.workspaceKey;
    if (!workspaceKey) throw new Error("The workspace is locked");
    const serialized = JSON.stringify(
      encryptedSyncEnvelopeSchema.parse(input.envelope),
    );
    if (hash(serialized) !== input.ciphertextHash)
      throw new Error("The encrypted sync commit checksum does not match");
    const plaintext = await decryptSyncPayload({
      workspaceId: this.runtime.workspaceId,
      valueId: input.commitId,
      purpose: "commit",
      workspaceKey,
      envelope: input.envelope,
    });
    const payload = JSON.parse(plaintext.toString("utf8")) as SyncCommitPayload;
    if (
      payload.formatVersion !== 1 ||
      payload.workspaceId !== this.runtime.workspaceId
    ) {
      await this.execute(
        `UPDATE "PersonalSyncState" SET "readOnlyReason" = ?, "lastError" = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = 'primary'`,
        [
          "schema_incompatible",
          "This workspace was written by an incompatible sync format",
        ],
      );
      throw new Error(
        "The sync format is incompatible; this workspace is now read-only",
      );
    }
    if (payload.commitId !== input.commitId)
      throw new Error("The sync commit envelope does not match this workspace");
    const existing = rows(
      await this.execute(
        `SELECT "status" FROM "PersonalSyncCommit" WHERE "id" = ? LIMIT 1`,
        [input.commitId],
      ),
    )[0];
    if (
      existing &&
      ["uploaded", "applied"].includes(String(value(existing, "status")))
    )
      return;

    const originFrontier = rows(
      await this.execute(
        `SELECT MAX("sequence") AS "sequence" FROM "PersonalSyncCommit" WHERE "originDeviceId" = ? AND "status" IN ('uploaded','applied')`,
        [payload.originDeviceId],
      ),
    )[0];
    const lastOriginSequence = Number(
      value(originFrontier ?? {}, "sequence") ?? 0,
    );
    if (payload.sequence !== lastOriginSequence + 1)
      throw new Error(
        payload.sequence <= lastOriginSequence
          ? "A conflicting or repeated device sequence was rejected"
          : "A sync commit dependency is missing",
      );
    for (const [originDeviceId, requiredSequence] of Object.entries(
      payload.dependencies,
    )) {
      const frontier = rows(
        await this.execute(
          `SELECT MAX("sequence") AS "sequence" FROM "PersonalSyncCommit" WHERE "originDeviceId" = ? AND "status" IN ('uploaded','applied')`,
          [originDeviceId],
        ),
      )[0];
      if (Number(value(frontier ?? {}, "sequence") ?? 0) < requiredSequence)
        throw new Error("A sync commit dependency is missing");
    }

    await runWithPersonalSyncApply(() =>
      this.runtime.em.transactional(async (em) => {
        const upserts = await this.orderChanges(
          em,
          payload.changes.filter(
            (candidate) => candidate.operation === "upsert",
          ),
        );
        const deletes = (
          await this.orderChanges(
            em,
            payload.changes.filter(
              (candidate) => candidate.operation === "delete",
            ),
          )
        ).reverse();
        for (const change of upserts) {
          await this.applyUpsert(em, payload, change);
        }
        for (const change of deletes) {
          await this.applyDelete(em, payload, change);
        }
        await this.invalidateDerivedProjections(em, payload.changes);
        await this.execute(
          `INSERT INTO "PersonalSyncCommit"
            ("id", "originDeviceId", "sequence", "status", "scopeKind", "scopeId", "fencingEpoch", "dependenciesJson", "ciphertextHash", "createdAt", "appliedAt")
           VALUES (?, ?, ?, 'applied', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT ("id") DO UPDATE SET "status" = 'applied', "appliedAt" = CURRENT_TIMESTAMP`,
          [
            payload.commitId,
            payload.originDeviceId,
            payload.sequence,
            payload.scopeKind,
            payload.scopeId,
            payload.fencingEpoch,
            JSON.stringify(payload.dependencies),
            input.ciphertextHash,
            payload.createdAt,
          ],
          em,
        );
        await this.execute(
          `INSERT INTO "PersonalSyncCursor" ("deviceId", "lastDownloadedSequence", "lastAppliedSequence", "updatedAt")
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT ("deviceId") DO UPDATE SET
             "lastDownloadedSequence" = MAX("lastDownloadedSequence", excluded."lastDownloadedSequence"),
             "lastAppliedSequence" = MAX("lastAppliedSequence", excluded."lastAppliedSequence"),
             "updatedAt" = CURRENT_TIMESTAMP`,
          [payload.originDeviceId, payload.sequence, payload.sequence],
          em,
        );
      }),
    );
  }

  async getAppliedFrontier(): Promise<Record<string, number>> {
    const found = rows(
      await this.execute(
        `SELECT "originDeviceId", MAX("sequence") AS "sequence"
           FROM "PersonalSyncCommit"
          WHERE "status" IN ('uploaded', 'applied')
          GROUP BY "originDeviceId"`,
      ),
    );
    return Object.fromEntries(
      found.map((row) => [
        String(value(row, "originDeviceId")),
        Number(value(row, "sequence") ?? 0),
      ]),
    );
  }

  async listConflicts() {
    return rows(
      await this.execute(
        `SELECT * FROM "PersonalSyncConflict" WHERE "resolvedAt" IS NULL ORDER BY "detectedAt" DESC`,
      ),
    );
  }

  async getTransportCursor(): Promise<{ syncToken: string | null }> {
    const state = await this.state();
    return {
      syncToken:
        value(state, "remoteChangeToken") == null
          ? null
          : String(value(state, "remoteChangeToken")),
    };
  }

  async setTransportCursor(syncToken: string | null): Promise<void> {
    await this.execute(
      `UPDATE "PersonalSyncState" SET "remoteChangeToken" = ?, "lastSuccessfulSyncAt" = CURRENT_TIMESTAMP, "transportState" = NULL, "lastError" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = 'primary'`,
      [syncToken],
    );
  }

  async reportTransportState(input: {
    kind: "offline" | "authentication_required" | "error" | "clear";
    message?: string | null;
  }): Promise<void> {
    const message =
      input.kind === "clear" ? null : (input.message ?? input.kind);
    await this.execute(
      `UPDATE "PersonalSyncState" SET "lastAttemptAt" = CURRENT_TIMESTAMP, "transportState" = ?, "lastError" = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = 'primary'`,
      [input.kind === "clear" ? null : input.kind, message],
    );
  }

  private async applyUpsert(
    em: EntityManager,
    payload: SyncCommitPayload,
    change: SyncRowChange,
  ): Promise<void> {
    const rule = personalSyncTableManifest[change.tableName];
    if (!rule || rule.policy !== change.mergePolicy || rule.scope === "local")
      throw new Error(
        `Rejected unclassified remote change for ${change.tableName}`,
      );
    if (!change.row) throw new Error("Remote upsert is missing its row image");
    change.row = portablePersonalSyncRow(change.tableName,{ ...change.row });
    const columns = Object.keys(change.row);
    if (!columns.length) return;
    const info = rows(
      await this.execute(
        `PRAGMA table_info(${quote(change.tableName)})`,
        [],
        em,
      ),
    );
    const primary = info
      .filter((column) => Number(value(column, "pk")) > 0)
      .sort((a, b) => Number(value(a, "pk")) - Number(value(b, "pk")));
    const where = primary
      .map((column) => `${quote(String(value(column, "name")))} = ?`)
      .join(" AND ");
    const keys = primary.map((column) => String(value(column, "name")));
    const existing = rows(
      await this.execute(
        `SELECT * FROM ${quote(change.tableName)} WHERE ${where} LIMIT 1`,
        keys.map((key) => change.row![key]),
        em,
      ),
    )[0];
    if (existing && change.mergePolicy === "immutable_union") {
      if (canonical(existing) !== canonical(change.row))
        await this.recordConflict(
          em,
          payload,
          change,
          "immutable_id_collision",
          "An immutable record ID has different content on two devices",
          existing,
        );
      return;
    }
    if (
      existing &&
      change.mergePolicy === "versioned_note" &&
      canonical(existing) !== canonical(change.row)
    ) {
      await this.recordConflict(
        em,
        payload,
        change,
        "concurrent_note_edit",
        "A note was edited concurrently; both versions were retained in sync diagnostics",
        existing,
      );
      const localUpdated = Date.parse(
        String(value(existing, "updatedAt") ?? ""),
      );
      const remoteUpdated = Date.parse(String(change.row.updatedAt ?? ""));
      if (
        Number.isFinite(localUpdated) &&
        Number.isFinite(remoteUpdated) &&
        localUpdated > remoteUpdated
      )
        return;
    }
    if (
      change.mergePolicy === "monotonic_projection" &&
      change.tableName === "UnitSessionState"
    ) {
      if (existing) {
        const rank = { available: 0, in_progress: 1, completed: 2 } as Record<
          string,
          number
        >;
        const localStatus = String(value(existing, "status") ?? "available");
        const remoteStatus = String(change.row.status ?? "available");
        if ((rank[localStatus] ?? 0) > (rank[remoteStatus] ?? 0))
          change.row.status = localStatus;
      }
      if (change.activeTimeCounter != null) {
        const counterKey = `UnitSessionState:${change.rowId}:activeSeconds`;
        await this.execute(
          `INSERT INTO "PersonalSyncDeviceCounter" ("counterKey", "deviceId", "value", "lastAggregateSeen", "updatedAt")
             VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)
             ON CONFLICT ("counterKey", "deviceId") DO UPDATE SET "value" = MAX("value", excluded."value"), "updatedAt" = CURRENT_TIMESTAMP`,
          [counterKey, payload.originDeviceId, change.activeTimeCounter],
          em,
        );
        const total = rows(
          await this.execute(
            `SELECT SUM("value") AS "value" FROM "PersonalSyncDeviceCounter" WHERE "counterKey" = ?`,
            [counterKey],
            em,
          ),
        )[0];
        change.row.cumulativeActiveSeconds = Number(
          value(total ?? {}, "value") ?? 0,
        );
        const localDevice = await this.state(em);
        await this.execute(
          `INSERT INTO "PersonalSyncDeviceCounter" ("counterKey", "deviceId", "value", "lastAggregateSeen", "updatedAt")
             VALUES (?, ?, 0, ?, CURRENT_TIMESTAMP)
             ON CONFLICT ("counterKey", "deviceId") DO UPDATE SET "lastAggregateSeen" = excluded."lastAggregateSeen", "updatedAt" = CURRENT_TIMESTAMP`,
          [
            counterKey,
            String(value(localDevice, "deviceId")),
            change.row.cumulativeActiveSeconds,
          ],
          em,
        );
      } else if (existing) {
        change.row.cumulativeActiveSeconds = Math.max(
          Number(value(existing, "cumulativeActiveSeconds") ?? 0),
          Number(change.row.cumulativeActiveSeconds ?? 0),
        );
      }
    }
    if (!keys.length)
      throw new Error(
        `Synchronized table ${change.tableName} has no primary key`,
      );
    const updates = columns.filter((column) => !keys.includes(column));
    const conflictAction = updates.length
      ? `DO UPDATE SET ${updates
          .map((column) => `${quote(column)} = excluded.${quote(column)}`)
          .join(",")}`
      : "DO NOTHING";
    await this.execute(
      `INSERT INTO ${quote(change.tableName)} (${columns.map(quote).join(",")})
       VALUES (${columns.map(() => "?").join(",")})
       ON CONFLICT (${keys.map(quote).join(",")}) ${conflictAction}`,
      columns.map((column) => change.row![column]),
      em,
    );
  }

  private async applyDelete(
    em: EntityManager,
    payload: SyncCommitPayload,
    change: SyncRowChange,
  ): Promise<void> {
    const rule = personalSyncTableManifest[change.tableName];
    if (!rule || rule.policy !== "leased_replace")
      throw new Error(
        `Remote deletion is not lease-authorized for ${change.tableName}`,
      );
    const row = change.row ?? {};
    const info = rows(
      await this.execute(
        `PRAGMA table_info(${quote(change.tableName)})`,
        [],
        em,
      ),
    );
    const primary = info
      .filter((column) => Number(value(column, "pk")) > 0)
      .sort((a, b) => Number(value(a, "pk")) - Number(value(b, "pk")));
    await this.execute(
      `DELETE FROM ${quote(change.tableName)} WHERE ${primary
        .map((column) => `${quote(String(value(column, "name")))} = ?`)
        .join(" AND ")}`,
      primary.map((column) => row[String(value(column, "name"))]),
      em,
    );
    await this.execute(
      `INSERT INTO "PersonalSyncTombstone" ("tableName", "rowId", "commitId", "deletedAt", "retainUntil")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, datetime('now', '+90 days'))
       ON CONFLICT ("tableName", "rowId") DO UPDATE SET "commitId" = excluded."commitId", "deletedAt" = CURRENT_TIMESTAMP, "retainUntil" = excluded."retainUntil"`,
      [change.tableName, change.rowId, payload.commitId],
      em,
    );
  }

  private async recordConflict(
    em: EntityManager,
    payload: SyncCommitPayload,
    change: SyncRowChange,
    kind: string,
    summary: string,
    localRow?: Row,
  ): Promise<void> {
    await this.execute(
      `INSERT INTO "PersonalSyncConflict"
        ("id", "kind", "scopeKind", "scopeId", "entityType", "entityId", "remoteCommitId", "summary", "detailJson", "detectedAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        randomUUID(),
        kind,
        payload.scopeKind,
        payload.scopeId,
        change.tableName,
        change.rowId,
        payload.commitId,
        summary,
        JSON.stringify({ localRow: localRow ?? null, remoteRow: change.row }),
      ],
      em,
    );
  }

  private async orderChanges(
    em: EntityManager,
    changes: readonly SyncRowChange[],
  ): Promise<SyncRowChange[]> {
    const byTable = new Map<string, SyncRowChange[]>();
    for (const change of changes) {
      const list = byTable.get(change.tableName) ?? [];
      list.push(change);
      byTable.set(change.tableName, list);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const orderedTables: string[] = [];
    const visit = async (table: string): Promise<void> => {
      if (visited.has(table)) return;
      if (visiting.has(table)) return;
      visiting.add(table);
      const foreignKeys = rows(
        await this.execute(`PRAGMA foreign_key_list(${quote(table)})`, [], em),
      );
      for (const foreignKey of foreignKeys) {
        const parent = String(value(foreignKey, "table"));
        if (byTable.has(parent)) await visit(parent);
      }
      visiting.delete(table);
      visited.add(table);
      orderedTables.push(table);
    };
    for (const table of byTable.keys()) await visit(table);
    return orderedTables.flatMap((table) => byTable.get(table) ?? []);
  }

  private async invalidateDerivedProjections(
    em: EntityManager,
    changes: readonly SyncRowChange[],
  ): Promise<void> {
    if (
      !changes.some((change) =>
        ["immutable_union", "monotonic_projection", "leased_replace"].includes(
          change.mergePolicy,
        ),
      )
    )
      return;
    for (const table of [
      "LearnerDimensionState",
      "LearnerEntityState",
      "LearnerStateRevision",
      "LearnerStateMemory",
      "LearnerGapHypothesis",
      "MisconceptionPattern",
      "AgendaItem",
      "AgendaRevision",
    ]) {
      const exists =
        rows(
          await this.execute(
            `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" = ?`,
            [table],
            em,
          ),
        ).length > 0;
      if (!exists) continue;
      const columns = rows(
        await this.execute(`PRAGMA table_info(${quote(table)})`, [], em),
      );
      if (columns.some((column) => String(value(column, "name")) === "userId"))
        await this.execute(
          `DELETE FROM ${quote(table)} WHERE "userId" = ?`,
          [LOCAL_OWNER_ID],
          em,
        );
      else await this.execute(`DELETE FROM ${quote(table)}`, [], em);
    }
  }

  private iso(raw: unknown): string | null {
    return personalSyncTimestampIso(raw);
  }
}
