import { TEACHING_DERIVATION_SCHEMA_VERSION } from "./types.js";
import type { TeachingDerivationDocumentV1 } from "./types.js";

export function emptyTeachingDerivationDocument(input: {
  id: string;
  title: string;
  locale: string;
  teachingGoal?: string;
}): TeachingDerivationDocumentV1 {
  return {
    schemaVersion: TEACHING_DERIVATION_SCHEMA_VERSION,
    id: input.id,
    title: input.title,
    locale: input.locale,
    teachingGoal: input.teachingGoal?.trim() || input.title,
    givens: [],
    steps: [],
    status: "draft",
    revision: 0,
  };
}
