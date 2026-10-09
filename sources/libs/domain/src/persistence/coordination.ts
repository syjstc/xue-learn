/** A lease token used to fence stale workers or serialized local writers. */
export type CoordinationLease = Readonly<{
  key: string;
  owner: string;
  fencingToken: string;
  acquiredAt: number;
  expiresAt: number;
}>;

export type AcquireCoordinationLeaseInput = Readonly<{
  key: string;
  owner: string;
  now: number;
  leaseMs: number;
  waitMs?: number;
  signal?: AbortSignal;
}>;

/**
 * Coordinates work without exposing PostgreSQL advisory-lock or SQLite
 * locking primitives. A null lease means that the caller did not acquire the
 * key before the requested wait window elapsed.
 */
export interface CoordinationPort {
  acquire(
    input: AcquireCoordinationLeaseInput,
  ): Promise<CoordinationLease | null>;
  renew(input: {
    lease: CoordinationLease;
    now: number;
    leaseMs: number;
  }): Promise<CoordinationLease | null>;
  release(lease: CoordinationLease): Promise<boolean>;
}
