import { readUnitImage } from "../images/storage.js";
import type { LearningMaterialContent } from "../llm/schemas.js";
import {
  compressImageBuffer,
  PDF_EMBED_IMAGE_OPTIONS,
} from "../images/compress-image.js";

export async function resolveMaterialImagesForPdf(
  unitId: string,
  material: LearningMaterialContent,
): Promise<LearningMaterialContent> {
  const blocks = await Promise.all(
    material.blocks.map(async (block) => {
      if (block.type !== "illustration" || !block.imageId) return block;
      const file = await readUnitImage(unitId, block.imageId);
      if (!file) return block;
      const embedded = await compressImageBuffer(
        file.data,
        file.mimeType,
        PDF_EMBED_IMAGE_OPTIONS,
      );
      const dataUri = `data:${embedded.mimeType};base64,${embedded.data.toString("base64")}`;
      return { ...block, imageUrl: dataUri };
    }),
  );
  return { ...material, blocks };
}
