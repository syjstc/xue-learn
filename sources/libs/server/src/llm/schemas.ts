import type { PresentationCapabilities } from "../../../domain/src/presentation-capabilities.js";
import { materialMusicBindingSchema, musicCueActionSchema } from "./music-schema.js";
import { learnerFacingContentIssues } from "../../../domain/src/learner-facing-content.js";
import { materialMusicTreeIssues } from "../../../domain/src/material-music.js";
import { materialVisualTreeIssues } from "../../../domain/src/material-visual.js";
import { materialTeachingBindingSchema, materialTeachingAuthoringBindingSchema } from "../../../domain/src/material-teaching.js";
import { materialTeachingTreeIssues } from "../../../domain/src/material-teaching-validation.js";
import { guidedImageDisplaySchema } from "../learning-systems/capabilities/material-components/guided-image/schema.js";
import { TOPIC_CATEGORIES } from "../../../common/src/index.js";
import { z } from "zod";
import { safeCourseSvgMarkupSchema } from "./safe-svg.js";
import {
  normalizeGoalMapPlan,
  preprocessGoalMapPlanPayload,
} from "../goals/normalize-goal-map-plan.js";
import { UNIT_QUIZ_BATCH_SIZE } from "../learning-systems/capabilities/assessment-runtime/quiz-prompt.js";
import {
  expandCornellCompact,
  expandDrillsCompact,
  expandFlashcardDeckCompact,
  expandFeynmanCompact,
  expandSocraticCompact,
  expandSqAnswersCompact,
} from "./compact-json.js";
import {
  MAX_KEY_TAKEAWAYS,
  MIN_LEARNING_MATERIAL_BLOCKS,
  normalizeLearningMaterial,
} from "./normalize-learning-material.js";
import { normalizeQuizPayload } from "./normalize-quiz.js";
import { normalizeSq3rPayload } from "./normalize-sq3r.js";
import { stripInternalLearningTargetRefs } from "./learner-facing-text.js";
import { containsCollapsedGeneratedCodeFence } from "../markdown/validate-code-fences.js";
import { courseSvgIntentSchema } from "./course-svg-intent.js";
import {
  collectCircuitParts,
  normalizeChemistryLabDefinition,
  normalizeCircuitSandboxPayload,
  validateMathExpression,
  type CircuitNode,
} from "../../../domain/src/index.js";
import { portableQuizQuestionSchema } from "../quiz/authoring.js";
import {
  portableSurveyPreviewSchema,
  generatableSurveyComponentTypeSchema,
  surveyComplexComponentTypeSchema,
  surveyGuidingQuestionSchema,
  surveyLearningTargetSchema,
  surveySectionOutlineItemSchema,
  surveySectionPlanItemSchema,
  surveySectionPlanSchema,
} from "../survey/authoring.js";

/** A session is a capability-scoped lesson; a module groups lessons. */
export const unitScopeSchema = z.enum(["session", "module"]);

/** scope for flat decompose output on the goal cognitive map */
export const decomposeUnitScopeSchema = z.enum(["session", "module", "branch"]);

/** Normalize only empty LLM placeholders; do not broadly coerce strings. */
const optionalLlmBooleanSchema = z
  .preprocess(
    (value) =>
      value === null || (typeof value === "string" && value.trim().length === 0)
        ? false
        : value,
    z.boolean(),
  )
  .optional();

/** First-level units on the goal cognitive map; deeper structure uses sub-units. */
export const MAX_TOP_LEVEL_UNITS = 12;
export const MIN_TOP_LEVEL_UNITS = 1;
/** Sequential curriculum v2 module count bounds. */
export const MAX_SEQUENTIAL_MODULES = 8;
/** Lessons generated inside one unlocked module. */
export const MIN_MODULE_UNITS = 1;
export const MAX_MODULE_UNITS = 20;
/** Max units returned in a single decompose LLM call (title-only catalogs). */
export const MAX_DECOMPOSE_UNITS = 500;
/** Max top-level units when map uses expansion stubs (catalog-scale goals). */
export const MAX_CATALOG_TOP_LEVEL_UNITS = 15;
/** Direct children under a generated module should stay scan-friendly. */
export const MIN_BRANCH_CHILD_UNITS = 2;
export const MAX_BRANCH_CHILD_UNITS = 12;
/** Above this, force another grouping layer instead of a flat sibling list. */
export const LARGE_FLAT_CHILD_THRESHOLD = 30;

export const decomposeUnitBindingSchema = z.object({
  title: z.string(),
  /** Optional parent module title; omitted/null means top-level goal map unit. */
  parentTitle: z.string().optional().nullable(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  prerequisiteTitles: z.array(z.string()).default([]),
  contentSummary: z.string().optional().default(""),
  planAreaRef: z
    .string()
    .regex(/^a_[1-9]\d*$/)
    .optional(),
  planningOutcomeRefs: z.array(z.string().regex(/^o_[1-9]\d*$/)).default([]),
  scope: decomposeUnitScopeSchema.default("session"),
  /** When true on a module stub, orchestrator expands this branch in follow-up calls. */
  needsExpansion: z.boolean().optional(),
});

export const decomposeUnitSchema = decomposeUnitBindingSchema.extend({
  needsExpansion: optionalLlmBooleanSchema,
});

export const subdivideUnitSchema = z.object({
  title: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  contentSummary: z.string(),
});

export const subdivideResultSchema = z.object({
  children: z
    .array(subdivideUnitSchema)
    .min(MIN_BRANCH_CHILD_UNITS)
    .max(MAX_BRANCH_CHILD_UNITS),
});

export type ExpandMapBranchChild = {
  title: string;
  difficulty: "easy" | "medium" | "hard";
  scope: z.infer<typeof unitScopeSchema>;
  needsExpansion?: boolean;
  contentSummary: string;
  children?: ExpandMapBranchChild[];
};

export const expandMapBranchChildBindingSchema: z.ZodType<ExpandMapBranchChild> =
  z.lazy(() =>
    z.object({
      title: z.string(),
      difficulty: z.enum(["easy", "medium", "hard"]),
      scope: unitScopeSchema.default("session"),
      needsExpansion: z.boolean().optional(),
      contentSummary: z.string().optional().default(""),
      children: z
        .array(expandMapBranchChildBindingSchema)
        .min(MIN_BRANCH_CHILD_UNITS)
        .max(MAX_BRANCH_CHILD_UNITS)
        .optional(),
    }),
  );

export const expandMapBranchChildSchema: z.ZodType<ExpandMapBranchChild> =
  z.lazy(() =>
    z.object({
      title: z.string(),
      difficulty: z.enum(["easy", "medium", "hard"]),
      scope: unitScopeSchema.default("session"),
      needsExpansion: optionalLlmBooleanSchema,
      contentSummary: z.string().optional().default(""),
      children: z
        .array(expandMapBranchChildSchema)
        .min(MIN_BRANCH_CHILD_UNITS)
        .max(MAX_BRANCH_CHILD_UNITS)
        .optional(),
    }),
  );

export const MAX_EXPAND_MAP_BRANCH_NODES = 120;

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function titleOf(value: unknown, fallback: string): string {
  const record = asPlainRecord(value);
  const title = record?.title;
  return typeof title === "string" && title.trim() ? title.trim() : fallback;
}

function branchDifficulty(children: unknown[]): "easy" | "medium" | "hard" {
  const rank = { easy: 0, medium: 1, hard: 2 } as const;
  let best: keyof typeof rank = "medium";
  for (const child of children) {
    const difficulty = asPlainRecord(child)?.difficulty;
    if (
      typeof difficulty === "string" &&
      difficulty in rank &&
      rank[difficulty as keyof typeof rank] > rank[best]
    ) {
      best = difficulty as keyof typeof rank;
    }
  }
  return best;
}

function groupedRangeTitle(
  index: number,
  firstTitle: string,
  lastTitle: string,
): string {
  const range =
    firstTitle === lastTitle ? firstTitle : `${firstTitle} - ${lastTitle}`;
  return `${index + 1}. ${range}`;
}

function chunkForBranchWidth(children: unknown[]): unknown[][] {
  const groupCount = Math.min(
    MAX_BRANCH_CHILD_UNITS,
    Math.max(
      MIN_BRANCH_CHILD_UNITS,
      Math.ceil(children.length / MAX_BRANCH_CHILD_UNITS),
    ),
  );
  const chunkSize = Math.ceil(children.length / groupCount);
  const chunks: unknown[][] = [];
  for (let i = 0; i < children.length; i += chunkSize) {
    chunks.push(children.slice(i, i + chunkSize));
  }
  return chunks;
}

function normalizeBranchChildTree(child: unknown): unknown {
  const record = asPlainRecord(child);
  if (!record) return child;
  const nested = Array.isArray(record.children)
    ? normalizeBranchChildrenForWidth(record.children, titleOf(record, "Group"))
    : undefined;
  return nested ? { ...record, children: nested } : record;
}

function normalizeBranchChildrenForWidth(
  children: unknown[],
  parentTitle?: string,
): unknown[] {
  const normalizedChildren = children.map(normalizeBranchChildTree);
  if (normalizedChildren.length <= MAX_BRANCH_CHILD_UNITS) {
    return normalizedChildren;
  }

  return chunkForBranchWidth(normalizedChildren).map((chunk, index) => {
    const firstTitle = titleOf(chunk[0], `Unit ${index + 1}`);
    const lastTitle = titleOf(chunk[chunk.length - 1], firstTitle);
    const groupTitle = groupedRangeTitle(index, firstTitle, lastTitle);
    return {
      title: groupTitle,
      contentSummary: [
        `Covers ${chunk.length} related units`,
        `from "${firstTitle}" through "${lastTitle}"`,
        "as one focused branch.",
      ].join(" "),
      difficulty: branchDifficulty(chunk),
      scope: "module",
      children: normalizeBranchChildrenForWidth(chunk, groupTitle),
    };
  });
}

export function normalizeExpandMapBranchPayload(data: unknown): unknown {
  const root = asPlainRecord(data);
  if (!root || !Array.isArray(root.children)) return data;
  return {
    ...root,
    children: normalizeBranchChildrenForWidth(root.children),
  };
}

export function countExpandMapBranchNodes(
  children: ExpandMapBranchChild[],
): number {
  return children.reduce(
    (total, child) =>
      total +
      1 +
      (child.children?.length ? countExpandMapBranchNodes(child.children) : 0),
    0,
  );
}

export const expandMapBranchBindingSchema = z.object({
  children: z
    .array(expandMapBranchChildBindingSchema)
    .min(1)
    .max(MAX_BRANCH_CHILD_UNITS),
  complete: z.boolean(),
});

export const expandMapBranchResultSchema = z.preprocess(
  normalizeExpandMapBranchPayload,
  expandMapBranchBindingSchema.superRefine((data, ctx) => {
    const nodeCount = countExpandMapBranchNodes(data.children);
    if (nodeCount > MAX_EXPAND_MAP_BRANCH_NODES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `branch must have at most ${MAX_EXPAND_MAP_BRANCH_NODES} total nodes (got ${nodeCount})`,
      });
    }
    const walk = (nodes: ExpandMapBranchChild[], path: string) => {
      for (const node of nodes) {
        const here = path ? `${path} > ${node.title}` : node.title;
        if (node.scope === "session" && node.children?.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `session nodes cannot have children (${here})`,
          });
        }
        if (
          node.scope === "module" &&
          !node.needsExpansion &&
          !node.children?.length
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `module nodes need inline children or needsExpansion (${here})`,
          });
        }
        if (node.scope === "module" && node.children?.length === 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `module nodes with one child should be a session leaf instead (${here})`,
          });
        }
        if (node.children?.length) {
          walk(node.children, here);
        }
      }
    };
    walk(data.children, "");
  }),
);

