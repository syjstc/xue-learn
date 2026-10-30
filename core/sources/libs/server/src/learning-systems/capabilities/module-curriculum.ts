import {
  lessonKnowledgeSequenceSchema,
  validateLessonKnowledgeOrder,
} from "../../goal-creation/knowledge-order.js";
import { GOAL_DIRECTED_TEACHING_POLICY } from "../../goal-creation/teaching-policy.js";
import { z } from "zod";
import {
  evaluateModuleKacomStructuralReadiness as evaluateStructuralReadiness,
  moduleCognitiveEntityBudget as cognitiveEntityBudget,
} from "../../../../domain/src/index.js";
import type { ContentLanguageCode } from "../../llm/content-language.js";
import { getLanguagePromptInstruction } from "../../llm/content-language.js";
import {
  MAX_MODULE_UNITS,
  MIN_MODULE_UNITS,
  type ModuleUnitPlanningBrief,
} from "../../llm/schemas.js";
import {
  runValidatedStructuredGeneration,
  type ObjectRepairSlot,
} from "../../llm/validated-structured-generation.js";
import { parseLlmJson } from "../../llm/sanitize-response.js";
import { teachingSkillGenerationMeta } from "../../teaching-skills/prompt.js";
import { defineLearningSystemCapability } from "../define-capability.js";
import type { ContextEnvelope, SystemViewRequest } from "../types.js";
import { MODULE_CURRICULUM_VIEW_KEYS } from "../../llm/module-curriculum-keys.js";

const cognitiveDimension = z.enum([
  "memory",
  "understanding",
  "application",
  "transfer",
  "fluency",
  "stability",
  "independence",
]);

const cognitiveLevel = z.enum([
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
]);

const difficulty = z.enum(["easy", "medium", "hard"]);

const moduleMilestoneRole = z.enum([
  "introduce",
  "practice",
  "integrate",
  "verify",
]);

const localizedCognitiveDimensions: Record<
  string,
  z.infer<typeof cognitiveDimension>
> = {
  记忆: "memory",
  記憶: "memory",
  记住: "memory",
  記住: "memory",
  回忆: "memory",
  回憶: "memory",
  remember: "memory",
  recall: "memory",
  knowledge: "memory",
  memorization: "memory",
  理解: "understanding",
  understand: "understanding",
  comprehension: "understanding",
  knowing: "understanding",
  analyze: "understanding",
  analyse: "understanding",
  analysis: "understanding",
  分析: "understanding",
  evaluate: "understanding",
  evaluation: "understanding",
  评价: "understanding",
  評價: "understanding",
  评估: "understanding",
  評估: "understanding",
  应用: "application",
  應用: "application",
  运用: "application",
  運用: "application",
  apply: "application",
  applying: "application",
  create: "application",
  creation: "application",
  创造: "application",
  創造: "application",
  synthesize: "application",
  synthesis: "application",
  迁移: "transfer",
  遷移: "transfer",
  generalization: "transfer",
  流畅: "fluency",
  流暢: "fluency",
  流畅性: "fluency",
  流暢性: "fluency",
  流利度: "fluency",
  流利: "fluency",
  熟练: "fluency",
  熟練: "fluency",
  稳定: "stability",
  穩定: "stability",
  稳定性: "stability",
  穩定性: "stability",
  巩固: "stability",
  鞏固: "stability",
  独立: "independence",
  獨立: "independence",
  独立性: "independence",
  獨立性: "independence",
  自主: "independence",
  autonomous: "independence",
  autonomy: "independence",
  independent: "independence",
};

const providerEnumAliases = {
  cognitiveDimension: localizedCognitiveDimensions,
  cognitiveLevel: {
    记忆: "remember",
    记住: "remember",
    理解: "understand",
    应用: "apply",
    运用: "apply",
    分析: "analyze",
    评价: "evaluate",
    评估: "evaluate",
    创造: "create",
    创建: "create",
  },
  difficulty: {
    low: "easy",
    beginner: "easy",
    simple: "easy",
    简单: "easy",
    容易: "easy",
    初级: "easy",
    moderate: "medium",
    intermediate: "medium",
    中等: "medium",
    中级: "medium",
    high: "hard",
    advanced: "hard",
    difficult: "hard",
    困难: "hard",
    高级: "hard",
  },
  milestoneRole: {
    intro: "introduce",
    introduction: "introduce",
    foundation: "introduce",
    begin: "introduce",
    引入: "introduce",
    导入: "introduce",
    develop: "practice",
    development: "practice",
    exercise: "practice",
    train: "practice",
    练习: "practice",
    训练: "practice",
    synthesis: "integrate",
    synthesize: "integrate",
    combine: "integrate",
    integration: "integrate",
    整合: "integrate",
    综合: "integrate",
    assess: "verify",
    assessment: "verify",
    evaluate: "verify",
    evaluation: "verify",
    test: "verify",
    check: "verify",
    验证: "verify",
    评估: "verify",
    测试: "verify",
  },
} as const;

function providerEnum<T extends string>(
  schema: z.ZodType<T>,
  aliases: Readonly<Record<string, T>>,
) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const normalized = value.trim().toLowerCase().replace(/[ -]+/g, "_");
    return aliases[normalized] ?? normalized;
  }, schema);
}

function normalizedProviderArray(
  value: unknown,
  normalizeItem: (item: unknown) => unknown,
  maximum: number,
): unknown {
  if (!Array.isArray(value)) return value;
  const seen = new Set<string>();
  const normalized: unknown[] = [];
  for (const raw of value) {
    const item = normalizeItem(raw);
    const fingerprint = JSON.stringify(item) ?? String(item);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    normalized.push(item);
    if (normalized.length >= maximum) break;
  }
  return normalized;
}

function normalizeProviderDimension(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase().replace(/[ -]+/g, "_");
  return (
    providerEnumAliases.cognitiveDimension[normalized] ??
    providerEnumAliases.cognitiveDimension[trimmed] ??
    normalized
  );
}

function normalizeProviderDimensionList(value: unknown): unknown {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? [value]
      : value;
  if (!Array.isArray(items)) return value;
  const mapped = items.filter(
    (item) =>
      cognitiveDimension.safeParse(normalizeProviderDimension(item)).success,
  );
  const unique = normalizedProviderArray(mapped, normalizeProviderDimension, 4);
  if (Array.isArray(unique) && unique.length === 0 && items.length > 0) {
    return ["understanding"];
  }
  return unique;
}

