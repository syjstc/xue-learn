import sharp from "sharp";
import { createHash } from "node:crypto";
import {
  imagePolygonPath,
  type GuidedImageAsset,
  type GuidedImageRegion,
} from "../../../../../../domain/src/guided-image.js";

export function imageSha256(data: Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

export async function normalizeGuidedImage(data: Buffer) {
  const result = await sharp(data, { limitInputPixels: 24_000_000 })
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    data: result.data,
    width: result.info.width,
    height: result.info.height,
    sha256: imageSha256(result.data),
  };
}

/** The model supplies outlines; libvips rasterizes and applies them. This is
 * alpha compositing, not a handwritten segmentation/matting algorithm. */
export async function cutGuidedImageRegion(
  data: Buffer,
  image: GuidedImageAsset,
  region: GuidedImageRegion,
) {
  if (imageSha256(data) !== image.sha256)
    throw new Error("Region source image changed");
  const paths = region.polygons
    .map(
      (p) =>
        `<path d="${imagePolygonPath(p, image.width, image.height)}" fill="white" fill-rule="evenodd"/>`,
    )
    .join("");
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}">${paths}</svg>`,
  );
  return sharp(data)
    .ensureAlpha()
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}
