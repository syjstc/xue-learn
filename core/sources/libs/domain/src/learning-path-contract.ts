import { z } from "zod";
import { COGNITIVE_DIMENSIONS } from "./module-objective-authority.js";

const text = z.string().trim().min(1).max(600);
const key = z.string().regex(/^[a-z][a-z0-9_.:-]*$/).max(120);
const dimensions = z.array(z.enum(COGNITIVE_DIMENSIONS)).min(1).max(7);

/** These are KACOM semantic identities and target requirements, never learner state. */
export const pathEntitySchema = z.object({
  semanticKey: key,
  kind: z.enum(["atom", "concept", "skill", "competency"]),
  title: text,
  description: text,
  scope: text,
});
export const pathRequirementSchema = z.object({
  entityKey: key,
  dimensions,
  threshold: z.number().gt(0).max(1),
});
export const pathDependencySchema = pathRequirementSchema.extend({
  /** baseline, or the exact earlier unitRef supplying this requirement. */
  source: z.string().regex(/^(baseline|u_[1-8]_[1-9]\d*)$/),
  rationale: text,
});
export const pathAssessmentSchema = z.object({
  task: text,
  criteria: z.array(text).min(1).max(6),
  assistance: z.enum(["independent", "light_hint", "guided"]),
  context: z.enum(["same", "near", "far"]),
});
export const pathUnitSchema = z.object({
  unitRef: z.string().regex(/^u_[1-8]_[1-9]\d*$/),
  title: text,
  summary: text,
  difficulty: z.enum(["easy", "medium", "hard"]),
  milestoneRole: z.enum(["introduce", "practice", "integrate", "verify"]),
  requires: z.array(pathDependencySchema).max(12),
  provides: z.array(pathRequirementSchema).min(1).max(8),
  /** Module exit identities this lesson helps build (not a mastery assertion). */
  supports: z.array(key).min(1).max(4),
  assessment: pathAssessmentSchema,
  rationale: text,
});
export const pathModuleSchema = z.object({
  moduleRef: z.string().regex(/^m_[1-8]$/),
  requires: z.array(pathDependencySchema).max(16),
  provides: z.array(pathRequirementSchema).min(1).max(8),
  assessment: pathAssessmentSchema,
  rationale: text,
  units: z.array(pathUnitSchema).min(1).max(20),
});
export const learningPathContractSchema = z.object({
  schemaVersion: z.literal(1),
  entities: z.array(pathEntitySchema).min(1).max(240),
  baseline: z.array(pathRequirementSchema.extend({
    status: z.enum(["reported", "unknown"]),
    rationale: text,
  })).max(24),
  goal: z.object({
    outcomes: z.array(z.object({
      outcomeRef: z.string().regex(/^o_[1-9]\d*$/),
      requires: z.array(pathRequirementSchema).min(1).max(8),
    })).min(1).max(12),
    assessment: pathAssessmentSchema,
  }),
  modules: z.array(pathModuleSchema).min(1).max(8),
});

export type LearningPathContract = z.infer<typeof learningPathContractSchema>;
export type PathModuleContract = z.infer<typeof pathModuleSchema>;
export type PathUnitContract = z.infer<typeof pathUnitSchema>;
export type PathRequirement = z.infer<typeof pathRequirementSchema>;
export type PathEntity = z.infer<typeof pathEntitySchema>;
export type LearningPathIssue = { code: string; at: string; message: string };
export type LearningPathValidation = {
  status: "invalid" | "conditional";
  issues: LearningPathIssue[];
  moduleCount: number;
  unitCount: number;
  dependencyCount: number;
  unverifiedBaselineCount: number;
};

/** All dimensions must be available at the same or stronger declared threshold. */
export function pathRequirementsCover(
  available: readonly PathRequirement[],
  required: PathRequirement,
): boolean {
  return required.dimensions.every((dimension) =>
    available.some((entry) =>
      entry.entityKey === required.entityKey &&
      entry.dimensions.includes(dimension) &&
      entry.threshold >= required.threshold,
    ),
  );
}

/**
 * Checks declared curriculum closure. It does not prove teaching effectiveness,
 * validate the learner's baseline, or write KACOM evidence/mastery estimates.
 */
