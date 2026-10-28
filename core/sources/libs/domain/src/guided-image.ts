/** Experimental image-first teaching display. Coordinates are relative to the
 * original, oriented image, never the surrounding card or its letterboxing. */
export type ImagePoint = Readonly<{ x: number; y: number }>;
export type ImagePolygon = Readonly<{
  outer: readonly ImagePoint[];
  holes: readonly (readonly ImagePoint[])[];
}>;

/** Observation transport limits apply per region, not per teaching subject.
 * Multiple independent regions may share the same partId. */
export const GUIDED_IMAGE_SELECTION_LIMITS = {
  regions: 32,
  shapesPerRegion: 3,
  descriptionLength: 4000,
} as const;
export const GUIDED_IMAGE_MAX_SELECTION_SHAPES =
  GUIDED_IMAGE_SELECTION_LIMITS.regions * GUIDED_IMAGE_SELECTION_LIMITS.shapesPerRegion;
export const GUIDED_IMAGE_MAX_SUBJECT_DESCRIPTION =
  GUIDED_IMAGE_SELECTION_LIMITS.regions * (GUIDED_IMAGE_SELECTION_LIMITS.descriptionLength + 1) - 1;

export type GuidedImageIntent = Readonly<{
  id: string;
  title: string;
  language: string;
  learningGoal: string;
  assumedKnowledge: string;
  composition: string;
  parts: readonly Readonly<{
    id: string;
    label: string;
    visualDescription: string;
    teachingPoints: readonly string[];
    required: boolean;
  }>[];
  relationships: readonly Readonly<{
    from: string;
    to: string;
    meaning: string;
  }>[];
}>;

export type GuidedImageRegion = Readonly<{
  id: string;
  partId: string;
  label: string;
  /** Evidence from the actual pixels; intent alone is not visual evidence. */
  observedDescription: string;
  polygons: readonly ImagePolygon[];
}>;

export type GuidedImageSegmentation = Readonly<{
  /** New observations use rectangles or polygons with at most six vertices. */
  geometryVersion?: "simple-shapes-v1";
  regions: readonly GuidedImageRegion[];
  missingPartIds: readonly string[];
  imageIssues: readonly string[];
}>;

export type GuidedImageBeat = Readonly<{
  id: string;
  text: string;
  /** Empty means explain the whole picture. */
  regionIds: readonly string[];
  partIds: readonly string[];
}>;

export type GuidedImageAsset = Readonly<{
  src: string;
  sha256: string;
  width: number;
  height: number;
}>;

export type GuidedImageDisplay = Readonly<{
  type: "guided_image";
  schemaVersion: 1;
  id: string;
  intent: GuidedImageIntent;
  image: GuidedImageAsset;
  segmentation: GuidedImageSegmentation;
  /** Full-size transparent canvases preserve exact registration with the image. */
  cutouts: readonly Readonly<{ regionId: string; src: string }>[];
  beats: readonly GuidedImageBeat[];
  persona: Readonly<{ ref: string; name: string; avatarCode: string }>;
  sourceFingerprint: string;
}>;

export function imageRingPath(
  ring: readonly ImagePoint[],
  width = 1,
  height = 1,
): string {
  return (
    ring
      .map((p, i) => `${i ? "L" : "M"}${p.x * width},${p.y * height}`)
      .join(" ") + " Z"
  );
}

export function imagePolygonPath(
  polygon: ImagePolygon,
  width = 1,
  height = 1,
): string {
  return [polygon.outer, ...polygon.holes]
    .map((ring) => imageRingPath(ring, width, height))
    .join(" ");
}

export function imageRingArea(ring: readonly ImagePoint[]): number {
  return (
    Math.abs(
      ring.reduce((sum, p, i) => {
        const q = ring[(i + 1) % ring.length]!;
        return sum + p.x * q.y - q.x * p.y;
      }, 0),
    ) / 2
  );
}

/** No inference at read time: unresolved ids leave the original picture intact. */
export function guidedImageActiveRegions(
  display: GuidedImageDisplay,
  beatId?: string,
) {
  const beat = display.beats.find((item) => item.id === beatId);
  return guidedImageHighlightRegions(
    display.segmentation,
    display.image,
  ).filter((region) => beat?.regionIds.includes(region.id));
}

/** Display-only breathing room, equal in image pixels on both axes. Old
 * contours become one box; authored polygons retain their deliberate shape.
 * Labels must be observed inside the source region, not inferred from padding. */
