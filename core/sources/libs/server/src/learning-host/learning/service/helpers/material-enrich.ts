import type { MaterialEnrichmentRepository } from "../../../../../../domain/src/index.js";
import { runWithUserId } from "../../../../user-context.js";
import {
  generateLearningMaterialWithSources,
  parseLearningMaterial,
  patchMaterialIllustrationBlock,
  serializeLearningMaterialBlocks,
} from "../../../../graph/unit-session.js";
import { enrichMaterialWithImages } from "../../../../images/enrich-material.js";
import { materialToJitItems } from "../../../../llm/jit-structured-items.js";

export function enrichMaterialImagesInBackground(
  repository: MaterialEnrichmentRepository,
  userId: string,
  unitId: string,
  textMaterial: ReturnType<typeof parseLearningMaterial>,
  goalId: string,
  unitTitle: string,
  contentLanguage: Awaited<
    ReturnType<typeof generateLearningMaterialWithSources>
  >["contentLanguage"],
  initialContentRevision: number,
) {
  void runWithUserId(userId, async () => {
    let material = textMaterial;
    let contentRevision = initialContentRevision;
    let persistTail = Promise.resolve();
    try {
      material = await enrichMaterialWithImages(
        textMaterial,
        unitId,
        {
          goalId,
          unitTitle,
          contentLanguage,
          storageRevision: `material-${initialContentRevision}`,
        },
        {
          onImageReady: async ({ blockIndex, block }) => {
            material = patchMaterialIllustrationBlock(material, blockIndex, {
              imageId: block.imageId!,
              imageUrl: block.imageUrl!,
            });
            const snapshot = material;
            const task = persistTail.then(async () => {
              const persisted = await repository.persistIfCurrent({
                userId,
                unitId,
                expectedContentRevision: contentRevision,
                sections: serializeLearningMaterialBlocks(snapshot),
                sourceItemsJson: JSON.stringify(materialToJitItems(snapshot)),
              });
              if (persisted.applied) {
                contentRevision = persisted.contentRevision;
              }
            });
            persistTail = task.then(
              () => undefined,
              () => undefined,
            );
            await task;
          },
        },
      );
      await persistTail;
    } catch {
      // Background image enrichment is best-effort; text material is already saved.
    }
  });
}
