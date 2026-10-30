import { z } from "zod";
import {
  learningPathContractSchema,
  pathEntitySchema,
  pathModuleSchema,
  pathRequirementsCover,
  validateLearningPath,
  type LearningPathContract,
  type PathEntity,
  type PathModuleContract,
} from "../../../domain/src/learning-path-contract.js";
import { moduleStructureAuditIssueCodes } from "./module-structure-audit.js";
import { parseMapPlan } from "../goals/map-plan.js";
import { formatDeterministicPromptValue } from "../agents/goal-creation/contract.js";
import { runGoalAuthoringRound } from "../goal-authoring/runner.js";
import { pathContextForModule } from "./learning-path.js";
import { projectPathModule } from "./path-module-projection.js";

export type ModulePathRepair = {
  entities: PathEntity[];
  module: PathModuleContract;
};

/** Recover actionable findings even from retries saved by the old projection guard. */
export function pathAuditFindings(raw?: string, moduleId?: string): string[] {
  const findings = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 12) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, depth + 1));
    } else if (value && typeof value === "object") {
      const entry = value as Record<string, unknown>;
      if (moduleId && entry.moduleId && entry.moduleId !== moduleId) return;
      if (moduleStructureAuditIssueCodes.includes(entry.issueCode as never) &&
          typeof entry.reason === "string" && entry.reason.trim()) {
        findings.add(`${entry.issueCode}: ${entry.reason.trim()}`);
      }
    } else if (typeof value === "string" && value.trim()) {
      const text = value.trim().replace(/^The approved capability path needs revision:\s*/, "");
      try {
        visit(JSON.parse(text), depth + 1);
      } catch {
        if (moduleStructureAuditIssueCodes.some((code) => text.startsWith(`${code}:`))) {
          findings.add(text);
        }
      }
    }
  };
  visit(raw, 0);
  return [...findings];
}

function assertRepairBoundary(previous: PathModuleContract, next: PathModuleContract) {
  const signature = (module: PathModuleContract) => module.provides.map((entry) =>
    `${entry.entityKey}:${[...entry.dimensions].sort().join(",")}:${entry.threshold}`,
  ).sort().join("\n");
  if (previous.moduleRef !== next.moduleRef || signature(previous) !== signature(next)) {
    throw new Error("Preserve the module identity and every frozen exit identity, dimension and threshold.");
  }
  for (const unit of previous.units) {
    const repaired = next.units.find((entry) => entry.unitRef === unit.unitRef);
    if (!repaired || unit.provides.some((output) => !pathRequirementsCover(repaired.provides, output))) {
      throw new Error(`Preserve ${unit.unitRef} and its existing outputs; later lessons may depend on them. Append new lessons instead of renumbering existing sources.`);
    }
  }
}

/** Merge only flagged modules; validate the complete route, including later consumers. */
export function mergeModulePathRepairs(
  path: LearningPathContract,
  repairs: readonly ModulePathRepair[],
): LearningPathContract {
  const entities = new Map(path.entities.map((entity) => [entity.semanticKey, entity]));
  const modules = [...path.modules];
  const seen = new Set<string>();
  for (const repair of repairs) {
    const index = modules.findIndex((module) => module.moduleRef === repair.module.moduleRef);
    if (index < 0 || seen.has(repair.module.moduleRef)) throw new Error("Unknown or repeated module repair.");
    seen.add(repair.module.moduleRef);
    assertRepairBoundary(modules[index]!, repair.module);
    for (const entity of repair.entities) {
      const existing = entities.get(entity.semanticKey);
      if (existing && JSON.stringify(existing) !== JSON.stringify(entity)) {
        throw new Error(`Do not redefine the existing KACOM identity ${entity.semanticKey}.`);
      }
      entities.set(entity.semanticKey, entity);
    }
    modules[index] = repair.module;
  }
  const merged = learningPathContractSchema.parse({ ...path, entities: [...entities.values()], modules });
  const { issues } = validateLearningPath(merged, {
    moduleCount: path.modules.length,
    outcomeCount: path.goal.outcomes.length,
  });
  if (issues.length) throw new Error(issues.map((issue) => `${issue.code} at ${issue.at}: ${issue.message}`).join("\n"));
  return merged;
}

