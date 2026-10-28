import {
  PERSONAL_SYNC_LEASE_HEARTBEAT_MS,
  PERSONAL_SYNC_LEASE_TAKEOVER_MS,
  PERSONAL_SYNC_LEASE_TTL_MS,
  type SyncLeaseScope,
} from "../../../runtime-contracts/src/index.js";

export type DurableSyncLease = Readonly<{
  scope: SyncLeaseScope;
  holderDeviceId: string;
  fencingEpoch: number;
  serverModifiedAtMs: number;
  expiresAtMs: number;
  transferRequestedByDeviceId: string | null;
}>;

export const syncLeaseTiming = Object.freeze({
  heartbeatMs: PERSONAL_SYNC_LEASE_HEARTBEAT_MS,
  ttlMs: PERSONAL_SYNC_LEASE_TTL_MS,
  takeoverMs: PERSONAL_SYNC_LEASE_TAKEOVER_MS,
});

export function isSyncLeaseExpired(
  lease: DurableSyncLease,
  serverNowMs: number,
): boolean {
  return serverNowMs >= lease.expiresAtMs;
}

export function canTakeOverSyncLease(
  lease: DurableSyncLease,
  serverNowMs: number,
): boolean {
  return (
    serverNowMs >= lease.expiresAtMs &&
    serverNowMs - lease.serverModifiedAtMs >= syncLeaseTiming.takeoverMs
  );
}

export function acquireSyncLease(input: {
  current: DurableSyncLease | null;
  scope: SyncLeaseScope;
  deviceId: string;
  serverNowMs: number;
  forceTakeover?: boolean;
}): DurableSyncLease {
  const current = input.current;
  if (
    current &&
    current.holderDeviceId !== input.deviceId &&
    !isSyncLeaseExpired(current, input.serverNowMs)
  ) {
    throw new Error("The sync scope is currently edited by another device");
  }
  if (
    current &&
    current.holderDeviceId !== input.deviceId &&
    input.forceTakeover &&
    !canTakeOverSyncLease(current, input.serverNowMs)
  ) {
    throw new Error("The sync lease is not old enough to take over");
  }
  return {
    scope: input.scope,
    holderDeviceId: input.deviceId,
    fencingEpoch:
      current?.holderDeviceId === input.deviceId
        ? current.fencingEpoch
        : (current?.fencingEpoch ?? 0) + 1,
    serverModifiedAtMs: input.serverNowMs,
    expiresAtMs: input.serverNowMs + syncLeaseTiming.ttlMs,
    transferRequestedByDeviceId: null,
  };
}

export function assertSyncLeaseFence(input: {
  lease: DurableSyncLease | null;
  deviceId: string;
  fencingEpoch: number;
  serverNowMs: number;
}): void {
  if (
    !input.lease ||
    input.lease.holderDeviceId !== input.deviceId ||
    input.lease.fencingEpoch !== input.fencingEpoch ||
    isSyncLeaseExpired(input.lease, input.serverNowMs)
  ) {
    throw new Error("The structural sync commit has a stale lease fence");
  }
}

