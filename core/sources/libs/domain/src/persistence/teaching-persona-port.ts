export type TeachingPersonaRecord = Readonly<{
  id: string;
  userId: string;
  name: string;
  avatarCode: string;
  tagline: string;
  learnerAddress: string;
  instructionsJson: string;
  createdAt: Date;
  updatedAt: Date;
}>;

export type CreateTeachingPersonaInput = Readonly<
  Omit<TeachingPersonaRecord, "createdAt" | "updatedAt">
>;

export type UpdateTeachingPersonaInput = Readonly<
  Partial<
    Pick<
      TeachingPersonaRecord,
      "name" | "avatarCode" | "tagline" | "learnerAddress" | "instructionsJson"
    >
  >
>;

/** Capability-specific persistence for learner-authored teaching personas. */
export interface TeachingPersonaRepository {
  listByUserId(userId: string): Promise<readonly TeachingPersonaRecord[]>;
  create(input: CreateTeachingPersonaInput): Promise<TeachingPersonaRecord>;
  update(
    userId: string,
    id: string,
    patch: UpdateTeachingPersonaInput,
  ): Promise<TeachingPersonaRecord | null>;
  deleteAndClearReferences(
    userId: string,
    id: string,
    defaultPersonaRef: string,
  ): Promise<boolean>;
}
