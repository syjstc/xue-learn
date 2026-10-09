import { z } from "zod";
import { normalizeStreamQuizQuestion } from "../llm/normalize-quiz.js";
import {
  buildQuizGenerationPrompt,
  UNIT_QUIZ_BATCH_MAX,
  UNIT_QUIZ_BATCH_SIZE,
  type QuizDifficulty,
} from "../learning-systems/capabilities/assessment-runtime/quiz-prompt.js";

export type QuizQuestion =
  | {
      type: "mcq";
      question: string;
      options: string[];
      correctIndex: number;
      primaryLearningTargetId: string;
      learningTargetIds: string[];
      primaryCognitiveEntityId?: string;
      evidenceDimension: "memory" | "understanding";
      criterionRef: string;
      contextDistance: "same" | "near" | "far";
    }
  | {
      type: "mcq_multi";
      question: string;
      options: string[];
      correctIndices: number[];
      primaryLearningTargetId: string;
      learningTargetIds: string[];
      primaryCognitiveEntityId?: string;
      evidenceDimension: "memory" | "understanding";
      criterionRef: string;
      contextDistance: "same" | "near" | "far";
    }
  | {
      type: "true_false";
      question: string;
      correctAnswer: boolean;
      primaryLearningTargetId: string;
      learningTargetIds: string[];
      primaryCognitiveEntityId?: string;
      evidenceDimension: "memory" | "understanding";
      criterionRef: string;
      contextDistance: "same" | "near" | "far";
    };

export type UnitQuizBatchPlan = {
  batchSize: number;
  slots: Array<{
    slotIndex: number;
    questionType: "mcq" | "mcq_multi" | "true_false";
    primaryLearningTargetId: string;
    primaryCognitiveEntityId: string;
    evidenceDimension: "memory" | "understanding";
    criterionRef: string;
    contextDistance: "same" | "near" | "far";
    targetLabel?: string;
  }>;
};

export const portableQuizQuestionSchema: z.ZodType<QuizQuestion> =
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("mcq"),
      question: z.string(),
      options: z.array(z.string()).min(2).max(6),
      correctIndex: z.number(),
      primaryLearningTargetId: z.string().regex(/^lt_\d+$/),
      learningTargetIds: z.array(z.string().regex(/^lt_\d+$/)).min(1),
      primaryCognitiveEntityId: z.string().min(1).optional(),
      evidenceDimension: z.enum(["memory", "understanding"]),
      criterionRef: z.string().min(1),
      contextDistance: z.enum(["same", "near", "far"]),
    }),
    z.object({
      type: z.literal("mcq_multi"),
      question: z.string(),
      options: z.array(z.string()).min(3).max(6),
      correctIndices: z.array(z.number()).min(2),
      primaryLearningTargetId: z.string().regex(/^lt_\d+$/),
      learningTargetIds: z.array(z.string().regex(/^lt_\d+$/)).min(1),
      primaryCognitiveEntityId: z.string().min(1).optional(),
      evidenceDimension: z.enum(["memory", "understanding"]),
      criterionRef: z.string().min(1),
      contextDistance: z.enum(["same", "near", "far"]),
    }),
    z.object({
      type: z.literal("true_false"),
      question: z.string(),
      correctAnswer: z.boolean(),
      primaryLearningTargetId: z.string().regex(/^lt_\d+$/),
      learningTargetIds: z.array(z.string().regex(/^lt_\d+$/)).min(1),
      primaryCognitiveEntityId: z.string().min(1).optional(),
      evidenceDimension: z.enum(["memory", "understanding"]),
      criterionRef: z.string().min(1),
      contextDistance: z.enum(["same", "near", "far"]),
    }),
  ]);

const quizJitItemSchema = z.preprocess(
  normalizeStreamQuizQuestion,
  portableQuizQuestionSchema,
);
const quizJitItemBindingSchema = portableQuizQuestionSchema;

export type UnitQuizAuthoringResult = {
  questions: QuizQuestion[];
  interleaved: QuizQuestion[];
};

export type PrepareUnitQuizAuthoringInput = {
  unitTitle: string;
  materialJson: string;
  languageBlock: string;
  styleBlock?: string;
  optionsBlock?: string;
  topicCategory?: unknown;
  goalTitle?: string;
  difficulty?: QuizDifficulty;
  learningTargetsBlock?: string;
  standaloneMicro?: boolean;
  batchPlan?: UnitQuizBatchPlan;
  decoratePrompt?: (prompt: string) => string;
  alignQuestions?: (questions: QuizQuestion[]) => QuizQuestion[];
  validateQuiz?: (quiz: UnitQuizAuthoringResult) => void;
};

export type PreparedUnitQuizAuthoring = {
  operation: "unit.quiz";
  questionCount: number;
  prompt: string;
  contextInvocation: Record<string, unknown>;
  itemSchema: typeof quizJitItemSchema;
  bindingItemSchema: typeof quizJitItemBindingSchema;
  resultSchema: z.ZodType<UnitQuizAuthoringResult>;
  alignQuestions: (questions: QuizQuestion[]) => QuizQuestion[];
  parseProviderOutput: (content: string) => UnitQuizAuthoringResult;
};

