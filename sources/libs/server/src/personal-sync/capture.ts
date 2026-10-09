import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type PersonalSyncCaptureContext = Readonly<{
  commitId: string;
  mode: "capture" | "apply";
}>;

const captureContext = new AsyncLocalStorage<PersonalSyncCaptureContext>();

/** Hosts may observe the current scope while implementing their own capture. */
export function getPersonalSyncCaptureContext(): PersonalSyncCaptureContext | undefined {
  return captureContext.getStore();
}

export function runWithPersonalSyncCapture<T>(
  work: () => T,
  commitId = randomUUID(),
): T {
  return captureContext.run({ commitId, mode: "capture" }, work);
}

export function runWithPersonalSyncApply<T>(work: () => T): T {
  return captureContext.run({ commitId: randomUUID(), mode: "apply" }, work);
}

/** Re-enter the application scope when native callbacks dropped its context. */
export function ensurePersonalSyncCapture<T>(work: () => T): T {
  if (captureContext.getStore()) return work();
  return runWithPersonalSyncCapture(work);
}
