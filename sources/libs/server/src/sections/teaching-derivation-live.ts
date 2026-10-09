import type { TeachingDerivationRunRecord } from "../../../domain/src/index.js";
import {
  parseTeachingDerivationDocument,
  type TeachingDerivationDocumentV1,
} from "../../../teaching-derivation/src/index.js";
import { requireTeachingDerivationPersistence } from "../learning-systems/capabilities/teaching-derivation/persistence.js";
import {
  shouldForwardLiveTeachingDocument,
  type TeachingDerivationRunEventV1,
} from "../learning-systems/capabilities/teaching-derivation/session.js";

const TERMINAL_RUN_STATUSES = new Set(["complete", "cancelled"]);

export function tryParseLiveTeachingDocument(
  json: string,
): TeachingDerivationDocumentV1 | null {
  try {
    const document = parseTeachingDerivationDocument(JSON.parse(json) as unknown);
    return document && document.steps.length > 0 ? document : null;
  } catch {
    return null;
  }
}

export { shouldForwardLiveTeachingDocument };

export function selectResumableTeachingDerivationRun(
  runs: readonly TeachingDerivationRunRecord[],
  sectionId: string,
): TeachingDerivationRunRecord | null {
  let best: { run: TeachingDerivationRunRecord; steps: number } | null = null;
  for (const run of runs) {
    if (run.sectionId !== sectionId) continue;
    if (TERMINAL_RUN_STATUSES.has(run.status)) continue;
    const live = tryParseLiveTeachingDocument(run.documentJson);
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

export async function loadUnpublishedTeachingDerivationDraft(
  sectionId: string,
): Promise<TeachingDerivationDocumentV1 | null> {
  try {
    const persistence = requireTeachingDerivationPersistence();
    const run = selectResumableTeachingDerivationRun(
      await persistence.listRunsBySection(sectionId),
      sectionId,
    );
    return run ? tryParseLiveTeachingDocument(run.documentJson) : null;
  } catch {
    return null;
  }
}

export function shouldForwardTeachingEvent(
  event: TeachingDerivationRunEventV1,
): boolean {
  return shouldForwardLiveTeachingDocument(event);
}
