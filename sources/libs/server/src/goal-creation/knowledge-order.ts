import { z } from "zod";

/** Local references are one-based positions in the ordered module catalog. */
export const lessonKnowledgeSequenceSchema = z.object({
  requiredKnowledge: z.array(z.string().trim().min(1)).max(24),
  taughtKnowledge: z.array(z.string().trim().min(1)).min(1).max(24),
  dependsOnUnits: z.array(z.number().int().min(1)).max(20),
  foundationsToTeachFirst: z.array(z.string().trim().min(1)).max(24),
});

export function validateLessonKnowledgeOrder(
  value: {
    units: readonly {
      knowledgeSequence?: z.infer<typeof lessonKnowledgeSequenceSchema>;
    }[];
  },
  ctx: z.RefinementCtx,
): void {
  value.units.forEach((unit, index) => {
    unit.knowledgeSequence?.dependsOnUnits.forEach((dependency, refIndex) => {
      if (dependency >= index + 1) {
        ctx.addIssue({
          code: "custom",
          path: [
            "units",
            index,
            "knowledgeSequence",
            "dependsOnUnits",
            refIndex,
          ],
          message: `Lesson ${index + 1} may depend only on earlier lessons; ${dependency} is a self, future or missing reference. Reorder or teach the foundation first.`,
        });
      }
    });
  });
}
