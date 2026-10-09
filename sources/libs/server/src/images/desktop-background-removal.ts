import sharp from "sharp";

const BORDER_SAMPLE_WIDTH = 8;
const PALETTE_SIZE = 12;
const COLOR_DISTANCE = 48;
const MIN_REMOVED_PIXELS = 256;
const MIN_FOREGROUND_RATIO = 0.01;
const MIN_BORDER_PALETTE_COVERAGE = 0.65;

type RgbaImage = {
  data: Buffer;
  width: number;
  height: number;
};

export type DesktopBackgroundRemovalResult = {
  data: Buffer;
  mimeType: string;
  removedPixels: number;
  wasAlreadyTransparent: boolean;
};

export class DesktopBackgroundRemovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesktopBackgroundRemovalError";
  }
}

function colorDistanceSquared(
  data: Buffer,
  offset: number,
  color: [number, number, number],
): number {
  const dr = data[offset]! - color[0];
  const dg = data[offset + 1]! - color[1];
  const db = data[offset + 2]! - color[2];
  return dr * dr + dg * dg + db * db;
}

function quantizedColorKey(data: Buffer, offset: number): string {
  return [data[offset], data[offset + 1], data[offset + 2]]
    .map((value) => Math.floor(value! / 16))
    .join(":");
}

function borderColorPalette(image: RgbaImage): {
  colors: [number, number, number][];
  coverage: number;
} {
  const counts = new Map<
    string,
    { count: number; red: number; green: number; blue: number }
  >();
  const border = Math.min(
    BORDER_SAMPLE_WIDTH,
    Math.max(1, Math.floor(Math.min(image.width, image.height) / 8)),
  );

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (
        x >= border &&
        x < image.width - border &&
        y >= border &&
        y < image.height - border
      ) {
        continue;
      }
      const offset = (y * image.width + x) * 4;
      const key = quantizedColorKey(image.data, offset);
      const current = counts.get(key);
      if (current) {
        current.count += 1;
        current.red += image.data[offset]!;
        current.green += image.data[offset + 1]!;
        current.blue += image.data[offset + 2]!;
      } else {
        counts.set(key, {
          count: 1,
          red: image.data[offset]!,
          green: image.data[offset + 1]!,
          blue: image.data[offset + 2]!,
        });
      }
    }
  }

  const sorted = [...counts.values()].sort(
    (left, right) => right.count - left.count,
  );
  const dominant = sorted.slice(0, PALETTE_SIZE);
  const total = sorted.reduce((sum, color) => sum + color.count, 0);

  return {
    coverage:
      total > 0
        ? dominant.reduce((sum, color) => sum + color.count, 0) / total
        : 0,
    colors: dominant.map((color) => [
      Math.round(color.red / color.count),
      Math.round(color.green / color.count),
      Math.round(color.blue / color.count),
    ]),
  };
}

function isNearPaletteColor(
  data: Buffer,
  offset: number,
  palette: [number, number, number][],
): boolean {
  const maxDistance = COLOR_DISTANCE * COLOR_DISTANCE;
  return palette.some(
    (color) => colorDistanceSquared(data, offset, color) <= maxDistance,
  );
}

async function decodeRgba(data: Buffer): Promise<RgbaImage> {
  const decoded = await sharp(data, { failOn: "none" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: decoded.data,
    width: decoded.info.width,
    height: decoded.info.height,
  };
}

function hasTransparentPixel(data: Buffer): boolean {
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset]! < 255) return true;
  }
  return false;
}

/**
 * Removes a flat or checkerboard-like raster background by edge flood fill.
 *
 * This is deliberately bounded to edge-connected colors. It is a safe local
 * fallback for generated teaching illustrations, not a general photo
 * segmentation model: enclosed light areas inside a diagram are preserved.
 */
export async function removeDesktopOpaqueBackground(
  data: Buffer,
  mimeType: string,
  onProgress?: () => void | Promise<void>,
): Promise<DesktopBackgroundRemovalResult> {
  const image = await decodeRgba(data);
  if (hasTransparentPixel(image.data)) {
    return {
      data,
      mimeType,
      removedPixels: 0,
      wasAlreadyTransparent: true,
    };
  }

  const palette = borderColorPalette(image);
  if (
    palette.colors.length === 0 ||
    palette.coverage < MIN_BORDER_PALETTE_COVERAGE
  ) {
    throw new DesktopBackgroundRemovalError(
      "Image edges are too varied for safe background removal",
    );
  }
  await onProgress?.();

  const pixelCount = image.width * image.height;
  const removed = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 0;

  const enqueueIfBackground = (x: number, y: number) => {
    if (x < 0 || x >= image.width || y < 0 || y >= image.height) return;
    const pixelIndex = y * image.width + x;
    if (removed[pixelIndex]) return;
    const offset = pixelIndex * 4;
    if (!isNearPaletteColor(image.data, offset, palette.colors)) return;
    removed[pixelIndex] = 1;
    queue[queueEnd] = pixelIndex;
    queueEnd += 1;
  };

  for (let x = 0; x < image.width; x += 1) {
    enqueueIfBackground(x, 0);
    enqueueIfBackground(x, image.height - 1);
  }
  for (let y = 1; y < image.height - 1; y += 1) {
    enqueueIfBackground(0, y);
    enqueueIfBackground(image.width - 1, y);
  }

  while (queueStart < queueEnd) {
    const pixelIndex = queue[queueStart]!;
    queueStart += 1;
    const x = pixelIndex % image.width;
    const y = Math.floor(pixelIndex / image.width);
    enqueueIfBackground(x - 1, y);
    enqueueIfBackground(x + 1, y);
    enqueueIfBackground(x, y - 1);
    enqueueIfBackground(x, y + 1);
  }

  const removedPixels = queueEnd;
  if (
    removedPixels < MIN_REMOVED_PIXELS ||
    removedPixels >= pixelCount * (1 - MIN_FOREGROUND_RATIO)
  ) {
    throw new DesktopBackgroundRemovalError(
      "No usable flat background was found at the image edges",
    );
  }

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    if (removed[pixelIndex]) image.data[pixelIndex * 4 + 3] = 0;
  }

  const output = await sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png()
    .toBuffer();

  return {
    data: output,
    mimeType: "image/png",
    removedPixels,
    wasAlreadyTransparent: false,
  };
}
