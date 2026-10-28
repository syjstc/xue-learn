import type { EntityManager } from "@mikro-orm/core";

const MAX_LOCAL_API_LOG_ROWS = 100_000;

type ProbeRow = { oversized?: unknown };

function rows(value: unknown): ProbeRow[] {
  return Array.isArray(value) ? (value as ProbeRow[]) : [];
}

/** Repair runaway device-local request telemetry without touching learner data. */
export async function compactOversizedLocalApiRequestLog(
  em: EntityManager,
): Promise<boolean> {
  const connection = em.getConnection();
  const found = rows(
    await connection.execute(
      `SELECT 1 AS "oversized" FROM "ApiRequestLog" LIMIT 1 OFFSET ${MAX_LOCAL_API_LOG_ROWS}`,
    ),
  )[0];
  if (!found) return false;

  await connection.execute(`DROP TABLE "ApiRequestLog"`);
  await connection.execute(`CREATE TABLE "ApiRequestLog" (
    "id" TEXT PRIMARY KEY, "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT NOT NULL, "traceId" TEXT NOT NULL, "userId" TEXT,
    "method" TEXT NOT NULL, "route" TEXT NOT NULL, "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL, "requestBytes" INTEGER, "responseBytes" INTEGER,
    "platform" TEXT, "ipHash" TEXT, "userAgentHash" TEXT, "errorCode" TEXT,
    "errorMessage" TEXT, "errorFingerprint" TEXT
  )`);
  await connection.execute(
    `CREATE INDEX "ApiRequestLog_createdAt_idx" ON "ApiRequestLog" ("createdAt")`,
  );
  await connection.execute(
    `CREATE INDEX "ApiRequestLog_errorFingerprint_createdAt_idx" ON "ApiRequestLog" ("errorFingerprint", "createdAt")`,
  );
  await connection.execute("PRAGMA wal_checkpoint(TRUNCATE)");
  await connection.execute("VACUUM");
  return true;
}
