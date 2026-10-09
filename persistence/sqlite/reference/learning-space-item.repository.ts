import type { EntityManager } from "@mikro-orm/core";
import type {
  CreateLearningSpaceGoalItemInput,
  CreateLearningSpacePlannedGoalItemInput,
  LearningSpaceGoalItemRecord,
  LearningSpaceItemRecord,
  LearningSpaceItemRepository,
  LearningSpacePlannedGoalItemRecord,
  UpdateLearningSpacePlannedGoalItemInput,
} from "@xue-learn/core/domain";
import { LearningGoalEntity } from "./learning-goal.entity.ts";
import { LearningSpaceEntity } from "./learning-space.entity.ts";
import { LearningSpaceItemEntity } from "./learning-space-item.entity.ts";
import { UserEntity } from "./user.entity.ts";
import { parsePlannedGoalBrief } from "@xue-learn/core/server/learning-spaces/planned-goal-brief";

type EntityReference = { readonly id: string } | string | null | undefined;

function referenceId(reference: EntityReference, field: string): string {
  if (typeof reference === "string") return reference;
  if (reference && typeof reference.id === "string") return reference.id;
  throw new Error(`LearningSpaceItemEntity.${field} is missing its id.`);
}

function toRecord(entity: LearningSpaceItemEntity): LearningSpaceItemRecord {
  const goalId =
    entity.goal === null || entity.goal === undefined
      ? null
      : referenceId(entity.goal, "goal");
  const base = {
    id: entity.id,
    spaceId: referenceId(entity.space, "space"),
    plannedTitle: entity.plannedTitle,
    rationale: entity.rationale,
    suggestedGoalKind: entity.suggestedGoalKind === "micro" ? "micro" : "full",
    goalBrief:
      entity.itemType === "planned_goal"
        ? parsePlannedGoalBrief(entity.goalBriefJson)
        : null,
    source: entity.source,
    sortIndex: entity.sortIndex,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  } as const;

  if (entity.itemType === "goal") {
    if (!goalId) {
      throw new Error(
        "LearningSpaceItemEntity violates the real-goal item shape.",
      );
    }
    return { ...base, itemType: "goal", goalId };
  }

  if (entity.itemType === "planned_goal") {
    if (goalId !== null || !entity.plannedTitle.trim()) {
      throw new Error(
        "LearningSpaceItemEntity violates the planned-goal item shape.",
      );
    }
    return { ...base, itemType: "planned_goal", goalId: null };
  }

  throw new Error(
    `LearningSpaceItemEntity has unsupported itemType: ${entity.itemType}`,
  );
}

function isGoalItem(
  record: LearningSpaceItemRecord,
): record is LearningSpaceGoalItemRecord {
  return record.itemType === "goal";
}

function isPlannedGoalItem(
  record: LearningSpaceItemRecord,
): record is LearningSpacePlannedGoalItemRecord {
  return record.itemType === "planned_goal";
}

export class MikroOrmLearningSpaceItemRepository implements LearningSpaceItemRepository {
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

  private ownedItemWhere(userId: string, itemId: string) {
    return {
      id: itemId,
      space: { user: this.userReference(userId) },
    };
  }

  private async ownedSpaceForItem(
    userId: string,
    entity: LearningSpaceItemEntity,
  ) {
    return this.em.findOne(
      LearningSpaceEntity,
      this.ownedSpaceWhere(userId, referenceId(entity.space, "space")),
    );
  }

  async listBySpaceId(
    userId: string,
    spaceId: string,
  ): Promise<readonly LearningSpaceItemRecord[]> {
    // Goal deletion restores placeholders with raw SQL. Refresh the whole row
    // so a retained identity map cannot combine its new type with an old goal.
    const entities = await this.em.find(
      LearningSpaceItemEntity,
      { space: this.ownedSpaceWhere(userId, spaceId) },
      { orderBy: { sortIndex: "asc", createdAt: "asc" }, refresh: true },
    );
    return entities.map(toRecord);
  }

  async findById(
    userId: string,
    itemId: string,
  ): Promise<LearningSpaceItemRecord | null> {
    const entity = await this.em.findOne(
      LearningSpaceItemEntity,
      this.ownedItemWhere(userId, itemId),
      { refresh: true },
    );
    return entity ? toRecord(entity) : null;
  }

  async findByGoalId(
    userId: string,
    goalId: string,
  ): Promise<LearningSpaceGoalItemRecord | null> {
    const entity = await this.em.findOne(
      LearningSpaceItemEntity,
      {
        goal: goalId,
        itemType: "goal",
        space: { user: this.userReference(userId) },
      },
      { refresh: true },
    );
    if (!entity) return null;
    const record = toRecord(entity);
    if (!isGoalItem(record)) {
      throw new Error(
        "LearningSpaceItemEntity returned a non-goal item for a goal lookup.",
      );
    }
    return record;
  }

