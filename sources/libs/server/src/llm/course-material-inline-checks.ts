import { createHash } from "node:crypto";
import { z } from "zod";
import { componentDslLine } from "./course-material-component-compiler.js";
import {
  interactiveBlockSchema,
  sqPreviewSchema,
  type InteractiveBlock,
} from "./schemas.js";
import { runValidatedStructuredGeneration } from "./validated-structured-generation.js";
import { buildMaterialComponentInvocationPrompt } from "../learning-systems/capabilities/material-components/capability.js";
import { MATERIAL_COMPONENT_VIEW_KEYS } from "../learning-systems/capabilities/material-components/keys.js";
import {
  planSectionMiniTest,
  prepareSectionMiniTestAuthoring,
} from "../unit-session/section-mini-test-authoring.js";

export type InlineCheckEvidenceDimension = "memory" | "understanding";

export type InlineCheckQuestionType = "mcq" | "mcq_multi" | "true_false";

export type InlineCheckPlan = {
  slotRef: string;
  questionType: InlineCheckQuestionType;
  primaryLearningTargetId: string;
  targetCognitiveEntityId: string;
  evidenceDimension: InlineCheckEvidenceDimension;
  criterionRef: string;
  contextDistance: "same";
  targetLabel: string;
  targetExplanation?: string;
  learningObjective?: string;
  assessmentCriterion: string;
  placementHint: string;
  /** Prompt hint when reusing the same target with a different question shape. */
  judgmentAngleHint?: string;
};

export type CompiledInlineCheck = Extract<InteractiveBlock, { type: "check" }>;

export type InlineCheckContext = {
  /** Canonical, published SQ preview JSON. Draft targets must not be supplied. */
  sqJson: string;
  /** Server-authoritative evidence bindings loaded from published targets. */
  authorityBindings?: readonly InlineCheckAuthorityBinding[];
  /** Section order for deterministic two-question type rotation. */
  sectionOrderIndex?: number;
};

export type InlineCheckAuthorityBinding = {
  learningTargetId: string;
  targetCognitiveEntityId: string;
  evidenceDimension: InlineCheckEvidenceDimension;
  criterionRef: string;
  assessmentCriterion?: string;
};

type AssessableSlot = {
  target: z.infer<typeof sqPreviewSchema>["learningTargets"][number];
  targetIndex: number;
  binding?: InlineCheckAuthorityBinding;
  entityId: string;
  dimension: InlineCheckEvidenceDimension;
  criterionRef: string;
  assessmentCriterion: string;
};

const generatedMcqContentSchema = z
  .object({
    question: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).max(6),
    correctIndex: z.number().int().min(0),
    explanation: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    if (value.correctIndex >= value.options.length) {
      ctx.addIssue({
        code: "custom",
        path: ["correctIndex"],
        message: "correctIndex must point to an existing option",
      });
    }
    const normalized = value.options.map((option) =>
      option.trim().toLowerCase(),
    );
    if (new Set(normalized).size !== normalized.length) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "options must be distinct",
      });
    }
  });

const generatedMcqMultiContentSchema = z
  .object({
    question: z.string().min(1),
    options: z.array(z.string().min(1)).min(3).max(6),
    correctIndices: z.array(z.number().int().min(0)).min(2),
    explanation: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    const normalized = value.options.map((option) =>
      option.trim().toLowerCase(),
    );
    if (new Set(normalized).size !== normalized.length) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "options must be distinct",
      });
    }
    const uniqueIndices = new Set(value.correctIndices);
    if (uniqueIndices.size !== value.correctIndices.length) {
      ctx.addIssue({
        code: "custom",
        path: ["correctIndices"],
        message: "correctIndices must be unique",
      });
    }
    for (const index of value.correctIndices) {
      if (index >= value.options.length) {
        ctx.addIssue({
          code: "custom",
          path: ["correctIndices"],
          message: "correctIndices must point to existing options",
        });
        break;
      }
    }
  });

