import { z } from "zod";
import {
  learningPathContractSchema,
  pathEntitySchema,
  pathModuleSchema,
  pathRequirementSchema,
  pathRequirementsCover,
  validateLearningPath,
  type LearningPathContract,
  type PathModuleContract,
  type PathEntity,
} from "../../../domain/src/learning-path-contract.js";
import { goalCurriculumJourneyBindingSchema, curriculumModuleJourneyStubSchema } from "../llm/schemas.js";

const modulesSchema = goalCurriculumJourneyBindingSchema.shape.modules;
/** Optional display-only alignment; structural curriculum edits use the module contract. */
export const goalPathModuleBriefSchema = curriculumModuleJourneyStubSchema.extend({
  title: z.string().trim().min(1).max(180),
  summary: z.string().trim().min(1).max(1200),
  objective: z.string().trim().min(1).max(600),
  dependsOnPrevious: z.string().trim().min(1).max(600),
}).strict();

export const goalPathRegistrySchema = learningPathContractSchema
  .omit({ schemaVersion: true, modules: true })
  .extend({
    moduleTargets: z.array(z.object({
      moduleRef: pathModuleSchema.shape.moduleRef,
      provides: z.array(pathRequirementSchema).min(1).max(8),
    })).min(1).max(8),
  });

/** One byte-stable provider tool for every path segment, including repairs. */
export const goalPathPartBindingSchema = z.object({
  part: z.enum(["outline", "registry", "module"]),
  modules: modulesSchema.nullish().describe("Only for part=outline: ordered module summaries. Omit or null for other parts."),
  registry: goalPathRegistrySchema.nullish().describe("Only for part=registry: shared identities, baseline, goal, and module output targets. Omit or null otherwise."),
  entities: z.array(pathEntitySchema).max(240).nullish().describe("Only for part=module: new bridge identities. Do not redefine existing identities. Omit or null otherwise."),
  module: pathModuleSchema.nullish().describe("Only for part=module: the requested module and its unit contracts. Omit or null otherwise."),
  moduleBrief: goalPathModuleBriefSchema.nullish().describe("Only for a metadata-only repair of the requested module: align its title/summary/objective/dependsOnPrevious to unchanged lesson contracts. Omit or null for ordinary authoring and structural repairs."),
});

/** Strict providers require all wire keys; null inactive fields carry no part. */
function pathPartResult<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const result = { ...value } as Record<string, unknown>;
    const active = result.part === "outline" ? "modules" : result.part === "registry" ? "registry" : "module";
    if (result.moduleBrief === null) delete result.moduleBrief;
    for (const key of ["modules", "registry", "module", "entities"]) {
      if (key !== active && result[key] === null) delete result[key];
    }
    return result;
  }, schema);
}

export const goalPathOutlineCommitSchema = pathPartResult(z.object({
  part: z.literal("outline"),
  modules: modulesSchema,
}).strict().superRefine(({ modules }, ctx) => {
  if (new Set(modules.map((module) => module.title)).size !== modules.length) {
    ctx.addIssue({ code: "custom", path: ["modules"], message: "Module titles must be distinct." });
  }
}));
export type GoalPathRegistry = z.infer<typeof goalPathRegistrySchema>;

export function registryCommitSchema(moduleCount: number, outcomeCount: number) {
  return pathPartResult(z.object({ part: z.literal("registry"), registry: goalPathRegistrySchema }).strict()
    .superRefine(({ registry }, ctx) => {
      const issue = (message: string) => ctx.addIssue({ code: "custom", path: ["registry"], message });
      const keys = new Set(registry.entities.map((entity) => entity.semanticKey));
      if (keys.size !== registry.entities.length) issue("Reuse existing identities; semanticKey values must be unique.");
      if (registry.moduleTargets.length !== moduleCount) issue("Include one output target for every frozen module.");
      registry.moduleTargets.forEach((target, index) => {
        if (target.moduleRef !== `m_${index + 1}`) issue(`Expected module target m_${index + 1}.`);
      });
      const available = [...registry.baseline, ...registry.moduleTargets.flatMap((target) => target.provides)];
      const used = new Set<string>();
      for (const requirement of [...available, ...registry.goal.outcomes.flatMap((outcome) => outcome.requires)]) {
        used.add(requirement.entityKey);
        if (!keys.has(requirement.entityKey)) issue(`Unknown identity ${requirement.entityKey}.`);
        if (new Set(requirement.dimensions).size !== requirement.dimensions.length) issue(`Repeated dimension for ${requirement.entityKey}.`);
      }
      for (const key of keys) if (!used.has(key)) issue(`Defer unused identity ${key} to the module that needs it.`);
      const refs = new Set(registry.goal.outcomes.map((outcome) => outcome.outcomeRef));
      if (refs.size !== outcomeCount || refs.size !== registry.goal.outcomes.length ||
          Array.from({ length: outcomeCount }, (_, i) => `o_${i + 1}`).some((ref) => !refs.has(ref))) {
        issue("Cover every frozen o_N outcome exactly once.");
      }
      for (const outcome of registry.goal.outcomes) for (const requirement of outcome.requires) {
        if (!pathRequirementsCover(available, requirement)) issue(`${outcome.outcomeRef}: no module target supplies ${requirement.entityKey} at every required dimension and threshold.`);
        if (requirement.dimensions.includes("transfer") && registry.goal.assessment.context !== "far") issue("Goal transfer requires a far-context task.");
        if (requirement.dimensions.includes("independence") && registry.goal.assessment.assistance !== "independent") issue("Goal independence requires an unaided task.");
      }
    }));
}

export function assemblePath(
  registry: GoalPathRegistry,
  entities: PathEntity[],
  modules: PathModuleContract[],
): LearningPathContract {
  return { schemaVersion: 1, entities, baseline: registry.baseline, goal: registry.goal, modules };
}

export function moduleCommitSchema(input: {
  registry: GoalPathRegistry;
  entities: PathEntity[];
  previous: PathModuleContract[];
  moduleCount: number;
  outcomeCount: number;
}) {
  const index = input.previous.length;
  return pathPartResult(z.object({
    part: z.literal("module"),
    entities: z.array(pathEntitySchema).max(240).default([]),
    module: pathModuleSchema,
  }).strict().superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", path: ["module"], message });
    const target = input.registry.moduleTargets[index]!;
    for (const requirement of target.provides) {
      if (!pathRequirementsCover(value.module.provides, requirement)) issue(`Preserve promised output ${requirement.entityKey}, dimensions and threshold for ${target.moduleRef}.`);
    }
    const path = assemblePath(input.registry, [...input.entities, ...value.entities], [...input.previous, value.module]);
    if (path.entities.length > 240) issue("The complete path exceeds 240 identities.");
    const complete = index + 1 === input.moduleCount;
    // Future identities/outcomes are pending. Every authored dependency and
    // module exit is still checked now, before it can become a checkpoint.
    const validationPath = complete ? path : { ...path, goal: { ...path.goal, outcomes: [] } };
    for (const entry of validateLearningPath(validationPath, {
      moduleCount: index + 1,
      outcomeCount: complete ? input.outcomeCount : 0,
    }).issues) {
      if (!complete && entry.code === "unused_entity") continue;
      issue(`${entry.code} at ${entry.at}: ${entry.message}`);
    }
  }));
}