export function modulePathRepairSchema(path: LearningPathContract, moduleRef: string) {
  return z.preprocess((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const result = { ...value } as Record<string, unknown>;
    // Strict providers send null for the inactive fields of the shared path tool.
    for (const key of ["modules", "registry"]) if (result[key] === null) delete result[key];
    if (result.entities === null) result.entities = [];
    return result;
  }, z.object({
    part: z.literal("module"),
    entities: z.array(pathEntitySchema).max(240).default([]),
    module: pathModuleSchema,
  }).strict().superRefine((value, ctx) => {
    try {
      if (value.module.moduleRef !== moduleRef) throw new Error(`Repair only ${moduleRef}.`);
      mergeModulePathRepairs(path, [value]);
    } catch (error) {
      ctx.addIssue({ code: "custom", path: ["module"], message: error instanceof Error ? error.message : String(error) });
    }
  }));
}

export function readCandidatePathRepair(candidateJson: string): ModulePathRepair | undefined {
  const raw = JSON.parse(candidateJson) as { pathRepair?: unknown };
  if (raw.pathRepair === undefined) return undefined;
  return z.object({ entities: z.array(pathEntitySchema), module: pathModuleSchema }).parse(raw.pathRepair);
}

export async function authorModulePathRepair(input: {
  userId: string;
  goalId: string;
  moduleId: string;
  moduleRef: string;
  moduleTitle: string;
  mapPlanJson: string;
  candidateJson: string;
  findings: readonly string[];
  contentLanguage: string;
  meta: Record<string, unknown>;
}) {
  const approved = parseMapPlan(input.mapPlanJson)?.learningPath;
  if (!approved) throw new Error("The bound module path has no valid owning goal path.");
  const previousRepair = readCandidatePathRepair(input.candidateJson);
  const path = previousRepair ? mergeModulePathRepairs(approved, [previousRepair]) : approved;
  const index = path.modules.findIndex((module) => module.moduleRef === input.moduleRef);
  if (index < 0) throw new Error("The repaired module is outside the owning goal path.");
  const result = await runGoalAuthoringRound({
    userId: input.userId,
    goalId: input.goalId,
    branchId: `module:${input.moduleId}`,
    expectedTool: "commit_goal_path_part",
    operation: "goal.authoring_agent",
    maxRepairAttempts: 2,
    resultSchema: modulePathRepairSchema(path, input.moduleRef),
    meta: { ...input.meta, stage: "path_module_repair", moduleRef: input.moduleRef },
    prompt: `Repair only ${input.moduleRef} — ${input.moduleTitle} in the unpublished capability path. The whole-catalog audit found concrete gaps in the learner-confirmed scope:
${input.findings.join("\n")}

Call commit_goal_path_part with {part:"module",entities:[],module:{...}} for this module only. Preserve the confirmed goal, baseline, all existing KACOM identities, this module's exact exit identities/dimensions/thresholds, and every existing unitRef and its outputs. Later modules depend on those sources. Do not renumber units; append a coherent new lesson when needed. Do not rewrite other modules, add baseline assumptions, lower difficulty targets, or author lesson prose/questions. Reuse existing identities and declare only necessary new local bridge identities in entities.
Address each finding with explicit teaching/practice and an observable assessment, rather than claiming coverage in a rationale. Keep unaffected lessons. Every requires item needs an exact earlier source and rationale; expose external requirements at module entry. The server will validate the complete path including downstream consumers, and the revised catalog must pass a fresh audit before publication. Write learner-facing text in ${input.contentLanguage}.

CURRENT MODULE CONTRACT AND ITS IDENTITIES:
${formatDeterministicPromptValue(pathContextForModule(path, index))}

EXISTING SHARED IDENTITIES (reuse without redefining):
${formatDeterministicPromptValue(path.entities)}

AVAILABLE EARLIER EXPORTED SOURCES:
${formatDeterministicPromptValue(path.modules.slice(0, index).flatMap((module) => module.units.map((unit) => ({
  source: unit.unitRef,
  provides: unit.provides.flatMap((output) => {
    const exported = module.provides.find((entry) => entry.entityKey === output.entityKey);
    const dimensions = output.dimensions.filter((dimension) => exported?.dimensions.includes(dimension));
    return exported && dimensions.length ? [{ entityKey: output.entityKey, dimensions, threshold: Math.min(output.threshold, exported.threshold) }] : [];
  }),
})).filter((entry) => entry.provides.length)))}`,
    repairInstruction: `Return part="module" and only ${input.moduleRef}. Preserve every existing unit source/output and every frozen exit; add missing teaching and practice, then satisfy all complete-path validation findings.`,
  });
  const repairedPath = mergeModulePathRepairs(path, [result]);
  const projected = projectPathModule({ pathContract: pathContextForModule(repairedPath, index) }, input.contentLanguage)!;
  return {
    ...projected,
    pathRepair: {
      entities: repairedPath.entities.filter((entity) => !approved.entities.some((original) => original.semanticKey === entity.semanticKey)),
      module: repairedPath.modules[index]!,
    } satisfies ModulePathRepair,
  };
}