const generatedTrueFalseContentSchema = z.object({
  question: z.string().min(1),
  correctAnswer: z.boolean(),
  explanation: z.string().min(1),
});

export const generatedInlineCheckItemBindingSchema = z.object({
  questionType: z.enum(["mcq", "mcq_multi", "true_false"]),
  question: z.string().min(1),
  options: z.array(z.string().min(1)).optional(),
  correctIndex: z.number().int().min(0).optional(),
  correctIndices: z.array(z.number().int().min(0)).optional(),
  correctAnswer: z.boolean().optional(),
  explanation: z.string().min(1),
});

export const generatedInlineCheckItemSchema =
  generatedInlineCheckItemBindingSchema.superRefine((value, ctx) => {
    const content = { ...value } as Record<string, unknown>;
    delete content.questionType;
    const schema =
      value.questionType === "mcq_multi"
        ? generatedMcqMultiContentSchema
        : value.questionType === "true_false"
          ? generatedTrueFalseContentSchema
          : generatedMcqContentSchema;
    const parsed = schema.safeParse(content);
    if (parsed.success) return;
    for (const issue of parsed.error.issues) {
      ctx.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
    }
  });

export function inlineCheckAuthorityBindingsFromTargets(
  targets: readonly {
    localRef: string;
    assessmentCriteria: readonly { ref: string; text: string }[];
    requirements: readonly {
      cognitiveEntityId: string;
      dimension: string;
    }[];
  }[],
): InlineCheckAuthorityBinding[] {
  return targets.flatMap((target) => {
    const criterion = target.assessmentCriteria[0];
    if (!criterion) return [];
    return target.requirements.flatMap((requirement) => {
      if (
        requirement.dimension !== "memory" &&
        requirement.dimension !== "understanding"
      ) {
        return [];
      }
      return [
        {
          learningTargetId: target.localRef,
          targetCognitiveEntityId: requirement.cognitiveEntityId,
          evidenceDimension: requirement.dimension,
          criterionRef: criterion.ref,
          assessmentCriterion: criterion.text,
        } satisfies InlineCheckAuthorityBinding,
      ];
    });
  });
}

function desiredCheckCount(assessableTargetCount: number, slotCount: number) {
  if (assessableTargetCount <= 0 || slotCount <= 0) return 0;
  if (assessableTargetCount >= 2 || slotCount >= 2) return 3;
  return 2;
}

function questionTypesForCount(
  count: number,
  sectionOrderIndex = 0,
): InlineCheckQuestionType[] {
  if (count <= 0) return [];
  if (count === 1) return ["mcq"];
  if (count === 2) {
    return ["mcq", sectionOrderIndex % 2 === 0 ? "mcq_multi" : "true_false"];
  }
  return ["mcq", "mcq_multi", "true_false"];
}

function targetDimension(
  target: z.infer<typeof sqPreviewSchema>["learningTargets"][number],
): InlineCheckEvidenceDimension {
  return target.targetCognitiveLevel === "remember"
    ? "memory"
    : "understanding";
}

function targetPriority(
  target: z.infer<typeof sqPreviewSchema>["learningTargets"][number],
  index: number,
): number[] {
  const importance =
    target.importance === "core"
      ? 0
      : target.importance === "supporting"
        ? 1
        : 2;
  const difficulty =
    target.difficulty === "hard" ? 0 : target.difficulty === "medium" ? 1 : 2;
  return [importance, -(target.importanceWeight ?? 0), difficulty, index];
}

