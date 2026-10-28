import { z } from "zod";
import { buildSqPreviewJsonPrompt } from "../learning-systems/capabilities/unit-content/sq-prompt.js";

export const surveyLearningTargetSchema = z.object({
  id: z.string().regex(/^lt_\d+$/),
  durableId: z.string().optional(),
  cognitiveEntityIds: z.array(z.string().min(1)).min(1).optional(),
  label: z.string().min(1),
  explanation: z.string().optional(),
  learningObjective: z.string().optional(),
  assessmentCriteria: z.array(z.string()).optional(),
  importance: z.enum(["core", "supporting", "enrichment"]).optional(),
  importanceWeight: z.number().int().min(1).max(5).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  targetCognitiveLevel: z
    .enum(["remember", "understand", "apply", "analyze", "evaluate", "create"])
    .optional(),
  rationale: z.string().optional(),
  isEntry: z.boolean().optional(),
  isExit: z.boolean().optional(),
});

export const surveyGuidingQuestionSchema = z.object({
  text: z.string().min(1),
  learningTargetIds: z.array(z.string().regex(/^lt_\d+$/)).default([]),
});

export const surveyComplexComponentTypeSchema = z.enum([
  "step_sort",
  "graph",
  "chart",
  "math_scene",
  "mechanics_sandbox",
  "circuit_sandbox",
  "chemistry_lab",
]);

/** Complex types selectable for new SQ/material generation. */
export const generatableSurveyComponentTypeSchema = z.enum([
  "chart",
  "math_scene",
  "mechanics_sandbox",
  "circuit_sandbox",
  "chemistry_lab",
]);

export const surveySectionContentKindSchema = z.enum([
  "standard",
  "formal_derivation",
]);
export type SurveySectionContentKind = z.infer<
  typeof surveySectionContentKindSchema
>;

export function persistedSectionContentKind(
  value: unknown,
): SurveySectionContentKind {
  return value === "formal_derivation" ? "formal_derivation" : "standard";
}

export function optionalSectionContentKind(
  value: unknown,
): { contentKind?: "formal_derivation" } {
  return value === "formal_derivation" ? { contentKind: "formal_derivation" } : {};
}

/** Micro courses stay one section; a formal_derivation Survey label applies to that whole lesson. */
export function microCourseSectionPlanDraft(input: {
  unitTitle: string;
  unitContentSummary?: string;
  outlinePlans?: ReadonlyArray<{
    title: string;
    contentSummary: string;
    contentKind?: string;
  }>;
  surveyContentKind?: string;
}): {
  title: string;
  contentSummary: string;
  assessmentAfter: false;
  contentKind: SurveySectionContentKind;
  targets: [];
} {
  const outlines = input.outlinePlans ?? [];
  const derivationItem = outlines.find(
    (item) => persistedSectionContentKind(item.contentKind) === "formal_derivation",
  );
  const isDerivation =
    Boolean(derivationItem) ||
    persistedSectionContentKind(input.surveyContentKind) ===
      "formal_derivation";
  const summaries = outlines
    .map((plan) => plan.contentSummary.trim())
    .filter(Boolean);
  return {
    title:
      derivationItem?.title.trim() ||
      (isDerivation
        ? outlines[0]?.title.trim() || input.unitTitle.trim()
        : "课程内容"),
    contentSummary:
      input.unitContentSummary?.trim() ||
      summaries.join("；") ||
      input.unitTitle.trim(),
    assessmentAfter: false,
    contentKind: isDerivation ? "formal_derivation" : "standard",
    targets: [],
  };
}

export const surveySectionOutlineItemSchema = z.object({
  title: z.string().trim().min(1),
  scope: z.string().trim().min(1),
  learningTargetIds: z.array(z.string()).min(1),
  checkpointAfter: z.boolean(),
  contentKind: surveySectionContentKindSchema.optional(),
});

export const surveySectionPlanItemSchema = z.object({
  title: z.string().trim().min(1),
  scope: z.string().trim().min(1),
  outlineIndexes: z.array(z.number().int().min(0)).min(1),
  contentKind: surveySectionContentKindSchema.optional(),
});

export const surveySectionPlanSchema = z
  .array(surveySectionPlanItemSchema)
  .min(1)
  .max(4);

