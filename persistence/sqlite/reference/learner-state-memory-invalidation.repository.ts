import type { EntityManager } from "@mikro-orm/core";
import type { LearnerStateMemoryInvalidationRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";

function qualifiedTable(em: EntityManager, table: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

/** Raw SQL adapter for post-commit learner-state cache invalidation. */
export class MikroOrmLearnerStateMemoryInvalidationRepository implements LearnerStateMemoryInvalidationRepository {
  constructor(private readonly em: EntityManager) {}

  async invalidate(input: {
    userId: string;
    reason: string;
    invalidatedAt?: Date;
  }): Promise<void> {
    const invalidatedAt = input.invalidatedAt ?? new Date();
    const reason = input.reason.slice(0, 120);
    await this.em.getConnection().execute(
      `INSERT INTO ${qualifiedTable(this.em, "LearnerStateMemory")}
         ("userId", "invalidatedAt", "lastRefreshReason", "updatedAt")
       VALUES (?, ?, ?, ?)
       ON CONFLICT ("userId") DO UPDATE SET
         "invalidatedAt" = excluded."invalidatedAt",
         "lastRefreshReason" = excluded."lastRefreshReason",
         "updatedAt" = excluded."updatedAt"`,
      [input.userId, invalidatedAt, reason, invalidatedAt],
    );
  }
}