function comparePriority(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function parsePublishedSq(sqJson: string) {
  try {
    const first = JSON.parse(sqJson) as unknown;
    const value = typeof first === "string" ? JSON.parse(first) : first;
    return sqPreviewSchema.safeParse(value);
  } catch {
    return sqPreviewSchema.safeParse(null);
  }
}

function slotKey(slot: AssessableSlot): string {
  return `${slot.target.id.toLowerCase()}::${slot.entityId}::${slot.dimension}`;
}

function buildAssessableSlots(
  context: InlineCheckContext,
  parsed: z.infer<typeof sqPreviewSchema>,
): AssessableSlot[] {
  const bindingsByTarget = new Map<string, InlineCheckAuthorityBinding[]>();
  for (const binding of context.authorityBindings ?? []) {
    const key = binding.learningTargetId.toLowerCase();
    bindingsByTarget.set(key, [...(bindingsByTarget.get(key) ?? []), binding]);
  }

  const slots: AssessableSlot[] = [];
  parsed.learningTargets.forEach((target, targetIndex) => {
    const bindings = bindingsByTarget.get(target.id.toLowerCase()) ?? [];
    const hasCriterion =
      Boolean(bindings[0]?.criterionRef) ||
      Boolean(target.assessmentCriteria?.[0]);
    if (!hasCriterion) return;

    if (bindings.length > 0) {
      for (const binding of bindings) {
        if (!binding.targetCognitiveEntityId) continue;
        slots.push({
          target,
          targetIndex,
          binding,
          entityId: binding.targetCognitiveEntityId,
          dimension: binding.evidenceDimension,
          criterionRef: binding.criterionRef,
          assessmentCriterion:
            binding.assessmentCriterion ?? target.assessmentCriteria?.[0] ?? "",
        });
      }
      return;
    }

    const entityId = target.cognitiveEntityIds?.[0];
    if (!entityId) return;
    const dimension = targetDimension(target);
    slots.push({
      target,
      targetIndex,
      entityId,
      dimension,
      criterionRef: `${target.id}:c1`,
      assessmentCriterion: target.assessmentCriteria![0]!,
    });
  });

  return slots
    .filter(
      (slot) =>
        context.authorityBindings === undefined || Boolean(slot.binding),
    )
    .sort((left, right) =>
      comparePriority(
        targetPriority(left.target, left.targetIndex),
        targetPriority(right.target, right.targetIndex),
      ),
    );
}

function selectSlotsForPlans(
  slots: AssessableSlot[],
  count: number,
): AssessableSlot[] {
  if (slots.length === 0 || count <= 0) return [];
  const selected: AssessableSlot[] = [];
  const seenKeys = new Set<string>();
  for (const slot of slots) {
    if (selected.length >= count) break;
    const key = slotKey(slot);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    selected.push(slot);
  }
  let cursor = 0;
  while (selected.length < count) {
    selected.push(slots[cursor % slots.length]!);
    cursor += 1;
  }
  return selected;
}

const JUDGMENT_ANGLE_BY_TYPE: Record<InlineCheckQuestionType, string> = {
  mcq: "Ask a single-answer multiple-choice question that tests one precise idea.",
  mcq_multi:
    "Ask a select-all-that-apply question with at least two correct options.",
  true_false:
    "Ask the learner to judge one declarative statement as true or false.",
};

const REPEAT_JUDGMENT_ANGLES: Record<InlineCheckQuestionType, string[]> = {
  mcq: [
    "Rephrase the criterion as a scenario-based single-answer question.",
    "Test the same target from a contrasting-example angle.",
  ],
  mcq_multi: [
    "Use a different facet of the target and require multiple correct selections.",
    "Frame the criterion as identifying all valid statements about the concept.",
  ],
  true_false: [
    "State a precise claim about the target that must be judged true or false.",
    "Use a boundary-case statement that tests a subtle distinction in the target.",
  ],
};

function judgmentAngleHint(
  questionType: InlineCheckQuestionType,
  reuseIndex: number,
): string | undefined {
  if (reuseIndex <= 0) return JUDGMENT_ANGLE_BY_TYPE[questionType];
  const variants = REPEAT_JUDGMENT_ANGLES[questionType];
  return variants[(reuseIndex - 1) % variants.length];
}

/**
 * Deterministically selects evidence-capable published targets for inline checks.
 * Targets without both an assessment criterion and a cognitive entity are skipped;
 * this makes empty/legacy SQ payloads safely produce zero checks.
 */
export function planCourseMaterialInlineChecks(
  context: InlineCheckContext,
): InlineCheckPlan[] {
  return planSectionMiniTest(context);
}

function stableCheckId(
  plan: InlineCheckPlan,
  content: Record<string, unknown>,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        questionType: plan.questionType,
        target: plan.primaryLearningTargetId,
        entity: plan.targetCognitiveEntityId,
        dimension: plan.evidenceDimension,
        criterion: plan.criterionRef,
        ...content,
      }),
    )
    .digest("hex")
    .slice(0, 24);
  return `material_check_${plan.questionType}_${digest}`;
}

