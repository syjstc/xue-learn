import { z } from "zod";
import { learnerFacingContentIssues } from "../../../domain/src/learner-facing-content.js";
import {
  courseMaterialAuthoredBlockBindingSchema,
  generatableComplexInteractiveBlockTypeSchema,
} from "../llm/schemas.js";
import { courseSvgAuthoringIntentSchema } from "../llm/course-svg-intent.js";
import { rewriteInLessonVisualWireItemToIllustration } from "../llm/illustration-from-visual-intent.js";
import { stripInternalLearningTargetRefs } from "../llm/learner-facing-text.js";
import { containsCollapsedGeneratedCodeFence } from "../markdown/validate-code-fences.js";

export const MIN_SECTION_MATERIAL_BLOCKS = 6;
export const MAX_SECTION_MATERIAL_BLOCKS = 120;
export const MAX_SECTION_MATERIAL_TAKEAWAYS = 10;

const learnerTextSchema = z
  .string()
  .overwrite(stripInternalLearningTargetRefs)
  .trim()
  .min(1);

export const sectionMaterialIntentSchema = z.object({
  setup: learnerTextSchema.max(1_000),
  learningGoal: learnerTextSchema.max(1_000),
  expectedInsight: learnerTextSchema.max(1_000),
});

export const sectionMaterialSvgIntentSchema = courseSvgAuthoringIntentSchema;

export const sectionMaterialComponentSlotSchema = z.union([
  z.object({
    type: z.literal("component_slot"),
    slotRef: z.string().regex(/^component_[1-8]$/),
    intent: sectionMaterialIntentSchema,
  }),
  z.object({
    type: z.literal("component_slot"),
    componentType: generatableComplexInteractiveBlockTypeSchema,
    intent: sectionMaterialIntentSchema,
  }),
]);

export const sectionMaterialSvgSlotSchema = z.object({
  type: z.literal("svg_slot"),
  intent: sectionMaterialSvgIntentSchema,
});

export const sectionMaterialAuthoredBlockSchema =
  courseMaterialAuthoredBlockBindingSchema.superRefine((block, context) => {
    if (containsCollapsedGeneratedCodeFence(block)) {
      context.addIssue({
        code: "custom",
        message:
          "substantial fenced source code must use physical newlines and source indentation; do not flatten it into one line",
      });
    }
  });

export const sectionMaterialProviderBlockSchema = z.union([
  sectionMaterialAuthoredBlockSchema,
  sectionMaterialComponentSlotSchema,
  sectionMaterialSvgSlotSchema,
]);

export type SectionMaterialAuthoredBlock = z.infer<
  typeof sectionMaterialAuthoredBlockSchema
>;
export type SectionMaterialProviderBlock = z.infer<
  typeof sectionMaterialProviderBlockSchema
>;

export type SectionMaterialAuthoringPolicy = {
  allowedComponentTypes: readonly z.infer<
    typeof generatableComplexInteractiveBlockTypeSchema
  >[];
  maxComponentCount: number;
  allowIllustrations: boolean;
  minIllustrationCount?: number;
  maxIllustrationCount?: number;
  replaceInLessonVisualsWithIllustrations?: boolean;
  plannedComponents?: readonly {
    id: string;
    componentType: z.infer<typeof generatableComplexInteractiveBlockTypeSchema>;
  }[];
};

/** Same leaf cleanup used by hosted structured-generation recovery. */
export function normalizeSectionMaterialGeneratedJsonValue(
  value: unknown,
): unknown {
  if (typeof value === "string") {
    return stripInternalLearningTargetRefs(value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeSectionMaterialGeneratedJsonValue);
  }
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  const isCodeBlock =
    object.type === "code" &&
    (typeof object.code === "string" || Array.isArray(object.parts));
  return Object.fromEntries(
    Object.entries(object).flatMap(([key, child]) => {
      if (child === null) return [];
      if (isCodeBlock && (key === "code" || key === "parts")) {
        return [[key, child] as const];
      }
      return [
        [key, normalizeSectionMaterialGeneratedJsonValue(child)] as const,
      ];
    }),
  );
}

function normalizeProviderBlock(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (typeof record.json === "string") {
    try {
      return normalizeSectionMaterialGeneratedJsonValue(
        JSON.parse(record.json) as unknown,
      );
    } catch {
      return value;
    }
  }
  if (
    record.kind === "block" &&
    record.block &&
    typeof record.block === "object" &&
    !Array.isArray(record.block)
  ) {
    return record.block;
  }
  return value;
}

