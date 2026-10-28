import { z } from "zod";
/** Facts about a request's display surface; no product identity or authored policy. */
export const presentationCapabilitiesSchema = z.object({
  version: z.literal(1), supportedDisplayTypes: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1),
  maxStageFigures: z.number().int().min(1).max(4),
  allowedStageLayouts: z.array(z.enum(["split-h", "split-v", "main+rail", "stack"])),
  stageRoles: z.object({ mainTypes: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1),
    helperTypes: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1) }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.stageRoles && value.maxStageFigures < 2) ctx.addIssue({code: "custom", path: ["stageRoles"], message: "Main/helper stages require capacity for two figures"});
  if (value.supportedDisplayTypes.includes("stage") && !value.allowedStageLayouts.length) ctx.addIssue({code: "custom", path: ["allowedStageLayouts"], message: "A supported stage requires a layout"});
  for (const type of [...(value.stageRoles?.mainTypes ?? []), ...(value.stageRoles?.helperTypes ?? [])])
    if (!value.supportedDisplayTypes.includes(type)) ctx.addIssue({code: "custom", path: ["stageRoles"], message: `Stage role ${type} must also be a supported display`});
});
export type PresentationCapabilities = z.infer<typeof presentationCapabilitiesSchema>;

export function presentationDisplayIssues(value: unknown, capabilities?: PresentationCapabilities): string[] {
  if (!capabilities || !value || typeof value !== "object") return [];
  const display = value as Record<string, unknown>;
  const type = String(display.type ?? "");
  if (!capabilities.supportedDisplayTypes.includes(type)) return [`Display ${type} is not supported by this request's presentation capabilities`];
  if (type !== "stage") return [];
  const figures = Array.isArray(display.figures) ? display.figures : [];
  const issues: string[] = [];
  if (!capabilities.allowedStageLayouts.includes(display.layout as never)) issues.push("Stage layout is not supported by this request's presentation capabilities");
  if (figures.length > capabilities.maxStageFigures) issues.push(`Stage exceeds the supported ${capabilities.maxStageFigures} figures`);
  if (capabilities.stageRoles) {
    if (figures.length !== 2) issues.push("Stage requires exactly one main figure and one helper figure");
    const types = figures.map(figure => String((figure as Record<string, unknown>)?.type));
    if (!capabilities.stageRoles.mainTypes.includes(types[0]!)) issues.push(`Stage main figure must be ${capabilities.stageRoles.mainTypes.join(" or ")}`);
    if (!capabilities.stageRoles.helperTypes.includes(types[1]!)) issues.push(`Stage helper figure must be ${capabilities.stageRoles.helperTypes.join(" or ")}`);
  }
  figures.forEach(figure => issues.push(...presentationDisplayIssues(figure, capabilities)));
  return issues;
}