export function inlineCheckAnchorGuidance(plans: InlineCheckPlan[]): string {
  if (plans.length === 0) {
    return "Do not emit any inline_check_ref item for this lesson.";
  }
  return [
    "The server is compiling the following checks concurrently. Do not write their question content.",
    "Emit each item exactly once at the requested teaching position:",
    ...plans.map(
      (plan) =>
        `- {"kind":"inline_check_ref","slotRef":"${plan.slotRef}"} — ${plan.placementHint}`,
    ),
    "Never emit check content directly. Never invent, rename, duplicate, reorder, or combine slotRef values.",
  ].join("\n");
}

function placeholderDslLine(plan: InlineCheckPlan): string {
  return componentDslLine({
    type: "placeholder",
    reason: "inline check is being prepared",
    componentType: "check",
    description: `Regenerate the check for ${plan.primaryLearningTargetId} using criterion ${plan.criterionRef}.`,
    primaryLearningTargetId: plan.primaryLearningTargetId,
    targetCognitiveEntityId: plan.targetCognitiveEntityId,
    evidenceDimension: plan.evidenceDimension,
    criterionRef: plan.criterionRef,
    contextDistance: plan.contextDistance,
  });
}

const QREF_PATTERN = /^QREF\s*‖\s*([a-zA-Z0-9_-]+)\s*$/;

/** Replaces streamed QREF anchors and optionally appends compiled omitted checks. */
export function replaceInlineCheckReferenceLines(params: {
  text: string;
  plans: InlineCheckPlan[];
  compiledBySlot: ReadonlyMap<string, CompiledInlineCheck | null>;
  includeOmitted?: boolean;
}): string {
  const planBySlot = new Map(params.plans.map((plan) => [plan.slotRef, plan]));
  const seen = new Set<string>();
  const lines = params.text.split(/\r?\n/).flatMap((line) => {
    const matched = line.trim().match(QREF_PATTERN);
    if (!matched) return [line];
    const slotRef = matched[1]!;
    const plan = planBySlot.get(slotRef);
    if (!plan || seen.has(slotRef)) return [];
    seen.add(slotRef);
    const compiled = params.compiledBySlot.get(slotRef);
    return [compiled ? componentDslLine(compiled) : placeholderDslLine(plan)];
  });

  if (params.includeOmitted) {
    for (const plan of params.plans) {
      if (seen.has(plan.slotRef)) continue;
      const compiled = params.compiledBySlot.get(plan.slotRef);
      if (compiled) lines.push(componentDslLine(compiled));
    }
  }
  return lines.join("\n").trim();
}

