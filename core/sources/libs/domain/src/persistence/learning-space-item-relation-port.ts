export type LearningSpaceItemRelationType =
  "prerequisite" | "supports" | "follow_up" | "related";

export type LearningSpaceItemRelationRecord = Readonly<{
  id: string;
  spaceId: string;
  fromItemId: string;
  toItemId: string;
  relationType: LearningSpaceItemRelationType;
  source: string;
  createdAt: Date;
}>;

export type CreateLearningSpaceItemRelationInput = Readonly<{
  userId: string;
  id: string;
  spaceId: string;
  fromItemId: string;
  toItemId: string;
  relationType: LearningSpaceItemRelationType;
  source?: string;
}>;

/** Capability-specific persistence for directed roadmap relationships. */
export interface LearningSpaceItemRelationRepository {
  listBySpaceId(
    userId: string,
    spaceId: string,
  ): Promise<readonly LearningSpaceItemRelationRecord[]>;
  findById(
    userId: string,
    relationId: string,
  ): Promise<LearningSpaceItemRelationRecord | null>;
  create(
    input: CreateLearningSpaceItemRelationInput,
  ): Promise<LearningSpaceItemRelationRecord | null>;
  delete(userId: string, relationId: string): Promise<boolean>;
  deleteByItemIds(userId: string, itemIds: readonly string[]): Promise<number>;
}
