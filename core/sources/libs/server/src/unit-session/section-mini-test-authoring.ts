import { GOAL_DIRECTED_TEACHING_POLICY } from "../goal-creation/teaching-policy.js";
import { createHash } from "node:crypto";
import { z } from "zod";

export type SectionMiniTestQuestionType = "mcq" | "mcq_multi" | "true_false";
export type SectionMiniTestEvidenceDimension = "memory" | "understanding";

export type SectionMiniTestAuthorityBinding = {
  learningTargetId: string;
  targetCognitiveEntityId: string;
  evidenceDimension: SectionMiniTestEvidenceDimension;
  criterionRef: string;
  assessmentCriterion?: string;
};

export type SectionMiniTestPlan = {
  slotRef: string;
  questionType: SectionMiniTestQuestionType;
  primaryLearningTargetId: string;
  targetCognitiveEntityId: string;
  evidenceDimension: SectionMiniTestEvidenceDimension;
  criterionRef: string;
  contextDistance: "same";
  targetLabel: string;
  targetExplanation?: string;
  learningObjective?: string;
  assessmentCriterion: string;
  placementHint: string;
  judgmentAngleHint?: string;
};

export type SectionMiniTestCheck =
  | {
      type: "check";
      questionType: "mcq";
      checkId: string;
      question: string;
      explanation: string;
      options: string[];
      correctIndex: number;
      primaryLearningTargetId: string;
      learningTargetIds: string[];
      targetCognitiveEntityId: string;
      evidenceDimension: SectionMiniTestEvidenceDimension;
      criterionRef: string;
      contextDistance: "same";
    }
  | {
      type: "check";
      questionType: "mcq_multi";
      checkId: string;
      question: string;
      explanation: string;
      options: string[];
      correctIndices: number[];
      primaryLearningTargetId: string;
      learningTargetIds: string[];
      targetCognitiveEntityId: string;
      evidenceDimension: SectionMiniTestEvidenceDimension;
      criterionRef: string;
      contextDistance: "same";
    }
  | {
      type: "check";
      questionType: "true_false";
      checkId: string;
      question: string;
      explanation: string;
      correctAnswer: boolean;
      primaryLearningTargetId: string;
      learningTargetIds: string[];
      targetCognitiveEntityId: string;
      evidenceDimension: SectionMiniTestEvidenceDimension;
      criterionRef: string;
      contextDistance: "same";
    };

const sqTargetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  explanation: z.string().optional(),
  learningObjective: z.string().optional(),
  assessmentCriteria: z.array(z.string()).optional(),
  cognitiveEntityIds: z.array(z.string()).optional(),
  targetCognitiveLevel: z.string().optional(),
  importance: z.string().optional(),
  importanceWeight: z.number().optional(),
  difficulty: z.string().optional(),
});

const sqSchema = z
  .object({ learningTargets: z.array(sqTargetSchema) })
  .passthrough();

type SqTarget = z.infer<typeof sqTargetSchema>;
type AssessableSlot = {
  target: SqTarget;
  targetIndex: number;
  entityId: string;
  dimension: SectionMiniTestEvidenceDimension;
  criterionRef: string;
  assessmentCriterion: string;
};

function parseSq(value: string) {
  try {
    const first = JSON.parse(value) as unknown;
    return sqSchema.safeParse(
      typeof first === "string" ? JSON.parse(first) : first,
    );
  } catch {
    return sqSchema.safeParse(null);
  }
}

