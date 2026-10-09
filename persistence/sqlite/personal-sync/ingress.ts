import type { PersonalSyncLeaseTarget } from "@xue-learn/core/source/libs/runtime-contracts/src/index.ts";
import { getLocalPersonalSyncRuntime } from "./runtime.ts";
import { personalSyncTimestampIso } from "./timestamp.ts";

export async function isPersonalSyncRuntimeReadOnly(): Promise<boolean> {
  const runtime = getLocalPersonalSyncRuntime();
  if (!runtime.syncEnabled) return false;
  const result = await runtime.em.getConnection().execute(
    `SELECT "readOnlyReason" FROM "PersonalSyncState" WHERE "id" = 'primary' LIMIT 1`,
  ) as Array<{ readOnlyReason?: string | null }>;
  return Boolean(result[0]?.readOnlyReason);
}

export async function hasPersonalSyncRuntimeLease(target: PersonalSyncLeaseTarget): Promise<boolean> {
  const runtime = getLocalPersonalSyncRuntime();
  if (!runtime.syncEnabled) return true;
  let scopeKey: string;
  if (target.kind === "workspace") scopeKey = "workspace";
  else if (target.kind === "goal") scopeKey = `goal:${target.goalId}`;
  else {
    const units = await runtime.em.getConnection().execute(
      `SELECT "goalId" FROM "LearningUnit" WHERE "id" = ? LIMIT 1`,
      [target.unitId],
    ) as Array<{ goalId?: string }>;
    if (!units[0]?.goalId) return false;
    scopeKey = `goal:${units[0].goalId}`;
  }
  const leases = await runtime.em.getConnection().execute(
    `SELECT l."holderDeviceId", l."expiresAt", s."deviceId"
     FROM "PersonalSyncLeaseCache" l CROSS JOIN "PersonalSyncState" s
     WHERE l."scopeKey" = ? AND s."id" = 'primary' LIMIT 1`,
    [scopeKey],
  ) as Array<{ holderDeviceId: string; expiresAt: string | Date; deviceId: string }>;
  const lease = leases[0];
  const expiresAt = lease && personalSyncTimestampIso(lease.expiresAt);
  return Boolean(lease && expiresAt && lease.holderDeviceId === lease.deviceId && Date.parse(expiresAt) > Date.now());
}
