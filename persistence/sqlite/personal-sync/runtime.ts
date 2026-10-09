import type { EntityManager } from "@mikro-orm/core";
import { setPersonalSyncCaptureEnabled } from "./capture.ts";

export type LocalPersonalSyncRuntime = Readonly<{
  workspaceId: string;
  syncEnabled: boolean;
  workspaceKey: Buffer | null;
  em: EntityManager;
}>;

let runtime: LocalPersonalSyncRuntime | null = null;

export function configureLocalPersonalSyncRuntime(
  value: LocalPersonalSyncRuntime,
): void {
  runtime = value;
}

export function getLocalPersonalSyncRuntime(): LocalPersonalSyncRuntime {
  if (!runtime)
    throw new Error("Local personal sync runtime is not initialized");
  return runtime;
}

export function disableLocalPersonalSyncRuntime(): void {
  const current = getLocalPersonalSyncRuntime();
  setPersonalSyncCaptureEnabled(false);
  runtime = {
    ...current,
    syncEnabled: false,
    workspaceKey: null,
  };
}
