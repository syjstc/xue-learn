import { z } from "zod";
import type { DiscoveryAnswer, DiscoveryQuestion } from "../../state.js";

/** LLMs sometimes emit { label, value } objects instead of plain strings. */
export function coerceChoiceLabel(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["label", "text", "value", "title", "choice"]) {
      if (typeof obj[key] === "string") {
        const trimmed = obj[key].trim();
        if (trimmed.length > 0) return trimmed;
      }
    }
  }
  return undefined;
}

function normalizeDiscoveryQuestionPayload(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const question = { ...(value as Record<string, unknown>) };
  if (Array.isArray(question.choices)) {
    question.choices = question.choices
      .map(coerceChoiceLabel)
      .filter((choice): choice is string => typeof choice === "string");
  }
  return question;
}

/** JSON-schema-safe schema for LangChain tool binding (no preprocess). */
export const discoveryQuestionToolSchema = z
  .object({
    id: z.string().describe("唯一标识，如 focus_areas"),
    text: z.string().describe("向用户展示的问题"),
    hint: z
      .string()
      .optional()
      .describe("自定义输入时的占位提示，不要写「可多选」等操作说明"),
    answerKind: z
      .enum(["text", "single_choice", "multi_choice"])
      .describe(
        "single_choice：互斥选项（水平、时间、单一目标）；multi_choice：用户可同时选多个方面/技能/侧重点（如学习重点、想覆盖的能力）",
      ),
    choices: z
      .array(z.string().min(1))
      .min(2)
      .max(7)
      .optional()
      .describe(
        "2-6 个真实可点击选项；不要加入「其他，自己输入」，自定义回答由界面输入框收集",
      ),
  })
  .superRefine((question, ctx) => {
    question.choices?.forEach((choice, index) => {
      if (choice.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["choices", index],
          message: "choices must be real non-empty option labels",
        });
      }
    });
    if (
      question.answerKind !== "text" &&
      (!question.choices || question.choices.length < 2)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["choices"],
        message:
          "single_choice and multi_choice questions must include 2-6 real choices",
      });
    }
  });

export const discoveryQuestionSchema = z.preprocess(
  normalizeDiscoveryQuestionPayload,
  discoveryQuestionToolSchema,
);

export function normalizeChoiceLabels(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map(coerceChoiceLabel)
    .filter((choice): choice is string => typeof choice === "string");
}

export function parseDiscoveryQuestions(
  questions: unknown,
): z.infer<typeof discoveryQuestionToolSchema>[] {
  if (!Array.isArray(questions)) return [];
  return questions.map((question) => discoveryQuestionSchema.parse(question));
}

export function normalizeDiscoveryQuestions(
  questions: z.infer<typeof discoveryQuestionToolSchema>[],
): DiscoveryQuestion[] {
  return questions.map((question) => {
    const choices = question.choices
      ?.map((choice) => choice.trim())
      .filter((choice) => choice.length > 0);
    if (!choices || choices.length < 2) {
      return {
        ...question,
        answerKind: "single_choice" as const,
        choices: ["不确定", "你看着办"],
      };
    }
    const visibleChoices = choices.filter(
      (choice) =>
        !/^(?:其他|其它|自定义|自己输入)(?:$|[\s,，、:：(/（])/u.test(choice),
    );
    if (visibleChoices.length < 2) {
      return {
        ...question,
        answerKind: "single_choice" as const,
        choices: ["不确定", "你看着办"],
      };
    }
    return {
      ...question,
      answerKind:
        question.answerKind === "multi_choice"
          ? ("multi_choice" as const)
          : ("single_choice" as const),
      choices: visibleChoices,
    };
  });
}

function normalizedQuestionText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase("und");
}

/** Keep all discovery questions so later batches can be checked for repeats. */
export function mergeDiscoveryQuestionHistory(
  existing: DiscoveryQuestion[],
  incoming: DiscoveryQuestion[],
): DiscoveryQuestion[] {
  const ids = new Set(existing.map((question) => question.id));
  const texts = new Set(
    existing.map((question) => normalizedQuestionText(question.text)),
  );
  const merged = [...existing];
  for (const question of incoming) {
    const text = normalizedQuestionText(question.text);
    if (ids.has(question.id) || texts.has(text)) continue;
    merged.push(question);
    ids.add(question.id);
    texts.add(text);
  }
  return merged;
}

/** Return the first question that repeats an earlier question or this batch. */
export function findRepeatedDiscoveryQuestion(
  existing: DiscoveryQuestion[],
  incoming: DiscoveryQuestion[],
): DiscoveryQuestion | undefined {
  const ids = new Set(existing.map((question) => question.id));
  const texts = new Set(
    existing.map((question) => normalizedQuestionText(question.text)),
  );
  for (const question of incoming) {
    const text = normalizedQuestionText(question.text);
    if (ids.has(question.id) || texts.has(text)) return question;
    ids.add(question.id);
    texts.add(text);
  }
  return undefined;
}

/** Merge answers by question id without dropping earlier discovery answers. */
export function mergeDiscoveryAnswerHistory(
  existing: DiscoveryAnswer[],
  incoming: DiscoveryAnswer[],
): DiscoveryAnswer[] {
  const byQuestion = new Map(
    existing.map((answer) => [answer.questionId, answer]),
  );
  for (const answer of incoming) byQuestion.set(answer.questionId, answer);
  return [...byQuestion.values()];
}

export function mergeDiscoveryAnswersIntoGenerationOptions(
  state: {
    generationOptions: string;
    discoveryQuestions: DiscoveryQuestion[];
  },
  answers: Array<{ questionId: string; answer: string | string[] }>,
): string {
  return [
    state.generationOptions,
    ...answers.map((entry) => {
      const question = state.discoveryQuestions.find(
        (item) => item.id === entry.questionId,
      );
      const label = question?.text ?? entry.questionId;
      const value = Array.isArray(entry.answer)
        ? entry.answer.join("、")
        : entry.answer;
      return `${label}: ${value}`;
    }),
  ]
    .filter(Boolean)
    .join("\n");
}