const providerCognitiveDimensions = z.preprocess(
  normalizeProviderDimensionList,
  z.array(cognitiveDimension).min(1).max(4),
);

function acceptNormalizedProviderResult<T>(
  sourceSchema: z.ZodType<unknown>,
  normalize: (value: unknown) => unknown,
  resultSchema: z.ZodType<T>,
): z.ZodType<T> {
  return z.preprocess((candidate) => {
    const parsed = sourceSchema.safeParse(candidate);
    if (!parsed.success) return candidate;
    return normalize(parsed.data);
  }, resultSchema);
}

const providerCognitiveLevel = providerEnum(
  cognitiveLevel,
  providerEnumAliases.cognitiveLevel,
);

const providerDifficulty = providerEnum(
  difficulty,
  providerEnumAliases.difficulty,
);

const providerMilestoneRole = providerEnum(
  moduleMilestoneRole,
  providerEnumAliases.milestoneRole,
);

function normalizeCapabilityRef(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  const match = /^(?:mc|capability)[_ -]?(\d+)$/.exec(normalized);
  return match ? `mc_${Number(match[1])}` : normalized;
}

const providerCapabilityRefs = z.preprocess(
  (value) => normalizedProviderArray(value, normalizeCapabilityRef, 4),
  z
    .array(z.string().regex(/^mc_[1-8]$/))
    .min(1)
    .max(4),
);

const providerAssessmentCriteria = z.preprocess(
  (value) => (Array.isArray(value) ? value.slice(0, 5) : value),
  z.array(z.string().trim().min(1)).min(2).max(5),
);

const providerDurationMinutes = z.preprocess((value) => {
  const numeric =
    typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())
      ? Number(value)
      : value;
  return typeof numeric === "number" && Number.isFinite(numeric)
    ? Math.max(10, Math.min(60, Math.round(numeric)))
    : numeric;
}, z.number().int().min(10).max(60));

const moduleCapabilitySchema = z.object({
  title: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  assessmentCriteria: z.array(z.string().trim().min(1)).min(2).max(5),
  dimensions: z.array(cognitiveDimension).min(1).max(7),
  criticalCompletionGate: z.boolean(),
  cognitiveLevel,
  difficulty,
  semanticKey: z.string().trim().min(1).optional(),
  entityKind: z.enum(["atom", "concept", "skill", "competency"]).optional(),
  threshold: z.number().gt(0).max(1).optional(),
});

export const moduleCapabilityProposalSchema = z.object({
  capabilities: z.array(moduleCapabilitySchema).min(1).max(8),
});

export const moduleCapabilityProviderResponseSchema = z.object({
  capabilities: z.array(
    moduleCapabilitySchema.extend({
      assessmentCriteria: providerAssessmentCriteria,
      dimensions: providerCognitiveDimensions,
      cognitiveLevel: providerCognitiveLevel,
      difficulty: providerDifficulty,
    }),
  ),
});

export type ModuleCapabilityProposal = z.infer<
  typeof moduleCapabilityProposalSchema
>;

const moduleStructureUnitSchema = z.object({
  knowledgeSequence: lessonKnowledgeSequenceSchema.optional(),
  title: z.string().trim().min(1),
  contentSummary: z.string().trim().min(1),
  difficulty,
  capabilityRefs: z
    .array(z.string().regex(/^mc_[1-8]$/))
    .min(1)
    .max(4),
  milestoneRole: moduleMilestoneRole,
});

export const moduleStructureProposalSchema = z.object({
  units: z
    .array(moduleStructureUnitSchema)
    .min(MIN_MODULE_UNITS)
    .max(MAX_MODULE_UNITS),
  coverageRationale: z.string().trim().min(1),
});

export const moduleStructureProviderResponseSchema = z.object({
  units: z.array(
    moduleStructureUnitSchema.extend({
      difficulty: providerDifficulty,
      capabilityRefs: providerCapabilityRefs,
      milestoneRole: providerMilestoneRole,
    }),
  ),
  coverageRationale: z.string().trim().min(1),
});

const explorationModuleUnitSchema = z.object({
  knowledgeSequence: lessonKnowledgeSequenceSchema.optional(),
  title: z.string().trim().min(1),
  contentSummary: z.string().trim().min(1),
  difficulty,
  milestoneRole: moduleMilestoneRole,
});

export const explorationModuleStructureProposalSchema = z.object({
  units: z
    .array(explorationModuleUnitSchema)
    .min(MIN_MODULE_UNITS)
    .max(MAX_MODULE_UNITS),
  coverageRationale: z.string().trim().min(1),
});

const explorationModuleStructureProviderResponseSchema = z.object({
  units: z.array(
    explorationModuleUnitSchema.extend({
      difficulty: providerDifficulty,
      milestoneRole: providerMilestoneRole,
    }),
  ),
  coverageRationale: z.string().trim().min(1),
});

export type ExplorationModuleStructureProposal = z.infer<
  typeof explorationModuleStructureProposalSchema
>;

const MIN_MODULE_CAPABILITIES = 1;
const MAX_MODULE_CAPABILITIES = 8;
const TYPICAL_MODULE_LESSON_GUIDANCE =
  "Match lesson count to this module's actual exit, not a textbook chapter. 1–3 lessons for a narrow milestone (one lesson is valid). Use additional lessons when distinct exit abilities, prerequisite bridges or progressively harder worked applications require them; 4–8 is not a quota or ceiling. Never pad toward 3–8. Never exceed 20. Do not split one proof, identity, or worked derivation into construction/verification/summary lessons; those beats belong in one lesson (a formal_derivation section when the job is a proof, formula derivation, or worked symbolic solution).";

function moduleCapabilityResultSchema() {
  return moduleCapabilityProposalSchema.superRefine((value, ctx) => {
    if (
      !value.capabilities.some(
        (capability) => capability.criticalCompletionGate,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "at least one capability must be a critical completion gate",
        path: ["capabilities"],
      });
    }
  });
}