function targetPriority(target: SqTarget, index: number): number[] {
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

function comparePriority(left: number[], right: number[]) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function questionTypes(
  count: number,
  sectionOrderIndex: number,
): SectionMiniTestQuestionType[] {
  if (count <= 0) return [];
  if (count === 1) return ["mcq"];
  if (count === 2)
    return ["mcq", sectionOrderIndex % 2 === 0 ? "mcq_multi" : "true_false"];
  return ["mcq", "mcq_multi", "true_false"];
}

const INITIAL_ANGLES: Record<SectionMiniTestQuestionType, string> = {
  mcq: "Ask a single-answer multiple-choice question that tests one precise idea.",
  mcq_multi:
    "Ask a select-all-that-apply question with at least two correct options.",
  true_false:
    "Ask the learner to judge one declarative statement as true or false.",
};

const REPEAT_ANGLES: Record<SectionMiniTestQuestionType, string[]> = {
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

export function planSectionMiniTest(input: {
  sqJson: string;
  authorityBindings?: readonly SectionMiniTestAuthorityBinding[];
  sectionOrderIndex?: number;
}): SectionMiniTestPlan[] {
  const parsed = parseSq(input.sqJson);
  if (!parsed.success) return [];
  const bindingsByTarget = new Map<string, SectionMiniTestAuthorityBinding[]>();
  for (const binding of input.authorityBindings ?? []) {
    const key = binding.learningTargetId.toLowerCase();
    bindingsByTarget.set(key, [...(bindingsByTarget.get(key) ?? []), binding]);
  }
  const slots: AssessableSlot[] = [];
  parsed.data.learningTargets.forEach((target, targetIndex) => {
    const bindings = bindingsByTarget.get(target.id.toLowerCase()) ?? [];
    if (bindings.length > 0) {
      for (const binding of bindings) {
        if (!binding.targetCognitiveEntityId || !binding.criterionRef) continue;
        slots.push({
          target,
          targetIndex,
          entityId: binding.targetCognitiveEntityId,
          dimension: binding.evidenceDimension,
          criterionRef: binding.criterionRef,
          assessmentCriterion:
            binding.assessmentCriterion ?? target.assessmentCriteria?.[0] ?? "",
        });
      }
      return;
    }
    if (input.authorityBindings !== undefined) return;
    const entityId = target.cognitiveEntityIds?.[0];
    const criterion = target.assessmentCriteria?.[0];
    if (!entityId || !criterion) return;
    slots.push({
      target,
      targetIndex,
      entityId,
      dimension:
        target.targetCognitiveLevel === "remember" ? "memory" : "understanding",
      criterionRef: `${target.id}:c1`,
      assessmentCriterion: criterion,
    });
  });
  slots.sort((left, right) =>
    comparePriority(
      targetPriority(left.target, left.targetIndex),
      targetPriority(right.target, right.targetIndex),
    ),
  );
  const targetCount = new Set(slots.map((slot) => slot.target.id.toLowerCase()))
    .size;
  const count =
    targetCount <= 0 ? 0 : targetCount >= 2 || slots.length >= 2 ? 3 : 2;
  if (count === 0) return [];
  const selected: AssessableSlot[] = [];
  const seen = new Set<string>();
  for (const slot of slots) {
    const key = `${slot.target.id.toLowerCase()}::${slot.entityId}::${slot.dimension}`;
    if (!seen.has(key)) {
      seen.add(key);
      selected.push(slot);
    }
    if (selected.length >= count) break;
  }
  for (let cursor = 0; selected.length < count; cursor += 1)
    selected.push(slots[cursor % slots.length]!);
  const types = questionTypes(count, input.sectionOrderIndex ?? 0);
  const reuse = new Map<string, number>();
  return selected.map((slot, index) => {
    const key = slot.target.id.toLowerCase();
    const reuseIndex = reuse.get(key) ?? 0;
    reuse.set(key, reuseIndex + 1);
    const questionType = types[index] ?? "mcq";
    return {
      slotRef: `check_${index + 1}`,
      questionType,
      primaryLearningTargetId: slot.target.id,
      targetCognitiveEntityId: slot.entityId,
      evidenceDimension: slot.dimension,
      criterionRef: slot.criterionRef,
      contextDistance: "same",
      targetLabel: slot.target.label,
      ...(slot.target.explanation
        ? { targetExplanation: slot.target.explanation }
        : {}),
      ...(slot.target.learningObjective
        ? { learningObjective: slot.target.learningObjective }
        : {}),
      assessmentCriterion: slot.assessmentCriterion,
      placementHint: `Place after the lesson has explicitly taught “${slot.target.label}” and before moving to a different target.`,
      judgmentAngleHint:
        reuseIndex === 0
          ? INITIAL_ANGLES[questionType]
          : REPEAT_ANGLES[questionType][
              (reuseIndex - 1) % REPEAT_ANGLES[questionType].length
            ],
    };
  });
}

const providerItemSchema = z
  .object({
    questionType: z.enum(["mcq", "mcq_multi", "true_false"]),
    question: z.string().min(1),
    options: z.array(z.string().min(1)).optional(),
    correctIndex: z.number().int().min(0).optional(),
    correctIndices: z.array(z.number().int().min(0)).optional(),
    correctAnswer: z.boolean().optional(),
    explanation: z.string().min(1),
  })
  .superRefine((value, context) => {
    if (value.questionType === "true_false") {
      if (typeof value.correctAnswer !== "boolean")
        context.addIssue({
          code: "custom",
          path: ["correctAnswer"],
          message: "correctAnswer is required",
        });
      return;
    }
    const minimum = value.questionType === "mcq_multi" ? 3 : 2;
    if (
      !value.options ||
      value.options.length < minimum ||
      value.options.length > 6
    )
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: `${minimum}-6 options are required`,
      });
    if (value.questionType === "mcq_multi") {
      if (!value.correctIndices || value.correctIndices.length < 2)
        context.addIssue({
          code: "custom",
          path: ["correctIndices"],
          message: "at least two correctIndices are required",
        });
    } else if (!Number.isInteger(value.correctIndex))
      context.addIssue({
        code: "custom",
        path: ["correctIndex"],
        message: "correctIndex is required",
      });
  });

