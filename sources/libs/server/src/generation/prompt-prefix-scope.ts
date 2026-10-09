import type { PromptPrefixScope } from "./prompt-prefix.js";

function canonicalOperationKey(operation: string): string {
  let current = operation.trim();
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const suffix of [".retry", ".repair"]) {
      if (!current.endsWith(suffix)) continue;
      current = current.slice(0, -suffix.length);
      stripped = true;
      break;
    }
  }
  return current;
}

const PLATFORM_OPERATIONS = new Set([
  "teaching_persona.preview",
  "admin.formal_derivation.author",
  "admin.formal_derivation.expand",
  "unit.formal_derivation.author",
  "unit.teaching_derivation.author",
  "memory.candidates.extract",
  "agenda.refine",
  "goal.curriculum.plan.deep_synthesis",
  "goal_plan.content_repair",
  "survey.content_verify",
  "survey.content_repair",
  "material.content_verify",
  "material.content_repair",
  "mini_test.content_verify",
  "mini_test.content_repair",
  "assessment.content_verify",
  "assessment.content_repair",
  "eval.rubric_judge",
]);

const GOAL_AUDIT_OPERATIONS = new Set([
  "goal.module_structure.audit",
  "module.kacom.audit",
]);

const MODULE_AUTHORING_OPERATIONS = new Set([
  "module.capabilities",
  "module.structure",
  "module.exploration_structure",
  "module.diagnostic",
]);

export function preferredPromptPrefixScope(
  operation: string,
  subject: { goalId?: string; moduleId?: string; unitId?: string } = {},
): PromptPrefixScope {
  const key = canonicalOperationKey(operation);
  if (PLATFORM_OPERATIONS.has(key)) return "platform";
  if (GOAL_AUDIT_OPERATIONS.has(key) || key.startsWith("goal.")) return "goal";
  if (MODULE_AUTHORING_OPERATIONS.has(key)) return "module";
  if (
    key.startsWith("unit.") ||
    key.startsWith("cognitive_model.") ||
    key === "subdivide"
  ) {
    return "unit";
  }
  if (key.startsWith("agent.")) {
    if (subject.unitId) return "unit";
    if (subject.moduleId) return "module";
    if (subject.goalId) return "goal";
    return "learner";
  }
  if (subject.unitId) return "unit";
  if (subject.moduleId) return "module";
  if (subject.goalId) return "goal";
  return "learner";
}
