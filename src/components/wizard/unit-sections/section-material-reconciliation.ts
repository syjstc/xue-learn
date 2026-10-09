import type { LearningMaterialContent } from "@xue-learn/core/source/src/shared/llm/schemas.ts";

export function resolveSectionMaterialForRender(input: {
  regenerating: boolean;
  preview: LearningMaterialContent | null;
  persisted: LearningMaterialContent | null | undefined;
}): LearningMaterialContent | null {
  if (input.regenerating) return input.preview ?? input.persisted ?? null;
  return input.persisted ?? null;
}

export function shouldPreservePublishedSectionContent(input: {
  generationStatus: string | undefined;
  activeSectionId: string | undefined;
  contentSectionId: string | undefined;
  material: LearningMaterialContent | null | undefined;
  derivation?: unknown;
}): boolean {
  return Boolean(
    input.generationStatus === "ready" &&
    input.activeSectionId &&
    input.contentSectionId === input.activeSectionId &&
    (input.material || input.derivation),
  );
}

/** Keep the on-screen draft when only the published revision/status changed. */
export function shouldKeepVisibleSectionMaterial(input: {
  activeSectionId: string | undefined;
  contentSectionId: string | undefined;
  hasMaterial: boolean;
}): boolean {
  return Boolean(
    input.activeSectionId &&
    input.contentSectionId === input.activeSectionId &&
    input.hasMaterial,
  );
}
