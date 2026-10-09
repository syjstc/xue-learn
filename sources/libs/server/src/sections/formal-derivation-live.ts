import {
  parseDerivationDocument,
  type DerivationDocumentV1,
  type FormalDerivationRunEventV1,
} from "../../../formal-derivation/src/index.js";
import type { FormalDerivationRunRecord } from "../../../domain/src/index.js";
import { requireFormalDerivationPersistence } from "../learning-systems/capabilities/formal-derivation/persistence.js";

const TERMINAL_RUN_STATUSES = new Set(["complete", "cancelled"]);

export function tryParseLiveDerivationDocument(
  json: string,
): DerivationDocumentV1 | null {
  try {
    const document = parseDerivationDocument(JSON.parse(json) as unknown);
    return document.steps.length > 0 ? document : null;
  } catch {
    return null;
  }
}

export function shouldForwardLiveDerivationDocument(
  event: FormalDerivationRunEventV1,
): boolean {
  if (event.type === "step_committed") return true;
  if (event.type !== "tool_finished" || !event.ok) return false;
  const result = event.result;
  if (!result || typeof result !== "object") return false;
  if ("step" in result) return true;
  return "validationLevel" in result && "summary" in result;
}

export function selectResumableFormalDerivationRun(
  runs: readonly FormalDerivationRunRecord[],
  sectionId: string,
): FormalDerivationRunRecord | null {
  let best: { run: FormalDerivationRunRecord; steps: number } | null = null;
  for (const run of runs) {
    if (run.sectionId !== sectionId) continue;
    if (TERMINAL_RUN_STATUSES.has(run.status)) continue;
    const live = tryParseLiveDerivationDocument(run.documentJson);
    if (!live) continue;
    const steps = live.steps.length;
    if (
      !best ||
      steps > best.steps ||
      (steps === best.steps && run.updatedAt > best.run.updatedAt)
    ) {
      best = { run, steps };
    }
  }
  return best?.run ?? null;
}

export async function loadUnpublishedDerivationDraft(
  sectionId: string,
): Promise<DerivationDocumentV1 | null> {
  try {
    const persistence = requireFormalDerivationPersistence();
    const run = selectResumableFormalDerivationRun(
      await persistence.listRunsBySection(sectionId),
      sectionId,
    );
    return run ? tryParseLiveDerivationDocument(run.documentJson) : null;
  } catch {
    return null;
  }
}