const surveyBodySchema = z
  .object({
    outline: z.array(z.string()),
    contentKind: surveySectionContentKindSchema.optional(),
    sectionOutline: z
      .array(surveySectionOutlineItemSchema)
      .min(2)
      .max(8)
      .optional(),
    sectionPlan: surveySectionPlanSchema.optional(),
    learningTargetLabels: z.array(z.string()),
  })
  .superRefine((survey, context) => {
    if (!survey.sectionPlan) return;
    let expectedOutlineIndex = 0;
    survey.sectionPlan.forEach((section, sectionIndex) => {
      section.outlineIndexes.forEach((outlineIndex, itemIndex) => {
        if (outlineIndex !== expectedOutlineIndex) {
          context.addIssue({
            code: "custom",
            path: ["sectionPlan", sectionIndex, "outlineIndexes", itemIndex],
            message:
              "sectionPlan must cover ordered Survey outline indexes exactly once",
          });
        }
        expectedOutlineIndex += 1;
      });
    });
    if (expectedOutlineIndex !== survey.outline.length) {
      context.addIssue({
        code: "custom",
        path: ["sectionPlan"],
        message: "sectionPlan must cover every Survey outline item",
      });
    }
  });

export const portableSurveyPreviewSchema = z.object({
  survey: surveyBodySchema,
  learningTargets: z.array(surveyLearningTargetSchema).max(30),
  questions: z.array(surveyGuidingQuestionSchema).min(1).max(8),
  componentSelection: z
    .object({
      mainCategory: z.enum([
        "base",
        "math_visualization",
        // Read compatibility for older survey previews.
        "process_sequence",
        "data_visualization",
        "mechanics_lab",
        "circuit_lab",
        "chemistry_lab",
      ]),
      enabledCategories: z
        .array(
          z.enum([
            "base",
            "math_visualization",
            // Read compatibility for older survey previews.
            "process_sequence",
            "data_visualization",
            "mechanics_lab",
            "circuit_lab",
            "chemistry_lab",
          ]),
        )
        .min(1),
      rationale: z.string().optional(),
      plannedComponents: z
        .array(
          z.object({
            id: z.string().regex(/^component_[1-8]$/),
            componentType: surveyComplexComponentTypeSchema,
            description: z.string().min(8).max(2_000),
          }),
        )
        .max(8)
        .optional(),
    })
    .optional(),
});

export type SurveyPreview = z.infer<typeof portableSurveyPreviewSchema>;
export type SurveyLearningTarget = z.infer<typeof surveyLearningTargetSchema>;

export const surveyOutlineItemSchema = z.object({
  kind: z.literal("outline"),
  text: z.string().trim().min(1),
  scope: z.string().trim().min(1).optional(),
  learningTargetIds: z.array(z.string()).optional(),
  checkpointAfter: z.boolean().optional(),
  contentKind: surveySectionContentKindSchema.optional(),
});
export const surveyQuestionItemSchema = z.object({
  kind: z.literal("question"),
  question: surveyGuidingQuestionSchema,
});
export const surveySectionPlanItemContractSchema = z.object({
  kind: z.literal("section_plan"),
  sections: surveySectionPlanSchema,
});
export const surveyAuthoringItemSchema = z.discriminatedUnion("kind", [
  surveyOutlineItemSchema,
  surveyQuestionItemSchema,
]);
export const surveyPreviewItemSchema = z.discriminatedUnion("kind", [
  surveyOutlineItemSchema,
  surveySectionPlanItemContractSchema,
  surveyQuestionItemSchema,
]);
export type SurveyAuthoringItem = z.infer<typeof surveyAuthoringItemSchema>;
export type SurveyPreviewItem = z.infer<typeof surveyPreviewItemSchema>;

/**
 * Provider-native Survey envelope. MiniMax/OpenAI-compatible function tools
 * need one object (`type`/`properties`/`required`), not an `anyOf` union.
 * A single growing `items` array lets parsePartialJson emit each complete
 * outline/question as soon as that object closes — two sibling arrays would
 * hold the first paint until `questions` exists.
 */
export const compactSurveyPreviewItemBindingSchema = z.object({
  kind: z.enum(["outline", "question"]),
  text: z.string(),
  scope: z.string().optional(),
  learningTargetIds: z.array(z.string()).optional(),
  checkpointAfter: z.boolean().optional(),
  contentKind: z.literal("standard").optional(),
});

