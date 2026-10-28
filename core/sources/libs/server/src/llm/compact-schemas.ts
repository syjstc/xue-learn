import { z } from "zod";
import {
  decomposeResultBindingSchema,
  expandMapBranchBindingSchema,
  goalMapPlanFieldsSchema,
  goalMapSummaryFieldsSchema,
  goalOverviewCourseBindingSchema,
  microUnitResultSchema,
  subdivideResultSchema,
} from "./schemas.js";
import { compactSurveyPreviewBindingSchema } from "../survey/authoring.js";
import { compactSurveySectionPlanBindingSchema } from "../survey/section-plan.js";

const compactSqAnswersBindingSchema = z.object({
  a: z.array(z.string().min(1)).min(1).max(8),
});

const compactCornellBindingSchema = z.object({
  n: z.string(),
  cu: z.string(),
  sm: z.string(),
});

const compactUnitKeyPointsBindingSchema = z.object({
  points: z.array(z.string()),
});

const compactFeynmanBindingSchema = z.object({
  pass: z.boolean(),
  str: z.array(z.string()),
  bs: z.array(z.string()),
  sg: z.array(z.string()),
  pl: z.string().optional(),
  obs: z
    .array(
      z.object({
        lt: z.string().regex(/^lt_\d+$/),
        cr: z.string().regex(/^lt_\d+:c\d+$/),
        sc: z.number().min(0).max(1),
        ra: z.string().min(1),
      }),
    )
    .optional(),
});

const compactSocraticBindingSchema = z.object({
  q: z.string(),
  et: z.enum(["careless", "concept", "prerequisite"]).optional(),
  dn: z.boolean().optional(),
});

const compactQuizQuestionBindingSchema = z.object({
  t: z.enum(["mcq", "mcq_multi"]),
  q: z.string(),
  opt: z.array(z.string()).min(2).max(6),
  ci: z.number().optional(),
  cis: z.array(z.number()).optional(),
  lti: z.array(z.string().regex(/^lt_\d+$/)).min(1),
  pti: z.string().regex(/^lt_\d+$/),
  ed: z.enum(["memory", "understanding", "application"]),
  cr: z.string().min(1),
  cd: z.enum(["same", "near", "far"]),
});

// Follow-up drills are parsed directly by `drillsSchema` rather than passing
// through the quiz normalizer that lowers over-claimed evidence dimensions.
// Keep their provider contract at the selected-response evidence ceiling so a
// provider-native response cannot pass binding and then fail business parsing.
const compactDrillQuestionBindingSchema =
  compactQuizQuestionBindingSchema.extend({
    ed: z.enum(["memory", "understanding"]),
  });

const compactDrillsBindingSchema = z.object({
  qs: z.array(compactDrillQuestionBindingSchema).min(3).max(5),
});

const compactQuizBindingSchema = z.object({
  qs: z.array(compactQuizQuestionBindingSchema),
  il: z.array(compactQuizQuestionBindingSchema).max(0).default([]),
});

const compactFlashcardBindingSchema = z.object({
  cs: z.array(
    z.object({
      fr: z.string(),
      bk: z.string(),
      lti: z.array(z.string().regex(/^lt_\d+$/)).length(1),
      an: z.record(z.string(), z.unknown()).optional(),
      ex: z.string().optional(),
    }),
  ),
});

export const compactLearningMaterialBindingSchema = z.object({
  items: z.array(z.unknown()),
});

const goalIconBindingSchema = z.object({
  // OpenAI strict JSON Schema requires every declared property to be listed
  // in `required`. The goal-icon prompt already requires a tint, and the
  // application keeps a deterministic fallback for invalid provider output.
  tint: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  svg: z.string().min(20).max(6000),
});

const topicSummaryBindingSchema = z.object({
  topic: z.string(),
  refinedTitle: z.string(),
  intentAnalysis: z.string(),
});

const documentTopicBindingSchema = z.object({
  topic: z.string().min(2),
  refinedTitle: z.string().min(2),
  intentAnalysis: z.string().min(2),
  documentSummary: z.string().min(2),
});

const BINDING_SCHEMAS: Record<string, z.ZodType> = {
  plan_goal_map: goalMapPlanFieldsSchema,
  "goal.plan.detail": goalMapPlanFieldsSchema,
  "goal.summary": goalMapSummaryFieldsSchema,
  decompose: decomposeResultBindingSchema,
  expand_map_branch: expandMapBranchBindingSchema,
  subdivide: subdivideResultSchema,
  "goal.micro_unit": microUnitResultSchema,
  "goal.icon": goalIconBindingSchema,
  "goal.overview": goalOverviewCourseBindingSchema,
  "unit.learning_material": compactLearningMaterialBindingSchema,
  "unit.sq_preview": compactSurveyPreviewBindingSchema,
  "unit.section_plan": compactSurveySectionPlanBindingSchema,
  "unit.sq_question_answers": compactSqAnswersBindingSchema,
  "unit.cornell": compactCornellBindingSchema,
  "unit.key_points": compactUnitKeyPointsBindingSchema,
  "unit.feynman": compactFeynmanBindingSchema,
  "unit.socratic": compactSocraticBindingSchema,
  "unit.drills": compactDrillsBindingSchema,
  "unit.quiz": compactQuizBindingSchema,
  "unit.flashcards": compactFlashcardBindingSchema,
  "agent.topic_summary": topicSummaryBindingSchema,
  "agent.document_topic": documentTopicBindingSchema,
};

export function resolveCompactBindingSchema(
  operation: string,
): z.ZodType | undefined {
  return BINDING_SCHEMAS[operation];
}
