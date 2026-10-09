import type { ImageAspectRatio } from "./providers/types.js";

/** Short edge for compact inline illustrations (~512px). */
export const COMPACT_SHORT_EDGE = 512;

function parseAspectRatio(ratio: ImageAspectRatio): [number, number] {
  const [w, h] = ratio.split(":").map(Number);
  return [w!, h!];
}

function roundToMultiple(n: number, multiple: number): number {
  return Math.round(n / multiple) * multiple;
}

/** Compact pixel dimensions preserving aspect ratio (multiples of 16 for provider APIs). */
export function compactImagePixelSize(aspectRatio?: ImageAspectRatio): {
  width: number;
  height: number;
  size: string;
} {
  const [rw, rh] = parseAspectRatio(aspectRatio ?? "16:9");
  const landscape = rw >= rh;
  let width: number;
  let height: number;
  if (landscape) {
    height = COMPACT_SHORT_EDGE;
    width = roundToMultiple((height * rw) / rh, 16);
  } else {
    width = COMPACT_SHORT_EDGE;
    height = roundToMultiple((width * rh) / rw, 16);
  }
  return { width, height, size: `${width}x${height}` };
}