export function compileInlineCheckContent(
  plan: InlineCheckPlan,
  content: {
    question: string;
    explanation: string;
    options?: string[];
    correctIndex?: number;
    correctIndices?: number[];
    correctAnswer?: boolean;
  },
): CompiledInlineCheck {
  const shared = {
    type: "check" as const,
    questionType: plan.questionType,
    checkId: stableCheckId(plan, content as Record<string, unknown>),
    question: content.question,
    explanation: content.explanation,
    primaryLearningTargetId: plan.primaryLearningTargetId,
    learningTargetIds: [plan.primaryLearningTargetId],
    targetCognitiveEntityId: plan.targetCognitiveEntityId,
    evidenceDimension: plan.evidenceDimension,
    criterionRef: plan.criterionRef,
    contextDistance: plan.contextDistance,
  };
  const candidate =
    plan.questionType === "mcq_multi"
      ? {
          ...shared,
          options: content.options,
          correctIndices: content.correctIndices,
        }
      : plan.questionType === "true_false"
        ? { ...shared, correctAnswer: content.correctAnswer }
        : {
            ...shared,
            options: content.options,
            correctIndex: content.correctIndex,
          };
  return interactiveBlockSchema.parse(candidate) as CompiledInlineCheck;
}

export type PrepareCourseMaterialInlineCheckArrayInput = {
  plans: readonly InlineCheckPlan[];
  unitTitle: string;
  language: string;
  context: string;
};

export type PreparedCourseMaterialInlineCheckArray = {
  operation: "unit.section_mini_test";
  prompt: string;
  questionCount: number;
  itemSchema: typeof generatedInlineCheckItemSchema;
  bindingItemSchema: typeof generatedInlineCheckItemBindingSchema;
  resultSchema: z.ZodType<
    z.infer<typeof generatedInlineCheckItemBindingSchema>[]
  >;
  parseProviderOutput(content: string): CompiledInlineCheck[];
};

function unwrapProviderJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

/**
 * Prepares the provider-independent section mini-test authoring contract.
 *
 * The topology supplies only transport. Question type/order and all evidence
 * authority fields are rebound from the server-owned plans before publication.
 */
export function prepareCourseMaterialInlineCheckArray(
  input: PrepareCourseMaterialInlineCheckArrayInput,
): PreparedCourseMaterialInlineCheckArray {
  const portable = prepareSectionMiniTestAuthoring(input);
  const resultSchema = z
    .array(generatedInlineCheckItemSchema)
    .length(input.plans.length)
    .superRefine((items, ctx) => {
      items.forEach((item, index) => {
        const expected = input.plans[index]?.questionType;
        if (expected && item.questionType !== expected) {
          ctx.addIssue({
            code: "custom",
            path: [index, "questionType"],
            message: `questionType must be ${expected}`,
          });
        }
      });
    });
  const promptInvocation = {
    mode: "array" as const,
    plans: input.plans,
    unitTitle: input.unitTitle,
    language: input.language,
    context: input.context,
  };
  return {
    operation: "unit.section_mini_test",
    prompt: portable.prompt,
    questionCount: input.plans.length,
    itemSchema: generatedInlineCheckItemSchema,
    bindingItemSchema: generatedInlineCheckItemBindingSchema,
    resultSchema,
    parseProviderOutput: (content: string) =>
      portable.parseProviderOutput(content) as CompiledInlineCheck[],
  };
}

