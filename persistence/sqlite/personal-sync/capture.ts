import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import {
  assertPersonalSyncTableCoverage,
  personalSyncTableManifest,
  isPortablePersonalSyncColumn,
  getPersonalSyncCaptureContext,
  runWithPersonalSyncCapture,
} from "@xue-learn/core/source/libs/server/src/personal-sync/index.ts";

let captureEnabled = false;
let rejectUnscopedCapture = false;
let validatedLegacyTables: readonly string[] = [];

export function configurePersonalSyncCapture(
  enabled: boolean,
  options: { rejectUnscoped?: boolean; validatedLegacyTables?: readonly string[] } = {},
): void {
  captureEnabled = enabled;
  rejectUnscopedCapture = Boolean(options.rejectUnscoped);
  validatedLegacyTables = options.validatedLegacyTables ?? [];
}

export function isValidatedLegacySyncTable(tableName: string): boolean {
  return validatedLegacyTables.includes(tableName);
}

/** Toggle capture without changing the host's unscoped-write policy. */
export function setPersonalSyncCaptureEnabled(enabled: boolean): void {
  captureEnabled = enabled;
}

export function bindPersonalSyncCaptureToConnection(em: EntityManager): void {
  const connection = em.getConnection();
  const original = connection.execute.bind(connection) as (
    ...args: unknown[]
  ) => unknown;
  connection.execute = ((...args: unknown[]) => {
    if (!captureEnabled || getPersonalSyncCaptureContext()) return original(...args);
    return runWithPersonalSyncCapture(() => original(...args));
  }) as typeof connection.execute;
}

type RawSqliteDatabase = {
  function(
    name: string,
    options: { deterministic?: boolean },
    callback: () => unknown,
  ): void;
};

function rawSqlite(em: EntityManager): RawSqliteDatabase {
  const connection = em.getConnection() as ReturnType<
    EntityManager["getConnection"]
  > & {
    database?: RawSqliteDatabase;
  };
  if (!connection.database)
    throw new Error("Personal sync requires the native SQLite connection");
  return connection.database;
}

export function registerPersonalSyncSqliteFunctions(em: EntityManager): void {
  const database = rawSqlite(em);
  database.function("xuelearn_sync_enabled", { deterministic: false }, () =>
    captureEnabled ? 1 : 0,
  );
  database.function(
    "xuelearn_sync_mode",
    { deterministic: false },
    () => getPersonalSyncCaptureContext()?.mode ?? "capture",
  );
  database.function(
    "xuelearn_sync_commit_id",
    { deterministic: false },
    () =>
      getPersonalSyncCaptureContext()?.commitId ??
      (rejectUnscopedCapture
        ? (() => {
            throw new Error("Unscoped synchronized SQLite write was rejected");
          })()
        : null),
  );
}

type Column = { name: string; pk: number };

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
const uuidSql = `lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))`;

function rowJsonSql(alias: "NEW" | "OLD", columns: readonly Column[]): string {
  return `json_object(${columns
    .flatMap((column) => [
      `'${column.name.replaceAll("'", "''")}'`,
      `CASE WHEN typeof(${alias}.${quote(column.name)}) = 'blob' THEN hex(${alias}.${quote(column.name)}) ELSE ${alias}.${quote(column.name)} END`,
    ])
    .join(", ")})`;
}

function rowIdSql(alias: "NEW" | "OLD", columns: readonly Column[]): string {
  const primary = columns
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk);
  if (!primary.length) throw new Error("Synchronized table has no primary key");
  if (primary.length === 1)
    return `CAST(${alias}.${quote(primary[0].name)} AS TEXT)`;
  return `json_array(${primary.map((column) => `${alias}.${quote(column.name)}`).join(", ")})`;
}

function goalScopeSql(
  tableName: string,
  alias: "NEW" | "OLD",
  columns: readonly Column[],
): { kind: string; id: string } {
  const rule = personalSyncTableManifest[tableName];
  if (rule?.scope === "goal_id")
    return { kind: "'goal'", id: rowIdSql(alias, columns) };
  if (
    rule?.scope === "goal_column" &&
    columns.some((column) => column.name === "goalId")
  ) {
    return { kind: "'goal'", id: `CAST(${alias}."goalId" AS TEXT)` };
  }
  if (
    rule?.scope === "goal_via_unit" &&
    columns.some((column) => column.name === "unitId")
  ) {
    return {
      kind: "'goal'",
      id: `(SELECT CAST("goalId" AS TEXT) FROM "LearningUnit" WHERE "id" = ${alias}."unitId" LIMIT 1)`,
    };
  }
  if (
    rule?.scope === "goal_via_module" &&
    columns.some((column) => column.name === "moduleId")
  ) {
    return {
      kind: "'goal'",
      id: `(SELECT CAST("goalId" AS TEXT) FROM "LearningModule" WHERE "id" = ${alias}."moduleId" LIMIT 1)`,
    };
  }
  return { kind: "'workspace'", id: "NULL" };
}

export async function installPersonalSyncCaptureTriggers(
  em: EntityManager,
): Promise<void> {
  const tableRows = (await em
    .getConnection()
    .execute(
      `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' ORDER BY "name"`,
    )) as Array<{ name: string }>;
  const tableNames = tableRows.map((row) => String(row.name));
  assertPersonalSyncTableCoverage(tableNames,{validatedLegacyTables});

  for (const tableName of validatedLegacyTables) {
    for (const operation of ["insert","update","delete"]) await em.getConnection().execute(`DROP TRIGGER IF EXISTS ${quote(`PersonalSyncCapture_${tableName}_${operation}`)}`);
  }
  for (const [tableName, rule] of Object.entries(personalSyncTableManifest)) {
    if (validatedLegacyTables.includes(tableName)) continue;
    if (rule.policy === "device_local" || rule.policy === "derived_rebuild")
      continue;
    if (!tableNames.includes(tableName)) continue;
    const columns = (await em
      .getConnection()
      .execute(`PRAGMA table_info(${quote(tableName)})`)) as Column[];
    const portableColumns=columns.filter(column=>isPortablePersonalSyncColumn(tableName,column.name));
    const triggerPrefix = `PersonalSyncCapture_${tableName}`;
    for (const operation of ["insert", "update", "delete"] as const) {
      await em
        .getConnection()
        .execute(
          `DROP TRIGGER IF EXISTS ${quote(`${triggerPrefix}_${operation}`)}`,
        );
      const alias = operation === "delete" ? "OLD" : "NEW";
      const scope = goalScopeSql(tableName, alias, columns);
      // SQLite applies the outer statement's ON CONFLICT algorithm to SQL
      // inside triggers, so INSERT OR IGNORE still ABORTs on a second write
      // that reuses the request commit id and rolls back the learner change.
      const commitIdSql = `COALESCE(xuelearn_sync_commit_id(), ${uuidSql})`;
      const capturedCommitId = `COALESCE(xuelearn_sync_commit_id(), (SELECT "id" FROM "PersonalSyncCommit" WHERE "originDeviceId" = 'local-pending' AND "sequence" = 0 ORDER BY rowid DESC LIMIT 1))`;
      await em.getConnection()
        .execute(`CREATE TRIGGER ${quote(`${triggerPrefix}_${operation}`)}
        AFTER ${operation.toUpperCase()} ON ${quote(tableName)}
        WHEN xuelearn_sync_enabled() = 1 AND xuelearn_sync_mode() = 'capture'
        BEGIN
          INSERT INTO "PersonalSyncCommit"
            ("id", "originDeviceId", "sequence", "status", "scopeKind", "scopeId", "dependenciesJson", "createdAt")
          SELECT c."commitId", 'local-pending', 0, 'collecting', ${scope.kind}, ${scope.id}, '{}', CURRENT_TIMESTAMP
          FROM (SELECT ${commitIdSql} AS "commitId") AS c
          WHERE NOT EXISTS (
            SELECT 1 FROM "PersonalSyncCommit" AS existing WHERE existing."id" = c."commitId"
          );
          INSERT INTO "PersonalSyncRowChange"
            ("id", "commitId", "tableName", "rowId", "operation", "mergePolicy", "scopeKind", "scopeId", "rowJson", "createdAt")
          VALUES (${uuidSql}, ${capturedCommitId}, '${tableName}', ${rowIdSql(alias, columns)}, '${operation === "delete" ? "delete" : "upsert"}', '${rule.policy}', ${scope.kind}, ${scope.id}, ${rowJsonSql(alias, portableColumns)}, CURRENT_TIMESTAMP);
        END;`);
    }
  }
}