export type ExpandMapBranchResult = z.infer<typeof expandMapBranchResultSchema>;

export const microTopicScopeSchema = z.enum(["focused", "overview"]);

/** Single lesson for micro (light) courses — no cognitive map. */
export const microUnitResultSchema = z.object({
  refinedTitle: z.string().optional(),
  topicScope: microTopicScopeSchema.default("focused"),
  topicOverview: z.string(),
  title: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  contentSummary: z.string(),
});

export type MicroUnitResult = z.infer<typeof microUnitResultSchema>;

/** First map gen: flat list of top-level learnable units (session or branch scope). */
export function isFlatTopLevelMap(
  units: Array<{ scope: string; parentTitle?: string | null }>,
): boolean {
  return units.length > 0 && units.every((u) => !u.parentTitle?.trim());
}

/** First map gen: flat list of learnable session units only. */
export function isFlatSessionMap(
  units: Array<{ scope: string; parentTitle?: string | null }>,
): boolean {
  return isFlatTopLevelMap(units) && units.every((u) => u.scope === "session");
}

/** @deprecated Legacy flat module lists from older prompts; normalized to sessions before persist. */
export function isFlatModuleMap(
  units: Array<{ scope: string; parentTitle?: string | null }>,
): boolean {
  return (
    units.length > 0 &&
    units.every((u) => u.scope === "module" || u.scope === "branch")
  );
}

function countTopLevelUnits(units: z.infer<typeof decomposeUnitSchema>[]) {
  if (isFlatTopLevelMap(units) || isFlatModuleMap(units)) return units.length;
  return units.filter((u) => !u.parentTitle?.trim()).length;
}

function validateDecomposeTopLevel(
  units: z.infer<typeof decomposeUnitSchema>[],
) {
  return countTopLevelUnits(units) >= 1;
}

function validateDecomposeSiblingGroups(
  units: z.infer<typeof decomposeUnitSchema>[],
): string | null {
  const hasNested = units.some((u) => u.parentTitle?.trim());
  if (!hasNested) return null;

  const childCountByParent = new Map<string, number>();
  for (const unit of units) {
    const parentTitle = unit.parentTitle?.trim();
    if (!parentTitle) continue;
    childCountByParent.set(
      parentTitle,
      (childCountByParent.get(parentTitle) ?? 0) + 1,
    );
  }

  for (const [parentTitle, childCount] of childCountByParent) {
    if (
      childCount < MIN_BRANCH_CHILD_UNITS ||
      childCount > MAX_BRANCH_CHILD_UNITS
    ) {
      return `module "${parentTitle}" must have ${MIN_BRANCH_CHILD_UNITS}-${MAX_BRANCH_CHILD_UNITS} direct children (got ${childCount})`;
    }
  }
  return null;
}

/** JSON-schema-safe binding for native structured output (validation runs after parse). */
export const decomposeResultBindingSchema = z.object({
  domainTag: z.enum(["stem", "humanities", "general"]),
  units: z.array(decomposeUnitBindingSchema).max(MAX_DECOMPOSE_UNITS),
});

export const decomposeResultSchema = z
  .object({
    domainTag: z.enum(["stem", "humanities", "general"]),
    units: z.array(decomposeUnitSchema).max(MAX_DECOMPOSE_UNITS),
  })
  .superRefine((data, ctx) => {
    if (!validateDecomposeTopLevel(data.units)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "map must contain at least one top-level unit",
      });
    }

    const siblingGroupError = validateDecomposeSiblingGroups(data.units);
    if (siblingGroupError) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: siblingGroupError,
      });
    }
  });

export type DecomposeUnit = z.infer<typeof decomposeUnitSchema>;
export type DecomposeResult = z.infer<typeof decomposeResultSchema>;
export type SubdivideResult = z.infer<typeof subdivideResultSchema>;
export type UnitScope = z.infer<typeof unitScopeSchema>;

/** @deprecated Legacy summary outline item; migrated to topicOverview-only summaries. */
export const goalMapSummaryItemSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
});

function preprocessGoalMapSummaryPayload(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const raw = value as Record<string, unknown>;
  const legacyOutline = Array.isArray(raw.topLevelOutline)
    ? raw.topLevelOutline
    : [];
  if (legacyOutline.length === 0) {
    return {
      refinedTitle: raw.refinedTitle,
      topicOverview: raw.topicOverview,
      assumptions: raw.assumptions,
    };
  }

  const outlineLines = legacyOutline
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (typeof item === "object" && item !== null) {
        const row = item as Record<string, unknown>;
        const title = typeof row.title === "string" ? row.title.trim() : "";
        const description =
          typeof row.description === "string" ? row.description.trim() : "";
        return description ? `${title}：${description}` : title;
      }
      return "";
    })
    .filter(Boolean);
  const legacyOverview =
    typeof raw.topicOverview === "string" ? raw.topicOverview.trim() : "";
  const outlineBlock = outlineLines
    .map((line, index) => `${index + 1}. ${line}`)
    .join("\n");
  const mergedOverview = legacyOverview
    ? `${legacyOverview}\n\n${outlineBlock}`
    : outlineBlock;

  return {
    refinedTitle: raw.refinedTitle,
    topicOverview: mergedOverview,
    assumptions: raw.assumptions,
  };
}

export const goalMapSummaryFieldsSchema = z.object({
  refinedTitle: z.string().trim().min(1).optional(),
  topicOverview: z.string().trim().min(1),
  assumptions: z.array(z.string()).default([]),
});

export const goalMapSummarySchema = z.preprocess(
  preprocessGoalMapSummaryPayload,
  goalMapSummaryFieldsSchema,
);

export type GoalMapSummary = z.infer<typeof goalMapSummaryFieldsSchema>;

/** How the learner engages with the field — drives pedagogy before map design. */
export const learningModeSchema = z.enum([
  "skill_practice",
  "conceptual_understanding",
  "research_scholarship",
  "professional_applied",
  "creative_expression",
  "mixed",
]);

export const domainAnalysisSchema = z.object({
  field: z.string().trim().min(1),
  subdomain: z.string().trim().min(1),
  learningMode: learningModeSchema,
  domainTag: z.enum(["stem", "humanities", "general"]),
  /** Broad topic category — drives specialist content markup (language ruby, STEM LaTeX, etc.). */
  topicCategory: z.enum(TOPIC_CATEGORIES),
  /** Why this mode fits (e.g. language use vs linguistics research). */
  modeClarification: z.string().trim().min(1),
  alternateInterpretations: z
    .array(
      z.object({
        label: z.string(),
        whyNotChosen: z.string(),
      }),
    )
    .max(3)
    .default([]),
});

export const mapStructureSchema = z.object({
  recommendedDepth: z.number().int().min(1).max(4),
  estimatedLeafUnits: z.number().int().min(1).max(200),
  layeringStrategy: z.string().trim().min(1),
  nestingRationale: z.string().trim().min(1),
});

export const majorAreaSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  /** leaf = one session; branch = module region with generated children. */
  mapRole: z.enum(["leaf", "branch"]).default("leaf"),
  estimatedChildCount: z.number().int().min(1).max(30).optional(),
  /** Grouping axis when branch: theme, difficulty, skill type, etc. */
  groupingAxis: z.string().optional(),
});

export const moduleUnitPlanningBriefSchema = z.object({
  scopeSize: z.enum(["compact", "standard", "large"]),
  /** Why this module needs the estimated lesson count. */
  rationale: z.string().trim().min(1),
  /** Ordered sub-map phases; these are scope briefs, not committed lesson titles. */
  progression: z.array(z.string().trim().min(1)).min(1).max(8),
});

const defaultModuleUnitPlanningBrief = {
  scopeSize: "standard" as const,
  rationale: "Expand the module objective into focused sequential lessons.",
  progression: ["Build progressively toward the module exit capability."],
};

/** Learner-visible sequential milestone authored at goal-blueprint time. */
export const curriculumModuleJourneyStubSchema = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  /** Observable milestone capability, not a topic-bucket label. */
  objective: z.string().trim().min(1),
  dependsOnPrevious: z.string().trim().min(1),
});

export const curriculumModulePlanSchema = curriculumModuleJourneyStubSchema.extend({
  plannedOutcomes: z.array(z.string().trim().min(1)).min(1).max(6),
  entryFoundationBriefs: z
    .array(
      z.object({
        ref: z.string().regex(/^ef_[1-9]\d*$/),
        title: z.string().trim().min(1),
        rationale: z.string().trim().min(1),
        criticality: z.enum(["critical", "recommended"]),
        verificationDimensions: z
          .array(z.enum(["memory", "understanding", "application"]))
          .min(1)
          .max(3),
      }),
    )
    .max(6)
    .default([]),
  exitCapabilityBriefs: z.array(z.string().trim().min(1)).min(1).max(8),
  estimatedUnitCount: z
    .number()
    .int()
    .min(MIN_MODULE_UNITS)
    .max(MAX_MODULE_UNITS),
  unitPlanningBrief: moduleUnitPlanningBriefSchema.default(
    defaultModuleUnitPlanningBrief,
  ),
});

export type LearningMode = z.infer<typeof learningModeSchema>;
export type DomainAnalysis = z.infer<typeof domainAnalysisSchema>;
export type MapStructure = z.infer<typeof mapStructureSchema>;
export type MajorArea = z.infer<typeof majorAreaSchema>;
export type CurriculumModuleJourneyStub = z.infer<
  typeof curriculumModuleJourneyStubSchema
>;
export type CurriculumModulePlan = z.infer<typeof curriculumModulePlanSchema>;
export type ModuleUnitPlanningBrief = z.infer<
  typeof moduleUnitPlanningBriefSchema
>;

export const goalMapPlanFieldsSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]).default(1),
  /** Clear, typo-free learning goal title (same language & intent as user input). */
  refinedTitle: z.string().trim().min(1).optional(),
  domainAnalysis: domainAnalysisSchema,
  topicOverview: z.string().trim().min(1),
  whatYouWillLearn: z.array(z.string().trim().min(1)).min(3).max(12),
  majorAreas: z
    .array(majorAreaSchema)
    .min(MIN_TOP_LEVEL_UNITS)
    .max(MAX_TOP_LEVEL_UNITS),
  /** V2 sequential milestone contracts. V1 plans omit this field. */
  modules: z
    .array(curriculumModulePlanSchema)
    .min(MIN_TOP_LEVEL_UNITS)
    .max(MAX_SEQUENTIAL_MODULES)
    .optional(),
  mapStructure: mapStructureSchema,
  outOfScope: z.array(z.string()).default([]),
  prerequisitesAssumed: z.array(z.string()).default([]),
});

