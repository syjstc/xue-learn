export type DatabaseHealthStatus = "ok" | "degraded" | "failed";

export type DatabaseHealth = Readonly<{
  status: DatabaseHealthStatus;
  driver: string;
  schemaVersion: string;
  checkedAt: number;
  details?: Readonly<Record<string, unknown>>;
}>;

export type DatabaseMigrationResult = Readonly<{
  applied: readonly string[];
  currentVersion: string;
}>;

export type DatabaseBackupResult = Readonly<{
  location: string;
  bytes?: number;
  createdAt: number;
}>;

export type DatabaseRepairResult = Readonly<{
  repaired: boolean;
  details?: Readonly<Record<string, unknown>>;
}>;

/**
 * Runtime lifecycle operations are intentionally expressed in terms of
 * locations and normalized results. The SQLite adapter can implement backup
 * and repair while a hosted adapter can make those operations no-ops or map
 * them to its operational tooling.
 */
export interface DatabaseLifecyclePort {
  initialize(): Promise<void>;
  migrate(): Promise<DatabaseMigrationResult>;
  health(): Promise<DatabaseHealth>;
  backup(input: {
    location: string;
    now: number;
  }): Promise<DatabaseBackupResult>;
  restore(input: { location: string }): Promise<void>;
  repair(): Promise<DatabaseRepairResult>;
  close(): Promise<void>;
}
