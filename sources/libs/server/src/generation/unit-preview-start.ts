import { ConflictException, NotFoundException } from "@nestjs/common";
import { createSseStream, sseResponse } from "../llm/sse.js";
import { runWithUserId } from "../user-context.js";
import { requireGenerationRunPersistence } from "./run-persistence.js";
import { failGenerationRunIfStale } from "./run.js";
import { createRunSubscribeStream } from "./tracked-sse.js";

// The desktop runtime owns one generation service. Serialize the short start
// transaction shared by automatic preview creation and explicit UI regeneration;
// the resulting tracked generation itself continues outside this lane.
const starts = new Map<string, Promise<unknown>>();
export async function serializeUnitPreviewStart<T>(
  input: { userId: string; unitId: string },
  work: () => Promise<T>,
): Promise<T> {
  const key = JSON.stringify([input.userId, input.unitId]);
  const previous = starts.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  starts.set(key, next);
  try { return await next; }
  finally { if (starts.get(key) === next) starts.delete(key); }
}

export type OwnedUnitPreviewState = {
  unitKind?: string;
  sq3rData: string | null;
  contentRevision: number;
  hasMaterial: boolean;
  /** The owning host reports retained preparation that must fence an automatic ensure. */
  hasProtectedPreparation?: boolean;
};

/** onlyIfMissing is an ensure operation, never implicit Survey regeneration. */
export function startUnitPreviewStream(input: {
  userId: string;
  unitId: string;
  onlyIfMissing: boolean;
  loadOwned(): Promise<OwnedUnitPreviewState | null>;
  start(): Promise<Response>;
}): Promise<Response> {
  return serializeUnitPreviewStart(input, () => runWithUserId(input.userId, async () => {
    const owned = await input.loadOwned();
    if (!owned) throw new NotFoundException("Unit not found");
    // Explicit regeneration retains the normal cancel/replace semantics, but
    // enters the same lane as the queue so its start cannot be raced by ensure.
    if (!input.onlyIfMissing) return input.start();
    // Orientation is published directly as course content and intentionally has
    // no Survey. Do not start generation or mistake its accepted body for a
    // damaged lesson. The film endpoint validates the published overview.
    if (owned.unitKind === "overview") return sseResponse(createSseStream(async send => {
      send({type: "done", sq: null, contentRevision: owned.contentRevision, structuredSubStep: "material", currentStep: "structured_input"});
    }));
    const active = await requireGenerationRunPersistence().listRunning({
      userId: input.userId, scope: "unit", scopeId: input.unitId, operation: "unit.generate_sq",
    });
    for (const run of active) {
      if (!await failGenerationRunIfStale(run)) return sseResponse(createRunSubscribeStream(run.id));
    }
    // A run can commit between the first owned read and the active-run query.
    // Re-read only after that query, inside the same start critical section.
    const current = await input.loadOwned();
    if (!current) throw new NotFoundException("Unit not found");
    let sq: {survey?: {outline?: unknown[]}} | null = null;
    try { sq = JSON.parse(current.sq3rData || "null"); } catch { /* missing or corrupt preview */ }
    if (Array.isArray(sq?.survey?.outline) && sq.survey.outline.some(value => typeof value === "string" && value.trim())) {
      return sseResponse(createSseStream(async send => {
        send({type: "done", sq, contentRevision: current.contentRevision, structuredSubStep: "sq", currentStep: "structured_input"});
      }));
    }
    if (current.hasMaterial) throw new ConflictException("已有正文但教学结构不完整，请先在课程内修复");
    if (current.hasProtectedPreparation) throw new ConflictException("已有保留的准备进度但预习缺失，请先在课程内恢复预习");
    return input.start();
  }));
}
