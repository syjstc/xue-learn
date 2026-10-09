import type { EntityManager } from "@mikro-orm/core";
import type {
  CreateLearningSpaceInput,
  LearningSpaceRecord,
  LearningSpaceRepository,
  UpdateLearningSpaceInput,
} from "@xue-learn/core/domain";
import { LearningSpaceEntity } from "./learning-space.entity.ts";
import { UserEntity } from "./user.entity.ts";

function toRecord(entity: LearningSpaceEntity): LearningSpaceRecord {
  return {
    id: entity.id,
    userId: typeof entity.user === "string" ? entity.user : entity.user.id,
    name: entity.name,
    normalizedName: entity.normalizedName,
    purpose: entity.purpose,
    sortIndex: entity.sortIndex,
    revision: entity.revision,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export class MikroOrmLearningSpaceRepository implements LearningSpaceRepository {
  constructor(private readonly em: EntityManager) {}

  async listByUserId(userId: string): Promise<readonly LearningSpaceRecord[]> {
    const entities = await this.em.find(
      LearningSpaceEntity,
      { user: this.em.getReference(UserEntity, userId) },
      { orderBy: { sortIndex: "asc", name: "asc" } },
    );
    return entities.map(toRecord);
  }

  async create(input: CreateLearningSpaceInput): Promise<LearningSpaceRecord> {
    const entity = Object.assign(new LearningSpaceEntity(), {
      user: input.userId,
      id: input.id,
      name: input.name,
      normalizedName: input.normalizedName,
      purpose: input.purpose,
      sortIndex: input.sortIndex,
      revision: input.revision,
    });
    this.em.persist(entity);
    await this.em.flush();
    return toRecord(entity);
  }

  async update(
    userId: string,
    id: string,
    patch: UpdateLearningSpaceInput,
  ): Promise<LearningSpaceRecord | null> {
    const entity = await this.em.findOne(LearningSpaceEntity, {
      user: this.em.getReference(UserEntity, userId),
      id,
    });
    if (!entity) return null;
    Object.assign(entity, patch);
    await this.em.flush();
    return toRecord(entity);
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const deleted = await this.em.nativeDelete(LearningSpaceEntity, {
      user: this.em.getReference(UserEntity, userId),
      id,
    });
    return deleted > 0;
  }
}