/** Goal identity authored first so learners can see summary/meta immediately. */
export const goalCurriculumIdentityBindingSchema = z.object({
  schemaVersion: z.literal(2),
  refinedTitle: z.string().trim().min(1).optional(),
  domainAnalysis: domainAnalysisSchema,
  topicOverview: z.string().trim().min(1),
  whatYouWillLearn: z.array(z.string().trim().min(1)).min(3).max(12),
  prerequisitesAssumed: z.array(z.string()).default([]),
});

/** Ordered module journey authored after identity on the same linear transcript. */
export const goalCurriculumJourneyBindingSchema = z.object({
  modules: z
    .array(curriculumModuleJourneyStubSchema)
    .min(MIN_TOP_LEVEL_UNITS)
    .max(MAX_SEQUENTIAL_MODULES),
});

/** Provider-authored V2 shape; structural map fields are derived server-side. */
export const goalCurriculumPlanV2BindingSchema =
  goalCurriculumIdentityBindingSchema.merge(goalCurriculumJourneyBindingSchema);

export type GoalCurriculumIdentity = z.infer<
  typeof goalCurriculumIdentityBindingSchema
>;
export type GoalCurriculumJourney = z.infer<
  typeof goalCurriculumJourneyBindingSchema
>;

function finalizeGoalMapPlanPayload(data: unknown): unknown {
  const preprocessed = preprocessGoalMapPlanPayload(data);
  const parsed = goalMapPlanFieldsSchema.safeParse(preprocessed);
  if (parsed.success) return normalizeGoalMapPlan(parsed.data);
  return preprocessed;
}

/** Pre-map planning: topic overview + first-level cognitive map scope. */
export const goalMapPlanSchema = z.preprocess(
  finalizeGoalMapPlanPayload,
  goalMapPlanFieldsSchema,
);

export type GoalMapPlan = z.infer<typeof goalMapPlanFieldsSchema>;

export const unitLearningTargetSchema = surveyLearningTargetSchema;

export const sqGuidingQuestionSchema = surveyGuidingQuestionSchema;

export const complexInteractiveBlockTypeSchema =
  surveyComplexComponentTypeSchema;

export type ComplexInteractiveBlockType = z.infer<
  typeof complexInteractiveBlockTypeSchema
>;

/** Complex types selectable for new SQ/material generation (excludes legacy). */
export const generatableComplexInteractiveBlockTypeSchema =
  generatableSurveyComponentTypeSchema;

export type GeneratableComplexInteractiveBlockType = z.infer<
  typeof generatableComplexInteractiveBlockTypeSchema
>;

export {
  surveySectionOutlineItemSchema as sqSectionOutlineItemSchema,
  surveySectionPlanItemSchema as sqSectionPlanItemSchema,
  surveySectionPlanSchema as sqSectionPlanSchema,
};

/** SQ phase: Survey + Questions only (before reading material). */
export const sqPreviewSchema = portableSurveyPreviewSchema;

export const sqPreviewResponseSchema = z.preprocess(
  normalizeSq3rPayload,
  sqPreviewSchema,
);

/** Short model answers for SQ guiding questions after reading material. */
export const sqQuestionAnswersSchema = z.preprocess(
  expandSqAnswersCompact,
  z.object({
    answers: z.array(z.string().min(1)).min(1).max(8),
  }),
);

const idContentSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
});

const learnerFacingRequiredTextSchema = z
  .string()
  .overwrite(stripInternalLearningTargetRefs)
  .min(1);

const chartSeriesSchema = z.object({
  dataKey: z.string().min(1),
  name: z.string().min(1),
  color: z.string().optional(),
  unit: z.string().optional(),
});

const mathRangeSchema = z.tuple([z.number(), z.number()]);
const mathPoint2Schema = z.tuple([z.number(), z.number()]);
const mathPoint3Schema = z.tuple([z.number(), z.number(), z.number()]);
const mathPointSchema = z.union([mathPoint2Schema, mathPoint3Schema]);
const mathSceneStyleSchema = z.object({
  color: z.string().min(1).optional(),
  dashed: z.boolean().optional(),
  opacity: z.number().min(0.1).max(1).optional(),
});
const mathSceneObjectBaseShape = {
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/),
  label: z.string().max(80).optional(),
  color: mathSceneStyleSchema.shape.color,
  dashed: mathSceneStyleSchema.shape.dashed,
  opacity: mathSceneStyleSchema.shape.opacity,
  draggable: z.boolean().optional(),
};

const mathSceneVectorRelationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.enum(["sum", "difference"]),
    operands: z.tuple([
      z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/),
      z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/),
    ]),
  }),
  z.object({
    operation: z.literal("scale"),
    operand: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/),
    factor: z.number().finite(),
    factorParameter: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
      .optional(),
  }),
]);

export const mathSceneObjectSchema = z.discriminatedUnion("kind", [
  z.object({
    ...mathSceneObjectBaseShape,
    kind: z.literal("point"),
    position: mathPointSchema,
  }),
  z.object({
    ...mathSceneObjectBaseShape,
    kind: z.literal("vector"),
    start: mathPointSchema.optional(),
    end: mathPointSchema,
    relation: mathSceneVectorRelationSchema.optional(),
  }),
  z.object({
    ...mathSceneObjectBaseShape,
    kind: z.literal("segment"),
    from: mathPointSchema,
    to: mathPointSchema,
  }),
  z.object({
    ...mathSceneObjectBaseShape,
    kind: z.literal("function"),
    expression: z.string().min(1).max(200),
    variable: z.literal("x"),
    domain: mathRangeSchema,
  }),
  z.object({
    ...mathSceneObjectBaseShape,
    kind: z.literal("parametric"),
    xExpression: z.string().min(1).max(200),
    yExpression: z.string().min(1).max(200),
    zExpression: z.string().min(1).max(200).optional(),
    parameter: z.literal("t"),
    domain: mathRangeSchema,
  }),
  z.object({
    ...mathSceneObjectBaseShape,
    kind: z.literal("polar_function"),
    expression: z.string().min(1).max(200),
    variable: z.literal("theta"),
    domain: mathRangeSchema,
  }),
  z.object({
    ...mathSceneObjectBaseShape,
    kind: z.literal("surface"),
    expression: z.string().min(1).max(200),
    variables: z.tuple([z.literal("x"), z.literal("y")]),
    xDomain: mathRangeSchema,
    yDomain: mathRangeSchema,
  }),
]);

export const mathSceneBindingSchema = z.object({
  type: z.literal("math_scene"),
  title: z.string().min(1).max(120),
  dimension: z.enum(["2d", "3d"]),
  coordinateSystem: z.enum(["cartesian", "polar"]),
  xRange: mathRangeSchema,
  yRange: mathRangeSchema,
  zRange: mathRangeSchema.optional(),
  objects: z.array(mathSceneObjectSchema).min(1).max(12),
  parameters: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
        name: z.string().min(1).max(60),
        min: z.number(),
        max: z.number(),
        step: z.number().positive(),
        default: z.number(),
      }),
    )
    .max(4)
    .optional(),
  showGrid: z.boolean().default(true),
  showAxes: z.boolean().default(true),
  camera: z
    .object({
      azimuth: z.number().min(-180).max(180),
      elevation: z.number().min(-89).max(89),
    })
    .optional(),
  summary: z.string().min(1).max(500),
});

const strictMathSceneIdSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/);
const strictMathScenePointFields = {
  x: z.number(),
  y: z.number(),
  // Provider strict schemas cannot express the 2D/3D tuple union. The
  // compiler drops z for 2D scenes after transport validation.
  z: z.number(),
};

/**
 * DeepSeek-strict-compatible wire schema for math-scene authoring.
 *
 * The canonical schema above intentionally uses discriminated object and
 * coordinate unions. DeepSeek strict function calling rejects those union
 * wrappers, so the provider sees homogeneous per-kind arrays instead. The
 * component compiler converts this wire shape back to `objects` and validates
 * the result with `mathSceneSchema` before it can be published.
 */
export const mathSceneStrictBindingSchema = z.object({
  type: z.literal("math_scene"),
  title: z.string(),
  dimension: z.enum(["2d", "3d"]),
  coordinateSystem: z.enum(["cartesian", "polar"]),
  xRange: mathRangeSchema,
  yRange: mathRangeSchema,
  zRange: mathRangeSchema,
  points: z.array(
    z.object({
      id: strictMathSceneIdSchema,
      label: z.string(),
      draggable: z.boolean(),
      ...strictMathScenePointFields,
    }),
  ),
  vectors: z.array(
    z.object({
      id: strictMathSceneIdSchema,
      label: z.string(),
      draggable: z.boolean(),
      startX: z.number(),
      startY: z.number(),
      startZ: z.number(),
      endX: z.number(),
      endY: z.number(),
      endZ: z.number(),
      relationOperation: z.enum(["none", "sum", "difference", "scale"]),
      relationOperandA: z.string(),
      relationOperandB: z.string(),
      relationFactor: z.number(),
      relationFactorParameter: z.string(),
    }),
  ),
  segments: z.array(
    z.object({
      id: strictMathSceneIdSchema,
      label: z.string(),
      draggable: z.boolean(),
      fromX: z.number(),
      fromY: z.number(),
      fromZ: z.number(),
      toX: z.number(),
      toY: z.number(),
      toZ: z.number(),
    }),
  ),
  functions: z.array(
    z.object({
      id: strictMathSceneIdSchema,
      label: z.string(),
      expression: z.string(),
      domain: mathRangeSchema,
    }),
  ),
  parametricCurves: z.array(
    z.object({
      id: strictMathSceneIdSchema,
      label: z.string(),
      xExpression: z.string(),
      yExpression: z.string(),
      zExpression: z.string(),
      domain: mathRangeSchema,
    }),
  ),
  polarFunctions: z.array(
    z.object({
      id: strictMathSceneIdSchema,
      label: z.string(),
      expression: z.string(),
      domain: mathRangeSchema,
    }),
  ),
  surfaces: z.array(
    z.object({
      id: strictMathSceneIdSchema,
      label: z.string(),
      expression: z.string(),
      xDomain: mathRangeSchema,
      yDomain: mathRangeSchema,
    }),
  ),
  parameters: z.array(
    z.object({
      id: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
      name: z.string(),
      min: z.number(),
      max: z.number(),
      step: z.number(),
      default: z.number(),
    }),
  ),
  showGrid: z.boolean(),
  showAxes: z.boolean(),
  summary: z.string(),
});

