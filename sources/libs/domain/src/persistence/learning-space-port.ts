export type LearningSpaceRecord = Readonly<{
  id: string;
  userId: string;
  name: string;
  normalizedName: string;
  purpose: string;
  sortIndex: number;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type CreateLearningSpaceInput = Readonly<
  Omit<LearningSpaceRecord, "createdAt" | "updatedAt">
>;

export type UpdateLearningSpaceInput = Readonly<
  Partial<
    Pick<
      LearningSpaceRecord,
      "name" | "normalizedName" | "purpose" | "sortIndex" | "revision"
    >
  >
>;

/** Capability-specific persistence for the user's roadmap spaces. */
export interface LearningSpaceRepository {
  listByUserId(userId: string): Promise<readonly LearningSpaceRecord[]>;
  create(input: CreateLearningSpaceInput): Promise<LearningSpaceRecord>;
  update(
    userId: string,
    id: string,
    patch: UpdateLearningSpaceInput,
  ): Promise<LearningSpaceRecord | null>;
  delete(userId: string, id: string): Promise<boolean>;
}