export function createSectionMaterialEnvelopeSchema(
  policy: SectionMaterialAuthoringPolicy,
) {
  return z
    .preprocess(
      normalizeSectionMaterialGeneratedJsonValue,
      z.object({
        introduction: learnerTextSchema,
        blocks: z
          .array(
            z.preprocess((value) => {
              const normalized = normalizeProviderBlock(value);
              return policy.replaceInLessonVisualsWithIllustrations
                ? rewriteInLessonVisualWireItemToIllustration(normalized)
                : normalized;
            }, sectionMaterialProviderBlockSchema),
          )
          .min(MIN_SECTION_MATERIAL_BLOCKS)
          .max(MAX_SECTION_MATERIAL_BLOCKS),
        keyTakeaways: z
          .array(learnerTextSchema)
          .max(MAX_SECTION_MATERIAL_TAKEAWAYS),
      }),
    )
    .superRefine((material, context) => {
      for (const issue of learnerFacingContentIssues(material))
        context.addIssue({ code: "custom", ...issue });
      const plannedIds = new Set(
        (policy.plannedComponents ?? []).map((component) => component.id),
      );
      const allowedTypes = new Set(policy.allowedComponentTypes);
      const seenRefs = new Set<string>();
      let componentCount = 0;
      let illustrationCount = 0;
      material.blocks.forEach((block, index) => {
        if (block.type === "illustration") illustrationCount += 1;
        if (block.type !== "component_slot") return;
        componentCount += 1;
        if ("slotRef" in block) {
          if (!plannedIds.has(block.slotRef)) {
            context.addIssue({
              code: "custom",
              path: ["blocks", index, "slotRef"],
              message: `component slot ${block.slotRef} is not in the frozen component plan`,
            });
          }
          if (seenRefs.has(block.slotRef)) {
            context.addIssue({
              code: "custom",
              path: ["blocks", index, "slotRef"],
              message: `component slot ${block.slotRef} must appear at most once`,
            });
          }
          seenRefs.add(block.slotRef);
        } else {
          if (plannedIds.size > 0) {
            context.addIssue({
              code: "custom",
              path: ["blocks", index, "componentType"],
              message:
                "frozen component plans cannot be mixed with material-owned component intents",
            });
          }
          if (!allowedTypes.has(block.componentType)) {
            context.addIssue({
              code: "custom",
              path: ["blocks", index, "componentType"],
              message: `componentType ${block.componentType} is outside the selected category palette`,
            });
          }
        }
      });
      if (componentCount > policy.maxComponentCount) {
        context.addIssue({
          code: "custom",
          path: ["blocks"],
          message: `material allows at most ${policy.maxComponentCount} interactive component intent(s)`,
        });
      }
      if (
        policy.allowIllustrations &&
        illustrationCount < (policy.minIllustrationCount ?? 0)
      ) {
        context.addIssue({
          code: "custom",
          path: ["blocks"],
          message: `material requires at least ${policy.minIllustrationCount} illustration block(s)`,
        });
      }
    });
}

export type PrepareSectionMaterialAuthoringInput = {
  /** Exact capability-composed hosted prompt or an equivalent local projection. */
  prompt: string;
  policy: SectionMaterialAuthoringPolicy;
};

function unwrapJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

/** Provider-independent contract at the boundary before component/SVG compilation. */
export function prepareSectionMaterialAuthoring(
  input: PrepareSectionMaterialAuthoringInput,
) {
  const resultSchema = createSectionMaterialEnvelopeSchema(input.policy);
  return {
    operation: "unit.learning_material" as const,
    prompt: input.prompt,
    policy: input.policy,
    resultSchema,
    parseProviderOutput: (content: string) =>
      resultSchema.parse(unwrapJson(content)),
  };
}

export type SectionMaterialAuthoringResult = z.infer<
  ReturnType<typeof createSectionMaterialEnvelopeSchema>
>;

export function hasUnresolvedSectionMaterialIntents(
  material: SectionMaterialAuthoringResult,
): boolean {
  return material.blocks.some(
    (block) => block.type === "component_slot" || block.type === "svg_slot",
  );
}
