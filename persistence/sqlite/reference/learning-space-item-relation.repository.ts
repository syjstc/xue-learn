import type { EntityManager } from "@mikro-orm/core";
import type {
  CreateLearningSpaceItemRelationInput,
  LearningSpaceItemRelationRecord,
  LearningSpaceItemRelationRepository,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import { LearningSpaceEntity } from "./learning-space.entity.ts";
import { LearningSpaceItemEntity } from "./learning-space-item.entity.ts";
import { LearningSpaceItemRelationEntity } from "./learning-space-item-relation.entity.ts";
import { UserEntity } from "./user.entity.ts";

const RELATION_TYPES = new Set([
  "prerequisite",
  "supports",
  "follow_up",
  "related",
]);

type EntityReference = { readonly id: string } | string | null | undefined;

function referenceId(reference: EntityReference, field: string): string {
  if (typeof reference === "string") return reference;
  if (reference && typeof reference.id === "string") return reference.id;
  throw new Error(
    `LearningSpaceItemRelationEntity.${field} is missing its id.`,
  );
}

function toRecord(
  entity: LearningSpaceItemRelationEntity,
): LearningSpaceItemRelationRecord {
  if (!RELATION_TYPES.has(entity.relationType)) {
    throw new Error(
      `LearningSpaceItemRelationEntity has unsupported relationType: ${entity.relationType}`,
    );
  }
  return {
    id: entity.id,
    spaceId: referenceId(entity.space, "space"),
    fromItemId: referenceId(entity.fromItem, "fromItem"),
    toItemId: referenceId(entity.toItem, "toItem"),
    relationType:
      entity.relationType as LearningSpaceItemRelationRecord["relationType"],
    source: entity.source,
    createdAt: entity.createdAt,
  };
}

export class MikroOrmLearningSpaceItemRelationRepository implements LearningSpaceItemRelationRepository {
  constructor(private readonly em: EntityManager) {}

  private userReference(userId: string) {
    return this.em.getReference(UserEntity, userId);
  }

  private ownedSpaceWhere(userId: string, spaceId: string) {
    return {
      id: spaceId,
      user: this.userReference(userId),
    };
  }

  private ownedRelationWhere(userId: string, relationId: string) {
    return {
      id: relationId,
      space: { user: this.userReference(userId) },
    };
  }

  private async ownedSpaceForRelation(
    userId: string,
    entity: LearningSpaceItemRelationEntity,
  ) {
    return this.em.findOne(
      LearningSpaceEntity,
      this.ownedSpaceWhere(userId, referenceId(entity.space, "space")),
    );
  }

  async listBySpaceId(
    userId: string,
    spaceId: string,
  ): Promise<readonly LearningSpaceItemRelationRecord[]> {
    const entities = await this.em.find(
      LearningSpaceItemRelationEntity,
      { space: this.ownedSpaceWhere(userId, spaceId) },
      { orderBy: { createdAt: "asc" } },
    );
    return entities.map(toRecord);
  }

  async findById(
    userId: string,
    relationId: string,
  ): Promise<LearningSpaceItemRelationRecord | null> {
    const entity = await this.em.findOne(
      LearningSpaceItemRelationEntity,
      this.ownedRelationWhere(userId, relationId),
    );
    return entity ? toRecord(entity) : null;
  }

  async create(
    input: CreateLearningSpaceItemRelationInput,
  ): Promise<LearningSpaceItemRelationRecord | null> {
    if (
      input.fromItemId === input.toItemId ||
      !RELATION_TYPES.has(input.relationType)
    ) {
      return null;
    }

    const user = this.userReference(input.userId);
    const [space, items] = await Promise.all([
      this.em.findOne(LearningSpaceEntity, {
        id: input.spaceId,
        user,
      }),
      this.em.find(LearningSpaceItemEntity, {
        id: { $in: [input.fromItemId, input.toItemId] },
        space: { id: input.spaceId, user },
      }),
    ]);
    if (!space || items.length !== 2) return null;

    const entity = Object.assign(new LearningSpaceItemRelationEntity(), {
      space: input.spaceId,
      fromItem: input.fromItemId,
      toItem: input.toItemId,
      id: input.id,
      relationType: input.relationType,
      source: input.source ?? "manual",
    });
    this.em.persist(entity);
    space.revision += 1;
    await this.em.flush();
    return toRecord(entity);
  }

  async delete(userId: string, relationId: string): Promise<boolean> {
    const entity = await this.em.findOne(
      LearningSpaceItemRelationEntity,
      this.ownedRelationWhere(userId, relationId),
    );
    if (!entity) return false;
    const space = await this.ownedSpaceForRelation(userId, entity);
    if (!space) return false;
    this.em.remove(entity);
    space.revision += 1;
    await this.em.flush();
    return true;
  }

  async deleteByItemIds(
    userId: string,
    itemIds: readonly string[],
  ): Promise<number> {
    const uniqueItemIds = [...new Set(itemIds)];
    if (uniqueItemIds.length === 0) return 0;

    const ownedItems = await this.em.find(LearningSpaceItemEntity, {
      id: { $in: uniqueItemIds },
      space: { user: this.userReference(userId) },
    });
    const ownedIds = ownedItems.map((item) => item.id);
    if (ownedIds.length === 0) return 0;

    const relations = await this.em.find(LearningSpaceItemRelationEntity, {
      space: { user: this.userReference(userId) },
      $or: [{ fromItem: { $in: ownedIds } }, { toItem: { $in: ownedIds } }],
    });
    if (relations.length === 0) return 0;

    const spaces = new Map<string, LearningSpaceEntity>();
    for (const relation of relations) {
      const space = await this.ownedSpaceForRelation(userId, relation);
      if (!space) continue;
      spaces.set(space.id, space);
      this.em.remove(relation);
    }
    if (spaces.size === 0) return 0;
    for (const space of spaces.values()) space.revision += 1;
    await this.em.flush();
    return relations.length;
  }
}
