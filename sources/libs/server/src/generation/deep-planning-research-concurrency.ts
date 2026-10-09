import { randomUUID } from "node:crypto";
import type {
  DeepPlanningResearchConcurrencySnapshot,
  DeepPlanningResearchLeaseContext,
  DeepPlanningResearchRepository,
} from "../../../domain/src/index.js";

export const DEFAULT_DEEP_PLANNING_RESEARCH_CONCURRENCY = 2;
export const MIN_DEEP_PLANNING_RESEARCH_CONCURRENCY = 1;
export const MAX_DEEP_PLANNING_RESEARCH_CONCURRENCY = 4;

const DEFAULT_LEASE_TTL_MS = 90_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
export type {
  DeepPlanningResearchConcurrencySnapshot,
  DeepPlanningResearchLeaseContext,
};

export type DeepPlanningResearchLeaseHandle = {
  id: string;
  renew(): Promise<boolean>;
  release(): Promise<void>;
};

function assertConcurrency(value: number): void {
  if (
    !Number.isInteger(value) ||
    value < MIN_DEEP_PLANNING_RESEARCH_CONCURRENCY ||
    value > MAX_DEEP_PLANNING_RESEARCH_CONCURRENCY
  ) {
    throw new RangeError(
      `deepPlanningResearchConcurrency must be an integer from ${MIN_DEEP_PLANNING_RESEARCH_CONCURRENCY} to ${MAX_DEEP_PLANNING_RESEARCH_CONCURRENCY}`,
    );
  }
}

export async function getDeepPlanningResearchConcurrencySnapshot(
  repository: DeepPlanningResearchRepository,
): Promise<DeepPlanningResearchConcurrencySnapshot> {
  return repository.getSnapshot(new Date());
}

export async function updateDeepPlanningResearchConcurrency(
  repository: DeepPlanningResearchRepository,
  value: number,
  updatedByUserId: string,
): Promise<DeepPlanningResearchConcurrencySnapshot> {
  assertConcurrency(value);
  await repository.updateConcurrency({
    value,
    updatedByUserId,
    now: new Date(),
  });
  return getDeepPlanningResearchConcurrencySnapshot(repository);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function acquireDeepPlanningResearchLease(
  repository: DeepPlanningResearchRepository,
  context: DeepPlanningResearchLeaseContext,
  options: {
    signal?: AbortSignal;
    ttlMs?: number;
    pollIntervalMs?: number;
    onQueued?: (leaseId: string) => void | Promise<void>;
  } = {},
): Promise<DeepPlanningResearchLeaseHandle> {
  const ttlMs = Math.max(10_000, options.ttlMs ?? DEFAULT_LEASE_TTL_MS);
  const pollIntervalMs = Math.max(
    100,
    options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  );
  const leaseId = randomUUID();
  await repository.enqueue({
    id: leaseId,
    ...context,
    now: new Date(),
  });

  let acquired = false;
  try {
    await options.onQueued?.(leaseId);
    while (!acquired) {
      if (options.signal?.aborted) throw options.signal.reason;
      const now = new Date();
      acquired = await repository.tryAcquire({
        id: leaseId,
        now,
        expiresAt: new Date(now.getTime() + ttlMs),
      });
      if (!acquired) await wait(pollIntervalMs, options.signal);
    }
  } catch (error) {
    await repository.cancelQueued(leaseId, new Date());
    throw error;
  }

  return {
    id: leaseId,
    async renew() {
      const now = new Date();
      return repository.renew({
        id: leaseId,
        now,
        expiresAt: new Date(now.getTime() + ttlMs),
      });
    },
    async release() {
      await repository.release(leaseId, new Date());
    },
  };
}

export async function withDeepPlanningResearchLease<T>(
  repository: DeepPlanningResearchRepository,
  context: DeepPlanningResearchLeaseContext,
  work: (lease: DeepPlanningResearchLeaseHandle) => Promise<T>,
  options: Parameters<typeof acquireDeepPlanningResearchLease>[2] = {},
): Promise<T> {
  const lease = await acquireDeepPlanningResearchLease(
    repository,
    context,
    options,
  );
  const ttlMs = Math.max(10_000, options.ttlMs ?? DEFAULT_LEASE_TTL_MS);
  const heartbeat = setInterval(
    () => {
      void lease.renew();
    },
    Math.max(5_000, Math.floor(ttlMs / 3)),
  );
  heartbeat.unref?.();
  try {
    return await work(lease);
  } finally {
    clearInterval(heartbeat);
    await lease.release();
  }
}