export function validateLearningPath(
  path: LearningPathContract,
  expected: { moduleCount: number; outcomeCount: number },
): LearningPathValidation {
  const issues: LearningPathIssue[] = [];
  const issue = (code: string, at: string, message: string) =>
    issues.push({ code, at, message });
  const entities = new Map<string, PathEntity>();
  for (const entity of path.entities) {
    if (entities.has(entity.semanticKey)) {
      issue("duplicate_identity", entity.semanticKey, "Reuse one KACOM semantic identity.");
    }
    entities.set(entity.semanticKey, entity);
  }
  const usedEntities = new Set<string>();
  const checkRefs = (entries: readonly PathRequirement[], at: string) => {
    for (const entry of entries) {
      usedEntities.add(entry.entityKey);
      if (!entities.has(entry.entityKey)) {
        issue("unknown_entity", at, `Unknown KACOM identity ${entry.entityKey}.`);
      }
      if (new Set(entry.dimensions).size !== entry.dimensions.length) {
        issue("duplicate_dimension", at, `Repeated dimension for ${entry.entityKey}.`);
      }
    }
  };
  checkRefs(path.baseline, "baseline");
  if (path.modules.length !== expected.moduleCount) {
    issue("module_coverage", "modules", "Every planned module needs exactly one contract.");
  }
  const units = new Map<string, { unit: PathUnitContract; moduleIndex: number }>();
  let dependencyCount = 0;
  const available: PathRequirement[] = [...path.baseline];
  const checkDependency = (
    dependency: z.infer<typeof pathDependencySchema>,
    at: string,
    moduleIndex: number,
    moduleEntry: boolean,
  ) => {
    dependencyCount += 1;
    checkRefs([dependency], at);
    if (dependency.source === "baseline") {
      if (!pathRequirementsCover(path.baseline, dependency)) {
        issue("missing_baseline", at, `Baseline does not supply ${dependency.entityKey} at the required dimensions/threshold.`);
      }
      return;
    }
    const provider = units.get(dependency.source);
    if (!provider || (moduleEntry && provider.moduleIndex >= moduleIndex)) {
      issue("forward_dependency", at, `${dependency.source} is missing, self-referential, or not earlier.`);
      return;
    }
    if (!pathRequirementsCover(provider.unit.provides, dependency)) {
      issue("insufficient_output", at, `${dependency.source} does not supply ${dependency.entityKey} at the required dimensions/threshold.`);
    }
    if (provider.moduleIndex !== moduleIndex &&
        !pathRequirementsCover(path.modules[provider.moduleIndex]!.provides, dependency)) {
      issue("unexported_capability", at, `The preceding module must expose ${dependency.entityKey} in its exit contract.`);
    }
  };
  path.modules.forEach((module, moduleIndex) => {
    const moduleRef = `m_${moduleIndex + 1}`;
    if (module.moduleRef !== moduleRef) {
      issue("module_identity", module.moduleRef, `Expected ${moduleRef} in curriculum order.`);
    }
    module.requires.forEach((requirement) =>
      checkDependency(requirement, moduleRef, moduleIndex, true),
    );
    checkRefs(module.provides, moduleRef);
    const moduleOutputs: PathRequirement[] = [];
    const supported = new Set<string>();
    const titles = new Set<string>();
    const exitKeys = module.provides.map((entry) => entry.entityKey);
    if (new Set(exitKeys).size !== exitKeys.length) {
      issue("duplicate_module_exit", moduleRef, "Combine dimensions into a single requirement per module exit identity.");
    }
    module.units.forEach((unit, unitIndex) => {
      const at = `${moduleRef}/${unit.unitRef}`;
      if (titles.has(unit.title)) issue("duplicate_unit_title", at, "Use distinct lesson titles within a module.");
      titles.add(unit.title);
      if (unit.unitRef !== `u_${moduleIndex + 1}_${unitIndex + 1}` ||
          units.has(unit.unitRef)) {
        issue("unit_identity", at, "Unit refs must be unique and match their ordered module/lesson positions.");
      }
      unit.requires.forEach((requirement) => {
        checkDependency(requirement, at, moduleIndex, false);
        const provider = units.get(requirement.source);
        if (requirement.source === "baseline" || provider?.moduleIndex !== moduleIndex) {
          if (!module.requires.some((entry) =>
            entry.source === requirement.source &&
            pathRequirementsCover([entry], requirement),
          )) {
            issue("hidden_module_input", at, `Expose ${requirement.entityKey} and its source in the module entry contract.`);
          }
        }
      });
      checkRefs(unit.provides, at);
      if (new Set([...unit.requires, ...unit.provides].map((entry) => entry.entityKey)).size > 18) {
        issue("unit_scope_too_large", at, "Split this lesson: its planned KACOM identities exceed the unit generation budget.");
      }
      const exitKeys = new Set(module.provides.map((entry) => entry.entityKey));
      for (const supportedKey of unit.supports) {
        if (!exitKeys.has(supportedKey)) {
          issue("unknown_module_exit", at, `This lesson supports an unknown module exit ${supportedKey}.`);
        }
        supported.add(supportedKey);
      }
      for (const output of unit.provides) {
        if (output.dimensions.includes("transfer") && unit.assessment.context !== "far") {
          issue("transfer_evidence", at, "Transfer requires a far-context assessment.");
        }
        if (output.dimensions.includes("independence") &&
            unit.assessment.assistance !== "independent") {
          issue("independence_evidence", at, "Independence requires an unaided assessment.");
        }
      }
      units.set(unit.unitRef, { unit, moduleIndex });
      moduleOutputs.push(...unit.provides);
    });
    for (const output of module.provides) {
      if (!pathRequirementsCover(moduleOutputs, output)) {
        issue("module_exit_gap", moduleRef, `No lesson delivers the declared exit ${output.entityKey}.`);
      }
      if (!supported.has(output.entityKey)) {
        issue("unsupported_exit", moduleRef, `No lesson is assigned to ${output.entityKey}.`);
      }
      if (output.dimensions.includes("transfer") && module.assessment.context !== "far") {
        issue("module_transfer_evidence", moduleRef, "Module transfer needs a far-context assessment.");
      }
      if (output.dimensions.includes("independence") && module.assessment.assistance !== "independent") {
        issue("module_independence_evidence", moduleRef, "Module independence needs an unaided assessment.");
      }
    }
    available.push(...module.provides);
  });
  const expectedOutcomes = new Set(
    Array.from({ length: expected.outcomeCount }, (_, i) => `o_${i + 1}`),
  );
  const seenOutcomes = new Set<string>();
  for (const outcome of path.goal.outcomes) {
    if (!expectedOutcomes.has(outcome.outcomeRef) || seenOutcomes.has(outcome.outcomeRef)) {
      issue("outcome_identity", outcome.outcomeRef, "Outcome refs must match the confirmed goal exactly once.");
    }
    seenOutcomes.add(outcome.outcomeRef);
    checkRefs(outcome.requires, outcome.outcomeRef);
    for (const requirement of outcome.requires) {
      if (!pathRequirementsCover(available, requirement)) {
        issue("goal_exit_gap", outcome.outcomeRef, `The path never supplies ${requirement.entityKey} at the requested level.`);
      }
      if (requirement.dimensions.includes("transfer") && path.goal.assessment.context !== "far") {
        issue("goal_transfer_evidence", outcome.outcomeRef, "The final task must assess far-context transfer.");
      }
      if (requirement.dimensions.includes("independence") &&
          path.goal.assessment.assistance !== "independent") {
        issue("goal_independence_evidence", outcome.outcomeRef, "The final task must assess independent performance.");
      }
    }
  }
  for (const ref of expectedOutcomes) {
    if (!seenOutcomes.has(ref)) issue("missing_outcome", ref, "The confirmed goal outcome has no requirement contract.");
  }
  for (const entity of path.entities) {
    if (!usedEntities.has(entity.semanticKey)) {
      issue("unused_entity", entity.semanticKey, "Remove identities that do not contribute to this path.");
    }
  }
  return {
    status: issues.length ? "invalid" : "conditional",
    issues,
    moduleCount: path.modules.length,
    unitCount: path.modules.reduce((sum, module) => sum + module.units.length, 0),
    dependencyCount,
    unverifiedBaselineCount: path.baseline.length,
  };
}
