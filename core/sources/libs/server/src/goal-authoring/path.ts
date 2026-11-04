import { createHash } from "node:crypto";
import { formatDeterministicPromptValue } from "../agents/goal-creation/contract.js";
import { LEARNING_PATH_INSTRUCTION } from "../goal-creation/learning-path.js";
import type { GoalCurriculumIdentity } from "../llm/schemas.js";
import type { PathEntity, PathModuleContract } from "../../../domain/src/learning-path-contract.js";
import {
  assemblePath,
  goalPathOutlineCommitSchema,
  registryCommitSchema,
  moduleCommitSchema,
} from "./path-parts.js";
import { runGoalAuthoringRound } from "./runner.js";

export function goalAuthoringCheckpointKey(value: unknown) {
  return createHash("sha256").update(formatDeterministicPromptValue(value)).digest("hex").slice(0, 24);
}

/** Append small commits to one transcript; no model re-emits the assembled path. */
export async function runGoalPathAuthoring(input: {
  userId: string;
  goalId: string;
  identity: GoalCurriculumIdentity;
  instruction: string;
  signal?: AbortSignal;
  onToken?: (delta: string) => void | Promise<void>;
  onProgress?: (progress: { moduleTitles: string[]; unitCount: number; complete: boolean }) => void | Promise<void>;
}) {
  const prefix = `goal-path:v1:${goalAuthoringCheckpointKey(input.identity)}`;
  const base = {
    userId: input.userId,
    goalId: input.goalId,
    expectedTool: "commit_goal_path_part",
    operation: "goal.authoring_agent",
    maxRepairAttempts: 2,
    signal: input.signal,
    onToken: input.onToken,
  };
  let moduleTitles: string[] = [];
  let unitCount = 0;
  let lastProgress = "";
  const progress = async (titles = moduleTitles, count = unitCount) => {
    const fingerprint = `${titles.join("\n")}:${count}`;
    if (fingerprint === lastProgress) return;
    lastProgress = fingerprint;
    await input.onProgress?.({ moduleTitles: titles, unitCount: count, complete: false });
  };
  const outline = await runGoalAuthoringRound({
    ...base,
    checkpointKey: `${prefix}:outline`,
    prompt: `${input.instruction}

Continue the confirmed goal contract, teaching skill, source evidence and frozen identity already in this conversation. Do not repeat those sources in your arguments.
Build the capability path in separate commits: module summaries, shared registry, then one module's unit contracts per turn. The following rules apply to the completed path across ALL parts; output ONLY the part requested in the current turn.
${LEARNING_PATH_INSTRUCTION}

Frozen identity and outcome numbering:
${formatDeterministicPromptValue(input.identity)}
${input.identity.whatYouWillLearn.map((outcome, i) => `o_${i + 1}: ${outcome}`).join("\n")}

CURRENT PART: outline. Call commit_goal_path_part with {part:"outline", modules:[...]} only.
Choose 1–8 distinct module milestones matching the confirmed scope. A narrow theorem, formula, proof or skill can be one module; do not pad to a quota. Each summary needs title, summary, objective and dependsOnPrevious. Do not output entities, a registry, a learningPath, or unit contracts yet.`,
    resultSchema: goalPathOutlineCommitSchema,
    repairInstruction: 'Keep part="outline". Every modules[] entry needs title, summary, objective and dependsOnPrevious. Keep at most 8 complete module summaries, with no other array items.',
    meta: { stage: "path_outline" },
    onPartialCandidate: async (candidate) => {
      const modules = (candidate as { modules?: Array<{ title?: string }> } | null)?.modules;
      if (Array.isArray(modules)) await progress(modules.flatMap((module) => typeof module?.title === "string" ? [module.title] : []));
    },
  });
  moduleTitles = outline.modules.map((module) => module.title);
  await progress();
  const registryResult = await runGoalAuthoringRound({
    ...base,
    checkpointKey: `${prefix}:registry:${goalAuthoringCheckpointKey(outline)}`,
    prompt: `CURRENT PART: registry. Call commit_goal_path_part with {part:"registry", registry:{entities,baseline,goal,moduleTargets}} only.
Use the accepted outline and frozen o_N outcomes above. Plan backwards from every goal outcome, assigning its required dimensions and thresholds to ordered moduleTargets [{moduleRef:"m_1",provides:[...]}]. Each provides item has entityKey, dimensions and threshold.
Define only shared KACOM identities needed by the baseline, goal or module targets. Every entityKey mentioned anywhere in baseline, goal.outcomes[].requires or moduleTargets[].provides MUST have an exact matching semanticKey in registry.entities, including ordinary assumed skills such as arithmetic or reading. Each entity needs semanticKey, kind, title, description and scope. Reuse identities across modules. Intermediate bridge identities may be added by their own module later.
baseline contains only genuinely assumed entry requirements with status reported or unknown and rationale; never future teaching or invented mastery. goal has every o_N once with requires, plus assessment {task,criteria,assistance,context}. Every goal requirement must be supplied by the targets or baseline, dimension by dimension at the same or higher threshold. Transfer needs far context; independence needs independent assistance.
Keep descriptions concise. Do not output module summaries, lesson units or a full learningPath.`,
    resultSchema: registryCommitSchema(outline.modules.length, input.identity.whatYouWillLearn.length),
    repairInstruction: 'Keep part="registry" and only the registry payload. Preserve the frozen outline and cover every o_N outcome with actual module output targets.',
    meta: { stage: "path_registry" },
  });
  const registry = registryResult.registry;
  const entities: PathEntity[] = [...registry.entities];
  const modules: PathModuleContract[] = [];
  for (let index = 0; index < outline.modules.length; index++) {
    input.signal?.throwIfAborted();
    const moduleRef = `m_${index + 1}`;
    const target = registry.moduleTargets[index]!;
    const available = modules.flatMap((earlier) => earlier.units.flatMap((unit) => {
      const provides = unit.provides.flatMap((output) => {
        const exported = earlier.provides.find((entry) => entry.entityKey === output.entityKey);
        const dimensions = output.dimensions.filter((dimension) => exported?.dimensions.includes(dimension));
        return exported && dimensions.length ? [{ entityKey: output.entityKey, dimensions,
          threshold: Math.min(output.threshold, exported.threshold) }] : [];
      });
      return provides.length ? [{ source: unit.unitRef, provides }] : [];
    }));
    const module = await runGoalAuthoringRound({
      ...base,
      checkpointKey: `${prefix}:module:${index + 1}:${goalAuthoringCheckpointKey({ registry, entities, modules })}`,
      markBlueprint: index + 1 === outline.modules.length,
      prompt: `CURRENT PART: module ${moduleRef} — ${outline.modules[index]!.title} (${index + 1}/${outline.modules.length}).
Call commit_goal_path_part with {part:"module", entities:[], module:{moduleRef:"${moduleRef}",requires,provides,assessment,rationale,units:[...]}} only. Do not repeat the outline, registry or previously accepted modules.
Author this module's complete ordered lesson contracts. Unit refs are u_${index + 1}_1, u_${index + 1}_2, etc. Every unit needs title, summary, difficulty, milestoneRole, requires, provides, supports, assessment and rationale. Follow the previously committed scope and source evidence. Keep one coherent lesson together and descriptions short; do not author prose, questions or detailed KACOM definitions.
FROZEN EXIT REQUIREMENTS for this module (copy each identity, dimension and threshold into provides, then ensure its units actually deliver them):
${formatDeterministicPromptValue(target.provides)}
Keep one provides entry per entityKey, merging its dimensions. Every module exit must be delivered and supported by its own units at the promised threshold in EVERY dimension. For example, understanding+application at 0.8 needs actual unit outputs supplying both at >=0.8. supports names this module's exits, not arbitrary intermediate identities.
AVAILABLE EXTERNAL SOURCES (only the exported dimensions/thresholds below are usable across modules; do not reference unexported intermediate identities):
${formatDeterministicPromptValue([{ source: "baseline", provides: registry.baseline.map(({ entityKey, dimensions, threshold }) => ({ entityKey, dimensions, threshold })) }, ...available])}
Every requires item, including module.requires, needs entityKey, dimensions, threshold, source AND a non-empty rationale. Use source="baseline" or an EXACT earlier unitRef supplying ALL requested dimensions/thresholds. Expose every external unit dependency in module.requires with the same source. Never invent mastery, new baseline assumptions, self/future dependencies or navigation-only dependencies. Teach a local bridge before first use if no listed external source supplies what is needed.
EXISTING IDENTITIES (reuse; detailed scopes are in their accepted commits):
${formatDeterministicPromptValue(entities.map(({ semanticKey, kind, title }) => ({ semanticKey, kind, title })))}
If a necessary bridge needs a new identity, declare it in this part's entities and teach it before use; never repeat/redefine an existing identity. For EVERY unit.provides containing transfer, that same unit.assessment.context must be far. For EVERY unit.provides containing independence, that same unit.assessment.assistance must be independent. Apply these rules independently to module.provides and module.assessment as well; an independent module assessment does not substitute for an independent lesson assessment. Do not mention an identity absent from EXISTING IDENTITIES or this part's entities, even for an assumed or intermediate input.
The top-level part value is exactly "module", never "${moduleRef}" or "module_contract".`,
      resultSchema: moduleCommitSchema({ registry, entities, previous: modules,
        moduleCount: outline.modules.length, outcomeCount: input.identity.whatYouWillLearn.length }),
      repairInstruction: `Keep part="module" and module.moduleRef="${moduleRef}". Keep all frozen outputs, combine dimensions into one module.provides record per identity, and supply every promised dimension/threshold in actual units. Every requires item needs source and rationale. Use only the listed exported external sources or teach a local bridge first.`,
      meta: { stage: "path_module", moduleRef, moduleIndex: index + 1, moduleCount: outline.modules.length },
      onPartialCandidate: async (candidate) => {
        const units = (candidate as { module?: { units?: unknown[] } } | null)?.module?.units;
        if (Array.isArray(units)) await progress(moduleTitles, unitCount + units.length);
      },
    });
    entities.push(...module.entities);
    modules.push(module.module);
    unitCount += module.module.units.length;
    await progress();
  }
  return { modules: outline.modules, learningPath: assemblePath(registry, entities, modules) };
}
