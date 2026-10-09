import { z } from "zod";

export const hybridLogicalClockSchema = z.object({
  wallTimeMs: z.number().int().nonnegative(),
  counter: z.number().int().nonnegative(),
  deviceId: z.string().uuid(),
});
export type HybridLogicalClock = z.infer<typeof hybridLogicalClockSchema>;

export function compareHybridLogicalClock(
  left: HybridLogicalClock,
  right: HybridLogicalClock,
): number {
  if (left.wallTimeMs !== right.wallTimeMs)
    return left.wallTimeMs - right.wallTimeMs;
  if (left.counter !== right.counter) return left.counter - right.counter;
  return left.deviceId.localeCompare(right.deviceId);
}

export function tickHybridLogicalClock(input: {
  deviceId: string;
  previous?: HybridLogicalClock | null;
  received?: HybridLogicalClock | null;
  nowMs?: number;
}): HybridLogicalClock {
  const now = Math.max(0, Math.trunc(input.nowMs ?? Date.now()));
  const previous = input.previous ?? null;
  const received = input.received ?? null;
  const wallTimeMs = Math.max(
    now,
    previous?.wallTimeMs ?? 0,
    received?.wallTimeMs ?? 0,
  );
  const previousCounter =
    previous?.wallTimeMs === wallTimeMs ? previous.counter : -1;
  const receivedCounter =
    received?.wallTimeMs === wallTimeMs ? received.counter : -1;
  return {
    wallTimeMs,
    counter: Math.max(previousCounter, receivedCounter) + 1,
    deviceId: input.deviceId,
  };
}

