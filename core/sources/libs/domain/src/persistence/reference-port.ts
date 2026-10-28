/**
 * Durable learner profile stored by the learner-domain persistence layer.
 *
 * The profile payload intentionally remains an opaque JSON string at this
 * boundary.  Parsing and validating the learner-facing profile is owned by
 * the persona/profile capability; the persistence port only owns durable
 * storage and timestamps.
 */
export type LearnerProfileRecord = Readonly<{
  userId: string;
  profileJson: string;
  updatedAt: Date;
}>;

export type UpsertLearnerProfileInput = Readonly<{
  userId: string;
  profileJson: string;
}>;

/**
 * Capability-specific persistence contract for the LearningProfile row.
 *
 * Implementations may use PostgreSQL, SQLite, or another durable store.  No
 * ORM, driver, transaction client, or database-specific value is exposed to
 * callers.  A surrounding UnitOfWorkPort may be used when this operation is
 * composed with other writes.
 */
export interface LearnerProfileRepository {
  findByUserId(userId: string): Promise<LearnerProfileRecord | null>;
  upsert(input: UpsertLearnerProfileInput): Promise<LearnerProfileRecord>;
}
