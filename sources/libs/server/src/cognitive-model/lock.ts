/** Serialize all lifecycle writes for one goal across API/worker processes. */
export async function acquireCognitiveModelWriteLock(
  client: {
    $queryRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
  },
  goalId: string,
  unitId?: string,
): Promise<void> {
  await client.$queryRawUnsafe(
    "SELECT pg_advisory_xact_lock(hashtext($1))::text AS locked",
    `cognitive-model:${goalId}`,
  );
  await client.$queryRawUnsafe(
    'SELECT "id" FROM "LearningGoal" WHERE "id" = $1 FOR UPDATE',
    goalId,
  );
  if (unitId) {
    await client.$queryRawUnsafe(
      'SELECT "id" FROM "LearningUnit" WHERE "id" = $1 AND "goalId" = $2 FOR UPDATE',
      unitId,
      goalId,
    );
  }
}

export const COGNITIVE_MODEL_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 60_000,
} as const;
