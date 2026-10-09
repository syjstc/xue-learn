import sharp from "sharp";

export type CompressImageOptions = {
  maxDimension?: number;
  maxWidth?: number;
  quality?: number;
};

/** Stored unit / room illustrations (~512–1024px). */
export const STORED_IMAGE_OPTIONS: CompressImageOptions = {
  maxDimension: 1024,
  quality: 82,
};

/** Stored 2K desktop-local illustrations (up to 2848x1600 / 2048x2048). */
export const STORED_2K_IMAGE_OPTIONS: CompressImageOptions = {
  maxDimension: 2848,
  quality: 84,
};

/** PDF embed: cap width at 512px (matches inline illustration size). */
export const PDF_EMBED_IMAGE_OPTIONS: CompressImageOptions = {
  maxWidth: 512,
  quality: 82,
};

const WEBP_EFFORT = 4;

function mimeExt(mimeType: string): "webp" | "jpg" | "png" {
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  return "png";
}

function isOptimizedWebp(
  data: Buffer,
  mimeType: string,
  meta: sharp.Metadata,
  options: CompressImageOptions,
): boolean {
  if (mimeExt(mimeType) !== "webp") return false;
  const maxDimension =
    options.maxDimension ?? STORED_IMAGE_OPTIONS.maxDimension!;
  const maxWidth = options.maxWidth;
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (maxWidth && width > maxWidth) return false;
  if (width > maxDimension || height > maxDimension) return false;
  const maxBytes = maxDimension > 1024 ? 1_500_000 : 280_000;
  return data.length <= maxBytes;
}

export async function compressImageBuffer(
  data: Buffer,
  mimeType: string,
  options: CompressImageOptions = STORED_IMAGE_OPTIONS,
): Promise<{ data: Buffer; mimeType: string }> {
  try {
    const input = sharp(data, { failOn: "none" });
    const meta = await input.metadata();
    if (!meta.width || !meta.height) {
      return { data, mimeType };
    }

    if (isOptimizedWebp(data, mimeType, meta, options)) {
      return { data, mimeType };
    }

    const maxDimension =
      options.maxDimension ?? STORED_IMAGE_OPTIONS.maxDimension!;
    const maxWidth = options.maxWidth;
    const quality = options.quality ?? STORED_IMAGE_OPTIONS.quality!;

    let pipeline = sharp(data, { failOn: "none" });
    if (maxWidth && meta.width > maxWidth) {
      pipeline = pipeline.resize({
        width: maxWidth,
        fit: "inside",
        withoutEnlargement: true,
      });
    } else if (meta.width > maxDimension || meta.height > maxDimension) {
      const landscape = meta.width >= meta.height;
      pipeline = pipeline.resize({
        width: landscape ? maxDimension : undefined,
        height: landscape ? undefined : maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    const compressed = await pipeline
      .webp({ quality, effort: WEBP_EFFORT })
      .toBuffer();

    if (mimeExt(mimeType) === "webp" && compressed.length >= data.length) {
      return { data, mimeType };
    }

    return { data: compressed, mimeType: "image/webp" };
  } catch {
    return { data, mimeType };
  }
}