function exactModuleStructureSchema(capabilityCount: number) {
  const allowedRefs = new Set(
    Array.from(
      { length: capabilityCount },
      (_value, index) => `mc_${index + 1}`,
    ),
  );
  return z
    .object({
      units: z
        .array(moduleStructureUnitSchema)
        .min(MIN_MODULE_UNITS)
        .max(MAX_MODULE_UNITS),
      coverageRationale: z.string().trim().min(1),
    })
    .superRefine((value, ctx) => {
      validateLessonKnowledgeOrder(value, ctx);
      const covered = new Set<string>();
      value.units.forEach((unit, unitIndex) => {
        unit.capabilityRefs.forEach((ref, refIndex) => {
          if (!allowedRefs.has(ref)) {
            ctx.addIssue({
              code: "custom",
              message: `capability ref ${ref} is outside this module`,
              path: ["units", unitIndex, "capabilityRefs", refIndex],
            });
          } else {
            covered.add(ref);
          }
        });
      });
      const missing = [...allowedRefs].filter((ref) => !covered.has(ref));
      if (missing.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: `module structure omits capabilities: ${missing.join(", ")}`,
          path: ["units"],
        });
      }
    });
}

function appendCapability(root: unknown, value: unknown): unknown {
  const candidate = root as z.infer<
    typeof moduleCapabilityProviderResponseSchema
  >;
  const capability = value as z.infer<typeof moduleCapabilitySchema>;
  return {
    ...candidate,
    capabilities: [...candidate.capabilities, capability],
  };
}

function capabilityRecoverySlots(params: {
  candidate: unknown;
  capabilityBriefs: string[];
}): ObjectRepairSlot[] {
  const candidate = params.candidate as z.infer<
    typeof moduleCapabilityProviderResponseSchema
  >;
  const repairs: ObjectRepairSlot[] = [];
  for (
    let index = candidate.capabilities.length;
    index < MIN_MODULE_CAPABILITIES;
    index += 1
  ) {
    const brief = params.capabilityBriefs[index]?.trim();
    repairs.push({
      slot: {
        description: `Create only missing module exit capability ${index + 1} of at least ${MIN_MODULE_CAPABILITIES}.${brief ? ` Planned brief: ${brief}` : ""}`,
        schema: moduleCapabilitySchema,
      },
      apply: appendCapability,
    });
  }
  if (
    !candidate.capabilities.some(
      (capability) => capability.criticalCompletionGate,
    )
  ) {
    repairs.push({
      slot: {
        description:
          "Set criticalCompletionGate to true for the final, integrative exit capability so the module has one explicit completion gate.",
        currentValue: false,
        schema: z.literal(true),
      },
      apply: (root, value) => {
        const current = root as z.infer<
          typeof moduleCapabilityProviderResponseSchema
        >;
        const index = Math.max(0, current.capabilities.length - 1);
        return {
          ...current,
          capabilities: current.capabilities.map((capability, itemIndex) =>
            itemIndex === index
              ? { ...capability, criticalCompletionGate: value }
              : capability,
          ),
        };
      },
    });
  }
  return repairs;
}

function allowedCapabilityRefSchema(
  capabilityCount: number,
  requiredRefs: readonly string[] = [],
) {
  const allowed = new Set(
    Array.from(
      { length: capabilityCount },
      (_value, index) => `mc_${index + 1}`,
    ),
  );
  return z
    .array(
      z
        .string()
        .refine((ref) => allowed.has(ref), "unknown module capability ref"),
    )
    .min(1)
    .max(4)
    .superRefine((refs, ctx) => {
      requiredRefs.forEach((ref) => {
        if (!refs.includes(ref)) {
          ctx.addIssue({
            code: "custom",
            message: `must include ${ref}`,
          });
        }
      });
    });
}

function moduleUnitRepairSchema(
  capabilityCount: number,
  requiredRefs: readonly string[],
) {
  return moduleStructureUnitSchema
    .extend({
      capabilityRefs: allowedCapabilityRefSchema(capabilityCount, requiredRefs),
    })
    .superRefine((unit, ctx) => {
      requiredRefs.forEach((ref) => {
        if (!unit.capabilityRefs.includes(ref)) {
          ctx.addIssue({ code: "custom", message: `unit must cover ${ref}` });
        }
      });
    });
}

