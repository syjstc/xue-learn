export const MODULE_STRUCTURE_DRAFT_STAGES = [
  "queued",
  "researching",
  "authoring",
  "validating",
  "ready_for_audit",
  "repairing",
  "publishing",
  "ready",
  "failed",
] as const;

export type ModuleStructureDraftStage =
  (typeof MODULE_STRUCTURE_DRAFT_STAGES)[number];

export type ModuleStructureDraftRecord = Readonly<{
  moduleId: string;
  sessionId: string;
  goalId: string;
  planHash: string;
  candidateJson: string;
  candidateHash: string;
  status: ModuleStructureDraftStage;
  attemptCount: number;
  issuesJson: string;
  leaseToken: string | null;
  leaseUntil: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type UpsertModuleStructureDraftInput = Readonly<{
  moduleId: string;
  sessionId: string;
  goalId: string;
  planHash: string;
  status?: ModuleStructureDraftStage;
}>;

export type ClaimModuleStructureDraftInput = Readonly<{
  moduleId: string;
  token: string;
  now: Date;
  leaseMs: number;
  stopRequested?: boolean;
}>;

export type PatchModuleStructureDraftInput = Readonly<{
  moduleId: string;
  expectedToken?: string | null;
  status?: ModuleStructureDraftStage;
  candidateJson?: string;
  candidateHash?: string;
  issuesJson?: string;
  attemptCount?: number;
  publishedAt?: Date | null;
  clearLease?: boolean;
}>;

export type ModuleStructureDraftProgress = Readonly<{
  preparedModuleCount: number;
  publishedModuleCount: number;
  failedModuleCount: number;
  modules: ReadonlyArray<{
    id: string;
    status: ModuleStructureDraftStage;
    attemptCount: number;
    issues: readonly string[];
  }>;
}>;

/** Atomically publish an audited path revision with its bound module briefs. */
export type CommitModulePathRepairsInput = Readonly<{
  goalId: string;
  sessionId: string;
  expectedMapPlanJson: string;
  mapPlanJson: string;
  modules: readonly Readonly<{
    moduleId: string;
    expectedCandidateHash: string;
    metadata?: Readonly<{ title: string; summary: string; objective: string }>;
    plannedOutcomesJson: string;
    exitCapabilityBriefsJson: string;
    estimatedUnitCount: number;
    unitPlanningBriefJson: string;
  }>[];
}>;

/** Durable unpublished module-structure candidates for agentic goal creation. */
export interface ModuleStructureDraftRepository {
  /** Older hosts can still materialize paths, but cannot publish an unsaved revision. */
  commitPathRepairs?(input: CommitModulePathRepairsInput): Promise<boolean>;
  upsertMany(
    inputs: readonly UpsertModuleStructureDraftInput[],
  ): Promise<void>;
  claim(
    input: ClaimModuleStructureDraftInput,
  ): Promise<ModuleStructureDraftRecord | null>;
  patch(input: PatchModuleStructureDraftInput): Promise<boolean>;
  listByGoal(goalId: string): Promise<readonly ModuleStructureDraftRecord[]>;
  listModuleIdsForGoal(goalId: string): Promise<readonly string[]>;
  listBySession(
    sessionId: string,
  ): Promise<readonly ModuleStructureDraftRecord[]>;
  progressForGoal(goalId: string): Promise<ModuleStructureDraftProgress>;
  deleteBySession(sessionId: string): Promise<number>;
  recoverStaleLeases(now: Date): Promise<number>;
  listGoalSessionsWithStatuses(
    statuses: readonly ModuleStructureDraftStage[],
  ): Promise<ReadonlyArray<{ goalId: string; sessionId: string }>>;
  enqueuePrepareEvents(input: {
    goalId: string;
    sessionId: string;
    moduleIds: readonly string[];
    reason: string;
  }): Promise<number>;
  enqueueAuditEvent(input: {
    goalId: string;
    sessionId: string;
  }): Promise<void>;
  enqueueCoordinateEvent(input: {
    goalId: string;
    sessionId: string;
    reason: string;
    idempotencyKey?: string;
  }): Promise<void>;
  requeueFailedWork(input: {
    goalId: string;
    sessionId: string;
  }): Promise<{ draftCount: number; auditEnqueued: boolean }>;
}
