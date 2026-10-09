export const GENERATION_RUN_HEARTBEAT_MS = 5_000;
export const GENERATION_RUN_STALE_MS = 20_000;
export const GENERATION_RUN_INTERRUPTED_CODE = "GENERATION_INTERRUPTED";

export function generationRunLeaseCutoff(now = Date.now()): Date {
  return new Date(now - GENERATION_RUN_STALE_MS);
}

export function isGenerationRunLeaseStale(
  updatedAt: Date | string,
  now = Date.now(),
): boolean {
  const timestamp =
    updatedAt instanceof Date ? updatedAt.getTime() : Date.parse(updatedAt);
  return (
    !Number.isFinite(timestamp) || timestamp < now - GENERATION_RUN_STALE_MS
  );
}

/**
 * Keep a persisted generation run lease alive while its in-memory work exists.
 * Heartbeat failures are deliberately non-fatal; the generation path will
 * surface its own database error, while another process can eventually expire
 * the abandoned lease.
 */
export function startGenerationRunHeartbeat(
  touch: () => Promise<unknown>,
): () => Promise<void> {
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  const heartbeat = () => {
    if (stopped || inFlight) return;
    inFlight = touch()
      .then(() => undefined)
      .catch((error) => {
        console.warn(
          "[generation] failed to renew run lease:",
          error instanceof Error ? error.message : error,
        );
      })
      .finally(() => {
        inFlight = null;
      });
  };

  const timer = setInterval(heartbeat, GENERATION_RUN_HEARTBEAT_MS);
  timer.unref?.();

  return async () => {
    stopped = true;
    clearInterval(timer);
    await inFlight;
  };
}