function structureRecoverySlots(params: {
  candidate: unknown;
  capabilityCount: number;
  progression: string[];
}): ObjectRepairSlot[] {
  const candidate = params.candidate as z.infer<
    typeof moduleStructureProviderResponseSchema
  >;
  const repairs: ObjectRepairSlot[] = [];
  const allowedRefs = Array.from(
    { length: params.capabilityCount },
    (_value, index) => `mc_${index + 1}`,
  );
  const allowedSet = new Set(allowedRefs);
  const plannedRefs = candidate.units.map((unit) => [
    ...new Set(unit.capabilityRefs.filter((ref) => allowedSet.has(ref))),
  ]);
  const covered = new Set(plannedRefs.flat());
  const missingRefs = allowedRefs.filter((ref) => !covered.has(ref));
  const missingUnitCount =
    candidate.units.length > 0
      ? 0
      : Math.max(1, Math.ceil(params.capabilityCount / 4));
  const requiredByMissingUnit = Array.from(
    { length: missingUnitCount },
    () => [] as string[],
  );
  let nextMissingUnit = 0;
  while (missingRefs.length > 0 && missingUnitCount > 0) {
    const target = requiredByMissingUnit[nextMissingUnit]!;
    if (target.length < 4) target.push(missingRefs.shift()!);
    nextMissingUnit = (nextMissingUnit + 1) % missingUnitCount;
    if (requiredByMissingUnit.every((refs) => refs.length >= 4)) break;
  }

  const refOccurrences = new Map<string, number>();
  plannedRefs
    .flat()
    .forEach((ref) =>
      refOccurrences.set(ref, (refOccurrences.get(ref) ?? 0) + 1),
    );
  const changedUnitIndexes = new Set<number>();
  candidate.units.forEach((unit, index) => {
    if (unit.capabilityRefs.some((ref) => !allowedSet.has(ref))) {
      changedUnitIndexes.add(index);
    }
  });
  while (missingRefs.length > 0 && plannedRefs.length > 0) {
    const missingRef = missingRefs.shift()!;
    let targetIndex = [...plannedRefs.keys()]
      .reverse()
      .find((index) => plannedRefs[index]!.length < 4);
    if (targetIndex == null) {
      targetIndex = [...plannedRefs.keys()]
        .reverse()
        .find((index) =>
          plannedRefs[index]!.some((ref) => (refOccurrences.get(ref) ?? 0) > 1),
        );
    }
    targetIndex ??= plannedRefs.length - 1;
    const refs = plannedRefs[targetIndex]!;
    if (refs.length >= 4) {
      const replaceIndex = refs.findIndex(
        (ref) => (refOccurrences.get(ref) ?? 0) > 1,
      );
      const removedIndex = replaceIndex >= 0 ? replaceIndex : refs.length - 1;
      const [removed] = refs.splice(removedIndex, 1);
      if (removed) {
        refOccurrences.set(
          removed,
          Math.max(0, (refOccurrences.get(removed) ?? 1) - 1),
        );
      }
    }
    refs.push(missingRef);
    refOccurrences.set(missingRef, 1);
    changedUnitIndexes.add(targetIndex);
  }

  [...changedUnitIndexes]
    .sort((left, right) => left - right)
    .forEach((index) => {
      const unit = candidate.units[index]!;
      const requiredRefs = plannedRefs[index]!;
      repairs.push({
        slot: {
          description: `Correct only the capability refs for unit "${unit.title}". Preserve its lesson meaning and include ${requiredRefs.join(", ") || "at least one valid module capability"}.`,
          currentValue: unit.capabilityRefs,
          schema: allowedCapabilityRefSchema(
            params.capabilityCount,
            requiredRefs,
          ),
        },
        apply: (root, value) => {
          const current = root as z.infer<
            typeof moduleStructureProviderResponseSchema
          >;
          return {
            ...current,
            units: current.units.map((item, itemIndex) =>
              itemIndex === index ? { ...item, capabilityRefs: value } : item,
            ),
          };
        },
      });
    });

  requiredByMissingUnit.forEach((requiredRefs, offset) => {
    const index = candidate.units.length + offset;
    const phase = params.progression[index]?.trim();
    repairs.push({
      slot: {
        description: `Create only missing ordered lesson ${index + 1}.${phase ? ` Coverage phase: ${phase}` : ""}${requiredRefs.length ? ` It must cover ${requiredRefs.join(", ")}.` : ""}`,
        schema: moduleUnitRepairSchema(params.capabilityCount, requiredRefs),
      },
      apply: (root, value) => {
        const current = root as z.infer<
          typeof moduleStructureProviderResponseSchema
        >;
        return { ...current, units: [...current.units, value] };
      },
    });
  });
  return repairs;
}

export type ModuleStructureProposal = z.infer<
  typeof moduleStructureProposalSchema
>;

export const moduleKacomAuditSchema = z.object({
  verdict: z.enum(["pass", "repair_required"]),
  duplicateConcepts: z.array(z.string().trim().min(1)).max(12),
  missingCoverage: z.array(z.string().trim().min(1)).max(12),
  invalidRelationships: z.array(z.string().trim().min(1)).max(12),
  unnecessaryProliferation: z.array(z.string().trim().min(1)).max(12),
  rationale: z.string().trim().min(1),
});

const CAPABILITY_SHAPE = `{
  "capabilities": [{
    "title": "observable capability",
    "objective": "what the learner can demonstrably do",
    "assessmentCriteria": ["criterion 1", "criterion 2"],
    "dimensions": ["understanding", "application"],
    "criticalCompletionGate": true,
    "cognitiveLevel": "apply",
    "difficulty": "medium"
  }]
}`;

const STRUCTURE_SHAPE = `{
  "units": [{
    "title": "focused lesson step",
    "contentSummary": "what this lesson contributes to the module milestone",
    "difficulty": "medium",
    "capabilityRefs": ["mc_1"],
    "milestoneRole": "introduce"
  }],
  "coverageRationale": "how the ordered units build every exit capability"
}`;

const EXPLORATION_STRUCTURE_SHAPE = `{
  "units": [{
    "title": "focused reading lesson step",
    "contentSummary": "what this lesson contributes to the module objective",
    "difficulty": "medium",
    "milestoneRole": "introduce"
  }],
  "coverageRationale": "how the ordered lessons cover the approved module scope"
}`;

export function moduleCognitiveEntityBudget(unitCount: number): {
  recommendedNewMin: number;
  maximumNew: number;
  maximumWorkingSet: number;
} {
  return cognitiveEntityBudget(unitCount);
}

export function evaluateModuleKacomStructuralReadiness(
  input: Omit<
    Parameters<typeof evaluateStructuralReadiness>[0],
    "entityBudget"
  >,
) {
  return evaluateStructuralReadiness({
    ...input,
    entityBudget: moduleCognitiveEntityBudget(input.units.length),
  });
}

export type PrepareModuleCapabilitiesAuthoringInput = {
  goalTitle: string;
  moduleTitle: string;
  moduleObjective: string;
  moduleSummary?: string;
  capabilityBriefs?: string[];
  priorModuleSummary: string;
  contentLanguage: ContentLanguageCode;
  teachingSkillBlock?: string;
  authoringMeta?: Record<string, unknown>;
};

type ModuleCapabilitiesPromptInput = PrepareModuleCapabilitiesAuthoringInput;