function allocatedQuestionCount(
  learningTargetsBlock?: string,
): number | undefined {
  return learningTargetsBlock
    ?.match(/Summative questions:\s*\d+/gi)
    ?.reduce((sum, line) => sum + Number(line.match(/\d+/)?.[0] ?? 0), 0);
}

function unwrapJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

function formatValidationError(error: unknown): string {
  return error instanceof z.ZodError
    ? error.issues
        .map(
          (issue) =>
            `${issue.path.length ? issue.path.join(".") : "response"}: ${issue.message}`,
        )
        .join("; ")
    : error instanceof Error
      ? error.message
      : String(error);
}

function applyBatchSlots(
  questions: QuizQuestion[],
  plan: UnitQuizBatchPlan,
): QuizQuestion[] {
  if (plan.slots.length === 0) return questions;
  return questions.map((generated, index) => {
    const slot = plan.slots[index];
    if (!slot) return generated;
    const base = {
      question: generated.question,
      primaryLearningTargetId: slot.primaryLearningTargetId,
      learningTargetIds: [slot.primaryLearningTargetId],
      primaryCognitiveEntityId: slot.primaryCognitiveEntityId,
      evidenceDimension: slot.evidenceDimension,
      criterionRef: slot.criterionRef,
      contextDistance: slot.contextDistance,
    };
    if (slot.questionType === "true_false") {
      return {
        ...base,
        type: "true_false",
        correctAnswer:
          generated.type === "true_false" ? generated.correctAnswer : false,
      };
    }
    const options =
      "options" in generated && generated.options.length >= 3
        ? generated.options
        : ["选项 A", "选项 B", "选项 C"];
    if (slot.questionType === "mcq_multi") {
      return {
        ...base,
        type: "mcq_multi",
        options,
        correctIndices:
          generated.type === "mcq_multi" && generated.correctIndices.length >= 2
            ? generated.correctIndices
            : [0, 1],
      };
    }
    return {
      ...base,
      type: "mcq",
      options,
      correctIndex: generated.type === "mcq" ? generated.correctIndex : 0,
    };
  });
}

/**
 * Prepare the provider-independent active-recall authoring contract.
 *
 * Both hosted and desktop-local use this exact prompt, compatibility
 * normalization, server-owned batch-slot binding, and authoritative final
 * schema. A topology supplies only its provider transport and optional
 * published-target alignment/validation.
 */
export function prepareUnitQuizAuthoring(
  input: PrepareUnitQuizAuthoringInput,
): PreparedUnitQuizAuthoring {
  const questionCount = input.batchPlan?.batchSize
    ? input.batchPlan.batchSize
    : Math.max(
        1,
        Math.min(
          UNIT_QUIZ_BATCH_MAX,
          allocatedQuestionCount(input.learningTargetsBlock) ??
            UNIT_QUIZ_BATCH_SIZE,
        ),
      );
  const promptOptions = {
    lang: input.languageBlock,
    style: input.styleBlock,
    options: input.optionsBlock,
    difficulty: input.difficulty,
    learningTargetsBlock: input.learningTargetsBlock,
    questionCount,
    standaloneMicro: input.standaloneMicro,
    batchSlots: input.batchPlan?.slots,
  };
  const contextInvocation = {
    unitTitle: input.unitTitle,
    materialJson: input.materialJson,
    promptOptions,
    topicCategory: input.topicCategory,
    goalTitle: input.goalTitle,
  };
  const basePrompt = buildQuizGenerationPrompt(
    input.unitTitle,
    input.materialJson,
    promptOptions,
  );
  const prompt = input.decoratePrompt?.(basePrompt) ?? basePrompt;
  const finalSchema = z.object({
    questions: z.array(portableQuizQuestionSchema).length(questionCount),
    interleaved: z.array(portableQuizQuestionSchema).max(0).default([]),
  });
  const alignQuestions = (questions: QuizQuestion[]) => {
    const slotted = input.batchPlan
      ? applyBatchSlots(questions, input.batchPlan)
      : questions;
    return input.alignQuestions?.(slotted) ?? slotted;
  };
  const resultSchema = z
    .array(quizJitItemSchema)
    .length(questionCount)
    .transform((questions) => alignQuestions(questions))
    .superRefine((questions, context) => {
      try {
        const quiz = finalSchema.parse({ questions, interleaved: [] });
        input.validateQuiz?.(quiz);
      } catch (error) {
        context.addIssue({
          code: "custom",
          message: formatValidationError(error),
        });
      }
    })
    .transform((questions) =>
      finalSchema.parse({ questions, interleaved: [] }),
    );

  return {
    operation: "unit.quiz",
    questionCount,
    prompt,
    contextInvocation,
    itemSchema: quizJitItemSchema,
    bindingItemSchema: quizJitItemBindingSchema,
    resultSchema,
    alignQuestions,
    parseProviderOutput: (content) => resultSchema.parse(unwrapJson(content)),
  };
}