export const chartStrictBindingSchema = z.object({
  type: z.literal("chart"),
  title: z.string(),
  chartType: z.enum(["line", "bar", "area", "pie", "scatter"]),
  data: z.array(
    z.object({
      entries: z.array(
        z.object({
          key: z.string(),
          valueType: z.enum(["string", "number"]),
          stringValue: z.string(),
          numberValue: z.number(),
        }),
      ),
    }),
  ),
  series: z.array(
    z.object({
      dataKey: z.string(),
      name: z.string(),
      color: z.string(),
      unit: z.string(),
    }),
  ),
  // Unused optional canonical keys are transported as empty strings.
  categoryKey: z.string(),
  xKey: z.string(),
  yKey: z.string(),
  xLabel: z.string(),
  yLabel: z.string(),
  unit: z.string(),
  showLegend: z.boolean(),
  donut: z.boolean(),
  summary: z.string(),
});

export const mathSceneSchema = mathSceneBindingSchema.superRefine(
  (scene, ctx) => {
    const issue = (message: string, path: PropertyKey[] = []) =>
      ctx.addIssue({ code: "custom", message, path });
    if (
      new Set(scene.objects.map((object) => object.id)).size !==
      scene.objects.length
    ) {
      issue("Math-scene object ids must be unique", ["objects"]);
    }
    for (const [name, range] of [
      ["xRange", scene.xRange],
      ["yRange", scene.yRange],
      ...(scene.zRange ? [["zRange", scene.zRange] as const] : []),
    ] as const) {
      if (range[0] >= range[1]) issue(`${name} must be ascending`, [name]);
      if (Math.max(Math.abs(range[0]), Math.abs(range[1])) > 1_000_000) {
        issue(`${name} exceeds the supported coordinate bound`, [name]);
      }
    }
    if (scene.dimension === "3d" && !scene.zRange) {
      issue("3D math scenes require zRange", ["zRange"]);
    }
    if (scene.dimension === "3d" && scene.coordinateSystem === "polar") {
      issue("3D math scenes currently require cartesian coordinates", [
        "coordinateSystem",
      ]);
    }
    const parameterIds = (scene.parameters ?? []).map(
      (parameter) => parameter.id,
    );
    if (
      parameterIds.length > 0 &&
      !scene.objects.some(
        (object) =>
          object.kind === "function" ||
          object.kind === "parametric" ||
          object.kind === "polar_function" ||
          object.kind === "surface" ||
          (object.kind === "vector" &&
            object.relation?.operation === "scale" &&
            object.relation.factorParameter),
      )
    ) {
      issue("Math-scene parameters require an expression or scaled vector", [
        "parameters",
      ]);
    }
    if (new Set(parameterIds).size !== parameterIds.length) {
      issue("Math-scene parameter ids must be unique", ["parameters"]);
    }
    (scene.parameters ?? []).forEach((parameter, index) => {
      if (parameter.min >= parameter.max)
        issue("Parameter min must be below max", ["parameters", index, "min"]);
      if (
        parameter.default < parameter.min ||
        parameter.default > parameter.max
      )
        issue("Parameter default must be inside its range", [
          "parameters",
          index,
          "default",
        ]);
    });
    const coordinateCount = scene.dimension === "3d" ? 3 : 2;
    const vectorIds = new Set(
      scene.objects
        .filter((object) => object.kind === "vector")
        .map((object) => object.id),
    );
    const relationDependencies = new Map<string, string[]>();
    scene.objects.forEach((object, index) => {
      const base = ["objects", index] as PropertyKey[];
      const point = (value: readonly number[] | undefined, key: string) => {
        if (value && value.length !== coordinateCount) {
          issue(
            `${scene.dimension} coordinates require ${coordinateCount} values`,
            [...base, key],
          );
        }
      };
      const expression = (
        value: string,
        variables: readonly string[],
        key = "expression",
      ) => {
        const error = validateMathExpression(value, variables);
        if (error) issue(error, [...base, key]);
      };
      if (object.kind === "point") point(object.position, "position");
      if (object.kind === "vector") {
        point(object.start, "start");
        point(object.end, "end");
        if (object.relation) {
          const dependencies =
            object.relation.operation === "scale"
              ? [object.relation.operand]
              : [...object.relation.operands];
          relationDependencies.set(object.id, dependencies);
          dependencies.forEach((dependency) => {
            if (!vectorIds.has(dependency)) {
              issue("Vector relations must reference existing vectors", [
                ...base,
                "relation",
              ]);
            }
            if (dependency === object.id) {
              issue("A vector relation cannot reference itself", [
                ...base,
                "relation",
              ]);
            }
          });
          if (object.draggable) {
            issue("A derived vector cannot also be draggable", [
              ...base,
              "draggable",
            ]);
          }
          if (
            object.relation.operation === "scale" &&
            object.relation.factorParameter &&
            !parameterIds.includes(object.relation.factorParameter)
          ) {
            issue("Vector scale parameters must reference a scene parameter", [
              ...base,
              "relation",
              "factorParameter",
            ]);
          }
        }
      }
      if (object.kind === "segment") {
        point(object.from, "from");
        point(object.to, "to");
      }
      if (object.kind === "function") {
        if (scene.dimension !== "2d")
          issue("Functions y=f(x) require a 2D scene", base);
        expression(object.expression, [object.variable, ...parameterIds]);
      }
      if (object.kind === "parametric") {
        if (scene.dimension === "3d" && !object.zExpression)
          issue("3D parametric curves require zExpression", [
            ...base,
            "zExpression",
          ]);
        if (scene.dimension === "2d" && object.zExpression)
          issue("2D parametric curves cannot include zExpression", [
            ...base,
            "zExpression",
          ]);
        expression(
          object.xExpression,
          [object.parameter, ...parameterIds],
          "xExpression",
        );
        expression(
          object.yExpression,
          [object.parameter, ...parameterIds],
          "yExpression",
        );
        if (object.zExpression)
          expression(
            object.zExpression,
            [object.parameter, ...parameterIds],
            "zExpression",
          );
      }
      if (object.kind === "polar_function") {
        if (scene.dimension !== "2d" || scene.coordinateSystem !== "polar")
          issue("Polar functions require a 2D polar scene", base);
        expression(object.expression, [object.variable, ...parameterIds]);
      }
      if (object.kind === "surface") {
        if (scene.dimension !== "3d")
          issue("Surfaces require a 3D scene", base);
        expression(object.expression, [...object.variables, ...parameterIds]);
        if (object.xDomain[0] >= object.xDomain[1])
          issue("xDomain must be ascending", [...base, "xDomain"]);
        if (object.yDomain[0] >= object.yDomain[1])
          issue("yDomain must be ascending", [...base, "yDomain"]);
      }
      if (
        (object.kind === "function" ||
          object.kind === "parametric" ||
          object.kind === "polar_function") &&
        object.domain[0] >= object.domain[1]
      ) {
        issue("Object domain must be ascending", [...base, "domain"]);
      }
      if (
        object.draggable &&
        (scene.dimension !== "2d" ||
          (object.kind !== "point" &&
            object.kind !== "vector" &&
            object.kind !== "segment"))
      ) {
        issue(
          "Draggable handles are supported only on 2D points, vectors, and segments",
          [...base, "draggable"],
        );
      }
    });
    const visitRelation = (id: string, path: string[]): boolean => {
      if (path.includes(id)) return true;
      return (relationDependencies.get(id) ?? []).some((dependency) =>
        visitRelation(dependency, [...path, id]),
      );
    };
    for (const id of relationDependencies.keys()) {
      if (visitRelation(id, [])) {
        issue("Vector relations cannot contain cycles", ["objects"]);
        break;
      }
    }
  },
);

export const interactiveHtmlSchema = z.object({
  type: z.literal("interactive_html"),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  html: z.string().trim().min(1).max(80_000),
  visualKind: z
    .enum([
      "simple_structure",
      "spatial_relationship",
      "state_comparison",
      "step_derivation",
    ])
    .optional(),
  height: z.number().int().min(240).max(720).optional(),
});

export const mechanicsSandboxSchema = z.object({
  type: z.literal("mechanics_sandbox"),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  sandboxType: z.enum([
    "collision_1d",
    "inclined_plane",
    "pendulum",
    "spring_oscillator",
  ]),
  parameters: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        unit: z.string().default(""),
        min: z.number(),
        max: z.number(),
        step: z.number().positive(),
        default: z.number(),
      }),
    )
    .optional(),
  objects: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        mass: z.number().positive(),
        color: z.string().optional(),
        radius: z.number().positive().optional(),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
        initialPosition: z.number().optional(),
        initialVelocity: z.number().optional(),
      }),
    )
    .min(1),
  showVectors: z.boolean().default(true),
  showEnergyChart: z.boolean().default(true),
  targetObservation: z.string().optional(),
});

export const circuitPartKindSchema = z.enum([
  "battery",
  "resistor",
  "rheostat",
  "switch",
  "bulb",
  "ammeter",
  "voltmeter",
]);

export const circuitPartSchema = z.object({
  id: z.string().min(1),
  kind: circuitPartKindSchema,
  label: z.string().optional(),
  v: z.number().optional(),
  ohm: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  closed: z.boolean().optional(),
  ratedV: z.number().positive().optional(),
  ratedW: z.number().positive().optional(),
});

const circuitNodeLeafSchema = circuitPartSchema;
const circuitNodeLevel = (child: z.ZodType) =>
  z.union([
    circuitPartSchema,
    z.object({ series: z.array(child).min(1) }),
    z.object({ parallel: z.array(child).min(1) }),
  ]);
const circuitNode1Schema = circuitNodeLevel(circuitNodeLeafSchema);
const circuitNode2Schema = circuitNodeLevel(circuitNode1Schema);
const circuitNode3Schema = circuitNodeLevel(circuitNode2Schema);
export const circuitNodeSchema = circuitNodeLevel(circuitNode3Schema);

/** Stored lessons may still use a node-id netlist. */
export const circuitComponentKindSchema = z.enum([
  "battery",
  "resistor",
  "rheostat",
  "switch",
  "bulb",
  "ammeter",
  "voltmeter",
  "voltage_source",
  "potentiometer",
  "lightbulb",
]);

export const circuitComponentSchema = z.object({
  id: z.string().min(1),
  kind: circuitComponentKindSchema,
  label: z.string().optional(),
  nodeA: z.string().min(1),
  nodeB: z.string().min(1),
  value: z.number().optional(),
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  closed: z.boolean().optional(),
  ratedVoltage: z.number().positive().optional(),
  ratedPower: z.number().positive().optional(),
  position: z.tuple([z.number(), z.number()]).optional(),
});

export const circuitSandboxSchema = z.object({
  type: z.literal("circuit_sandbox"),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  circuit: circuitNodeSchema.optional(),
  components: z.array(circuitComponentSchema).optional(),
  wires: z
    .array(
      z.object({
        id: z.string().min(1),
        from: z.string().min(1),
        to: z.string().min(1),
        points: z.array(z.tuple([z.number(), z.number()])).optional(),
      }),
    )
    .optional(),
  groundNode: z.string().optional(),
  targetObservation: z.string().optional(),
});

