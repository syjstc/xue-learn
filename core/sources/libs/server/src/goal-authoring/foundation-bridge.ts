import { z } from "zod";
import {
  pathEntitySchema,
  learningPathContractSchema,
  pathModuleSchema,
  pathRequirementsCover,
  validateLearningPath,
  type PathRequirement,
  type PathModuleContract,
} from "../../../domain/src/learning-path-contract.js";
import type { GoalMapPlan } from "../llm/schemas.js";
import { runGoalAuthoringRound } from "./runner.js";
import { goalAuthoringCheckpointKey } from "./path.js";

export type FoundationBridgeProposal = {
  entities: z.infer<typeof pathEntitySchema>[];
  module: PathModuleContract;
};

/** Leave room for a bounded bridge without changing an existing module's assessment. */
export function canAddFoundationBridge(
  plan: GoalMapPlan,
  entityKey: string,
): boolean {
  const first = plan.learningPath?.modules[0];
  const foundation = plan.learningPath?.baseline.find(
    (entry) => entry.entityKey === entityKey,
  );
  return Boolean(
    first &&
    foundation &&
    plan.modules?.length &&
    first.units.length <= 17 &&
    (first.provides.length < 8 ||
      first.provides.some((entry) => entry.entityKey === entityKey)) &&
    (!foundation.dimensions.includes("transfer") ||
      first.assessment.context === "far") &&
    (!foundation.dimensions.includes("independence") ||
      first.assessment.assistance === "independent"),
  );
}

/** Reuse the validated curriculum; only the explicitly rejected entry assumption changes. */
export function mergeFoundationBridge(
  plan: GoalMapPlan,
  entityKey: string,
  proposal: FoundationBridgeProposal,
): GoalMapPlan {
  const original = plan.learningPath;
  if (!original || !plan.modules?.length)
    throw new Error("A validated capability path is required.");
  const foundation = original.baseline.find(
    (entry) => entry.entityKey === entityKey,
  );
  if (!foundation)
    throw new Error(
      "The selected foundation is no longer an entry assumption.",
    );
  const result = structuredClone(plan);
  const path = result.learningPath!;
  const first = path.modules[0]!;
  const count = proposal.module.units.length;
  if (count < 1 || count > 3)
    throw new Error("Use one to three focused foundation lessons.");
  const providers = proposal.module.units;
  const sourceFor = (requirement: PathRequirement) => {
    const provider = [...providers]
      .reverse()
      .find((unit) => pathRequirementsCover(unit.provides, requirement));
    if (!provider)
      throw new Error(
        "The bridge must supply every rejected foundation requirement.",
      );
    return provider.unitRef;
  };
  const shiftSource = (source: string) => {
    const match = /^u_1_(\d+)$/.exec(source);
    return match ? `u_1_${Number(match[1]) + count}` : source;
  };
  for (const module of path.modules) {
    module.requires = module.requires.flatMap((requirement) => {
      if (
        requirement.source === "baseline" &&
        requirement.entityKey === entityKey
      ) {
        return module === first
          ? []
          : [{ ...requirement, source: sourceFor(requirement) }];
      }
      return [{ ...requirement, source: shiftSource(requirement.source) }];
    });
    for (const unit of module.units) {
      unit.unitRef = shiftSource(unit.unitRef);
      unit.requires = unit.requires.map((requirement) => ({
        ...requirement,
        source:
          requirement.source === "baseline" &&
          requirement.entityKey === entityKey
            ? sourceFor(requirement)
            : shiftSource(requirement.source),
      }));
    }
  }
  first.units.unshift(...structuredClone(providers));
  first.requires.push(...structuredClone(proposal.module.requires));
  first.requires = first.requires.filter(
    (entry, index, entries) =>
      entries.findIndex(
        (other) => JSON.stringify(other) === JSON.stringify(entry),
      ) === index,
  );
  const exported = first.provides.find(
    (entry) => entry.entityKey === entityKey,
  );
  if (exported) {
    exported.dimensions = [
      ...new Set([...exported.dimensions, ...foundation.dimensions]),
    ];
    exported.threshold = Math.max(exported.threshold, foundation.threshold);
  } else {
    const { entityKey: key, dimensions, threshold } = foundation;
    first.provides.push({
      entityKey: key,
      dimensions: [...dimensions],
      threshold,
    });
  }
  path.entities.push(...structuredClone(proposal.entities));
  path.baseline = path.baseline.filter(
    (entry) => entry.entityKey !== entityKey,
  );
  const title = path.entities.find(
    (entry) => entry.semanticKey === entityKey,
  )?.title;
  result.prerequisitesAssumed = result.prerequisitesAssumed?.filter(
    (item) => item !== title,
  );
  if (result.mapStructure) {
    result.mapStructure.estimatedLeafUnits = path.modules.reduce(
      (count, module) => count + module.units.length,
      0,
    );
  }
  learningPathContractSchema.parse(path);
  const validation = validateLearningPath(path, {
    moduleCount: result.modules!.length,
    outcomeCount: result.whatYouWillLearn.length,
  });
  if (validation.issues.length)
    throw new Error(
      validation.issues
        .map((issue) => `${issue.code} at ${issue.at}: ${issue.message}`)
        .join("\n"),
    );
  return result;
}

