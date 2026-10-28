import { z } from "zod";
import {
  imageRingArea,
  GUIDED_IMAGE_SELECTION_LIMITS,
  type GuidedImageIntent,
  type GuidedImageSegmentation,
} from "../../../../../../domain/src/guided-image.js";
import { paragraphNarrationIssues } from "../../../../llm/narrated-material-sequence.js";

const id = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const text = z.string().trim().min(1).max(GUIDED_IMAGE_SELECTION_LIMITS.descriptionLength);
export const guidedImageIntentSchema = z
  .object({
    id,
    title: text,
    language: z.string().min(2).max(20),
    learningGoal: text,
    assumedKnowledge: text,
    composition: text,
    parts: z
      .array(
        z.object({
          id,
          label: text,
          visualDescription: text,
          teachingPoints: z.array(text).min(1).max(12),
          required: z.boolean(),
        }),
      )
      .min(1)
      .max(24),
    relationships: z
      .array(z.object({ from: id, to: id, meaning: text }))
      .max(48),
  })
  .superRefine((value, ctx) => {
    const ids = value.parts.map((p) => p.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "Part ids must be unique" });
    for (const edge of value.relationships) {
      if (!ids.includes(edge.from) || !ids.includes(edge.to))
        ctx.addIssue({
          code: "custom",
          message: "Relationship references an unknown part",
        });
    }
  });

const point = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
const ring = z.array(point).min(3).max(256);
export const guidedImageSegmentationBinding = z.object({
  geometryVersion: z.literal("simple-shapes-v1").optional(),
  regions: z
    .array(
      z.object({
        id,
        partId: id,
        label: text,
        observedDescription: text,
        polygons: z
          .array(z.object({ outer: ring, holes: z.array(ring).max(8) }))
          .min(1)
          .max(8),
      }),
    )
    .max(32),
  missingPartIds: z.array(id).max(24),
  imageIssues: z.array(text).max(24),
});

export function segmentationSchema(intent: GuidedImageIntent) {
  return guidedImageSegmentationBinding.superRefine((value, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const ids = value.regions.map((r) => r.id);
    if (new Set(ids).size !== ids.length) fail("Region ids must be unique");
    const parts = new Set(intent.parts.map((p) => p.id));
    for (const region of value.regions) {
      if (!parts.has(region.partId)) fail(`Unknown part: ${region.partId}`);
      if (value.missingPartIds.includes(region.partId))
        fail(`Part is both visible and missing: ${region.partId}`);
      for (const polygon of region.polygons) {
        if (imageRingArea(polygon.outer) < 0.00002)
          fail(`Empty or degenerate polygon: ${region.id}`);
        if (
          polygon.holes.some(
            (hole) => imageRingArea(hole) >= imageRingArea(polygon.outer),
          )
        )
          fail(`Invalid hole: ${region.id}`);
      }
    }
    for (const partId of value.missingPartIds)
      if (!parts.has(partId)) fail(`Unknown missing part: ${partId}`);
    for (const part of intent.parts) {
      if (
        !value.regions.some((r) => r.partId === part.id) &&
        !value.missingPartIds.includes(part.id)
      )
        fail(`Locate or explicitly report missing: ${part.id}`);
    }
  });
}

/** Compact model transport. The model never authors dense contours or holes.
 * Persisted displays still use the shared polygon format for all renderers. */
export const guidedImageSelectionBinding = z.object({
  regions: z
    .array(
      z.object({
        id,
        partId: id,
        label: text,
        observedDescription: text,
        shapes: z
          .array(
            z.discriminatedUnion("type", [
              z.object({
                type: z.literal("rect"),
                x: z.number().min(0).max(1),
                y: z.number().min(0).max(1),
                width: z.number().positive().max(1),
                height: z.number().positive().max(1),
              }),
              z.object({
                type: z.literal("polygon"),
                points: z.array(point).min(3).max(6),
              }),
            ]),
          )
          .min(1)
          .max(GUIDED_IMAGE_SELECTION_LIMITS.shapesPerRegion),
      }),
    )
    .max(GUIDED_IMAGE_SELECTION_LIMITS.regions),
  missingPartIds: z.array(id).max(24),
  imageIssues: z.array(text).max(24),
});

export function selectionToSegmentation(
  selection: z.infer<typeof guidedImageSelectionBinding>,
): GuidedImageSegmentation {
  return {
    geometryVersion: "simple-shapes-v1",
    missingPartIds: selection.missingPartIds,
    imageIssues: selection.imageIssues,
    regions: selection.regions.map(({ shapes, ...region }) => ({
      ...region,
      polygons: shapes.map((shape) => ({
        outer:
          shape.type === "polygon"
            ? shape.points
            : [
                { x: shape.x, y: shape.y },
                { x: shape.x + shape.width, y: shape.y },
                { x: shape.x + shape.width, y: shape.y + shape.height },
                { x: shape.x, y: shape.y + shape.height },
              ],
        holes: [],
      })),
    })),
  };
}