/** Server-owned certified chemistry lab intent. Reaction rules never come from the model. */
export const chemistryLabSchema = z.object({
  type: z.literal("chemistry_lab"),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  experimentId: z.enum([
    "acid_base_indicator",
    "acid_base_titration",
    "precipitation_reaction",
    "mass_conservation",
  ]),
  experimentVersion: z.literal(1).default(1),
  stage: z
    .enum(["middle_school", "high_school", "undergraduate"])
    .default("high_school"),
  renderMode: z.enum(["2d", "3d"]).default("3d"),
  parameters: z.record(z.string(), z.number()).default({}),
  targetObservation: z.string().optional(),
  controls: z.array(z.string().min(1).max(40)).max(16).optional(),
  observations: z
    .array(
      z.object({
        id: z.string().min(1).max(60),
        label: z.string().min(1).max(120),
        value: z.union([z.number(), z.string()]),
        unit: z.string().max(24).optional(),
        kind: z.enum(["scalar", "text", "state"]).optional(),
      }),
    )
    .max(32)
    .optional(),
});

const materialCueTargetSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^(whole|left|right|top|bottom|main|rail|side-\d+|item-\d+)$/);
const materialCueBindingSchema = z.object({
  music: musicCueActionSchema.optional(),
  target: materialCueTargetSchema,
  targetIds: z.array(z.string().trim().min(1)).min(1).max(16).optional(),
  op: z.enum(["highlight", "window"]).optional(),
  regionIds: z.array(z.string().trim().min(1)).optional(),
  figureId: z.string().trim().min(1).optional(),
});
const codeRegionBindingSchema = z.object({
  id: z.string().trim().min(1),
  match: z.string().min(1),
});
const authoredCodePartBindingSchema = z.object({
  id: z.string().trim().min(1).optional(),
  text: z.string().min(1),
});

const materialVisualBindingSchema = z.object({
  type: z.literal("visual"),
  id: z.string().trim().min(1).optional(),
  kind: z.enum(["process", "cycle", "layers", "bars"]),
  title: z.string().trim().min(1).max(60),
  unit: z.string().max(12).optional(),
  items: z.array(z.object({
    id: z.string().trim().min(1).max(40),
    label: z.string().trim().min(1).max(24),
    detail: z.string().max(60).optional(),
    value: z.number().finite().min(0).optional(),
  }).strict()).min(2).max(5),
}).strict();

// DeepSeek strict requires every declared field. Separate the two shapes so
// non-numeric diagrams never need dummy values (or a nullable-field repair).
const authoredMaterialVisualBindingSchema = z.discriminatedUnion("kind", [
  materialVisualBindingSchema.omit({ unit: true }).extend({
    kind: z.enum(["process", "cycle", "layers"]),
    items: z.array(materialVisualBindingSchema.shape.items.element.omit({ value: true })).min(2).max(5),
  }),
  materialVisualBindingSchema.extend({
    kind: z.literal("bars"),
    items: z.array(materialVisualBindingSchema.shape.items.element.extend({ value: z.number().finite().min(0) })).min(2).max(5),
  }),
]);

const authoredCodeBlockBindingSchema = z.object({
  type: z.literal("code"),
  id: z.string().trim().min(1).optional(),
  code: z.string().min(1),
  language: z.string().min(1).optional(),
  parts: z.array(authoredCodePartBindingSchema).min(1).max(24).optional(),
  regions: z.array(codeRegionBindingSchema).optional(),
});
const authoredConversationBlockBindingSchema = z.object({
  type: z.literal("conversation"),
  id: z.string().trim().min(1).optional(),
  title: learnerFacingRequiredTextSchema.optional(),
  turns: z
    .array(
      z.object({
        speaker: learnerFacingRequiredTextSchema,
        text: learnerFacingRequiredTextSchema,
      }),
    )
    .min(2),
});
const authoredCalloutBlockBindingSchema = z.object({
  type: z.literal("callout"),
  id: z.string().trim().min(1).optional(),
  variant: z.enum(["tip", "warning", "definition", "example"]),
  title: learnerFacingRequiredTextSchema.optional(),
  body: learnerFacingRequiredTextSchema,
});
const authoredAccordionBlockBindingSchema = z.object({
  type: z.literal("accordion"),
  id: z.string().trim().min(1).optional(),
  title: learnerFacingRequiredTextSchema,
  body: learnerFacingRequiredTextSchema,
});
const authoredIllustrationBlockBindingSchema = z.object({
  type: z.literal("illustration"),
  id: z.string().trim().min(1).optional(),
  caption: learnerFacingRequiredTextSchema,
  prompt: learnerFacingRequiredTextSchema,
  style: z.enum(["diagram", "process", "concept", "comparison"]),
  aspectRatio: z
    .enum(["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16"])
    .optional(),
});
/** Runtime-compatible illustration envelope for a completed image-first child. */
export const guidedImageIllustrationSchema = authoredIllustrationBlockBindingSchema.extend({
  id: z.string().min(1),
  imageId: z.string().min(1),
  imageUrl: z.string().min(1),
  guidedImage: guidedImageDisplaySchema,
});
const authoredSvgSlotFigureBindingSchema = z.object({
  type: z.literal("svg_slot"),
  id: z.string().trim().min(1).optional(),
  intent: courseSvgIntentSchema,
});
const authoredCompareSideBindingSchema = z.object({
  id: z.string().trim().min(1).optional(),
  label: learnerFacingRequiredTextSchema,
  points: z.array(learnerFacingRequiredTextSchema).min(1),
});
const authoredCompareBlockBindingSchema = z.object({
  type: z.literal("compare"),
  id: z.string().trim().min(1).optional(),
  left: authoredCompareSideBindingSchema,
  right: authoredCompareSideBindingSchema,
  sides: z.array(authoredCompareSideBindingSchema).min(2).optional(),
});
const authoredStageFigureBindingSchema = z.discriminatedUnion("type", [
  materialMusicBindingSchema,
  materialTeachingBindingSchema,
  materialVisualBindingSchema,
  authoredCodeBlockBindingSchema,
  authoredConversationBlockBindingSchema,
  authoredCalloutBlockBindingSchema,
  authoredAccordionBlockBindingSchema,
  authoredIllustrationBlockBindingSchema,
  authoredSvgSlotFigureBindingSchema,
  authoredCompareBlockBindingSchema,
]);

/**
 * Provider-safe blocks that the material author may emit directly. Executable
 * checks and complex components are deliberately absent: the server compiles
 * those from `inline_check_ref` and frozen `component_ref` items.
 */
const authoredStageBlockBindingSchema = z.object({
  type: z.literal("stage"),
  id: z.string().trim().min(1).optional(),
  layout: z.enum(["split-h", "split-v", "main+rail", "stack"]),
  presentation: z.enum(["steps", "compare", "focus"]).optional(),
  figures: z.array(authoredStageFigureBindingSchema).min(2).max(4),
});

/** Visible topic displays only — heading/paragraph are coerced before parse. */
export const legacyCourseMaterialTopicDisplayBindingSchema = z.discriminatedUnion(
  "type",
  [
    materialMusicBindingSchema,
  materialTeachingBindingSchema,
    materialVisualBindingSchema,
    authoredCodeBlockBindingSchema,
    authoredConversationBlockBindingSchema,
    authoredCalloutBlockBindingSchema,
    authoredAccordionBlockBindingSchema,
    authoredIllustrationBlockBindingSchema,
    authoredCompareBlockBindingSchema,
    authoredSvgSlotFigureBindingSchema,
    authoredStageBlockBindingSchema,
  ],
);

/** New displays compose ordinary subviews; compare is read-only legacy data. */
const currentStageFigureBindingSchema = z.union([
  materialMusicBindingSchema,
  materialTeachingAuthoringBindingSchema,
  ...authoredMaterialVisualBindingSchema.options,
  authoredCodeBlockBindingSchema,
  authoredConversationBlockBindingSchema,
  authoredCalloutBlockBindingSchema,
  authoredAccordionBlockBindingSchema,
  authoredIllustrationBlockBindingSchema,
  authoredSvgSlotFigureBindingSchema,
]);
const currentStageBlockBindingSchema = authoredStageBlockBindingSchema.extend({
  figures: z.array(currentStageFigureBindingSchema).min(2).max(4),
});
export const courseMaterialTopicDisplayBindingSchema = z.union([
  ...currentStageFigureBindingSchema.options,
  currentStageBlockBindingSchema,
]);

/** Provider binding derived from request facts; persisted formats remain complete. */
export function courseMaterialTopicDisplaySchemaForCapabilities(capabilities?: PresentationCapabilities): z.ZodType<z.infer<typeof courseMaterialTopicDisplayBindingSchema>> {
  if (!capabilities) return courseMaterialTopicDisplayBindingSchema;
  const supported = (schema: z.ZodType): boolean => {
    const candidate = schema as unknown as {shape?: {type?: z.ZodType}; options?: z.ZodType[]};
    return capabilities.supportedDisplayTypes.some(type => candidate.shape?.type?.safeParse(type).success) ||
      Boolean(candidate.options?.some(supported));
  };
  const figures = currentStageFigureBindingSchema.options.filter(supported);
  const displays: z.ZodType[] = [...figures];
  if (capabilities.supportedDisplayTypes.includes("stage") && capabilities.maxStageFigures >= 2 && figures.length && capabilities.allowedStageLayouts.length) {
    const figure = figures.length === 1 ? figures[0]! : z.union(figures as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]);
    displays.push(currentStageBlockBindingSchema.extend({
      layout: z.enum(capabilities.allowedStageLayouts as ["split-h" | "split-v" | "main+rail" | "stack", ...("split-h" | "split-v" | "main+rail" | "stack")[]]),
      figures: capabilities.stageRoles ? z.array(figure).length(2).describe(`First ${capabilities.stageRoles.mainTypes.join("/")}; second ${capabilities.stageRoles.helperTypes.join("/")}`)
        : z.array(figure).min(2).max(capabilities.maxStageFigures),
    }));
  }
  if (!displays.length) throw new Error("PRESENTATION_CAPABILITIES_UNSUPPORTED: No supported course display matches this surface");
  return (displays.length === 1 ? displays[0]! : z.union(displays as [z.ZodType, z.ZodType, ...z.ZodType[]])) as z.ZodType<z.infer<typeof courseMaterialTopicDisplayBindingSchema>>;
}

const legacyCourseMaterialAuthoredBlockBindingSchema = z.discriminatedUnion(
  "type",
  [
    materialMusicBindingSchema,
  materialTeachingBindingSchema,
    materialVisualBindingSchema,
    z.object({
      type: z.literal("heading"),
      level: z.union([z.literal(2), z.literal(3)]),
      text: learnerFacingRequiredTextSchema,
      topicId: z.string().trim().min(1).optional(),
    }),
    z.object({
      type: z.literal("paragraph"),
      text: learnerFacingRequiredTextSchema,
      cue: materialCueBindingSchema.optional(),
    }),
    authoredCodeBlockBindingSchema,
    authoredConversationBlockBindingSchema,
    authoredCalloutBlockBindingSchema,
    authoredAccordionBlockBindingSchema,
    authoredIllustrationBlockBindingSchema,
    authoredCompareBlockBindingSchema,
    authoredStageBlockBindingSchema,
  ],
);

