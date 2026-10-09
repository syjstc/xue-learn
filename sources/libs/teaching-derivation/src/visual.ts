import { z } from "zod";
import type { TeachingDerivationDocumentV1, TeachingDerivationStepV1 } from "./types.js";

const id = z.string().min(1).max(128);
const label = z.string().trim().min(1).max(80);
const interval = z.tuple([z.number().finite(), z.number().finite()]);
const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });

/** Host-only copies of accepted images. Authors select an ID; they cannot
 * author URLs, replace pixels, or invent observed image geometry. */
export const teachingVisualAssetSchema = z.object({
  id,
  title: z.string().min(1).max(200),
  image: z.object({
    src: z.string().regex(/^\/api\/units\/[A-Za-z0-9_-]+\/images\/ill-guided-[a-f0-9]{64}\.png\?aigc=v1$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().positive().max(32768),
    height: z.number().int().positive().max(32768),
  }),
  segmentation: z.object({
    geometryVersion: z.literal("simple-shapes-v1").optional(),
    regions: z.array(z.object({
      id, partId: id, label: z.string().min(1).max(80),
      observedDescription: z.string().min(1).max(128031),
      polygons: z.array(z.object({
        // Historical accepted observations may have detailed contours. Reuse
        // them byte for byte; simple-shape limits apply to fresh observation.
        outer: z.array(point).min(3),
        holes: z.array(z.array(point).min(3)),
      })).min(1).max(96),
    })).max(32),
    missingPartIds: z.array(id).max(0),
    imageIssues: z.array(z.string()).max(0),
  }),
}).superRefine((asset, context) => {
  if (!asset.image.src.includes(`ill-guided-${asset.image.sha256}.png`))
    context.addIssue({ code: "custom", message: "Image pixels must retain their accepted hash", path: ["image", "src"] });
  if (new Set(asset.segmentation.regions.map(region => region.id)).size !== asset.segmentation.regions.length
    || asset.segmentation.regions.reduce((sum, region) => sum + region.polygons.length, 0) > 96)
    context.addIssue({ code: "custom", message: "Keep unique observed regions within the original image shape budget", path: ["segmentation"] });
});
export type TeachingVisualAssetV1 = z.infer<typeof teachingVisualAssetSchema>;

/** The owning course-display compiler validates these host copies before they
 * enter a run. Persist the accepted source instead of reauthoring its content. */
export const teachingVisualDisplaySchema = z.object({
  id, title: z.string().min(1).max(200), display: z.object({ type: z.string().min(1) }).catchall(z.unknown()),
  scene: z.object({ templateId: z.string(), title: z.string(), slots: z.record(z.string(), z.string()) }),
  targetIds: z.array(z.string().min(1).max(512)),
});
export type TeachingVisualDisplayV1 = z.infer<typeof teachingVisualDisplaySchema>;

/** Coordinates here are mathematical quantities, never screen positions.
 * The host evaluates the polynomial and its signed integrals without code eval. */
export const teachingPlotSchema = z.object({
  kind: z.literal("plot"),
  title: label,
  xLabel: label,
  yLabel: label,
  coefficients: z.array(z.number().finite()).min(1).max(4),
  domain: interval,
  regions: z.array(z.object({ id, label, interval })).max(6),
  markers: z.array(z.object({ id, label, x: z.number().finite() })).max(6),
}).strict();
export const teachingVisualSchema = z.discriminatedUnion("kind", [
  teachingPlotSchema,
  z.object({ kind: z.literal("image"), assetId: id }).strict(),
  z.object({ kind: z.literal("display"), displayId: id }).strict(),
]);
export type TeachingVisualV1 = z.infer<typeof teachingVisualSchema>;
export type TeachingPlotV1 = z.infer<typeof teachingPlotSchema>;

export function teachingPolynomialValue(coefficients: readonly number[], x: number): number {
  return coefficients.reduceRight((value, coefficient) => value * x + coefficient, 0);
}
export function teachingPolynomialIntegral(coefficients: readonly number[], from: number, to: number): number {
  const primitive = (x: number) => coefficients.reduce((sum, coefficient, power) => sum + coefficient * x ** (power + 1) / (power + 1), 0);
  return primitive(to) - primitive(from);
}

export function teachingVisualIssues(document: TeachingDerivationDocumentV1, step: TeachingDerivationStepV1): { code: string; message: string; path?: string }[] {
  const issues: { code: string; message: string; path?: string }[] = [];
  const problem = (code: string, message: string, path?: string) => issues.push({ code, message, path });
  for (const [path, indexes] of [
    ["givenIndexes", step.givenIndexes],
    ...(step.cues ?? []).map(cue => [`cues.${cue.id}.givenIndexes`, cue.givenIndexes] as const),
  ] as const) {
    if (indexes && (new Set(indexes).size !== indexes.length || indexes.some(index => !document.givens[index])))
      problem("given_index_invalid", "Select existing zero-based given indexes once; do not invent or rewrite premises", path);
  }
  const visual = step.visual;
  let targetIds: readonly string[] = [];
  if (visual?.kind === "plot") {
    const [from, to] = visual.domain;
    const ids = [...visual.regions, ...visual.markers].map(item => item.id);
    const values = Array.from({length: 241}, (_, index) => teachingPolynomialValue(visual.coefficients, from + (to - from) * index / 240));
    if (from >= to || !Number.isFinite(to - from))
      problem("visual_domain_invalid", "The plotted domain must be a finite, representable increasing interval", "visual.domain");
    else if (values.some(value => !Number.isFinite(value)) || !Number.isFinite(Math.max(0, ...values) - Math.min(0, ...values))
      || [visual.domain, ...visual.regions.map(region => region.interval)].some(([a, b]) => !Number.isFinite(teachingPolynomialIntegral(visual.coefficients, a!, b!))))
      problem("visual_numeric_capacity", "The plot exceeds numerical capacity. Use source-grounded units or a supported accepted visual; do not change the formula to fit", "visual");
    if (new Set(ids).size !== ids.length) problem("visual_target_duplicate", "Plot region and marker IDs must be unique", "visual");
    visual.regions.forEach((region, index) => {
      if (region.interval[0] < from || region.interval[1] > to || region.interval[0] >= region.interval[1])
        problem("visual_region_invalid", "A signed area must use an increasing interval inside the plotted domain", `visual.regions.${index}`);
    });
    if (visual.markers.some(marker => marker.x < from || marker.x > to))
      problem("visual_marker_invalid", "Each marked x value must lie inside the plotted domain", "visual.markers");
    targetIds = ids;
  } else if (visual?.kind === "image") {
    const asset = document.visualAssets?.find(item => item.id === visual.assetId);
    if (!asset) problem("visual_asset_missing", "Select an image ID from this run's accepted visualAssets catalog", "visual.assetId");
    targetIds = asset?.segmentation.regions.map(region => region.id) ?? [];
  } else if (visual?.kind === "display") {
    const source = document.visualDisplays?.find(item => item.id === visual.displayId);
    if (!source) problem("visual_display_missing", "Select an ID from this run's accepted visualDisplays catalog", "visual.displayId");
    targetIds = source?.targetIds ?? [];
  }
  for (const cue of step.cues ?? []) {
    if (cue.visualTargetIds?.some(id => !targetIds.includes(id)))
      problem("visual_target_missing", "Visual cue targets must name actual plot regions/markers or observed image regions", `cues.${cue.id}.visualTargetIds`);
  }
  return issues;
}

/** Pure cue selection, shared by reading, classroom and exact film seeks. */
export function teachingExplanationFrame(document: TeachingDerivationDocumentV1, step: TeachingDerivationStepV1, cueId?: string) {
  const cue = cueId ? step.cues?.find(item => item.id === cueId) : step.cues?.[0];
  const indexes = cue?.givenIndexes ?? step.givenIndexes ?? [];
  const previousStep = document.steps[step.index - 2];
  const previousCue = cue && (step.cues?.indexOf(cue) ?? 0) > 0
    ? step.cues?.[step.cues.indexOf(cue) - 1]
    : previousStep && JSON.stringify(previousStep.visual) === JSON.stringify(step.visual) ? previousStep.cues?.at(-1) : undefined;
  return {
    cue,
    text: cue?.onScreenText ?? cue?.text ?? step.justification,
    givens: indexes.flatMap(index => document.givens[index] ? [document.givens[index]!] : []),
    visualTargetIds: cue?.visualTargetIds ?? [],
    previousVisualTargetIds: previousCue?.visualTargetIds ?? [],
  };
}