export async function addFoundationBridge(input: {
  userId: string;
  goalId: string;
  plan: GoalMapPlan;
  entityKey: string;
  contentLanguage: string;
  signal?: AbortSignal;
  onToken?: (delta: string) => void | Promise<void>;
}): Promise<GoalMapPlan> {
  const path = input.plan.learningPath;
  const foundation = path?.baseline.find(
    (entry) => entry.entityKey === input.entityKey,
  );
  const entity = path?.entities.find(
    (entry) => entry.semanticKey === input.entityKey,
  );
  if (!path || !foundation || !entity)
    throw new Error(
      "The selected foundation is no longer an entry assumption.",
    );
  const schema = z.preprocess((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const result = { ...value } as Record<string, unknown>;
    if (result.entities === null) result.entities = [];
    return result;
  }, z
    .object({
      part: z.literal("module"),
      entities: z.array(pathEntitySchema).max(8).default([]),
      module: pathModuleSchema,
    })
    .superRefine((proposal, ctx) => {
      try {
        mergeFoundationBridge(input.plan, input.entityKey, proposal);
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          path: ["module"],
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }));
  const proposal = await runGoalAuthoringRound({
    userId: input.userId,
    goalId: input.goalId,
    expectedTool: "commit_goal_path_part",
    operation: "goal.authoring_agent",
    markBlueprint: true,
    checkpointKey: `foundation-bridge:v1:${goalAuthoringCheckpointKey({ plan: input.plan, entityKey: input.entityKey })}`,
    prompt: `The learner explicitly cannot yet perform the entry foundation below. Add a focused bridge to the EXISTING validated plan, preserving all existing outcomes, module summaries, assessments and lesson contracts. Do not regenerate identity, outline, registry, or the curriculum. Write learner-facing strings in ${input.contentLanguage}.
REJECTED FOUNDATION: ${JSON.stringify({ entity, requirement: foundation })}
CURRENT PART: module. Call commit_goal_path_part with {part:"module",entities:[],module:{...}}. Author ONLY one to three short bridge lesson contracts, numbered u_1_1, u_1_2, u_1_3, inside m_1. The server prepends these lessons to the existing first module and remaps all previous references. Do not copy existing lessons or invent learner mastery.
The bridge must teach and verify ALL of the foundation's declared dimensions at its threshold. A single bridge lesson must supply every dimension needed by a dependent lesson. Its module.provides contains the rejected foundation, and every bridge lesson supports this identity. New local identities are allowed only when actually taught and needed; reuse declared identities below. No bridge lesson may depend on the rejected baseline or on the existing curriculum: use only other remaining baseline entries or an earlier bridge lesson. Every external unit requirement must also appear in module.requires with the same source, dimensions and threshold. Every requires entry needs rationale. Thresholds must be greater than zero. Transfer requires context=far and independence requires assistance=independent in the lesson's assessment.
REMAINING BASELINE: ${JSON.stringify(path.baseline.filter((entry) => entry.entityKey !== input.entityKey))}
DECLARED IDENTITIES: ${JSON.stringify(path.entities)}
EXISTING FIRST MODULE (context only; do not repeat it): ${JSON.stringify({ summary: input.plan.modules?.[0], assessment: path.modules[0]?.assessment })}`,
    resultSchema: schema,
    repairInstruction:
      "Repair only these bridge lessons. Keep the existing plan unchanged. Supply the rejected foundation without assuming it, use only remaining baseline inputs or earlier bridge lessons, and preserve exact declared identities. Never add another outline or curriculum.",
    maxRepairAttempts: 2,
    signal: input.signal,
    onToken: input.onToken,
    meta: { stage: "foundation_bridge", foundationEntityKey: input.entityKey },
  });
  return mergeFoundationBridge(input.plan, input.entityKey, proposal);
}