function buildModuleCapabilitiesPrompt(
  params: ModuleCapabilitiesPromptInput,
): string {
  const briefs = (params.capabilityBriefs ?? []).filter((brief) =>
    brief.trim(),
  );
  const summaryLine = params.moduleSummary?.trim()
    ? `Module summary: ${params.moduleSummary.trim()}\n`
    : "";
  const briefBlock = briefs.length
    ? `\nOptional planner hints (expand or replace with better observable contracts):\n${briefs.map((brief, index) => `${index + 1}. ${brief}`).join("\n")}\n`
    : "";
  return `You are defining the authoritative exit-capability contracts for one unlocked learning module.

Course: ${params.goalTitle}
Current module: ${params.moduleTitle}
Module objective: ${params.moduleObjective}
${summaryLine}Earlier completed module context:
${params.priorModuleSummary || "(This is the first module.)"}
${briefBlock}${params.teachingSkillBlock ? `\n${params.teachingSkillBlock}\n` : ""}

Create the fewest observable exit capabilities that still describe this module (minimum ${MIN_MODULE_CAPABILITIES}, maximum ${MAX_MODULE_CAPABILITIES}). Prefer ${MIN_MODULE_CAPABILITIES} for a narrow milestone. Do not invent extra capabilities to fill 3–6, and do not turn proof substeps into separate capabilities.
- A capability is demonstrable learner performance, never a vague topic.
- Each capability needs 2–5 concrete assessment criteria.
- Declare only cognitive dimensions that a direct diagnostic can observe.
- Dimension values are machine identifiers and must remain exactly one of: memory, understanding, application, transfer, fluency, stability, independence. Never translate these values, even when the surrounding content is not English.
- cognitiveLevel is also a machine identifier and must remain exactly one of: remember, understand, apply, analyze, evaluate, create.
- difficulty is also a machine identifier and must remain exactly one of: easy, medium, hard. Use hard, never high.
- Mark the small subset that must pass individually as criticalCompletionGate; at least one capability must be critical.
- Include application or transfer when the module promises usable performance.
- Keep capabilities broad enough for a module exit diagnostic but specific enough for deterministic scoring.
- Do not combine unrelated abilities.
- Do not create units, atoms, lesson content, questions, scores, evidence, or unlock decisions.
${getLanguagePromptInstruction(params.contentLanguage)}`;
}

export type PrepareModuleStructureAuthoringInput = {
  goalTitle: string;
  goalLevel: string;
  moduleTitle: string;
  moduleSummary: string;
  moduleObjective: string;
  plannedOutcomes?: string[];
  estimatedUnitCount?: number;
  unitPlanningBrief?: ModuleUnitPlanningBrief;
  capabilities: ModuleCapabilityProposal["capabilities"];
  priorModuleSummary: string;
  priorCognitiveContext: string;
  sourceContext?: string;
  validationFindings?: string;
  generationOptions?: string;
  contentLanguage: ContentLanguageCode;
  teachingSkillBlock?: string;
  authoringMeta?: Record<string, unknown>;
};

type ModuleStructurePromptInput = PrepareModuleStructureAuthoringInput;

function buildModuleStructurePrompt(params: ModuleStructurePromptInput) {
  const entityBudget = moduleCognitiveEntityBudget(
    Math.max(3, params.capabilities.length),
  );
  const capabilityBlock = params.capabilities
    .map(
      (capability, index) =>
        `mc_${index + 1}. ${capability.title}: ${capability.objective}`,
    )
    .join("\n");
  const outcomes = (params.plannedOutcomes ?? []).filter((item) => item.trim());
  const outcomeBlock = outcomes.length
    ? `Planner outcome hints:\n${outcomes.map((outcome) => `- ${outcome}`).join("\n")}\n\n`
    : "";
  return `You are generating the compact learning-unit journey for ONE unlocked module.

Course: ${params.goalTitle}
Learner level: ${params.goalLevel}
Current module: ${params.moduleTitle}
Summary: ${params.moduleSummary}
Objective: ${params.moduleObjective}
${outcomeBlock}Module exit capabilities:
${capabilityBlock}

Earlier completed modules:
${params.priorModuleSummary || "(none)"}

Published earlier cognitive context (reuse identical concepts; do not redefine them):
${params.priorCognitiveContext || "(none)"}

Relevant source context:
${params.sourceContext || "(none)"}

${params.validationFindings ? `Current module audit findings to repair in this draft:\n${params.validationFindings.slice(0, 4000)}\n` : ""}

Learner and generation guidance:
${params.generationOptions || "(none)"}
${params.teachingSkillBlock ? `\n${params.teachingSkillBlock}\n` : ""}

${GOAL_DIRECTED_TEACHING_POLICY}
For each new unit supply knowledgeSequence: requiredKnowledge, taughtKnowledge, dependsOnUnits (one-based earlier positions within THIS module only), and foundationsToTeachFirst. Copy the pedagogically relevant requirements and first-use bridges into the natural-language contentSummary so downstream lessons retain them. Dependencies on earlier modules must be justified by supplied earlier content, never encoded as local lesson numbers.

${TYPICAL_MODULE_LESSON_GUIDANCE}
- Units are steps toward the exit capabilities, not independent topic cards or textbook subsections.
- Every unit cites at least one mc_N capability; every capability must be covered.
- In coverageRationale, map relevant source section identifiers and their required scope to the actual unit positions/titles in this module. Use the supplied source text, including later passages; never invent missing source specifications or claim to cover unrelated modules.
- difficulty is a machine identifier and must remain exactly one of: easy, medium, hard. Use hard, never high.
- milestoneRole is a machine identifier and must remain exactly one of: introduce, practice, integrate, verify. Use practice rather than develop, and verify rather than assess.
- If the teaching persona specifies first-principles sequencing, order units for the fastest path to understanding rather than a textbook subsection list. Otherwise begin with the minimum new foundation, then practice, integrate, and verify as appropriate.
- Avoid duplicate entities or targets already established in earlier modules.
- Reuse earlier stable cognitive concepts when the meaning is identical.
- Later KACOM generation may add prerequisite/enables/supports edges to earlier entities.
- Never generate, preview, revise, or mention the internal structure of a locked future module.
- Do not create nested course modules, atoms, targets, assessments, or lesson content here.
- Later KACOM authoring should generally create ${entityBudget.recommendedNewMin}–${entityBudget.maximumNew} genuinely new cognitive entities for this module and reuse earlier identities whenever meanings match. This range is planning guidance, not a publication gate; coherent lesson contracts may exceed it.
- The complete working set, including reused earlier entities, must never exceed ${entityBudget.maximumWorkingSet}.
${getLanguagePromptInstruction(params.contentLanguage)}`;
}

export type PrepareExplorationModuleStructureAuthoringInput = Omit<
  PrepareModuleStructureAuthoringInput,
  "capabilities" | "priorCognitiveContext"
>;

type ExplorationModuleStructurePromptInput =
  PrepareExplorationModuleStructureAuthoringInput;