function hasCrossedEdges(points: readonly z.infer<typeof point>[]) {
  const cross = (
    a: z.infer<typeof point>,
    b: z.infer<typeof point>,
    c: z.infer<typeof point>,
  ) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const between = (a: number, b: number, c: number) =>
    c >= Math.min(a, b) && c <= Math.max(a, b);
  const on = (
    a: z.infer<typeof point>,
    b: z.infer<typeof point>,
    c: z.infer<typeof point>,
  ) =>
    Math.abs(cross(a, b, c)) < 1e-10 &&
    between(a.x, b.x, c.x) &&
    between(a.y, b.y, c.y);
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const [a, b, c, d] = [
        points[i]!,
        points[(i + 1) % points.length]!,
        points[j]!,
        points[(j + 1) % points.length]!,
      ];
      if (
        (cross(a, b, c) * cross(a, b, d) < 0 &&
          cross(c, d, a) * cross(c, d, b) < 0) ||
        on(a, b, c) ||
        on(a, b, d) ||
        on(c, d, a) ||
        on(c, d, b)
      )
        return true;
    }
  }
  return false;
}

export function selectionSchema(intent: GuidedImageIntent) {
  return guidedImageSelectionBinding.superRefine((value, ctx) => {
    const segmentation = selectionToSegmentation(value);
    const parsed = segmentationSchema(intent).safeParse(segmentation);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        ctx.addIssue({
          code: "custom",
          message: issue.message,
          path: issue.path,
        });
    for (const region of segmentation.regions)
      for (const polygon of region.polygons)
        if (hasCrossedEdges(polygon.outer))
          ctx.addIssue({
            code: "custom",
            message: `Crossed polygon edges in ${region.id}; use a rectangle or ordered perimeter points`,
          });
  });
}

export const guidedImageNarrationBinding = z.object({
  beats: z
    .array(
      z.object({
        id,
        text: z.string().trim().min(1).max(1200),
        regionIds: z.array(id).max(32),
        partIds: z.array(id).max(24),
      }),
    )
    .min(1)
    .max(80),
});

export function narrationSchema(
  intent: GuidedImageIntent,
  segmentation: GuidedImageSegmentation,
) {
  return guidedImageNarrationBinding.superRefine((value, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const ids = value.beats.map((b) => b.id);
    if (new Set(ids).size !== ids.length) fail("Beat ids must be unique");
    const regions = new Map(segmentation.regions.map((r) => [r.id, r]));
    for (const [beatIndex, beat] of value.beats.entries()) {
      for (const issue of paragraphNarrationIssues(beat.text, beatIndex))
        ctx.addIssue({
          code: "custom",
          path: ["beats", beatIndex, "text"],
          message: issue.message,
        });
      if (
        new Set(beat.regionIds).size !== beat.regionIds.length ||
        new Set(beat.partIds).size !== beat.partIds.length
      )
        fail(`Duplicate targets: ${beat.id}`);
      for (const regionId of beat.regionIds) {
        const region = regions.get(regionId);
        if (!region) fail(`Unknown region: ${regionId}`);
        else if (!beat.partIds.includes(region.partId))
          fail(`Highlighted region must belong to a taught part: ${regionId}`);
      }
      for (const partId of beat.partIds)
        if (!intent.parts.some((p) => p.id === partId))
          fail(`Unknown taught part: ${partId}`);
    }
    for (const part of intent.parts.filter((p) => p.required)) {
      if (
        !value.beats.some(
          (b) =>
            b.partIds.includes(part.id) &&
            b.regionIds.some((r) => regions.get(r)?.partId === part.id),
        )
      )
        fail(`Required part needs grounded explanation: ${part.id}`);
    }
  });
}

/** Completed artifacts only. Authoring tools never receive this server-owned
 * schema: they submit an intent and the child workflow fills these fields. */
export const guidedImageDisplaySchema = z.object({
  type: z.literal("guided_image"),
  schemaVersion: z.literal(1),
  id,
  intent: guidedImageIntentSchema,
  image: z.object({
    src: text,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  segmentation: guidedImageSegmentationBinding,
  cutouts: z.array(z.object({ regionId: id, src: text })),
  beats: guidedImageNarrationBinding.shape.beats,
  persona: z.object({ ref: text, name: text, avatarCode: text }),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