function buildPrompt(input: {
  plans: readonly SectionMiniTestPlan[];
  unitTitle: string;
  language: string;
  context: string;
}) {
  return `${GOAL_DIRECTED_TEACHING_POLICY}
Only assess concepts and solution methods established in the supplied actual teaching content or explicitly confirmed prior knowledge. A future catalog entry is not an assessment prerequisite.

Create exactly ${input.plans.length} short test questions in one response.
Return one root JSON array in the fixed order below. Each item must contain questionType, question, explanation, and the answer fields required by that questionType:
- mcq: options (2-6 distinct choices) and correctIndex. Exactly one correct answer. Never say “select all that apply”.
- mcq_multi: options (3-6 distinct choices) and correctIndices (at least two). The stem may say select-all-that-apply.
- true_false: correctAnswer

Do not add learning-target ids or evidence metadata. Do not repeat or closely paraphrase another item in the array.
Unit: ${input.unitTitle}
Use ${input.language}.
Every question must use only content explicitly taught in the lesson context.

Fixed question slots:
${input.plans
  .map(
    (plan, index) => `${index + 1}. questionType=${plan.questionType}
   Published learning target: ${plan.targetLabel}
   Target explanation: ${plan.targetExplanation ?? ""}
   Learning objective: ${plan.learningObjective ?? ""}
   Assessment criterion: ${plan.assessmentCriterion}
   Evidence dimension: ${plan.evidenceDimension}
   Judgment angle: ${plan.judgmentAngleHint ?? ""}`,
  )
  .join("\n")}

Lesson context:
${input.context}`;
}

function stableId(plan: SectionMiniTestPlan, content: Record<string, unknown>) {
  return `material_check_${plan.questionType}_${createHash("sha256")
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
    .slice(0, 24)}`;
}

function compile(
  plan: SectionMiniTestPlan,
  item: z.infer<typeof providerItemSchema>,
): SectionMiniTestCheck {
  const shared = {
    type: "check" as const,
    checkId: stableId(plan, item),
    question: item.question,
    explanation: item.explanation,
    primaryLearningTargetId: plan.primaryLearningTargetId,
    learningTargetIds: [plan.primaryLearningTargetId],
    targetCognitiveEntityId: plan.targetCognitiveEntityId,
    evidenceDimension: plan.evidenceDimension,
    criterionRef: plan.criterionRef,
    contextDistance: "same" as const,
  };
  if (plan.questionType === "true_false")
    return {
      ...shared,
      questionType: "true_false",
      correctAnswer: item.correctAnswer!,
    };
  if (plan.questionType === "mcq_multi")
    return {
      ...shared,
      questionType: "mcq_multi",
      options: item.options!,
      correctIndices: item.correctIndices!,
    };
  return {
    ...shared,
    questionType: "mcq",
    options: item.options!,
    correctIndex: item.correctIndex!,
  };
}

export function prepareSectionMiniTestAuthoring(input: {
  plans: readonly SectionMiniTestPlan[];
  unitTitle: string;
  language: string;
  context: string;
}) {
  const resultSchema = z
    .array(providerItemSchema)
    .length(input.plans.length)
    .superRefine((items, context) => {
      items.forEach((item, index) => {
        const expected = input.plans[index]?.questionType;
        if (expected && item.questionType !== expected)
          context.addIssue({
            code: "custom",
            path: [index, "questionType"],
            message: `questionType must be ${expected}`,
          });
      });
    });
  return {
    operation: "unit.section_mini_test" as const,
    questionCount: input.plans.length,
    prompt: buildPrompt(input),
    parseProviderOutput(content: string): SectionMiniTestCheck[] {
      const trimmed = content.trim();
      const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      const items = resultSchema.parse(JSON.parse(fenced?.[1] ?? trimmed));
      return items.map((item, index) => compile(input.plans[index]!, item));
    },
  };
}