function buildExplorationModuleStructurePrompt(
  params: ExplorationModuleStructurePromptInput,
) {
  const outcomes = (params.plannedOutcomes ?? []).filter((item) => item.trim());
  const outcomeBlock = outcomes.length
    ? `Planner outcome hints:\n${outcomes.map((outcome) => `- ${outcome}`).join("\n")}\n\n`
    : "";
  return `You are generating the compact reading journey for ONE unlocked exploration module.

Course: ${params.goalTitle}
Learner level: ${params.goalLevel}
Current module: ${params.moduleTitle}
Summary: ${params.moduleSummary}
Objective: ${params.moduleObjective}
${outcomeBlock}Earlier completed modules:
${params.priorModuleSummary || "(none)"}

Relevant source context:
${params.sourceContext || "(none)"}

${params.validationFindings ? `Current module audit findings to repair in this draft:\n${params.validationFindings.slice(0, 4000)}\n` : ""}

Learner and generation guidance:
${params.generationOptions || "(none)"}
${params.teachingSkillBlock ? `\n${params.teachingSkillBlock}\n` : ""}

${GOAL_DIRECTED_TEACHING_POLICY}
For each new unit supply knowledgeSequence: requiredKnowledge, taughtKnowledge, dependsOnUnits (one-based earlier positions within THIS module only), and foundationsToTeachFirst. Copy the pedagogically relevant requirements and first-use bridges into the natural-language contentSummary so downstream lessons retain them. Dependencies on earlier modules must be justified by supplied earlier content, never encoded as local lesson numbers.

${TYPICAL_MODULE_LESSON_GUIDANCE}
- Cover the approved objective without padding or repetition.
- In coverageRationale, map relevant source section identifiers and their required scope to the actual unit positions/titles in this module. Use the supplied source text, including later passages; never invent missing source specifications or claim to cover unrelated modules.
- Each lesson must have a narrow content focus suitable for one GELC-shaped reading session.
- Move from orientation and examples toward integration and a final synthesis/checkpoint where appropriate.
- difficulty must remain exactly easy, medium, or hard.
- milestoneRole must remain exactly introduce, practice, integrate, or verify.
- This goal is exploration-only: do not create KACOM entities, learning targets, capability refs, evidence contracts, graded diagnostics, or mastery claims.
- When the confirmed objective requires independent analysis or application, plan a concrete learner-produced example on new material and a way to compare or revise it using feedback. Keep this an ungraded learning opportunity, without a completion gate or mastery claim.
- Never generate or mention the internal structure of a locked future module.
- Do not author lesson content or assessment questions here.
${getLanguagePromptInstruction(params.contentLanguage)}`;
}

type ModuleKacomAuditPromptInput = Omit<
  Parameters<typeof auditModuleKacom>[0],
  "signal"
>;

const MODULE_CAPABILITIES_INSTRUCTION = `Define the requested module's authoritative exit-capability contracts from the invocation input.
- Preserve the goal, module objective, planned capability briefs, language, and prior-module boundary.
- Match capability count to the module's actual exit. Prefer the schema minimum for a narrow milestone; do not invent extras to fill a typical 3–6 range.
- Define observable module-exit performance only; do not create lessons, assessments, evidence, or unlock decisions.
- Follow the invocation's complete rules and structured-output contract.`;

const MODULE_STRUCTURE_INSTRUCTION = `Create the requested module's ordered learning-unit journey from the invocation input.
- Preserve the approved module objective, exit capabilities, language, and prior cognitive identities.
- Match lesson count to the module's actual scope. One focused lesson is valid; do not pad toward 3–8 or split a proof into substep lessons.
- Cover every supplied module capability without entering locked future-module scope.
- If the teaching persona specifies first-principles sequencing, order units for the fastest path to understanding rather than a textbook subsection list.
- Follow the invocation's complete rules and structured-output contract.`;

const MODULE_EXPLORATION_STRUCTURE_INSTRUCTION = `Create the requested exploration module's ordered reading-unit journey from the invocation input.
- Preserve the approved module objective, language, and prior-module boundary.
- Match lesson count to the approved objective. One focused reading lesson is valid for a narrow module; do not pad toward 3–8.
- Keep the result KACOM-free: do not create capabilities, cognitive entities, targets, evidence contracts, or assessments.
- If the teaching persona specifies first-principles sequencing, order reading units for understanding rather than a textbook subsection list.
- Follow the invocation's complete rules and structured-output contract.`;

const MODULE_KACOM_AUDIT_INSTRUCTION = `Audit the requested finished module KACOM proposal from the invocation input.
- Check only semantic identity reuse, module-capability coverage, relationship direction, and unnecessary proliferation.
- Preserve prior modules, evidence contracts, identifiers, completion authority, and future-module boundaries.
- Follow the invocation's complete audit rules and structured-output contract.`;

function buildModuleKacomAuditPrompt(
  params: ModuleKacomAuditPromptInput,
): string {
  return `Audit the finished KACOM proposal for ONE learning module.

Course: ${params.goalTitle}
Module: ${params.moduleTitle}
Objective: ${params.moduleObjective}
Capabilities:
${params.capabilitySummary}

Ordered units and target coverage:
${params.unitSummary}

Published entities (including reusable prior-module identities):
${params.entitySummary}

Relevant relations:
${params.relationSummary || "(none)"}

Check only:
1. semantic duplicates that should reuse one stable identity;
2. missing module-capability coverage;
3. invalid or backward prerequisite/enables relationships;
4. unnecessary atom/entity proliferation.
Do not rewrite prior modules, define future modules, change evidence contracts, assign IDs, decide completion, or unlock anything.
Return repair_required only for a concrete correctness problem. Cosmetic wording differences are not failures.
${getLanguagePromptInstruction(params.contentLanguage)}`;
}

