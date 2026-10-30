import { z } from "zod";
import { compileMathExpression } from "./math-scene.js";
export {readingResultMarkdown, readingResultParts, readingProseMarkdown, readingPremiseMarkdown} from "./reading-math.js";

const text = z.string().trim().min(1);
const id = text.max(80).regex(/^[A-Za-z][A-Za-z0-9_-]*$/);

/** Authoring contains content only. Job IDs, revisions and presentation are host-owned. */
export const readingBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text }),
  z.object({ type: z.literal("paragraph"), text }),
  z.object({ type: z.literal("callout"), title: text, body: text,
    variant: z.enum(["definition", "example", "tip", "warning"]) }),
  z.object({ type: z.literal("accordion"), title: text, body: text }),
  z.object({ type: z.literal("steps"), title: text,
    items: z.array(z.object({title: text, body: text})).min(2).max(8) }),
  z.object({ type: z.literal("comparison"), title: text,
    items: z.array(z.object({title: text, body: text})).min(2).max(3) }),
  z.object({ type: z.literal("concept_grid"), title: text,
    items: z.array(z.object({term: text, definition: text})).min(2).max(6) }),
  z.object({ type: z.literal("summary"), title: text,
    items: z.array(text).min(2).max(6) }),
  z.object({ type: z.literal("check"), question: text,
    options: z.array(text).min(2).max(8), correctIndex: z.number().int().nonnegative(), explanation: text }),
  z.object({ type: z.literal("component_slot"), title: text,
    componentType: z.enum(["plot", "svg", "image", "derivation"]), description: text.max(4000),
    sourceId: id.optional() }),
]).superRefine((block, ctx) => {
  if (block.type === "check" && block.correctIndex >= block.options.length)
    ctx.addIssue({code: "custom", path: ["correctIndex"], message: "Answer must refer to an existing option"});
});
export const readingDraftSchema = z.object({
  title: text.max(240),
  blocks: z.array(readingBlockSchema).min(1).max(160),
});
export type ReadingDraft = z.infer<typeof readingDraftSchema>;
export type ReadingBlock = z.infer<typeof readingBlockSchema>;

/** Mathematical dependencies are retained; motion and speech are derived separately. */
export const readingDerivationSchema = z.object({
  title: text,
  premises: z.array(z.object({ id, text })).max(24),
  steps: z.array(z.object({
    id, result: text.max(4000), reason: text.max(2000),
    dependsOn: z.array(id).max(24),
    condition: text.max(1000).optional(),
    relation: z.enum(["equivalence", "imply", "substitute", "introduce"]).optional(),
  })).min(1).max(80),
}).superRefine((document, ctx) => {
  const seen = new Set<string>();
  document.premises.forEach((premise, index) => {
    if (seen.has(premise.id)) ctx.addIssue({code: "custom", path: ["premises", index, "id"], message: "Duplicate premise ID"});
    seen.add(premise.id);
  });
  document.steps.forEach((step, index) => {
    if (seen.has(step.id)) ctx.addIssue({code: "custom", path: ["steps", index, "id"], message: "Duplicate step ID"});
    for (const dependency of step.dependsOn)
      if (!seen.has(dependency)) ctx.addIssue({code: "custom", path: ["steps", index, "dependsOn"], message: `Unknown or forward dependency: ${dependency}`});
    seen.add(step.id);
  });
});
export type ReadingDerivation = z.infer<typeof readingDerivationSchema>;

const range = z.tuple([z.number().finite(), z.number().finite()])
  .refine(([min, max]) => min < max, "Range must increase");
export const readingPlotSchema = z.object({
  title: text,
  functions: z.array(z.object({ expression: text.max(500), label: text.max(160) })).min(1).max(6),
  xRange: range, yRange: range,
  parameters: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,19}$/).refine(value => !["pi", "e", "tau"].includes(value), "Reserved mathematical constant"),
    name: text.max(40), min: z.number().finite(), max: z.number().finite(),
    step: z.number().positive().finite(), default: z.number().finite(),
  }).refine(p => p.min < p.max && p.default >= p.min && p.default <= p.max, "Invalid slider range")).max(6),
  caption: text,
}).superRefine((plot, ctx) => {
  const names = plot.parameters.map(parameter => parameter.id);
  if (names.includes("x") || new Set(names).size !== names.length)
    ctx.addIssue({code: "custom", path: ["parameters"], message: "Parameter names must be unique and distinct from x"});
  plot.functions.forEach((fn, index) => {
    try {compileMathExpression(fn.expression, ["x", ...names]);}
    catch (error) {ctx.addIssue({code: "custom", path: ["functions", index, "expression"], message: String(error)});}
  });
});
export type ReadingPlot = z.infer<typeof readingPlotSchema>;

export type ReadingComponentArtifact =
  | { type: "derivation"; document: ReadingDerivation }
  | { type: "plot"; plot: ReadingPlot }
  | { type: "svg"; svg: string; caption: string; alt: string }
  | { type: "image"; imageUrl: string; caption: string };
export type ReadingJobStatus = "pending" | "running" | "ready" | "failed" | "cancelled";
export type ReadingComponent = {
  jobId: string; status: ReadingJobStatus; error?: string; artifact?: ReadingComponentArtifact;
};
export type ReadingDocument = {
  version: 1; title: string;
  blocks: Array<ReadingBlock & { id: string; component?: ReadingComponent }>;
};
export type ReadingSnapshot = {
  jobId: string; revision: number; status: ReadingJobStatus; error?: string;
  document: ReadingDocument | null; pendingComponents: number;
};
export type ReadingCourse = {
  unitId: string; title: string; language: string;
  sections: Array<{ id: string; title: string; scope: string; reading: ReadingSnapshot | null }>;
};

export function readingPlotScene(plot: ReadingPlot) {
  return {
    type: "math_scene" as const, title: plot.title, dimension: "2d" as const,
    coordinateSystem: "cartesian" as const, xRange: plot.xRange, yRange: plot.yRange,
    objects: plot.functions.map((fn, index) => ({
      id: `function_${index}`, kind: "function" as const, variable: "x" as const,
      expression: fn.expression, label: fn.label, domain: plot.xRange,
    })),
    parameters: plot.parameters, showGrid: true, showAxes: true, summary: plot.caption,
  };
}
