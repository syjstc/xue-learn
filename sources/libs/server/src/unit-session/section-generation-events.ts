import { createMaterialDelta, type MaterialDelta } from "../../../contracts/src/index.js";

export type SectionGenerationArtifactKind = "material" | "mini_test";
export type SectionGenerationPhase = "section_material" | "section_mini_test";

export type SectionMaterialLike<TBlock = unknown> = {
  introduction: string;
  blocks: TBlock[];
  keyTakeaways: string[];
};

export type SectionMaterialPartial<TBlock = unknown> = {
  material: SectionMaterialLike<TBlock>;
  completeBlockCount: number;
  placeholderBlockCount?: number;
};

export type SectionMaterialDeltaEvent<TBlock = unknown> = {
  type: "material_delta";
  delta: MaterialDelta<TBlock>;
  reset: boolean;
  streamRevision: number;
  completeBlockCount: number;
  placeholderBlockCount: number;
};

export function sectionGenerationDescriptor(sectionId: string): {
  artifactKind: SectionGenerationArtifactKind;
  phase: SectionGenerationPhase;
} {
  return sectionId.startsWith("mini-test:")
    ? { artifactKind: "mini_test", phase: "section_mini_test" }
    : { artifactKind: "material", phase: "section_material" };
}

export function sectionGenerationDoneEvent(sectionId: string): {
  type: "done";
  sectionId: string;
} {
  return { type: "done", sectionId };
}

/**
 * Map validated material snapshots to the canonical section-generation delta
 * stream. The mapper suppresses duplicate snapshots while retaining progress
 * changes and monotonically increasing stream revisions.
 */
export function createSectionMaterialDeltaEmitter<TBlock>(
  send: (event: SectionMaterialDeltaEvent<TBlock>) => void,
): (partial: SectionMaterialPartial<TBlock>) => void {
  let streamedMaterial: SectionMaterialLike<TBlock> | null = null;
  let streamedCompleteBlockCount = -1;
  let streamedPlaceholderBlockCount = -1;
  let streamRevision = 0;

  return (partial) => {
    const reset = streamedMaterial === null;
    const delta = createMaterialDelta(streamedMaterial, partial.material);
    streamedMaterial = structuredClone(partial.material);
    const placeholderBlockCount = partial.placeholderBlockCount ?? 0;
    if (
      Object.keys(delta).length === 0 &&
      partial.completeBlockCount === streamedCompleteBlockCount &&
      placeholderBlockCount === streamedPlaceholderBlockCount
    ) {
      return;
    }
    streamedCompleteBlockCount = partial.completeBlockCount;
    streamedPlaceholderBlockCount = placeholderBlockCount;
    streamRevision += 1;
    send({
      type: "material_delta",
      delta,
      reset,
      streamRevision,
      completeBlockCount: partial.completeBlockCount,
      placeholderBlockCount,
    });
  };
}