export function createModuleCurriculumCapability() {
  const capabilityId = "module-curriculum";
  const version = "1.3.0";
  const view =
    (promptBlock: string) =>
    async ({ subject }: SystemViewRequest): Promise<ContextEnvelope> => {
      return {
        ownerCapabilityId: capabilityId,
        ownerCapabilityVersion: version,
        schemaVersion: 1,
        authority: "server_policy",
        scope: { ...subject },
        freshness: { asOf: new Date(0).toISOString(), stale: false },
        data: { promptBlock },
      };
    };
  return defineLearningSystemCapability({
    id: capabilityId,
    version,
    kind: "learning_system",
    views: {
      [MODULE_CURRICULUM_VIEW_KEYS.capabilitiesInstructionContext]: view(
        MODULE_CAPABILITIES_INSTRUCTION,
      ),
      [MODULE_CURRICULUM_VIEW_KEYS.structureInstructionContext]: view(
        MODULE_STRUCTURE_INSTRUCTION,
      ),
      [MODULE_CURRICULUM_VIEW_KEYS.explorationStructureInstructionContext]:
        view(MODULE_EXPLORATION_STRUCTURE_INSTRUCTION),
      [MODULE_CURRICULUM_VIEW_KEYS.auditInstructionContext]: view(
        MODULE_KACOM_AUDIT_INSTRUCTION,
      ),
    },
  });
}

/** Provider-independent module-exit capability contract after context gathering. */
export function prepareModuleCapabilitiesAuthoring(
  params: PrepareModuleCapabilitiesAuthoringInput,
) {
  const resultSchema = moduleCapabilityResultSchema();
  const recoveryPolicy = {
    sourceSchema: moduleCapabilityProviderResponseSchema,
    normalize: (candidate: unknown) => {
      const parsed = candidate as z.infer<
        typeof moduleCapabilityProviderResponseSchema
      >;
      const droppedCount = Math.max(
        0,
        parsed.capabilities.length - MAX_MODULE_CAPABILITIES,
      );
      return {
        value:
          droppedCount > 0
            ? {
                ...parsed,
                capabilities: parsed.capabilities.slice(
                  0,
                  MAX_MODULE_CAPABILITIES,
                ),
              }
            : parsed,
        droppedCount,
      };
    },
    repairSlots: ({ candidate }: { candidate: unknown }) =>
      capabilityRecoverySlots({
        candidate,
        capabilityBriefs: params.capabilityBriefs ?? [],
      }),
  };
  const prompt = buildModuleCapabilitiesPrompt(params);
  const parseResult = (candidate: unknown) => {
    const source = moduleCapabilityProviderResponseSchema.parse(candidate);
    return resultSchema.parse(recoveryPolicy.normalize(source).value);
  };
  return {
    operation: "module.capabilities" as const,
    prompt,
    standalonePrompt: `${MODULE_CAPABILITIES_INSTRUCTION}\n\n${prompt}`,
    contextInvocation: params,
    schema: resultSchema,
    acceptSchema: acceptNormalizedProviderResult(
      moduleCapabilityProviderResponseSchema,
      (parsed) => recoveryPolicy.normalize(parsed).value,
      resultSchema,
    ),
    bindingSchema: moduleCapabilityProposalSchema,
    schemaShape: CAPABILITY_SHAPE,
    recoveryPolicy,
    parseResult,
    parseProviderOutput: (content: string) =>
      parseResult(parseLlmJson<unknown>(content)),
  };
}

export async function generateModuleCapabilities(
  params: PrepareModuleCapabilitiesAuthoringInput & { signal?: AbortSignal },
) {
  const prepared = prepareModuleCapabilitiesAuthoring(params);
  const result = await runValidatedStructuredGeneration(
    {
      mode: "object",
      schema: prepared.schema,
      prompt: prepared.prompt,
      recoveryPolicy: prepared.recoveryPolicy,
      options: {
        operation: prepared.operation,
        schemaShape: prepared.schemaShape,
        bindingSchema: prepared.bindingSchema,
        meta: {
          goalTitle: params.goalTitle,
          moduleTitle: params.moduleTitle,
          ...teachingSkillGenerationMeta(params.teachingSkillBlock),
          ...params.authoringMeta,
        },
      },
      contextSubject: {},
      contextQuery: params.moduleTitle.slice(0, 2_000),
      contextInvocation: prepared.contextInvocation,
    },
    { signal: params.signal },
  );
  return result;
}

/** Provider-independent mastery module lesson-structure contract. */
export function prepareModuleStructureAuthoring(
  params: PrepareModuleStructureAuthoringInput,
) {
  const entityBudget = moduleCognitiveEntityBudget(
    Math.max(3, params.capabilities.length),
  );
  const resultSchema = exactModuleStructureSchema(params.capabilities.length);
  const recoveryPolicy = {
    sourceSchema: moduleStructureProviderResponseSchema,
    normalize: (candidate: unknown) => {
      const parsed = candidate as z.infer<
        typeof moduleStructureProviderResponseSchema
      >;
      // Overflow must fail validation; truncation silently removes goal coverage.
      return { value: parsed, droppedCount: 0 };
    },
    repairSlots: ({ candidate }: { candidate: unknown }) =>
      structureRecoverySlots({
        candidate,
        capabilityCount: params.capabilities.length,
        progression: params.unitPlanningBrief?.progression ?? [],
      }),
  };
  const prompt = buildModuleStructurePrompt(params);
  const parseResult = (candidate: unknown) => {
    const source = moduleStructureProviderResponseSchema.parse(candidate);
    return resultSchema.parse(recoveryPolicy.normalize(source).value);
  };
  return {
    operation: "module.structure" as const,
    prompt,
    standalonePrompt: `${MODULE_STRUCTURE_INSTRUCTION}\n\n${prompt}`,
    contextInvocation: params,
    entityBudget,
    schema: resultSchema,
    acceptSchema: acceptNormalizedProviderResult(
      moduleStructureProviderResponseSchema,
      (parsed) => recoveryPolicy.normalize(parsed).value,
      resultSchema,
    ),
    bindingSchema: moduleStructureProposalSchema,
    schemaShape: STRUCTURE_SHAPE,
    recoveryPolicy,
    parseResult,
    parseProviderOutput: (content: string) =>
      parseResult(parseLlmJson<unknown>(content)),
  };
}

