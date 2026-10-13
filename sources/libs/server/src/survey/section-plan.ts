import { z } from "zod";
import {
  portableSurveyPreviewSchema,
  surveySectionPlanSchema,
  type SurveyPreview,
} from "./authoring.js";
import { FORMAL_DERIVATION_CONTENT_KIND_RULE } from "./formal-derivation-planning.js";

export const SECTION_PLAN_OPERATION = "unit.section_plan" as const;

export const SECTION_PLAN_STABLE_INSTRUCTION = `Group a frozen Survey outline into 1-4 contiguous teaching sections. Follow server-owned index coverage; output only the requested structured object.
Section-planning rules:
- Group every outline index exactly once, in order, into 1-4 contiguous teaching sections.
- Choose section boundaries by conceptual dependency and teaching coherence, not by rhetorical outline count.
- Use one section when the whole unit is small enough to teach coherently without navigation; do not split merely to create more sections.
- Each section title and scope must describe the complete teaching job owned by its grouped outline points.
- Do not rewrite, reorder, drop, or invent outline items. Indexes are the only grouping authority.
- ${FORMAL_DERIVATION_CONTENT_KIND_RULE}`;

export const surveySectionPlanObjectSchema = z.object({
  sections: surveySectionPlanSchema,
});

export type SurveySectionPlanObject = z.infer<
  typeof surveySectionPlanObjectSchema
>;

export const compactSurveySectionPlanBindingSchema = z.object({
  sections: z.array(
    z.object({
      title: z.string(),
      scope: z.string(),
      outlineIndexes: z.array(z.number().int()),
      contentKind: z.literal("standard").optional(),
    }),
  ),
});

export function surveySectionPlanForOutlineSchema(outlineLength: number) {
  return surveySectionPlanObjectSchema.superRefine((value, context) => {
    let expectedOutlineIndex = 0;
    value.sections.forEach((section, sectionIndex) => {
      section.outlineIndexes.forEach((outlineIndex, itemIndex) => {
        if (outlineIndex !== expectedOutlineIndex) {
          context.addIssue({
            code: "custom",
            path: ["sections", sectionIndex, "outlineIndexes", itemIndex],
            message:
              "sectionPlan must cover ordered Survey outline indexes exactly once",
          });
        }
        expectedOutlineIndex += 1;
      });
    });
    if (expectedOutlineIndex !== outlineLength) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "sectionPlan must cover every Survey outline item",
      });
    }
  });
}

export function fallbackExplorationSectionPlan(
  outline: readonly string[],
): SurveySectionPlanObject {
  const titles = outline.length > 0 ? [...outline] : ["本课"];
  return {
    sections: [
      {
        title: titles[0]!,
        scope: titles.join("；"),
        outlineIndexes: titles.map((_, index) => index),
      },
    ],
  };
}

export function attachSurveySectionPlan(
  survey: SurveyPreview,
  plan: SurveySectionPlanObject,
): SurveyPreview {
  return portableSurveyPreviewSchema.parse({
    ...survey,
    survey: {
      ...survey.survey,
      sectionPlan: plan.sections,
    },
  });
}

export function buildSectionPlanJsonPrompt(params: {
  unitTitle: string;
  outline: readonly string[];
  questions?: readonly string[];
  languageBlock?: string;
}): string {
  const numberedOutline = params.outline
    .map((item, index) => `${index}. ${item}`)
    .join("\n");
  const questions = (params.questions ?? [])
    .map((question, index) => `${index + 1}. ${question}`)
    .join("\n");
  return `Group the frozen Survey outline for unit "${params.unitTitle}" into 1-4 contiguous teaching sections.
${params.languageBlock ? `\n${params.languageBlock}\n` : ""}
Frozen outline (authoritative, index-stable):
${numberedOutline || "(empty)"}
${questions ? `\nGuiding questions (context only; do not regroup):\n${questions}\n` : ""}
Return a JSON object:
{"sections":[{"title":"coherent section title","scope":"complete owned teaching scope","outlineIndexes":[0,1],"contentKind":"standard"}]}
${FORMAL_DERIVATION_CONTENT_KIND_RULE}`;
}

export type PrepareSectionPlanAuthoringInput = {
  unitTitle: string;
  outline: readonly string[];
  questions?: readonly string[];
  languageBlock?: string;
};

export type PreparedSectionPlanAuthoring = {
  operation: typeof SECTION_PLAN_OPERATION;
  prompt: string;
  contextInvocation: Record<string, unknown>;
  resultSchema: z.ZodType<SurveySectionPlanObject>;
};

export function prepareSectionPlanAuthoring(
  input: PrepareSectionPlanAuthoringInput,
): PreparedSectionPlanAuthoring {
  const contextInvocation = {
    unitTitle: input.unitTitle,
    outline: [...input.outline],
    questions: [...(input.questions ?? [])],
    languageBlock: input.languageBlock ?? "",
  };
  return {
    operation: SECTION_PLAN_OPERATION,
    prompt: buildSectionPlanJsonPrompt(contextInvocation),
    contextInvocation,
    resultSchema: surveySectionPlanForOutlineSchema(input.outline.length).transform(plan => ({
      ...plan, sections: plan.sections.map(section => ({...section, contentKind: "standard" as const})),
    })),
  };
}