export async function capturePersonalSyncInitialState(
  em: EntityManager,
  chunkSize = 100,
): Promise<{ totalRows: number; commitCount: number }> {
  const connection = em.getConnection();
  const execute = (sql: string, params: unknown[] = []) =>
    connection.execute(sql, params, undefined, em.getTransactionContext());
  const tableRows = (await execute(
    `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' ORDER BY "name"`,
  )) as Array<{ name: string }>;
  const tableNames = new Set(tableRows.map((row) => String(row.name)));
  const boundedChunkSize = Math.max(1, Math.min(500, Math.trunc(chunkSize)));
  let totalRows = 0;
  let commitCount = 0;

  const captureChunk = async (tableName?: string, offset = 0) => {
    const commitId = randomUUID();
    await runWithPersonalSyncCapture(async () => {
      // Every bootstrap commit is workspace-fenced, including goal-only table
      // chunks. This keeps the first complete export under one advisory lease.
      if (tableNames.has("User")) {
        await execute(
          `UPDATE "User" SET "id" = "id" WHERE "id" = (SELECT "id" FROM "User" ORDER BY rowid LIMIT 1)`,
        );
      }
      if (!tableName || tableName === "User") return;
      const columns = (await execute(
        `PRAGMA table_info(${quote(tableName)})`,
      )) as Column[];
      const primary = columns
        .filter((column) => column.pk > 0)
        .sort((a, b) => a.pk - b.pk)[0];
      if (!primary)
        throw new Error(`Synchronized table ${tableName} has no primary key`);
      await execute(
        `UPDATE ${quote(tableName)} SET ${quote(primary.name)} = ${quote(primary.name)}
         WHERE rowid IN (
           SELECT rowid FROM ${quote(tableName)} ORDER BY rowid LIMIT ? OFFSET ?
         )`,
        [boundedChunkSize, offset],
      );
    }, commitId);
    commitCount += 1;
  };

  if (tableNames.has("User")) await captureChunk();
  for (const [tableName, rule] of Object.entries(personalSyncTableManifest)) {
    if (validatedLegacyTables.includes(tableName)) continue;
    if (
      tableName === "User" ||
      rule.policy === "device_local" ||
      rule.policy === "derived_rebuild" ||
      !tableNames.has(tableName)
    )
      continue;
    const countRows = (await execute(
      `SELECT COUNT(*) AS "count" FROM ${quote(tableName)}`,
    )) as Array<{ count?: number | string }>;
    const count = Number(countRows[0]?.count ?? 0);
    totalRows += count;
    for (let offset = 0; offset < count; offset += boundedChunkSize) {
      await captureChunk(tableName, offset);
    }
  }
  if (tableNames.has("User")) {
    const users = (await execute(
      `SELECT COUNT(*) AS "count" FROM "User"`,
    )) as Array<{ count?: number | string }>;
    totalRows += Number(users[0]?.count ?? 0);
  }
  return { totalRows, commitCount };
}
