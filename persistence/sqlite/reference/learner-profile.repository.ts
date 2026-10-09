import type { EntityManager } from "@mikro-orm/core";
import type {
  LearnerProfileRecord,
  LearnerProfileRepository,
  UpsertLearnerProfileInput,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import { LearnerProfileEntity } from "./learner-profile.entity.ts";

function toRecord(entity: LearnerProfileEntity): LearnerProfileRecord {
  return {
    userId: entity.userId,
    profileJson: entity.profileJson,
    updatedAt: entity.updatedAt,
  };
}

/**
 * MikroORM implementation of the learner-profile capability port.
 *
 * The repository intentionally does not begin or commit a transaction.  The
 * caller can compose it with other capability repositories through the
 * shared UnitOfWorkPort; a single profile upsert remains safe because the
 * user id is the primary key and the ORM flush is atomic for this row.
 */
export class MikroOrmLearnerProfileRepository implements LearnerProfileRepository {
  constructor(private readonly em: EntityManager) {}

  async findByUserId(userId: string): Promise<LearnerProfileRecord | null> {
    const entity = await this.em.findOne(LearnerProfileEntity, { userId });
    return entity ? toRecord(entity) : null;
  }

  async upsert(
    input: UpsertLearnerProfileInput,
  ): Promise<LearnerProfileRecord> {
    // MikroORM translates `upsert` to each driver's native conflict-merge
    // operation, keeping concurrent profile writes safe on PostgreSQL and
    // SQLite without exposing dialect-specific SQL at this boundary.
    const entity = await this.em.upsert(
      LearnerProfileEntity,
      {
        userId: input.userId,
        profileJson: input.profileJson,
        updatedAt: new Date(),
      },
      { onConflictFields: ["userId"] },
    );
    await this.em.flush();
    return toRecord(entity);
  }
}
