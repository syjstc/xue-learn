/** A build owns one immutable input. Retries retain its checkpoint and source hash. */
export type DisplayBuildStatus = "pending" | "running" | "ready" | "failed" | "cancelled";
export type DisplayBuildRun = Readonly<{
  id: string;
  ownerUserId: string;
  scopeKey: string;
  kind: string;
  componentVersion: number;
  sourceHash: string;
  inputRevision: number;
  input: Readonly<Record<string, unknown>>;
  status: DisplayBuildStatus;
  revision: number;
  attempt: number;
  checkpoint?: unknown;
  artifact?: unknown;
  error?: string;
  leaseToken?: string;
  leaseUntil?: number;
  createdAt: number;
  updatedAt: number;
}>;

/** Atomic compare-and-swap is required across all workers sharing this store. */
export interface DisplayBuildRepository {
  get(id: string): Promise<DisplayBuildRun | null>;
  list(): Promise<readonly DisplayBuildRun[]>;
  create(run: DisplayBuildRun): Promise<DisplayBuildRun>;
  replace(run: DisplayBuildRun, expectedRevision: number): Promise<boolean>;
}