export const courseMaterialAuthoredBlockBindingSchema = z.union([
  materialMusicBindingSchema,
  materialTeachingAuthoringBindingSchema,
  ...authoredMaterialVisualBindingSchema.options,
  legacyCourseMaterialAuthoredBlockBindingSchema.options.find((option) => "shape" in option && option.shape.type.value === "heading")!,
  legacyCourseMaterialAuthoredBlockBindingSchema.options.find((option) => "shape" in option && option.shape.type.value === "paragraph")!,
  authoredCodeBlockBindingSchema,
  authoredConversationBlockBindingSchema,
  authoredCalloutBlockBindingSchema,
  authoredAccordionBlockBindingSchema,
  authoredIllustrationBlockBindingSchema,
  currentStageBlockBindingSchema,
]);

// Accepted historical transcripts can still contain compare blocks.
export type CourseMaterialAuthoredBlock = z.infer<
  typeof legacyCourseMaterialAuthoredBlockBindingSchema
> | z.infer<typeof guidedImageIllustrationSchema>;

export type MaterialCheckQuestionType = "mcq" | "mcq_multi" | "true_false";

function effectiveMaterialCheckQuestionType(
  block: Record<string, unknown>,
): MaterialCheckQuestionType {
  const raw = block.questionType;
  if (raw === "true_false" || raw === "mcq_multi" || raw === "mcq") {
    if (
      raw === "mcq" &&
      Array.isArray(block.correctIndices) &&
      block.correctIndices.filter(
        (item): item is number => typeof item === "number",
      ).length >= 2
    ) {
      return "mcq_multi";
    }
    return raw;
  }
  if (typeof block.correctAnswer === "boolean") return "true_false";
  if (
    Array.isArray(block.correctIndices) &&
    block.correctIndices.filter(
      (item): item is number => typeof item === "number",
    ).length >= 2
  ) {
    return "mcq_multi";
  }
  return "mcq";
}

const interactiveBlockBaseSchema = z.discriminatedUnion("type", [
  materialMusicBindingSchema,
  materialTeachingBindingSchema,
  materialVisualBindingSchema,
  z.object({
    type: z.literal("heading"),
    level: z.union([z.literal(2), z.literal(3)]),
    text: z.string(),
    topicId: z.string().trim().min(1).optional(),
  }),
  z.object({
    type: z.literal("paragraph"),
    text: z.string(),
    cue: materialCueBindingSchema.optional(),
  }),
  z.object({
    type: z.literal("code"),
    id: z.string().min(1).optional(),
    code: z.string().min(1),
    language: z.string().min(1).optional(),
    parts: z.array(authoredCodePartBindingSchema).min(1).max(24).optional(),
    regions: z.array(codeRegionBindingSchema).optional(),
  }),
  z.object({
    type: z.literal("conversation"),
    id: z.string().min(1).optional(),
    title: z.string().optional(),
    turns: z.array(z.object({ speaker: z.string(), text: z.string() })).min(2),
  }),
  z.object({
    type: z.literal("callout"),
    id: z.string().min(1).optional(),
    variant: z.enum(["tip", "warning", "definition", "example"]),
    title: z.string().optional(),
    body: z.string(),
  }),
  z.object({
    type: z.literal("accordion"),
    id: z.string().min(1).optional(),
    title: z.string(),
    body: z.string(),
  }),
  z.object({
    type: z.literal("check"),
    /** Stable server-generated identity. Absent only on legacy Q blocks. */
    checkId: z.string().min(1).optional(),
    questionType: z.enum(["mcq", "mcq_multi", "true_false"]).optional(),
    question: z.string(),
    options: z.array(z.string()).min(2).max(8).optional(),
    correctIndex: z.number().optional(),
    correctIndices: z.array(z.number().int().min(0)).min(2).optional(),
    correctAnswer: z.boolean().optional(),
    explanation: z.string(),
    primaryLearningTargetId: z
      .string()
      .regex(/^lt_\d+$/)
      .optional(),
    learningTargetIds: z.array(z.string().regex(/^lt_\d+$/)).min(1),
    targetCognitiveEntityId: z.string().min(1).optional(),
    evidenceDimension: z.enum(["memory", "understanding", "application"]),
    criterionRef: z.string().min(1),
    contextDistance: z.enum(["same", "near"]),
  }),
  z.object({
    type: z.literal("compare"),
    id: z.string().min(1).optional(),
    // Historical material still resolves narration through these object ids.
    // Keep them through validation before the read-time stage projection.
    left: z.object({
      id: z.string().trim().min(1).optional(),
      label: z.string(),
      points: z.array(z.string()).min(1),
    }),
    right: z.object({
      id: z.string().trim().min(1).optional(),
      label: z.string(),
      points: z.array(z.string()).min(1),
    }),
    sides: z
      .array(
        z.object({
          id: z.string().trim().min(1).optional(),
          label: z.string(),
          points: z.array(z.string()).min(1),
        }),
      )
      .min(2)
      .optional(),
  }),
  z.object({
    type: z.literal("step_sort"),
    title: z.string().min(1),
    correct_sequence: z
      .array(idContentSchema.extend({ order: z.number().int().positive() }))
      .min(2),
    dependency_hint: z.string().default(""),
  }),
  z.object({
    type: z.literal("graph"),
    variant: z.enum(["process_flow", "concept_map"]),
    title: z.string().min(1).max(120),
    direction: z.enum(["LR", "TB", "RADIAL"]),
    nodes: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1).max(80),
          description: z.string().max(500).optional(),
          kind: z
            .enum([
              "process",
              "decision",
              "start",
              "end",
              "io",
              "concept",
              "system",
              "source",
              "outcome",
            ])
            .default("concept"),
          groupId: z.string().min(1).optional(),
          emphasis: z.enum(["primary", "normal"]).default("normal"),
        }),
      )
      .min(3)
      .max(24),
    edges: z
      .array(
        z.object({
          id: z.string().min(1),
          from: z.string().min(1),
          to: z.string().min(1),
          label: z.string().max(80).optional(),
          arrow: z
            .enum(["forward", "backward", "both", "none"])
            .default("forward"),
        }),
      )
      .min(2)
      .max(40),
    groups: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1).max(80),
          description: z.string().max(500).optional(),
        }),
      )
      .max(6)
      .optional(),
    caption: z.string().max(500).optional(),
  }),
  z.object({
    type: z.literal("chart"),
    title: z.string().min(1),
    chartType: z.enum(["line", "bar", "area", "pie", "scatter"]),
    data: z
      .array(z.record(z.string(), z.union([z.string(), z.number()])))
      .min(1),
    series: z.array(chartSeriesSchema).min(1),
    categoryKey: z.string().min(1).optional(),
    xKey: z.string().min(1).optional(),
    yKey: z.string().min(1).optional(),
    xLabel: z.string().optional(),
    yLabel: z.string().optional(),
    unit: z.string().optional(),
    showLegend: z.boolean().default(true),
    donut: z.boolean().default(false),
    summary: z.string().min(1),
  }),
  mathSceneSchema,
  interactiveHtmlSchema,
  mechanicsSandboxSchema,
  circuitSandboxSchema,
  chemistryLabSchema,
  z.object({
    type: z.literal("illustration"),
    id: z.string().min(1).optional(),
    caption: z.string(),
    /** English prompt for the image provider; filled by LLM at generation time. */
    prompt: z.string(),
    style: z
      .enum(["diagram", "process", "concept", "comparison"])
      .default("diagram"),
    aspectRatio: z
      .enum(["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16"])
      .optional(),
    /** Set after image provider runs */
    imageId: z.string().optional(),
    imageUrl: z.string().optional(),
    guidedImage: guidedImageDisplaySchema.optional(),
  }),
  z.object({
    type: z.literal("svg"),
    title: z.string().min(1).max(120).optional(),
    caption: z.string().min(1).max(500),
    alt: z.string().min(1).max(500),
    svg: safeCourseSvgMarkupSchema,
    intent: courseSvgIntentSchema.optional(),
  }),
  z.object({
    type: z.literal("placeholder"),
    reason: z.string(),
    componentType: z
      .enum([
        "check",
        "step_sort",
        "graph",
        "chart",
        "math_scene",
        "svg",
        "interactive_html",
        "mechanics_sandbox",
        "circuit_sandbox",
        "chemistry_lab",
      ])
      .optional(),
    description: z.string().min(1).optional(),
    /** Readable lesson content shown while an optional component is unavailable. */
    fallbackBody: z.string().min(1).optional(),
    primaryLearningTargetId: z
      .string()
      .regex(/^lt_\d+$/)
      .optional(),
    targetCognitiveEntityId: z.string().min(1).optional(),
    evidenceDimension: z.enum(["memory", "understanding"]).optional(),
    criterionRef: z
      .string()
      .regex(/^lt_\d+:c\d+$/)
      .optional(),
    contextDistance: z.literal("same").optional(),
  }),
  z.object({
    type: z.literal("svg_slot"),
    id: z.string().min(1).optional(),
    intent: courseSvgIntentSchema,
  }),
  z.object({
    type: z.literal("stage"),
    id: z.string().min(1).optional(),
    layout: z.enum(["split-h", "split-v", "main+rail", "stack"]),
    presentation: z.enum(["steps", "compare", "focus"]).optional(),
    figures: z.array(z.lazy(() => interactiveBlockBaseSchema)),
  }),
]);

/** JSON-schema-safe per-type schema used only for provider/tool binding. */
export function interactiveBlockBindingSchemaForType(
  type: ComplexInteractiveBlockType,
): z.ZodType<InteractiveBlock> {
  const schema = interactiveBlockBaseSchema.options.find(
    (option) => "shape" in option && option.shape.type.value === type,
  );
  if (!schema)
    throw new Error(`No interactive block schema for type "${type}"`);
  return schema as unknown as z.ZodType<InteractiveBlock>;
}

/** Provider-facing schema used by unit.learning_material.component_compile. */
export function componentCompileBindingSchemaForType(
  type: ComplexInteractiveBlockType,
): z.ZodType {
  switch (type) {
    case "chart":
      return chartStrictBindingSchema;
    case "math_scene":
      return mathSceneStrictBindingSchema;
    default:
      return interactiveBlockBindingSchemaForType(type);
  }
}

function hasUniqueIds(items: Array<{ id: string }>): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