/** Authors the complete test question array in one normal LLM request. */
export async function compileCourseMaterialInlineCheckArray(params: {
  plans: readonly InlineCheckPlan[];
  unitTitle: string;
  language: string;
  context: string;
  onPartialChecks?: (partial: {
    checks: CompiledInlineCheck[];
    completeQuestionCount: number;
    placeholderQuestionCount: number;
  }) => void | Promise<void>;
  signal?: AbortSignal;
  operation?: string;
  meta?: Record<string, unknown>;
}): Promise<CompiledInlineCheck[]> {
  if (params.plans.length === 0) return [];
  params.signal?.throwIfAborted();
  const prepared = prepareCourseMaterialInlineCheckArray(params);
  const resultSchema = prepared.resultSchema;
  const promptInvocation = {
    mode: "array" as const,
    plans: params.plans,
    unitTitle: params.unitTitle,
    language: params.language,
    context: params.context,
  };
  const items = await runValidatedStructuredGeneration<
    z.infer<typeof generatedInlineCheckItemBindingSchema>,
    {
      items: z.infer<typeof generatedInlineCheckItemBindingSchema>[];
      placeholders: number;
    },
    z.infer<typeof resultSchema>
  >(
    {
      mode: "item-array",
      operation: params.operation ?? "unit.learning_material.inline_check",
      prompt: prepared.prompt,
      itemSchema: prepared.itemSchema,
      bindingItemSchema: prepared.bindingItemSchema,
      resultSchema,
      assemble: (values) => values,
      assemblePartial: (items, placeholders) => ({ items, placeholders }),
      repairContext: `Required question count: ${params.plans.length}. Keep the fixed question types and order. Return only the missing or corrected question content.`,
      maxRepairAttempts: 1,
      meta: {
        ...params.meta,
        questionCount: params.plans.length,
        outputFormat: "structured_array",
      },
      contextSubject: {},
      contextQuery: params.unitTitle.slice(0, 2_000),
      contextInvocation: promptInvocation,
    },
    {
      signal: params.signal,
      onPartial: params.onPartialChecks
        ? async ({ items, placeholders }) => {
            const checks: CompiledInlineCheck[] = [];
            for (let index = 0; index < items.length; index += 1) {
              const plan = params.plans[index];
              const item = items[index];
              // A malformed earlier slot can make the runner's compact partial
              // array ambiguous. Publish only the validated contiguous prefix;
              // the positional repair/final result remains authoritative.
              if (!plan || !item || item.questionType !== plan.questionType)
                break;
              checks.push(compileInlineCheckContent(plan, item));
            }
            await params.onPartialChecks?.({
              checks,
              completeQuestionCount: checks.length,
              placeholderQuestionCount: Math.max(
                placeholders,
                params.plans.length - checks.length,
              ),
            });
          }
        : undefined,
    },
  );
  return items.map((item, index) =>
    compileInlineCheckContent(params.plans[index]!, item),
  );
}

/** Forced tool-call compiler. Only content comes from the model; evidence fields are injected. */
export async function compileCourseMaterialInlineCheck(params: {
  plan: InlineCheckPlan;
  unitTitle: string;
  language: string;
  context: string;
  /** Questions already used by sibling checks and forbidden for this retry. */
  avoidQuestions?: readonly string[];
  signal?: AbortSignal;
  operation?: string;
  meta?: Record<string, unknown>;
}): Promise<CompiledInlineCheck | null> {
  params.signal?.throwIfAborted();
  const schema =
    params.plan.questionType === "mcq_multi"
      ? generatedMcqMultiContentSchema
      : params.plan.questionType === "true_false"
        ? generatedTrueFalseContentSchema
        : generatedMcqContentSchema;
  const promptInvocation = {
    mode: "single" as const,
    plans: [params.plan],
    unitTitle: params.unitTitle,
    language: params.language,
    context: params.context,
    avoidQuestions: params.avoidQuestions,
  };
  const content = await runValidatedStructuredGeneration(
    {
      mode: "object",
      schema,
      prompt:
        buildMaterialComponentInvocationPrompt(
          MATERIAL_COMPONENT_VIEW_KEYS.inlineCheckInstructionContext,
          promptInvocation,
        ) ?? "",
      options: {
        operation: params.operation ?? "unit.learning_material.inline_check",
        bindingSchema: schema,
        meta: {
          ...params.meta,
          slotRef: params.plan.slotRef,
          questionType: params.plan.questionType,
          learningTargetId: params.plan.primaryLearningTargetId,
          outputFormat: "structured_object",
        },
      },
      contextSubject: {},
      contextQuery: params.unitTitle.slice(0, 2_000),
      contextInvocation: promptInvocation,
    },
    { signal: params.signal },
  );
  return compileInlineCheckContent(params.plan, content);
}
