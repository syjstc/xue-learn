import type { LearnerStateMemoryReadRecord } from "./learner-state-memory-read-port.js";

export type LearnerStateMemoryPublication = Readonly<{
  schemaVersion: number;
  sourceSchemaVersion: number;
  inferencePolicyVersion: number;
  sourceFingerprint: string;
  sourceRevisionCutoffAt: Date | null;
  stateJson: unknown;
  refreshedAt: Date;
  nextRefreshAt: Date | null;
}>;

export interface LearnerStateMemoryMaintenanceRepository {
  listGoals(userId: string): Promise<readonly { id: string; title: string }[]>;
  findLatestStateRevisionAt(userId: string): Promise<Date | null>;
  totalActiveSeconds(userId: string): Promise<number>;
  listDueUsers(now: Date, limit: number): Promise<readonly string[]>;
  recordError(userId: string, message: string): Promise<void>;
  runExclusive<T>(
    userId: string,
    operation: (
      existing: LearnerStateMemoryReadRecord | null,
    ) => Promise<
      Readonly<{ result: T; publication?: LearnerStateMemoryPublication }>
    >,
  ): Promise<T>;
}
