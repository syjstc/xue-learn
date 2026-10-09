import type { LearningUnitRepository } from "../../../domain/src/index.js";

let configured:
  Pick<LearningUnitRepository, "findModulePromptContext"> | undefined;

export function configureModulePromptContextPersistence(
  repository:
    Pick<LearningUnitRepository, "findModulePromptContext"> | undefined,
): void {
  configured = repository;
}

export async function getUnitModulePromptBlock(
  unitId: string,
): Promise<string> {
  if (!configured)
    throw new Error("Module-prompt persistence is not configured");
  const context = await configured.findModulePromptContext(unitId);
  if (!context) return "";
  const refs = context.moduleCapabilityRefs;
  return `Sequential module context:
- Module: ${context.moduleTitle}
- Module objective: ${context.moduleObjective}
- This unit contributes to: ${refs.join(", ") || "supporting module work"}
- Module exit capabilities:
${context.learningTargets
  .filter((mapping) => mapping.role !== "entry")
  .map((mapping, index) => {
    const ref = /^lt_\d+$/.test(mapping.localRef)
      ? mapping.localRef.replace(/^lt_/, "mc_")
      : /^mc_\d+$/.test(mapping.localRef)
        ? mapping.localRef
        : `mc_${index + 1}`;
    return `  - ${ref}: ${mapping.title} — ${mapping.learningObjective}`;
  })
  .join("\n")}
Explain how this lesson advances the module milestone without reteaching the whole course. Do not preview locked future modules.`;
}