export async function generateModuleStructure(
  params: PrepareModuleStructureAuthoringInput & { signal?: AbortSignal },
) {
  const prepared = prepareModuleStructureAuthoring(params);
  const result = await runValidatedStructuredGeneration(
    {
      mode: "object",
      schema: prepared.schema,
      prompt: prepared.prompt,
      recoveryPolicy: prepared.recoveryPolicy,
      options: {
        operation: prepared.operation,
        schemaShape: prepared.schemaShape,
        bindingSchema: prepared.bindingSchema,
        meta: {
          goalTitle: params.goalTitle,
          moduleTitle: params.moduleTitle,
          maximumNewCognitiveEntities: prepared.entityBudget.maximumNew,
          maximumWorkingSetEntities: prepared.entityBudget.maximumWorkingSet,
          ...teachingSkillGenerationMeta(params.teachingSkillBlock),
          ...params.authoringMeta,
        },
      },
      contextSubject: {},
      contextQuery: params.moduleTitle.slice(0, 2_000),
      contextInvocation: prepared.contextInvocation,
    },
    { signal: params.signal },
  );
  return result;
}

/** Provider-independent exploration module lesson-structure contract. */
export function prepareExplorationModuleStructureAuthoring(
  params: PrepareExplorationModuleStructureAuthoringInput,
) {
  const resultSchema = z
    .object({
      units: z
        .array(explorationModuleUnitSchema)
        .min(MIN_MODULE_UNITS)
        .max(MAX_MODULE_UNITS),
      coverageRationale: z.string().trim().min(1),
    })
    .superRefine(validateLessonKnowledgeOrder);
  const recoveryPolicy = {
    sourceSchema: explorationModuleStructureProviderResponseSchema,
    normalize: (candidate: unknown) => {
      const parsed = candidate as z.infer<
        typeof explorationModuleStructureProviderResponseSchema
      >;
      // Overflow must fail validation; truncation silently removes goal coverage.
      return { value: parsed, droppedCount: 0 };
    },
    repairSlots: ({ candidate }: { candidate: unknown }) => {
      const parsed = candidate as z.infer<
        typeof explorationModuleStructureProviderResponseSchema
      >;
      const repairs: ObjectRepairSlot[] = [];
      if (parsed.units.length === 0) {
        repairs.push({
          slot: {
            description: `Create the first ordered exploration lesson for this module.`,
            schema: explorationModuleUnitSchema,
          },
          apply: (root, value) => {
            const current = root as z.infer<
              typeof explorationModuleStructureProviderResponseSchema
            >;
            return { ...current, units: [...current.units, value] };
          },
        });
      }
      return repairs;
    },
  };
  const prompt = buildExplorationModuleStructurePrompt(params);
  const parseResult = (candidate: unknown) => {
    const source =
      explorationModuleStructureProviderResponseSchema.parse(candidate);
    return resultSchema.parse(recoveryPolicy.normalize(source).value);
  };
  return {
    operation: "module.exploration_structure" as const,
    prompt,
    standalonePrompt: `${MODULE_EXPLORATION_STRUCTURE_INSTRUCTION}\n\n${prompt}`,
    contextInvocation: params,
    schema: resultSchema,
    acceptSchema: acceptNormalizedProviderResult(
      explorationModuleStructureProviderResponseSchema,
      (parsed) => recoveryPolicy.normalize(parsed).value,
      resultSchema,
    ),
    bindingSchema: explorationModuleStructureProposalSchema,
    schemaShape: EXPLORATION_STRUCTURE_SHAPE,
    recoveryPolicy,
    parseResult,
    parseProviderOutput: (content: string) =>
      parseResult(parseLlmJson<unknown>(content)),
  };
}

export async function generateExplorationModuleStructure(
  params: PrepareExplorationModuleStructureAuthoringInput & {
    signal?: AbortSignal;
  },
) {
  const prepared = prepareExplorationModuleStructureAuthoring(params);
  return runValidatedStructuredGeneration(
    {
      mode: "object",
      schema: prepared.schema,
      prompt: prepared.prompt,
      recoveryPolicy: prepared.recoveryPolicy,
      options: {
        operation: prepared.operation,
        schemaShape: prepared.schemaShape,
        bindingSchema: prepared.bindingSchema,
        meta: {
          goalTitle: params.goalTitle,
          moduleTitle: params.moduleTitle,
          ...teachingSkillGenerationMeta(params.teachingSkillBlock),
          ...params.authoringMeta,
        },
      },
      contextSubject: {},
      contextQuery: params.moduleTitle.slice(0, 2_000),
      contextInvocation: prepared.contextInvocation,
    },
    { signal: params.signal },
  );
}

export type PrepareModuleKacomAuditAuthoringInput = {
  goalTitle: string;
  moduleTitle: string;
  moduleObjective: string;
  capabilitySummary: string;
  unitSummary: string;
  entitySummary: string;
  relationSummary: string;
  contentLanguage: ContentLanguageCode;
};

/** Provider-independent semantic audit contract shared by hosted and local. */
export function prepareModuleKacomAuditAuthoring(
  params: PrepareModuleKacomAuditAuthoringInput,
) {
  const prompt = buildModuleKacomAuditPrompt(params);
  const parseResult = (candidate: unknown) =>
    moduleKacomAuditSchema.parse(candidate);
  return {
    operation: "module.kacom.audit" as const,
    prompt,
    standalonePrompt: `${MODULE_KACOM_AUDIT_INSTRUCTION}\n\n${prompt}`,
    contextInvocation: params,
    schema: moduleKacomAuditSchema,
    bindingSchema: moduleKacomAuditSchema,
    schemaShape:
      '{"verdict":"pass","duplicateConcepts":[],"missingCoverage":[],"invalidRelationships":[],"unnecessaryProliferation":[],"rationale":"..."}',
    parseResult,
    parseProviderOutput: (content: string) =>
      parseResult(parseLlmJson<unknown>(content)),
  };
}

export async function auditModuleKacom(
  params: PrepareModuleKacomAuditAuthoringInput & {
    signal?: AbortSignal;
  },
) {
  const prepared = prepareModuleKacomAuditAuthoring(params);
  return runValidatedStructuredGeneration(
    {
      mode: "object",
      schema: prepared.schema,
      prompt: prepared.prompt,
      options: {
        operation: prepared.operation,
        bindingSchema: prepared.bindingSchema,
        schemaShape: prepared.schemaShape,
        meta: {
          goalTitle: params.goalTitle,
          moduleTitle: params.moduleTitle,
        },
      },
      contextSubject: {},
      contextQuery: params.moduleTitle.slice(0, 2_000),
      contextInvocation: params,
    },
    { signal: params.signal },
  );
}
