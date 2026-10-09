import { z } from "zod";
import { compileTeachingDerivation } from "./compile.js";
import { teachingPresentationHash } from "./teaching-plan.js";
import type { TeachingDerivationDocumentV1 } from "./types.js";

export const teachingLineageRepairSchema = z.object({
  expectedRevision: z.number().int().min(0),
  expectedHash: z.string().min(1),
  links: z
    .array(
      z.object({
        stepIndex: z.number().int().min(2),
        formulaKey: z.string().min(1),
        source: z.object({
          stepIndex: z.number().int().min(1),
          formulaKey: z.string().min(1),
        }),
        cueId: z.string().min(1),
        relation: z.enum(["equivalence", "imply", "substitute"]).optional(),
      }),
    )
    .min(1)
    .max(80),
});
export type TeachingLineageRepair = z.infer<typeof teachingLineageRepairSchema>;

/** Explicit, reviewed links only. Never infer mathematical lineage from similarity. */
export function repairTeachingLineage(
  document: TeachingDerivationDocumentV1,
  input: TeachingLineageRepair,
) {
  const patch = teachingLineageRepairSchema.parse(input);
  if (teachingPresentationHash(document) !== patch.expectedHash)
    throw new Error("Lineage source changed");
  const next = structuredClone(document);
  const steps = [...next.steps];
  const seen = new Set<number>();
  for (const link of patch.links) {
    if (seen.has(link.stepIndex)) throw new Error("Repair each step once");
    seen.add(link.stepIndex);
    const step = steps[link.stepIndex - 1];
    const formula = step?.board.find(
      (f) => f.key === link.formulaKey && f.role === "primary",
    );
    const source = steps[link.source.stepIndex - 1]?.board.find(
      (f) => f.key === link.source.formulaKey && f.role === "primary",
    );
    if (
      !step ||
      !formula ||
      !source ||
      link.source.stepIndex !== link.stepIndex - 1
    )
      throw new Error("Repair requires an explicit adjacent primary source");
    if (!step.cues?.some((c) => c.id === link.cueId))
      throw new Error("Repair cue is missing");
    const relation = link.relation ?? step.relation;
    if (!["equivalence", "imply", "substitute"].includes(relation))
      throw new Error("Repair requires a transformation relation");
    steps[link.stepIndex - 1] = {
      ...step,
      relation,
      board: step.board.map((f) =>
        f === formula ? { ...f, source: link.source, change: "transform" } : f,
      ),
      cues: step.cues.map((c) => ({
        ...c,
        startTransform: c.id === link.cueId,
      })),
    };
  }
  const repaired: TeachingDerivationDocumentV1 = {
    ...next,
    steps,
    revision: document.revision + 1,
    lineageBackup: document.lineageBackup ?? structuredClone(document.steps),
  };
  const before = compileTeachingDerivation(document);
  const derived = compileTeachingDerivation(repaired);
  for (const link of patch.links) {
    const oldIssues = new Set(
      before.steps[link.stepIndex - 1]?.presentation?.issues.map((i) =>
        JSON.stringify(i),
      ),
    );
    if (
      derived.steps[link.stepIndex - 1]?.presentation?.issues.some(
        (i) => !oldIssues.has(JSON.stringify(i)),
      )
    )
      throw new Error("Lineage repair invalidates teaching targets or cues");
  }
  return { document: repaired, derived };
}
