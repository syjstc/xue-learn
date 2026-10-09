/** Database-independent transaction isolation names. */
export type TransactionIsolationLevel =
  "read-uncommitted" | "read-committed" | "repeatable-read" | "serializable";

export type TransactionOptions = Readonly<{
  isolationLevel?: TransactionIsolationLevel;
  readOnly?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}>;

/**
 * Metadata for the active unit of work.
 *
 * Repositories may use this value for ownership/fencing metadata, but it
 * deliberately exposes no ORM transaction client or database connection.
 * Throwing from a `UnitOfWorkPort.run` callback is the rollback signal.
 */
export interface UnitOfWork {
  readonly id: string;
  readonly parentId?: string;
  readonly isolationLevel: TransactionIsolationLevel;
  readonly readOnly: boolean;
  readonly startedAt: number;
  readonly signal?: AbortSignal;
}

export interface UnitOfWorkPort {
  run<T>(
    work: (unitOfWork: UnitOfWork) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
}
