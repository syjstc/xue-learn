import { z } from "zod";

export const PERSONAL_SYNC_FORMAT_VERSION = 1 as const;
export const PERSONAL_SYNC_ACTIVE_POLL_MS = 5_000 as const;
export const PERSONAL_SYNC_IDLE_POLL_MS = 30_000 as const;
export const PERSONAL_SYNC_UPLOAD_DEBOUNCE_MS = 1_000 as const;
export const PERSONAL_SYNC_LEASE_HEARTBEAT_MS = 10_000 as const;
export const PERSONAL_SYNC_LEASE_TTL_MS = 45_000 as const;
export const PERSONAL_SYNC_LEASE_TAKEOVER_MS = 60_000 as const;

export const workspaceIdSchema = z.string().uuid();
export const syncDeviceIdSchema = z.string().uuid();

export const workspaceSummarySchema = z.object({
  workspaceId: workspaceIdSchema,
  name: z.string().min(1).max(120),
  active: z.boolean(),
  cloudSyncEnabled: z.boolean(),
  syncTransport: z.enum(["folder", "cloudkit"]).nullable().optional(),
  syncFolderPath: z.string().min(1).nullable().optional(),
  locked: z.boolean(),
  createdAt: z.string().datetime(),
  lastOpenedAt: z.string().datetime(),
});
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;

export const personalSyncStateSchema = z.enum([
  "disabled",
  "synced",
  "syncing",
  "offline",
  "authentication_required",
  "locked",
  "read_only",
  "conflict",
  "error",
]);
export type PersonalSyncState = z.infer<typeof personalSyncStateSchema>;

export const personalSyncStatusSchema = z.object({
  formatVersion: z.literal(PERSONAL_SYNC_FORMAT_VERSION),
  workspaceId: workspaceIdSchema,
  state: personalSyncStateSchema,
  pendingUploadCount: z.number().int().nonnegative(),
  pendingDownloadCount: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  lastSuccessfulSyncAt: z.string().datetime().nullable(),
  lastAttemptAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
});
export type PersonalSyncStatus = z.infer<typeof personalSyncStatusSchema>;

export const personalSyncProgressSchema = z.object({
  running: z.boolean(),
  phase: z.enum(["idle", "preparing", "uploading", "receiving", "finalizing"]),
  completedItems: z.number().int().nonnegative(),
  totalItems: z.number().int().nonnegative().nullable(),
});
export type PersonalSyncProgress = z.infer<typeof personalSyncProgressSchema>;

export const syncLeaseScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("workspace") }),
  z.object({ kind: z.literal("goal"), goalId: z.string().min(1) }),
]);
export type SyncLeaseScope = z.infer<typeof syncLeaseScopeSchema>;

export const goalLeaseStateSchema = z.object({
  scope: syncLeaseScopeSchema,
  holderDeviceId: syncDeviceIdSchema.nullable(),
  holderDisplayName: z.string().min(1).nullable(),
  fencingEpoch: z.number().int().nonnegative(),
  heartbeatAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  ownedByThisDevice: z.boolean(),
  takeoverAllowedAt: z.string().datetime().nullable(),
});
export type GoalLeaseState = z.infer<typeof goalLeaseStateSchema>;

export const syncConflictKindSchema = z.enum([
  "immutable_id_collision",
  "concurrent_note_edit",
  "stale_lease_commit",
  "schema_incompatible",
  "corrupt_payload",
  "missing_dependency",
]);
export type SyncConflictKind = z.infer<typeof syncConflictKindSchema>;

export const syncConflictSchema = z.object({
  conflictId: z.string().uuid(),
  workspaceId: workspaceIdSchema,
  kind: syncConflictKindSchema,
  scope: syncLeaseScopeSchema.nullable(),
  entityType: z.string().min(1).nullable(),
  entityId: z.string().min(1).nullable(),
  localCommitId: z.string().uuid().nullable(),
  remoteCommitId: z.string().uuid().nullable(),
  detectedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  summary: z.string().min(1),
});
export type SyncConflict = z.infer<typeof syncConflictSchema>;