  async createGoalItem(
    input: CreateLearningSpaceGoalItemInput,
  ): Promise<LearningSpaceGoalItemRecord | null> {
    const user = this.userReference(input.userId);
    const [space, goal] = await Promise.all([
      this.em.findOne(LearningSpaceEntity, {
        id: input.spaceId,
        user,
      }),
      this.em.findOne(LearningGoalEntity, {
        id: input.goalId,
        user,
      }),
    ]);
    if (!space || !goal) return null;

    const entity = Object.assign(new LearningSpaceItemEntity(), {
      space: input.spaceId,
      goal: input.goalId,
      id: input.id,
      itemType: "goal",
      source: input.source ?? "manual",
      sortIndex: input.sortIndex ?? 0,
    });
    this.em.persist(entity);
    space.revision += 1;
    await this.em.flush();
    const record = toRecord(entity);
    if (!isGoalItem(record)) {
      throw new Error("Created LearningSpaceItem is not a real-goal item.");
    }
    return record;
  }

  async createPlannedGoalItem(
    input: CreateLearningSpacePlannedGoalItemInput,
  ): Promise<LearningSpacePlannedGoalItemRecord | null> {
    const space = await this.em.findOne(
      LearningSpaceEntity,
      this.ownedSpaceWhere(input.userId, input.spaceId),
    );
    if (!space) return null;

    const entity = Object.assign(new LearningSpaceItemEntity(), {
      space: input.spaceId,
      goal: null,
      id: input.id,
      itemType: "planned_goal",
      plannedTitle: input.plannedTitle,
      rationale: input.rationale ?? "",
      suggestedGoalKind: input.suggestedGoalKind ?? "full",
      goalBriefJson: input.goalBrief ? JSON.stringify(input.goalBrief) : "{}",
      source: input.source ?? "manual",
      sortIndex: input.sortIndex ?? 0,
    });
    this.em.persist(entity);
    space.revision += 1;
    await this.em.flush();
    const record = toRecord(entity);
    if (!isPlannedGoalItem(record)) {
      throw new Error("Created LearningSpaceItem is not a planned-goal item.");
    }
    return record;
  }

  async updatePlannedGoalItem(
    userId: string,
    itemId: string,
    patch: UpdateLearningSpacePlannedGoalItemInput,
  ): Promise<LearningSpacePlannedGoalItemRecord | null> {
    const entity = await this.em.findOne(LearningSpaceItemEntity, {
      ...this.ownedItemWhere(userId, itemId),
      itemType: "planned_goal",
    });
    if (!entity) return null;
    const space = await this.ownedSpaceForItem(userId, entity);
    if (!space) return null;
    const { goalBrief, ...scalarPatch } = patch;
    Object.assign(entity, scalarPatch);
    if (goalBrief !== undefined) {
      entity.goalBriefJson = goalBrief ? JSON.stringify(goalBrief) : "{}";
    }
    space.revision += 1;
    await this.em.flush();
    const record = toRecord(entity);
    if (!isPlannedGoalItem(record)) {
      throw new Error("Updated LearningSpaceItem is not a planned-goal item.");
    }
    return record;
  }

  async activatePlannedGoalItem(
    userId: string,
    itemId: string,
    goalId: string,
    source?: string,
  ): Promise<LearningSpaceGoalItemRecord | null> {
    const user = this.userReference(userId);
    const [entity, goal] = await Promise.all([
      this.em.findOne(LearningSpaceItemEntity, {
        ...this.ownedItemWhere(userId, itemId),
        itemType: "planned_goal",
      }),
      this.em.findOne(LearningGoalEntity, { id: goalId, user }),
    ]);
    if (!entity || !goal) return null;
    const space = await this.ownedSpaceForItem(userId, entity);
    if (!space) return null;

    entity.itemType = "goal";
    entity.goal = goalId;
    if (source !== undefined) entity.source = source;
    space.revision += 1;
    await this.em.flush();
    const record = toRecord(entity);
    if (!isGoalItem(record)) {
      throw new Error("Activated LearningSpaceItem is not a real-goal item.");
    }
    return record;
  }

  async delete(userId: string, itemId: string): Promise<boolean> {
    const entity = await this.em.findOne(
      LearningSpaceItemEntity,
      this.ownedItemWhere(userId, itemId),
    );
    if (!entity) return false;
    const space = await this.ownedSpaceForItem(userId, entity);
    if (!space) return false;
    this.em.remove(entity);
    space.revision += 1;
    await this.em.flush();
    return true;
  }

  async reorder(
    userId: string,
    spaceId: string,
    orderedItemIds: readonly string[],
  ): Promise<boolean> {
    const space = await this.em.findOne(
      LearningSpaceEntity,
      this.ownedSpaceWhere(userId, spaceId),
    );
    if (!space) return false;
    const entities = await this.em.find(
      LearningSpaceItemEntity,
      { space: this.ownedSpaceWhere(userId, spaceId) },
      { orderBy: { sortIndex: "asc", createdAt: "asc" } },
    );
    const ownedIds = new Set(entities.map((entity) => entity.id));
    if (
      orderedItemIds.length !== ownedIds.size ||
      new Set(orderedItemIds).size !== ownedIds.size ||
      orderedItemIds.some((id) => !ownedIds.has(id))
    ) {
      return false;
    }

    const entityById = new Map(entities.map((entity) => [entity.id, entity]));
    for (const [sortIndex, itemId] of orderedItemIds.entries()) {
      entityById.get(itemId)!.sortIndex = sortIndex;
    }
    space.revision += 1;
    await this.em.flush();
    return true;
  }
}
