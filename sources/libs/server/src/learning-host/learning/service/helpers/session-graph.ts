import type {
  UnitSessionStateRepository,
  UnitStructuredCleanupRepository,
} from "../../../../../../domain/src/index.js";
import {
  graphStateWithoutReviewMode,
  parseSessionGraphState,
} from "../../../../graph/review-mode.js";
import { parseJson } from "../../../../utils.js";
import {
  sqPreviewResponseSchema,
  type SqPreview,
} from "../../../../llm/schemas.js";

export function parseSqData(raw: string): SqPreview | null {
  const data = parseJson<Record<string, unknown>>(raw, {});
  if (!data.survey || !data.questions) return null;
  try {
    return sqPreviewResponseSchema.parse(data);
  } catch {
    return data as SqPreview;
  }
}

export async function clearStructuredDownstream(
  repository: UnitStructuredCleanupRepository,
  userId: string,
  unitId: string,
  from: "sq" | "material",
) {
  await repository.clear({ userId, unitId, from });
}

export async function migrateLegacyReviewMode(
  repository: UnitSessionStateRepository,
  userId: string,
  unitId: string,
  sessionGraphState: string,
) {
  const graphState = parseSessionGraphState(sessionGraphState);
  if (!graphState.reviewMode) return graphState;
  const cleaned = graphStateWithoutReviewMode(graphState);
  await repository.updateOwned({
    userId,
    unitId,
    patch: { graphState: JSON.stringify(cleaned) },
  });
  return cleaned;
}
