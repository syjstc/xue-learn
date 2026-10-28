import type { EntityManager } from "@mikro-orm/core";
import type {
  CreateTeachingPersonaInput,
  TeachingPersonaRecord,
  TeachingPersonaRepository,
  UpdateTeachingPersonaInput,
} from "@xue-learn/core/domain";
import { TeachingPersonaEntity } from "./teaching-persona.entity.ts";
import { UserEntity } from "./user.entity.ts";

function toRecord(entity: TeachingPersonaEntity): TeachingPersonaRecord {
  return {
    id: entity.id,
    userId: typeof entity.user === "string" ? entity.user : entity.user.id,
    name: entity.name,
    avatarCode: entity.avatarCode,
    tagline: entity.tagline,
    learnerAddress: entity.learnerAddress,
    instructionsJson: entity.instructionsJson,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

function table(em: EntityManager, name: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${name.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

export class MikroOrmTeachingPersonaRepository implements TeachingPersonaRepository {
  constructor(private readonly em: EntityManager) {}

  async listByUserId(
    userId: string,
  ): Promise<readonly TeachingPersonaRecord[]> {
    const entities = await this.em.find(
      TeachingPersonaEntity,
      { user: this.em.getReference(UserEntity, userId) },
      { orderBy: { updatedAt: "desc" } },
    );
    return entities.map(toRecord);
  }

  async create(
    input: CreateTeachingPersonaInput,
  ): Promise<TeachingPersonaRecord> {
    // `mapToPk` is intentionally a primitive at runtime, while MikroORM's
    // generic `create()` type expects a loaded UserEntity for the same field.
    // Constructing the entity keeps the port independent of a loaded parent
    // without weakening the EntitySchema metadata.
    const entity = Object.assign(new TeachingPersonaEntity(), {
      user: input.userId,
      id: input.id,
      name: input.name,
      avatarCode: input.avatarCode,
      tagline: input.tagline,
      learnerAddress: input.learnerAddress,
      instructionsJson: input.instructionsJson,
    });
    this.em.persist(entity);
    await this.em.flush();
    return toRecord(entity);
  }

  async update(
    userId: string,
    id: string,
    patch: UpdateTeachingPersonaInput,
  ): Promise<TeachingPersonaRecord | null> {
    const entity = await this.em.findOne(TeachingPersonaEntity, {
      user: this.em.getReference(UserEntity, userId),
      id,
    });
    if (!entity) return null;
    Object.assign(entity, patch);
    await this.em.flush();
    return toRecord(entity);
  }

  async deleteAndClearReferences(
    userId: string,
    id: string,
    defaultPersonaRef: string,
  ): Promise<boolean> {
    return this.em.transactional(async (em) => {
      const entity = await em.findOne(TeachingPersonaEntity, {
        user: em.getReference(UserEntity, userId),
        id,
      });
      if (!entity) return false;
      const ref = `custom:${id}`;
      const execute = (sql: string, params: unknown[]) =>
        em
          .getConnection()
          .execute(sql, params, undefined, em.getTransactionContext());
      await execute(
        `UPDATE ${table(em, "UserSettings")} SET "teachingPersonaRef" = ?, "updatedAt" = ? WHERE "userId" = ? AND "teachingPersonaRef" = ?`,
        [defaultPersonaRef, new Date(), userId, ref],
      );
      await execute(
        `UPDATE ${table(em, "LearningGoal")} SET "teachingPersonaRef" = NULL, "updatedAt" = ? WHERE "userId" = ? AND "teachingPersonaRef" = ?`,
        [new Date(), userId, ref],
      );
      em.remove(entity);
      await em.flush();
      return true;
    });
  }
}