function refineInteractiveBlock(
  block: z.infer<typeof interactiveBlockBaseSchema>,
  ctx: z.RefinementCtx,
): void {
  const issue = (message: string, path: PropertyKey[] = []) =>
    ctx.addIssue({ code: "custom", message, path });
  for (const message of [...materialVisualTreeIssues(block), ...materialMusicTreeIssues(block), ...materialTeachingTreeIssues(block)]) issue(message);
  if (block.type === "stage") {
    if (block.figures.length < 2 || block.figures.length > 4) {
      issue("a stage must contain 2 to 4 figures", ["figures"]);
    }
    block.figures.forEach((figure, index) => {
      if (
        figure.type === "heading" ||
        figure.type === "paragraph" ||
        figure.type === "check" ||
        figure.type === "stage"
      ) {
        issue("stage figures cannot be heading, paragraph, check, or nested stage", [
          "figures",
          index,
        ]);
      }
    });
  }
  if (block.type === "step_sort") {
    if (!hasUniqueIds(block.correct_sequence)) issue("Step ids must be unique");
    const orders = block.correct_sequence
      .map((item) => item.order)
      .sort((a, b) => a - b);
    if (orders.some((order, index) => order !== index + 1)) {
      issue("Step orders must be contiguous starting at 1");
    }
  } else if (block.type === "graph") {
    if (!hasUniqueIds(block.nodes)) issue("Graph node ids must be unique");
    if (!hasUniqueIds(block.edges)) issue("Graph edge ids must be unique");
    if (!hasUniqueIds(block.groups ?? []))
      issue("Graph group ids must be unique");
    const nodeIds = new Set(block.nodes.map((item) => item.id));
    const groupIds = new Set((block.groups ?? []).map((item) => item.id));
    if ([...nodeIds].some((id) => groupIds.has(id))) {
      issue("Graph node and group ids must not overlap");
    }
    block.nodes.forEach((node, index) => {
      if (node.groupId && !groupIds.has(node.groupId)) {
        issue("Graph node group must exist", ["nodes", index, "groupId"]);
      }
      if (node.kind === "decision") {
        const outgoing = block.edges.filter((edge) => edge.from === node.id);
        if (outgoing.length > 3) {
          issue("Graph decision nodes may have at most three outgoing edges", [
            "nodes",
            index,
          ]);
        }
      }
    });
    block.edges.forEach((edge, index) => {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        issue("Graph edge endpoints must exist", ["edges", index]);
      }
    });
    if (block.variant === "concept_map") {
      if (block.direction !== "RADIAL") {
        issue("Concept maps must use RADIAL direction", ["direction"]);
      }
      if (
        block.nodes.filter((node) => node.emphasis === "primary").length !== 1
      ) {
        issue("Concept maps require exactly one primary node", ["nodes"]);
      }
    } else if (block.direction === "RADIAL") {
      issue("Only concept maps may use RADIAL direction", ["direction"]);
    }
    if (block.variant === "process_flow") {
      if (!block.nodes.some((node) => node.kind === "start")) {
        issue("Process-flow graphs require a start node", ["nodes"]);
      }
      if (!block.nodes.some((node) => node.kind === "end")) {
        issue("Process-flow graphs require an end node", ["nodes"]);
      }
    }
  } else if (block.type === "check") {
    const questionType = effectiveMaterialCheckQuestionType(
      block as Record<string, unknown>,
    );
    if (questionType === "mcq") {
      const options = block.options ?? [];
      if (options.length < 2) {
        issue("mcq checks require at least two options", ["options"]);
      }
      if (
        typeof block.correctIndex !== "number" ||
        block.correctIndex < 0 ||
        block.correctIndex >= options.length
      ) {
        issue("correctIndex must point to an existing option", [
          "correctIndex",
        ]);
      }
    } else if (questionType === "mcq_multi") {
      const options = block.options ?? [];
      if (options.length < 2) {
        issue("mcq_multi checks require at least two options", ["options"]);
      }
      const correctIndices = block.correctIndices ?? [];
      const unique = new Set(correctIndices);
      if (correctIndices.length < 2) {
        issue("mcq_multi checks require at least two correctIndices", [
          "correctIndices",
        ]);
      }
      if (unique.size !== correctIndices.length) {
        issue("correctIndices must be unique", ["correctIndices"]);
      }
      for (const index of correctIndices) {
        if (index < 0 || index >= options.length) {
          issue("correctIndices must point to existing options", [
            "correctIndices",
          ]);
          break;
        }
      }
    } else if (typeof block.correctAnswer !== "boolean") {
      issue("true_false checks require correctAnswer", ["correctAnswer"]);
    }
  } else if (block.type === "chart") {
    const keys = new Set(block.data.flatMap((row) => Object.keys(row)));
    block.series.forEach((series, index) => {
      if (!keys.has(series.dataKey))
        issue("Series dataKey must exist in chart data", [
          "series",
          index,
          "dataKey",
        ]);
    });
    if (block.chartType === "scatter" && (!block.xKey || !block.yKey)) {
      issue("Scatter charts require xKey and yKey");
    }
    if (block.chartType !== "scatter" && !block.categoryKey) {
      issue("Non-scatter charts require categoryKey");
    }
    for (const key of [block.categoryKey, block.xKey, block.yKey]) {
      if (key && !keys.has(key)) {
        issue(`Chart key ${key} must exist in chart data`);
      }
    }
  } else if (block.type === "math_scene") {
    if (!hasUniqueIds(block.objects))
      issue("Math-scene object ids must be unique");
    const parameterIds = (block.parameters ?? []).map(
      (parameter) => parameter.id,
    );
    if (
      parameterIds.length > 0 &&
      !block.objects.some(
        (object) =>
          object.kind === "function" ||
          object.kind === "parametric" ||
          object.kind === "polar_function" ||
          object.kind === "surface" ||
          (object.kind === "vector" &&
            object.relation?.operation === "scale" &&
            object.relation.factorParameter),
      )
    ) {
      issue("Math-scene parameters require an expression or scaled vector", [
        "parameters",
      ]);
    }
    if (new Set(parameterIds).size !== parameterIds.length) {
      issue("Math-scene parameter ids must be unique", ["parameters"]);
    }
    (block.parameters ?? []).forEach((parameter, index) => {
      if (parameter.min >= parameter.max) {
        issue("Parameter min must be below max", ["parameters", index, "min"]);
      }
      if (
        parameter.default < parameter.min ||
        parameter.default > parameter.max
      ) {
        issue("Parameter default must be inside its range", [
          "parameters",
          index,
          "default",
        ]);
      }
    });
    const ranges = [
      ["xRange", block.xRange],
      ["yRange", block.yRange],
      ...(block.zRange ? [["zRange", block.zRange] as const] : []),
    ] as const;
    ranges.forEach(([name, range]) => {
      if (range[0] >= range[1]) issue(`${name} must be ascending`, [name]);
      if (Math.max(Math.abs(range[0]), Math.abs(range[1])) > 1_000_000) {
        issue(`${name} exceeds the supported coordinate bound`, [name]);
      }
    });
    if (block.dimension === "3d" && !block.zRange) {
      issue("3D math scenes require zRange", ["zRange"]);
    }
    if (block.dimension === "3d" && block.coordinateSystem === "polar") {
      issue("3D math scenes currently require cartesian coordinates", [
        "coordinateSystem",
      ]);
    }
    const expectedPointLength = block.dimension === "3d" ? 3 : 2;
    const validatePoint = (
      point: readonly number[] | undefined,
      path: PropertyKey[],
    ) => {
      if (point && point.length !== expectedPointLength) {
        issue(
          `${block.dimension} scene coordinates require ${expectedPointLength} values`,
          path,
        );
      }
    };
    block.objects.forEach((object, index) => {
      const basePath: PropertyKey[] = ["objects", index];
      if (object.kind === "point") {
        validatePoint(object.position, [...basePath, "position"]);
      } else if (object.kind === "vector") {
        validatePoint(object.start, [...basePath, "start"]);
        validatePoint(object.end, [...basePath, "end"]);
        if (
          object.relation?.operation === "scale" &&
          object.relation.factorParameter &&
          !parameterIds.includes(object.relation.factorParameter)
        ) {
          issue("Vector scale parameters must reference a scene parameter", [
            ...basePath,
            "relation",
            "factorParameter",
          ]);
        }
      } else if (object.kind === "segment") {
        validatePoint(object.from, [...basePath, "from"]);
        validatePoint(object.to, [...basePath, "to"]);
      } else if (object.kind === "function") {
        if (block.dimension !== "2d")
          issue("Functions y=f(x) require a 2D scene", basePath);
        const error = validateMathExpression(object.expression, [
          object.variable,
          ...parameterIds,
        ]);
        if (error) issue(error, [...basePath, "expression"]);
      } else if (object.kind === "parametric") {
        if (block.dimension === "3d" && !object.zExpression) {
          issue("3D parametric curves require zExpression", [
            ...basePath,
            "zExpression",
          ]);
        }
        if (block.dimension === "2d" && object.zExpression) {
          issue("2D parametric curves cannot include zExpression", [
            ...basePath,
            "zExpression",
          ]);
        }
        for (const key of [
          "xExpression",
          "yExpression",
          "zExpression",
        ] as const) {
          const expression = object[key];
          if (!expression) continue;
          const error = validateMathExpression(expression, [
            object.parameter,
            ...parameterIds,
          ]);
          if (error) issue(error, [...basePath, key]);
        }
      } else if (object.kind === "polar_function") {
        if (block.dimension !== "2d" || block.coordinateSystem !== "polar") {
          issue("Polar functions require a 2D polar scene", basePath);
        }
        const error = validateMathExpression(object.expression, [
          object.variable,
          ...parameterIds,
        ]);
        if (error) issue(error, [...basePath, "expression"]);
      } else if (object.kind === "surface") {
        if (block.dimension !== "3d")
          issue("Surfaces require a 3D scene", basePath);
        const error = validateMathExpression(object.expression, [
          ...object.variables,
          ...parameterIds,
        ]);
        if (error) issue(error, [...basePath, "expression"]);
      }
      const domain =
        object.kind === "function" ||
        object.kind === "parametric" ||
        object.kind === "polar_function"
          ? object.domain
          : null;
      if (domain && domain[0] >= domain[1]) {
        issue("Object domain must be ascending", [...basePath, "domain"]);
      }
      if (object.kind === "surface") {
        if (object.xDomain[0] >= object.xDomain[1])
          issue("xDomain must be ascending", [...basePath, "xDomain"]);
        if (object.yDomain[0] >= object.yDomain[1])
          issue("yDomain must be ascending", [...basePath, "yDomain"]);
      }
    });
  } else if (block.type === "interactive_html") {
    if (!block.html.includes("<") || !block.html.includes(">")) {
      issue("Interactive HTML must contain markup", ["html"]);
    }
  } else if (block.type === "mechanics_sandbox") {
    if (!hasUniqueIds(block.objects)) {
      issue("Mechanics sandbox object ids must be unique", ["objects"]);
    }
  } else if (block.type === "circuit_sandbox") {
    const parts = block.circuit
      ? collectCircuitParts(block.circuit as CircuitNode)
      : (block.components ?? []);
    if (parts.length < 2) {
      issue("Circuit sandbox needs at least two parts", ["circuit"]);
    }
    if (!hasUniqueIds(parts)) {
      issue("Circuit sandbox part ids must be unique", ["circuit"]);
    }
    if (
      !parts.some((part) => {
        const kind = "kind" in part ? String(part.kind) : "";
        return kind === "battery" || kind === "voltage_source";
      })
    ) {
      issue("Circuit sandbox needs a battery", ["circuit"]);
    }
  }
}

