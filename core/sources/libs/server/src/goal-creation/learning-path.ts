import {
  learningPathContractSchema,
  pathModuleSchema,
  pathEntitySchema,
  validateLearningPath,
  type LearningPathContract,
  type PathModuleContract,
} from "../../../domain/src/learning-path-contract.js";
import { z } from "zod";

export const LEARNING_PATH_JSON_SHAPE = `{
  "schemaVersion": 1,
  "entities": [{"semanticKey":"domain.capability","kind":"skill","title":"...","description":"...","scope":"..."}],
  "baseline": [],
  "goal": {"outcomes":[{"outcomeRef":"o_1","requires":[{"entityKey":"domain.capability","dimensions":["understanding","application"],"threshold":0.7}]}],"assessment":{"task":"...","criteria":["..."],"assistance":"independent","context":"near"}},
  "modules": [{"moduleRef":"m_1","requires":[],"provides":[{"entityKey":"domain.capability","dimensions":["understanding","application"],"threshold":0.7}],"assessment":{"task":"...","criteria":["..."],"assistance":"independent","context":"near"},"rationale":"...",
    "units":[{"unitRef":"u_1_1","title":"...","summary":"...","difficulty":"easy","milestoneRole":"introduce","requires":[],"provides":[{"entityKey":"domain.capability","dimensions":["understanding","application"],"threshold":0.7}],"supports":["domain.capability"],"assessment":{"task":"...","criteria":["..."],"assistance":"independent","context":"near"},"rationale":"..."}]}]
}`;

export const LEARNING_PATH_INSTRUCTION = `
Whole-goal capability path (required learningPath, schemaVersion 1):
- Plan backwards from every frozen o_N outcome, through module exits and ALL ordered lesson contracts, to the learner's entry foundation. Complete the entire skeleton before final plan acceptance; never author lesson prose or assessment questions.
- Use KACOM semantic identities: atom (one independently stateable fact), concept (a stable explanatory structure), skill (an operation), competency (coordinated performance). Use concise language-neutral semanticKey values, stable across revisions, never title/order-derived aliases. Reuse an identity instead of creating synonyms. This is planned objective structure, not a learner state or evidence record.
- Each entity includes title, description, and scope (conditions/difficulty under which it applies). Different performance scopes cannot be silently equated.
- A requirement references entityKey plus exact cognitive dimensions and threshold (0 < threshold <= 1). Dimensions: memory, understanding, application, transfer, fluency, stability, independence. A stronger-looking dimension does NOT imply another dimension. Entry requirements must be explicitly supplied at the same or stronger threshold for EVERY requested dimension.
- baseline lists only externally assumed entry requirements, each status reported (explicit learner/profile statement) or unknown (not established), plus a concise rationale. Never invent verified mastery. Known missing knowledge must be taught in bridge lessons before first use. Do not list future learning as baseline.
- Emit ordered modules[] summaries first for immediate display. Then learningPath.entities, baseline, goal, and learningPath.modules. Contracts use m_1, m_2... corresponding exactly to the summary order; their units use u_1_1, u_1_2... in lesson order.
- Every module and unit declares requires, provides, assessment, and a short public rationale. Each requires item includes source="baseline" or the EXACT earlier unitRef and a concise explanation of why that output is used. All listed prerequisites are AND requirements. Never use self/future/missing units. Independent foundations may branch and converge; do not invent dependencies for navigation order.
- Module requires must include every external requirement used by its units, with the same source. Cross-module requirements must be explicitly exposed in the source module's provides. Module provides must be achieved by its own units, not just promised by its title.
- Each unit includes title, summary, difficulty (easy/medium/hard), milestoneRole (introduce/practice/integrate/verify), requires, provides, supports (1-4 entityKeys from this module's provides), assessment, and rationale. Teach the smallest sufficient bridge at first use. One coherent lesson is valid; do not pad chapters or split proof substeps into lessons.
- Assessment is a compact task description, 1-6 criteria, assistance (independent/light_hint/guided), context (same/near/far). It must directly observe the stated provides, including integration when promised. Transfer requires far context; independence requires independent assistance. Do not create questions, scores or evidence. Exploration mode treats these as ungraded practice opportunities.
- goal.outcomes lists EVERY frozen o_N exactly once with its requires. Each requirement must be supplied by the completed path. goal.assessment is the integrated final task under the confirmed scope, not a claim that reading guarantees mastery.
- Keep each sentence short. Use 1-3 planned outputs per lesson where sufficient; include materially necessary knowledge but avoid exhaustive atom enumeration. Detailed KACOM definitions and teaching content are authored later from these identities. Never claim structural validation establishes actual mastery.`;

/** Persisted with a module brief so later workers cannot silently invent another route. */
export const modulePathContextSchema = z.object({
  entities: z.array(pathEntitySchema).min(1).max(240),
  baseline: learningPathContractSchema.shape.baseline,
  contract: pathModuleSchema,
});
export type ModulePathContext = z.infer<typeof modulePathContextSchema>;

export function pathContextForModule(
  path: LearningPathContract,
  moduleIndex: number,
): ModulePathContext {
  const contract = path.modules[moduleIndex]!;
  const keys = new Set([
    ...contract.requires,
    ...contract.provides,
    ...contract.units.flatMap((unit) => [...unit.requires, ...unit.provides]),
  ].map((entry) => entry.entityKey));
  return {
    contract,
    entities: path.entities.filter((entity) => keys.has(entity.semanticKey)),
    baseline: path.baseline.filter((entry) => keys.has(entry.entityKey)),
  };
}

export function readModulePathContext(brief: unknown): ModulePathContext | undefined {
  if (!brief || typeof brief !== "object") return undefined;
  const raw = (brief as Record<string, unknown>).pathContract;
  if (raw === undefined) return undefined;
  // A malformed bound contract must never fall back to an unbound generation.
  return modulePathContextSchema.parse(raw);
}

export function refinePathJourney(
  value: { modules: readonly unknown[]; learningPath: LearningPathContract },
  ctx: z.RefinementCtx,
  outcomeCount: number,
) {
  for (const issue of validateLearningPath(value.learningPath, {
    moduleCount: value.modules.length,
    outcomeCount,
  }).issues) {
    ctx.addIssue({
      code: "custom",
      path: ["learningPath"],
      message: `${issue.code} at ${issue.at}: ${issue.message}`,
    });
  }
}

export function pathModuleBrief(
  path: LearningPathContract,
  contract: PathModuleContract,
) {
  const byKey = new Map(path.entities.map((entity) => [entity.semanticKey, entity]));
  return {
    plannedOutcomes: contract.provides.slice(0, 6).map((entry) => byKey.get(entry.entityKey)?.title ?? entry.entityKey),
    exitCapabilityBriefs: contract.provides.map((entry) => byKey.get(entry.entityKey)?.description ?? entry.entityKey),
    estimatedUnitCount: contract.units.length,
    unitPlanningBrief: {
      scopeSize: contract.units.length >= 9 ? "large" as const
        : contract.units.length >= 4 ? "standard" as const : "compact" as const,
      rationale: contract.rationale,
      progression: contract.units.slice(0, 8).map((unit) => unit.title),
      pathContract: pathContextForModule(path, path.modules.indexOf(contract)),
    },
  };
}
