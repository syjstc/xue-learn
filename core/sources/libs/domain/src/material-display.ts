import { z } from "zod";
import type { DisplayDocument, DisplayNode } from "../../display/src/types.js";
import { validateDisplayDocument } from "../../display/src/validation.js";

const name = z.string().trim().min(1).max(256);
const nodeSchema: z.ZodType<DisplayNode> = z.lazy(() => z.object({
  id: name, kind: name, version: z.number().int().positive(), payload: z.unknown(),
  children: z.array(nodeSchema).optional(), slots: z.record(z.string(), z.array(nodeSchema)).optional(),
  targets: z.array(name).optional(),
  build: z.object({ jobId: name, status: z.enum(["pending", "running", "ready", "failed", "cancelled"]),
    sourceHash: z.string().optional(), revision: z.number().int().nonnegative().optional(), error: z.string().optional() }).strict().optional(),
}).strict());

export const materialDisplayDocumentSchema: z.ZodType<DisplayDocument> = z.object({
  version: z.literal(1), id: name, root: nodeSchema,
  plugins: z.array(z.object({id: name, version: name, integrity: z.string().optional()}).strict()),
  resources: z.array(z.object({id: name, kind: z.enum(["image", "audio", "video", "font", "data"]),
    uri: z.string().min(1), integrity: z.string().optional(), required: z.boolean().optional()}).strict()).optional(),
  timeline: z.array(z.object({id: name, startTick: z.number().int().nonnegative(), durationTicks: z.number().int().positive(),
    targets: z.array(name)}).strict()).optional(),
  ticksPerSecond: z.number().int().positive().optional(), durationTicks: z.number().int().nonnegative().optional(), seed: z.number().optional(),
}).strict().superRefine((value, ctx) => {
  for (const issue of validateDisplayDocument(value)) ctx.addIssue({code: "custom", message: issue.message});
});

/** Material wrapper shared by persisted courses and fresh provider output. */
export const materialDisplayBlockSchema = z.object({
  type: z.literal("display"), id: name, title: z.string().trim().min(1).max(200), document: materialDisplayDocumentSchema,
});
export type MaterialDisplayBlock = z.infer<typeof materialDisplayBlockSchema>;

/** Only an intent is authored. The host owns job IDs, scope and revisions. */
export const displayBuildIntentSchema = z.object({
  type: z.literal("display_build"), id: name, title: z.string().trim().min(1).max(200),
  pluginId: name, pluginVersion: name, builderId: name, input: z.record(z.string(), z.unknown()),
}).strict();
export type DisplayBuildIntent = z.infer<typeof displayBuildIntentSchema>;

export function displayDocumentTargets(document: DisplayDocument): string[] {
  const targets: string[] = [];
  const visit = (node: DisplayNode) => {
    targets.push(node.id, ...(node.targets ?? []).map(target => `${node.id}/${target}`));
    node.children?.forEach(visit);
    Object.values(node.slots ?? {}).forEach(children => children.forEach(visit));
  };
  visit(document.root);
  return targets;
}