export const interactiveBlockSchema = interactiveBlockBaseSchema.superRefine(
  refineInteractiveBlock,
);

function normalizeChemistryLabPayload(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  const normalized = normalizeChemistryLabDefinition({
    experimentId: typeof raw.experimentId === "string" ? raw.experimentId : "",
    experimentVersion:
      typeof raw.experimentVersion === "number" ? raw.experimentVersion : 1,
    title: typeof raw.title === "string" ? raw.title : undefined,
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    stage:
      typeof raw.stage === "string"
        ? (raw.stage as "middle_school" | "high_school" | "undergraduate")
        : undefined,
    targetObservation:
      typeof raw.targetObservation === "string"
        ? raw.targetObservation
        : undefined,
    parameters:
      raw.parameters &&
      typeof raw.parameters === "object" &&
      !Array.isArray(raw.parameters)
        ? (raw.parameters as Record<string, number>)
        : undefined,
    strictParameters: true,
  });
  return (
    normalized ?? { ...raw, experimentId: "__invalid_chemistry_template__" }
  );
}

/**
 * Narrow per-type result validator. Unlike the binding schema, this includes
 * cross-field/reference semantics so invalid formulas, ids, and chart keys
 * participate in the structured repair loop.
 */
export function interactiveBlockSchemaForType(
  type: ComplexInteractiveBlockType,
): z.ZodType<InteractiveBlock> {
  const bindingSchema = interactiveBlockBindingSchemaForType(type);
  const validationSchema =
    type === "circuit_sandbox"
      ? z.preprocess(normalizeCircuitSandboxPayload, bindingSchema)
      : type === "chemistry_lab"
        ? z.preprocess(normalizeChemistryLabPayload, bindingSchema)
        : bindingSchema;
  return validationSchema.superRefine((block, ctx) =>
    refineInteractiveBlock(
      block as z.infer<typeof interactiveBlockBaseSchema>,
      ctx,
    ),
  ) as z.ZodType<InteractiveBlock>;
}

export const learningMaterialSchema = z.preprocess(
  normalizeLearningMaterial,
  z.object({
    introduction: z.string(),
    blocks: z.array(interactiveBlockSchema).min(MIN_LEARNING_MATERIAL_BLOCKS),
    keyTakeaways: z.array(z.string()).max(MAX_KEY_TAKEAWAYS),
  }),
);

export const MAX_GENERATED_LEARNING_MATERIAL_BLOCKS = 120;

/**
 * Authoritative output validation for newly generated material. It performs no
 * compatibility normalization or padding; legacy normalization remains on
 * `learningMaterialSchema` for stored/read paths only.
 */
export const strictLearningMaterialSchema = z
  .object({
    // Optional opener — UI already skips blank introductions. Content depth is
    // enforced on introduction + blocks together so a missing intro does not
    // fail closed when teaching blocks are complete.
    introduction: z.string(),
    blocks: z
      .array(interactiveBlockSchema)
      .min(1)
      .max(MAX_GENERATED_LEARNING_MATERIAL_BLOCKS),
    keyTakeaways: z.array(z.string().min(1)).max(MAX_KEY_TAKEAWAYS),
  })
  .superRefine((material, ctx) => {
    for (const issue of learnerFacingContentIssues(material))
      ctx.addIssue({ code: "custom", ...issue });
    const contentUnits =
      (material.introduction.trim() ? 1 : 0) + material.blocks.length;
    if (contentUnits < MIN_LEARNING_MATERIAL_BLOCKS) {
      ctx.addIssue({
        code: "custom",
        message: `material requires at least ${MIN_LEARNING_MATERIAL_BLOCKS} content units (introduction + blocks)`,
      });
    }
    material.blocks.forEach((block, index) => {
      const isRetryableOptionalFallback =
        block.type === "placeholder" &&
        (block.reason === "interactive component compilation failed" ||
          block.reason === "teaching diagram compilation failed") &&
        Boolean(block.componentType && block.description && block.fallbackBody);
      if (block.type === "placeholder" && !isRetryableOptionalFallback) {
        ctx.addIssue({
          code: "custom",
          path: ["blocks", index],
          message: "generated material cannot contain placeholder blocks",
        });
      }
      if (block.type === "svg_slot") {
        ctx.addIssue({
          code: "custom",
          path: ["blocks", index],
          message: "generated material cannot contain uncompiled svg_slot blocks",
        });
      }
      if (block.type === "stage") {
        block.figures.forEach((figure, figureIndex) => {
          if (figure.type === "svg_slot") {
            ctx.addIssue({
              code: "custom",
              path: ["blocks", index, "figures", figureIndex],
              message:
                "generated material cannot contain uncompiled svg_slot figures",
            });
          }
        });
      }
      if (containsCollapsedGeneratedCodeFence(block)) {
        ctx.addIssue({
          code: "custom",
          path: ["blocks", index],
          message:
            "substantial fenced source code must use physical newlines and source indentation; do not flatten it into one line",
        });
      }
    });
  });

export type InteractiveBlock = z.infer<typeof interactiveBlockSchema>;
export type LearningMaterialContent = z.infer<typeof learningMaterialSchema>;
export type SqPreview = z.infer<typeof sqPreviewSchema>;

/**
 * JSON-schema-safe provider binding for `goal.overview`. The authoritative
 * `goalOverviewCourseSchema` embeds the preprocessed `learningMaterialSchema`,
 * which cannot be projected to a provider JSON Schema (transforms are
 * unrepresentable), so the provider sees this structural mirror while
 * authoritative validation stays on the full schema.
 */
export const goalOverviewCourseBindingSchema = z.object({
  overviewCourse: z.object({
    title: z.string().min(1),
    summary: z.string(),
    units: z
      .array(
        z.object({
          title: z.string().min(1),
          summary: z.string().min(1),
          keyConcepts: z.array(z.string()).min(2).max(6),
          branchIncludes: z.array(z.string()).min(2).max(12),
          sq: sqPreviewSchema.nullish(),
          material: z.object({
            introduction: z.string(),
            blocks: z.array(interactiveBlockSchema),
            keyTakeaways: z.array(z.string()),
          }),
          checkQuestion: z.string().optional(),
        }),
      )
      .min(1)
      .max(1),
  }),
});


/** Full SQ3R optional enrichment using the same published targets. */
export const sq3rSchema = z.object({
  survey: z.object({
    outline: z.array(z.string()),
    learningTargetLabels: z.array(z.string()),
  }),
  learningTargets: z.array(unitLearningTargetSchema).min(1).max(30),
  questions: z.array(sqGuidingQuestionSchema).min(1).max(8),
  readHighlights: z.array(z.string()),
  recitePrompts: z.array(z.string()),
  reviewSummary: z.string(),
});

export const sq3rResponseSchema = z.preprocess(
  normalizeSq3rPayload,
  sq3rSchema,
);

export const cornellSchema = z.preprocess(
  expandCornellCompact,
  z.object({
    notes: z.string(),
    cues: z.string(),
    summary: z.string(),
  }),
);

/** Canonical hosted/local active-recall question contract. */
export const quizQuestionSchema = portableQuizQuestionSchema;

const quizFieldsSchema = z.object({
  questions: z.array(quizQuestionSchema).length(UNIT_QUIZ_BATCH_SIZE),
  interleaved: z.array(quizQuestionSchema).max(0).default([]),
});

export const quizSchema = z.preprocess(normalizeQuizPayload, quizFieldsSchema);

/** V2 unit quizzes use the deterministic per-point workload instead of a fixed count. */
export function unitQuizSchema(questionCount: number) {
  return z.preprocess(
    normalizeQuizPayload,
    z.object({
      questions: z.array(quizQuestionSchema).length(questionCount),
      interleaved: z.array(quizQuestionSchema).max(0).default([]),
    }),
  );
}

export function diagnosticQuizSchema(questionCount: number) {
  return z.preprocess(
    normalizeQuizPayload,
    z.object({
      // Minimum only — surplus questions are truncated by the generation
      // recovery path / authoring parse rather than fail-closed on maxItems.
      questions: z.array(quizQuestionSchema).min(questionCount),
      interleaved: z.array(quizQuestionSchema).max(0).default([]),
    }),
  );
}

/**
 * Lenient schema used while assembling a diagnostic. Coverage is enforced after
 * parsing so a valid short response can be repaired instead of discarded.
 */
export function diagnosticQuizCandidateSchema() {
  return z.preprocess(
    normalizeQuizPayload,
    z.object({
      questions: z.array(quizQuestionSchema),
      interleaved: z.array(quizQuestionSchema).max(0).default([]),
    }),
  );
}

export const feynmanFeedbackSchema = z.preprocess(
  expandFeynmanCompact,
  z.object({
    passed: z.boolean(),
    strengths: z.array(z.string()),
    blindSpots: z.array(z.string()),
    suggestions: z.array(z.string()),
    plainLanguagePrompt: z.string().optional(),
    criterionScores: z
      .array(
        z.object({
          learningTargetId: z.string().regex(/^lt_\d+$/),
          criterionRef: z.string().regex(/^lt_\d+:c\d+$/),
          score: z.number().min(0).max(1),
          rationale: z.string().min(1),
        }),
      )
      .default([]),
  }),
);

export const socraticSchema = z.preprocess(
  expandSocraticCompact,
  z.object({
    question: z.string(),
    errorType: z.enum(["careless", "concept", "prerequisite"]).optional(),
    done: z.boolean().default(false),
  }),
);

export const drillsSchema = z.preprocess(
  expandDrillsCompact,
  z.object({
    questions: z.array(quizQuestionSchema).min(3).max(5),
  }),
);

export type QuizQuestion = z.infer<typeof quizQuestionSchema>;

export const materialAnchorSchema = z.object({
  scope: z.enum(["introduction", "key_takeaway", "block", "cornell_cue"]),
  sectionId: z.string().optional(),
  blockIndex: z.number().optional(),
  takeawayIndex: z.number().optional(),
  blockKey: z.string().optional(),
  blockType: z.string().optional(),
  subPath: z.string().optional(),
  selectedText: z.string().optional(),
  textRange: z.object({ start: z.number(), end: z.number() }).optional(),
  wrongOptionIndex: z.number().optional(),
  highlightKey: z.string().optional(),
});

export const flashCardDraftSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
  learningTargetIds: z
    .array(z.string().regex(/^lt_\d+$/))
    .min(1)
    .max(1),
  anchor: materialAnchorSchema.optional(),
  sourceExcerpt: z.string().default(""),
  tags: z.array(z.string()).optional(),
});

export const flashCardDeckSchema = z.preprocess(
  expandFlashcardDeckCompact,
  z.object({
    cards: z.array(flashCardDraftSchema).min(0).max(15),
  }),
);

export type FlashCardDraft = z.infer<typeof flashCardDraftSchema>;
export type MaterialAnchorSchema = z.infer<typeof materialAnchorSchema>;
