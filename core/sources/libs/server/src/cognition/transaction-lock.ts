// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import { Persistence, type PersistenceClient } from "../persistence/persistence-compat.js";

type AdvisoryLockClient = PersistenceClient | Persistence.TransactionClient;

/**
 * Serialize a derived cognition projection inside the caller's transaction.
 * PostgreSQL transaction advisory locks avoid a placeholder state row and are
 * released automatically on commit/rollback.
 */
export async function acquireCognitionTransactionLock(
  client: AdvisoryLockClient,
  namespace:
    | "learner-entity"
    | "evidence-claim"
    | "unit-reset"
    | "learner-state-memory",
  identity: string,
): Promise<void> {
  const queryRaw = (
    client as unknown as {
      $queryRaw?: (query: Persistence.Sql) => Promise<unknown>;
    }
  ).$queryRaw;
  if (typeof queryRaw !== "function") {
    // Narrow unit-test doubles intentionally implement only the repositories
    // exercised by a test. Every real Persistence client exposes $queryRaw.
    if (process.env.NODE_ENV === "test") return;
    throw new Error("cognition transaction lock requires a Persistence raw client");
  }
  const key = `kacom:${namespace}:${identity}`;
  await queryRaw.call(
    client,
    Persistence.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked`,
  );
}