export const compactSurveyPreviewBindingSchema = z.object({
  items: z.array(compactSurveyPreviewItemBindingSchema),
});

function asJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function surveyItemFromWire(value: unknown): unknown {
  const item = asJsonObject(value);
  if (!item) return value;
  if (item.kind === "outline") return item;
  if (item.kind === "question" && asJsonObject(item.question)) return item;
  if (item.kind === "question") return questionItemFromEnvelope(item);
  if (asJsonObject(item.question)) return questionItemFromEnvelope(item);
  return outlineItemFromEnvelope(item);
}

function outlineItemFromEnvelope(value: unknown): unknown {
  const item = asJsonObject(value);
  if (!item) return value;
  if (item.kind === "outline") return item;
  const text = typeof item.text === "string" ? item.text : "";
  const scope = typeof item.scope === "string" ? item.scope.trim() : "";
  return {
    kind: "outline",
    text,
    ...(scope ? { scope } : {}),
    ...(Array.isArray(item.learningTargetIds)
      ? { learningTargetIds: item.learningTargetIds }
      : {}),
    ...(typeof item.checkpointAfter === "boolean"
      ? { checkpointAfter: item.checkpointAfter }
      : {}),
    ...optionalSectionContentKind(item.contentKind),
  };
}

function questionItemFromEnvelope(value: unknown): unknown {
  const item = asJsonObject(value);
  if (!item) return value;
  if (asJsonObject(item.question)) {
    return item.kind === "question" ? item : { ...item, kind: "question" };
  }
  const text = typeof item.text === "string" ? item.text : "";
  const learningTargetIds = Array.isArray(item.learningTargetIds)
    ? item.learningTargetIds
    : [];
  return {
    kind: "question",
    question: { text, learningTargetIds },
  };
}

/** Convert the provider object envelope into the internal progressive item list. */
export function normalizeSurveyPreviewEnvelopeCandidate(
  candidate: unknown,
): unknown {
  if (Array.isArray(candidate)) {
    return { items: candidate.map(surveyItemFromWire) };
  }
  const envelope = asJsonObject(candidate);
  if (!envelope) return candidate;
  if (Array.isArray(envelope.items)) {
    return { items: envelope.items.map(surveyItemFromWire) };
  }
  const outline = Array.isArray(envelope.outline) ? envelope.outline : [];
  const questions = Array.isArray(envelope.questions) ? envelope.questions : [];
  if (outline.length === 0 && questions.length === 0) return candidate;
  return {
    items: [
      ...outline.map(outlineItemFromEnvelope),
      ...questions.map(questionItemFromEnvelope),
    ],
  };
}

export function surveyItemsFromProviderPayload(value: unknown): unknown {
  const normalized = normalizeSurveyPreviewEnvelopeCandidate(value);
  const envelope = asJsonObject(normalized);
  return Array.isArray(envelope?.items) ? envelope.items : value;
}

/** Same leaf normalization used by hosted structured-generation recovery. */
export function normalizeSurveyGeneratedJsonValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (Array.isArray(value)) return value.map(normalizeSurveyGeneratedJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) =>
      child === null
        ? []
        : [[key, normalizeSurveyGeneratedJsonValue(child)] as const],
    ),
  );
}

const surveyAuthoringInputItemSchema = z.preprocess(
  normalizeSurveyGeneratedJsonValue,
  surveyAuthoringItemSchema,
);

export function surveyAuthoringItemsSchemaFor(
  sectionPlanningMode: SurveySectionPlanningMode,
) {
  const minOutlines = sectionPlanningMode === "kacom" ? 2 : 1;
  return z
    .array(surveyAuthoringItemSchema)
    .min(minOutlines + 1)
    .superRefine((items, context) => {
      const outlineCount = items.filter(
        (item) => item.kind === "outline",
      ).length;
      if (outlineCount < minOutlines || outlineCount > 8) {
        context.addIssue({
          code: "custom",
          message:
            minOutlines === 2
              ? "SQ requires 2-8 outline items"
              : "SQ requires 1-8 outline items",
        });
      }
      if (!items.some((item) => item.kind === "question")) {
        context.addIssue({
          code: "custom",
          message: "SQ requires a guiding question",
        });
      }
    });
}

export const surveyAuthoringItemsSchema = surveyAuthoringItemsSchemaFor("kacom");