export function guidedImageHighlightRegions(
  segmentation: GuidedImageSegmentation,
  image: Pick<GuidedImageAsset, "width" | "height"> = { width: 1, height: 1 },
) {
  return segmentation.regions.map((region) => {
    const polygons =
      segmentation.geometryVersion === "simple-shapes-v1"
        ? region.polygons
        : [
            {
              outer: region.polygons.flatMap((polygon) => polygon.outer),
              holes: [],
            },
          ];
    return {
      ...region,
      polygons: polygons.map((polygon) => {
        const points = polygon.outer;
        if (!points.length) return polygon;
        // Keep intentionally shaped selections; rectangles receive breathing room.
        if (
          segmentation.geometryVersion === "simple-shapes-v1" &&
          !rectangle({ ...region, polygons: [polygon] })
        )
          return polygon;
        const left = Math.min(...points.map((point) => point.x));
        const right = Math.max(...points.map((point) => point.x));
        const top = Math.min(...points.map((point) => point.y));
        const bottom = Math.max(...points.map((point) => point.y));
        const shortSide = Math.min(image.width, image.height);
        // Scale with the object, while limiting how much of the image is added.
        const padding = Math.min(
          shortSide * 0.025,
          Math.max(
            shortSide * 0.008,
            Math.max(
              (right - left) * image.width,
              (bottom - top) * image.height,
            ) * 0.06,
          ),
        );
        const dx = padding / image.width;
        const dy = padding / image.height;
        return {
          outer: [
            { x: Math.max(0, left - dx), y: Math.max(0, top - dy) },
            { x: Math.min(1, right + dx), y: Math.max(0, top - dy) },
            { x: Math.min(1, right + dx), y: Math.min(1, bottom + dy) },
            { x: Math.max(0, left - dx), y: Math.min(1, bottom + dy) },
          ],
          holes: [],
        };
      }),
    };
  });
}

export type GuidedImageHighlightFrame = Readonly<{
  backgroundOpacity: number;
  highlights: readonly Readonly<{
    region: GuidedImageRegion;
    opacity: number;
  }>[];
}>;

// Keep context visible as a quiet reference while the narrated regions retain
// their original contrast. All display surfaces sample this same spotlight.
const FOCUS_BACKGROUND_OPACITY = 0.28;

export function guidedImageStillFrame(
  regions: readonly GuidedImageRegion[],
): GuidedImageHighlightFrame {
  return {
    backgroundOpacity: regions.length ? FOCUS_BACKGROUND_OPACITY : 1,
    highlights: regions.map((region) => ({ region, opacity: 1 })),
  };
}

function rectangle(region: GuidedImageRegion) {
  if (region.polygons.length !== 1 || region.polygons[0]!.holes.length)
    return null;
  const points = region.polygons[0]!.outer;
  if (points.length !== 4) return null;
  const [a, b, c, d] = points;
  return a!.y === b!.y && b!.x === c!.x && c!.y === d!.y && d!.x === a!.x
    ? points
    : null;
}

/** Shared by reading-page animation and the deterministic classroom clock.
 * Rectangles travel without changing topology; other selections crossfade. */
export function guidedImageTransitionFrame(
  from: GuidedImageHighlightFrame,
  regions: readonly GuidedImageRegion[],
  progress: number,
): GuidedImageHighlightFrame {
  const t = 1 - (1 - Math.max(0, Math.min(1, progress))) ** 3;
  if (t >= 1) return guidedImageStillFrame(regions);
  const mix = (a: number, b: number) => a + (b - a) * t;
  const backgroundOpacity = mix(
    from.backgroundOpacity,
    regions.length ? FOCUS_BACKGROUND_OPACITY : 1,
  );
  const previous =
    from.highlights.length === 1 ? from.highlights[0] : undefined;
  const next = regions.length === 1 ? regions[0] : undefined;
  const a = previous && rectangle(previous.region);
  const b = next && rectangle(next);
  if (a && b && previous && next) {
    return {
      backgroundOpacity,
      highlights: [
        {
          region: {
            ...next,
            polygons: [
              {
                holes: [],
                outer: b.map((point, i) => ({
                  x: mix(a[i]!.x, point.x),
                  y: mix(a[i]!.y, point.y),
                })),
              },
            ],
          },
          opacity: mix(previous.opacity, 1),
        },
      ],
    };
  }
  const targets = new Map(regions.map((region) => [region.id, region]));
  const previousIds = new Set(from.highlights.map(({ region }) => region.id));
  return {
    backgroundOpacity,
    highlights: [
      ...from.highlights.map(({ region, opacity }) => ({
        region: targets.get(region.id) ?? region,
        opacity: mix(opacity, targets.has(region.id) ? 1 : 0),
      })),
      ...regions
        .filter((region) => !previousIds.has(region.id))
        .map((region) => ({ region, opacity: t })),
    ].filter(({ opacity }) => opacity > 0),
  };
}