export const syncDeviceSchema = z.object({
  deviceId: syncDeviceIdSchema,
  displayName: z.string().min(1).max(120),
  appVersion: z.string().min(1),
  lastSeenAt: z.string().datetime(),
  inactive: z.boolean(),
  thisDevice: z.boolean(),
});
export type SyncDevice = z.infer<typeof syncDeviceSchema>;

export const workspaceCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type WorkspaceCreateInput = z.infer<typeof workspaceCreateInputSchema>;

export const workspaceSwitchInputSchema = z.object({
  workspaceId: workspaceIdSchema,
});
export type WorkspaceSwitchInput = z.infer<typeof workspaceSwitchInputSchema>;

export const syncWorkspaceDirectorySchema = z.object({
  workspaceId: workspaceIdSchema,
  formatVersion: z.literal(PERSONAL_SYNC_FORMAT_VERSION),
  createdAt: z.string().datetime(),
});
export type SyncWorkspaceDirectory = z.infer<
  typeof syncWorkspaceDirectorySchema
>;
/** @deprecated Use SyncWorkspaceDirectory. */
export const cloudWorkspaceDirectorySchema = syncWorkspaceDirectorySchema;
/** @deprecated Use SyncWorkspaceDirectory. */
export type CloudWorkspaceDirectory = SyncWorkspaceDirectory;

export const personalSyncFolderInputSchema = z.object({
  folderPath: z.string().trim().min(1).max(4_096),
});
export type PersonalSyncFolderInput = z.infer<
  typeof personalSyncFolderInputSchema
>;

export const workspaceJoinInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  folderPath: personalSyncFolderInputSchema.shape.folderPath,
  passphrase: z.string().refine((value) => [...value].length >= 12, {
    message: "Sync passphrase must contain at least 12 Unicode characters",
  }),
});
export type WorkspaceJoinInput = z.infer<typeof workspaceJoinInputSchema>;

const personalSyncPassphraseSchema = z.object({
  passphrase: z.string().refine((value) => [...value].length >= 12, {
    message: "Sync passphrase must contain at least 12 Unicode characters",
  }),
});
export const personalSyncConnectInputSchema =
  personalSyncPassphraseSchema.extend({
    folderPath: personalSyncFolderInputSchema.shape.folderPath,
  });
export type PersonalSyncConnectInput = z.infer<
  typeof personalSyncConnectInputSchema
>;

export const personalSyncUnlockInputSchema = personalSyncPassphraseSchema;
export type PersonalSyncUnlockInput = z.infer<
  typeof personalSyncUnlockInputSchema
>;

export const personalSyncPassphraseChangeSchema = z.object({
  currentPassphrase: personalSyncConnectInputSchema.shape.passphrase,
  nextPassphrase: personalSyncConnectInputSchema.shape.passphrase,
});
export type PersonalSyncPassphraseChange = z.infer<
  typeof personalSyncPassphraseChangeSchema
>;

export const syncLeaseActionSchema = z.object({
  scope: syncLeaseScopeSchema,
  action: z.enum([
    "acquire",
    "renew",
    "release",
    "request_transfer",
    "takeover",
  ]),
});
export type SyncLeaseAction = z.infer<typeof syncLeaseActionSchema>;

export function assertCanChangeSyncLease(input: {
  action: SyncLeaseAction["action"];
  deviceId: string;
  holderDeviceId: string;
  heartbeatAtMs: number;
  expiresAtMs: number;
  nowMs: number;
}): void {
  const holder = input.holderDeviceId;
  const live = Boolean(
    holder && Number.isFinite(input.expiresAtMs) && input.expiresAtMs > input.nowMs,
  );
  if (input.action === "renew" && holder !== input.deviceId) {
    throw new Error("This device does not own the sync lease");
  }
  if (input.action === "release" && holder !== input.deviceId) {
    throw new Error("Only the lease holder can release it");
  }
  if (input.action === "acquire" && holder && holder !== input.deviceId && live) {
    throw new Error("This area is being edited on another device");
  }
  if (
    input.action === "takeover" &&
    holder !== input.deviceId &&
    (!Number.isFinite(input.heartbeatAtMs) ||
      input.nowMs - input.heartbeatAtMs < PERSONAL_SYNC_LEASE_TAKEOVER_MS)
  ) {
    throw new Error("The other device's lease is not old enough to take over");
  }
}
