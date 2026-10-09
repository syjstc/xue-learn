import type { GuidedImageAsset, GuidedImageRegion } from "./guided-image.js";

export type GuidedImageCamera = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}>;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/** Video samples absolute cue cameras, so seeking/export never depends on the
 * last browser frame. A settled cue is exactly the next cue's starting camera. */
export function guidedImageCameraFrame(params: {
  image: Pick<GuidedImageAsset, "width" | "height">;
  viewport: { width: number; height: number };
  regions: readonly GuidedImageRegion[];
  previousRegions: readonly GuidedImageRegion[];
  progress: number;
}): GuidedImageCamera {
  // Video lays out at 1920 px but is commonly watched around 1280 px wide.
  // Keep the same readable target at that viewing size, independent of export
  // resolution or preview zoom. Source-resolution and context caps still apply.
  const video = { ...params, readabilityScale: 1.5 };
  const from = guidedImageCamera({ ...video, regions: params.previousRegions });
  const to = guidedImageCamera(video);
  const progress = clamp(params.progress, 0, 1);
  if (progress === 0) return from;
  if (progress === 1) return to;
  const t = 1 - (1 - progress) ** 3;
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    x: mix(from.x, to.x),
    y: mix(from.y, to.y),
    width: mix(from.width, to.width),
    height: mix(from.height, to.height),
    zoom: mix(from.zoom, to.zoom),
  };
}

/** A display-only camera. Region geometry and the original image stay intact. */
export function guidedImageCamera(params: {
  image: Pick<GuidedImageAsset, "width" | "height">;
  viewport: { width: number; height: number };
  regions: readonly GuidedImageRegion[];
  previous?: GuidedImageCamera;
  readabilityScale?: number;
}): GuidedImageCamera {
  const { image, viewport, regions, previous } = params;
  if (viewport.width < 1 || viewport.height < 1)
    return { x: 0, y: 0, width: image.width, height: image.height, zoom: 1 };
  const ratio = Math.max(1, viewport.width) / Math.max(1, viewport.height);
  const width = Math.max(image.width, image.height * ratio);
  const height = width / ratio;
  const whole = {
    x: (image.width - width) / 2,
    y: (image.height - height) / 2,
    width,
    height,
    zoom: 1,
  };
  const points = regions.flatMap((region) =>
    region.polygons.flatMap((polygon) => polygon.outer),
  );
  if (
    !points.length ||
    viewport.width < 1 ||
    viewport.height < 1 ||
    image.width < 1 ||
    image.height < 1
  )
    return whole;
  const left =
    clamp(Math.min(...points.map((point) => point.x)), 0, 1) * image.width;
  const right =
    clamp(Math.max(...points.map((point) => point.x)), 0, 1) * image.width;
  const top =
    clamp(Math.min(...points.map((point) => point.y)), 0, 1) * image.height;
  const bottom =
    clamp(Math.max(...points.map((point) => point.y)), 0, 1) * image.height;
  const bw = right - left,
    bh = bottom - top;
  if (bw <= 0 || bh <= 0 || (bw * bh) / (image.width * image.height) > 0.38)
    return whole;
  const baseScale = viewport.width / width;
  // Zoom only when the selected object is genuinely small in screen pixels.
  const desired = Math.max(
    Math.min(300 * (params.readabilityScale ?? 1), viewport.width * 0.56) /
      (bw * baseScale),
    Math.min(160 * (params.readabilityScale ?? 1), viewport.height * 0.44) /
      (bh * baseScale),
  );
  const padding = Math.max(
    Math.min(image.width, image.height) * 0.045,
    Math.max(bw, bh) * 0.22,
  );
  const zoom = Math.min(
    2.6,
    1.35 / baseScale,
    desired,
    width / (bw + padding * 2),
    height / (bh + padding * 2),
  );
  if (zoom < 1.28) return whole;
  const targetWidth = width / zoom,
    targetHeight = height / zoom;
  // Never pan beyond the image except its unavoidable aspect-ratio letterbox.
  const x =
    targetWidth >= image.width
      ? (image.width - targetWidth) / 2
      : clamp((left + right - targetWidth) / 2, 0, image.width - targetWidth);
  const y =
    targetHeight >= image.height
      ? (image.height - targetHeight) / 2
      : clamp(
          (top + bottom - targetHeight) / 2,
          0,
          image.height - targetHeight,
        );
  // Nearby cues share a stable camera if the new subject already fits with
  // breathing room. Hysteresis avoids a new pan for every spoken sentence.
  if (
    previous &&
    previous.zoom > 1 &&
    Math.abs(previous.width / previous.height - ratio) < 0.01 &&
    previous.zoom >= zoom * 0.82 &&
    previous.zoom <= zoom * 1.25
  ) {
    const inset = Math.min(
      padding,
      Math.min(previous.width, previous.height) * 0.08,
    );
    if (
      left >= previous.x + inset &&
      right <= previous.x + previous.width - inset &&
      top >= previous.y + inset &&
      bottom <= previous.y + previous.height - inset
    )
      return previous;
  }
  return { x, y, width: targetWidth, height: targetHeight, zoom };
}
