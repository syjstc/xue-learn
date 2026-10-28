import { normalizeChoiceLabels } from "../goal-creation/subagents/intake/discovery-questions.js";
import { normalizeCommitDerivationStepArgs } from "../../learning-systems/capabilities/formal-derivation/normalize-commit-args.js";
import { normalizeCommitStepArgs } from "../../../../teaching-derivation/src/index.js";

function normalizeQuestionId(value: string, index: number): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\u4e00-\u9fff]+/giu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return normalized || `question_${index + 1}`;
}

function normalizeAnswerKind(value: unknown, hasChoices: boolean): string {
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (["multi_choice", "multiple", "multi", "checkbox"].includes(lower)) {
      return "multi_choice";
    }
    if (["single_choice", "single", "choice", "radio"].includes(lower)) {
      return "single_choice";
    }
    if (lower === "text" && !hasChoices) {
      return "text";
    }
  }
  return hasChoices ? "single_choice" : "text";
}

function normalizeDiscoveryQuestionArgs(
  questions: unknown,
): Record<string, unknown>[] {
  if (!Array.isArray(questions)) return [];
  const normalized: Record<string, unknown>[] = [];
  questions.forEach((value, index) => {
    if (!value || typeof value !== "object") return;
    const question = value as Record<string, unknown>;
    const text = String(
      question.text ?? question.question ?? question.title ?? "",
    ).trim();
    if (!text) return;
    const choices = normalizeChoiceLabels(question.choices);
    const id =
      typeof question.id === "string" && question.id.trim()
        ? question.id.trim()
        : normalizeQuestionId(text, index);
    normalized.push({
      ...question,
      id,
      text,
      answerKind: normalizeAnswerKind(question.answerKind, choices.length >= 2),
      ...(choices.length > 0 ? { choices } : {}),
    });
  });
  return normalized;
}

export function normalizeToolArgsBeforeValidation(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (
    toolName === "draw_math_scene" &&
    args.scene &&
    typeof args.scene === "object" &&
    !Array.isArray(args.scene)
  ) {
    // Some providers wrap a tool's sole structured argument in the semantic
    // name shown by the UI payload. The executable tool contract is the scene
    // itself, so unwrap this harmless transport drift before validation.
    return args.scene as Record<string, unknown>;
  }
  if (toolName === "ask_clarification") {
    return { ...args, choices: normalizeChoiceLabels(args.choices) };
  }
  if (toolName === "ask_discovery_questions") {
    return {
      ...args,
      questions: normalizeDiscoveryQuestionArgs(args.questions),
    };
  }
  if (toolName === "commit_derivation_step") {
    return normalizeCommitDerivationStepArgs(args);
  }
  if (toolName === "commit_teaching_step") {
    return normalizeCommitStepArgs(args);
  }
  return args;
}
