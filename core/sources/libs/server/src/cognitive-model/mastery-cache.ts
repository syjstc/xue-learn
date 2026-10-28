import type { MasterySummary } from "./mastery-summary.js";
export type MasteryCachePort = Readonly<{ read(key: string): Promise<MasterySummary | null>; write(key: string, value: MasterySummary): Promise<void> }>;
let cache: MasteryCachePort | null = null;
/** Hosts may cache deterministic projections; a missing cache always reads authoritative persistence. */
export function configureMasteryCache(value: MasteryCachePort | null): void { cache = value; }
export function masteryCacheKey(input: {
  userId: string;
  scope: "goal" | "module";
  scopeId: string;
  modelVersion: number;
  assessmentPolicyVersion: number;
  inferencePolicyVersion: number;
  evidenceCutoffAt: Date | null;
  lifecycleCutoffAt: Date | null;
}): string {
  return [
    "kacom:mastery",
    input.userId,
    input.scope,
    input.scopeId,
    `m${input.modelVersion}`,
    `a${input.assessmentPolicyVersion}`,
    `i${input.inferencePolicyVersion}`,
    `e${input.evidenceCutoffAt?.toISOString() ?? "none"}`,
    `l${input.lifecycleCutoffAt?.toISOString() ?? "none"}`,
  ].join(":");
}

export async function readMasteryCache(key: string): Promise<MasterySummary | null> {
 try { return await cache?.read(key) ?? null; } catch { return null; }
}
export async function writeMasteryCache(key: string, value: MasterySummary): Promise<void> {
 try { await cache?.write(key, value); } catch { /* Projection reads remain authoritative. */ }
}