export type SurveySectionPlanningMode = "kacom" | "exploration" | "micro";

export type PrepareSurveyAuthoringInput = {
  unitTitle: string;
  goalBlock: string;
  difficultyBlock: string;
  styleBlock: string;
  languageBlock: string;
  optionsBlock?: string;
  context: string;
  canonicalLearningTargetsBlock: string;
  canonicalLearningTargets?: SurveyLearningTarget[];
  moduleContext?: string;
  sharedContextReuseLine?: string;
  sectionPlanningMode: SurveySectionPlanningMode;
  finalizeSurvey?: (draft: SurveyPreview) => SurveyPreview;
};

export type PreparedSurveyAuthoring = {
  operation: "unit.sq_preview";
  prompt: string;
  contextInvocation: Record<string, unknown>;
  itemSchema: typeof surveyAuthoringInputItemSchema;
  bindingItemSchema: typeof surveyAuthoringItemSchema;
  bindingSchema: typeof compactSurveyPreviewBindingSchema;
  resultSchema: z.ZodType<SurveyPreview>;
  parseProviderOutput(content: string): SurveyPreview;
};

function unwrapJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

export function assembleSurveyItems(
  items: SurveyAuthoringItem[],
  learningTargets: SurveyLearningTarget[],
  sectionPlanningMode: SurveySectionPlanningMode,
): SurveyPreview {
  const outlineItems = items
    .filter(
      (item): item is Extract<SurveyAuthoringItem, { kind: "outline" }> =>
        item.kind === "outline",
    )
    .slice(0, 8);
  const hasDerivationOutline = outlineItems.some(
    (item) => item.contentKind === "formal_derivation",
  );
  return portableSurveyPreviewSchema.parse({
    survey: {
      outline: outlineItems.map((item) => item.text),
      ...(sectionPlanningMode === "kacom"
        ? {
            sectionOutline: outlineItems.map((item) => ({
              title: item.text,
              scope: item.scope?.trim() || item.text,
              learningTargetIds: item.learningTargetIds ?? [],
              checkpointAfter: item.checkpointAfter ?? false,
              ...optionalSectionContentKind(item.contentKind),
            })),
          }
        : {}),
      ...(sectionPlanningMode === "micro" && hasDerivationOutline
        ? { contentKind: "formal_derivation" as const }
        : {}),
      learningTargetLabels: learningTargets.map((target) => target.label),
    },
    learningTargets,
    questions: items.flatMap((item) =>
      item.kind === "question" ? [item.question] : [],
    ),
  });
}

/** Shared provider-independent Survey/SQ authoring contract. */
export function prepareSurveyAuthoring(
  input: PrepareSurveyAuthoringInput,
): PreparedSurveyAuthoring {
  const contextInvocation = {
    unitTitle: input.unitTitle,
    goalBlock: input.goalBlock,
    difficultyBlock: input.difficultyBlock,
    styleBlock: input.styleBlock,
    languageBlock: input.languageBlock,
    optionsBlock: input.optionsBlock ?? "",
    context: input.context,
    canonicalLearningTargets: input.canonicalLearningTargetsBlock,
    moduleContext: input.moduleContext,
    sharedContextReuseLine: input.sharedContextReuseLine,
    sectionPlanningMode: input.sectionPlanningMode,
  };
  const prompt = buildSqPreviewJsonPrompt(contextInvocation);
  const resultSchema = z
    .preprocess(
      normalizeSurveyGeneratedJsonValue,
      surveyAuthoringItemsSchemaFor(input.sectionPlanningMode),
    )
    .transform((items) => {
      const draft = assembleSurveyItems(
        items.map(item => item.kind === "outline" ? {...item, contentKind: "standard" as const} : item),
        input.canonicalLearningTargets ?? [],
        input.sectionPlanningMode,
      );
      const finalized = input.finalizeSurvey?.(draft) ?? draft;
      return portableSurveyPreviewSchema.parse(finalized);
    });
  return {
    operation: "unit.sq_preview",
    prompt,
    contextInvocation,
    itemSchema: surveyAuthoringInputItemSchema,
    bindingItemSchema: surveyAuthoringItemSchema,
    bindingSchema: compactSurveyPreviewBindingSchema,
    resultSchema,
    parseProviderOutput: (content) =>
      resultSchema.parse(surveyItemsFromProviderPayload(unwrapJson(content))),
  };
}
