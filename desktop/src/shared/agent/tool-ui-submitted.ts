import type { AgentClientActionButton } from "./client-actions.ts";

/**
 * Discovery / clarification questions are shown only in the tool card
 * (assistant prose must not repeat them). Keep the card after the user
 * answers so the original question stays in the chat history.
 *
 * Space organization previews are one-time approval surfaces and disappear
 * after submission; the assistant posts a fresh result message instead.
 */
export function shouldRetainSubmittedToolUi(uiKind: string): boolean {
  return (
    uiKind === "discovery_questions" ||
    uiKind === "knowledge_activity" ||
    uiKind === "math_scene" ||
    uiKind === "goal_space_suggestion"
  );
}

export function discoveryAnswersFromSubmitted(
  submitted?: Record<string, unknown>,
): Record<string, string | string[]> | undefined {
  const answers = submitted?.answers;
  if (!Array.isArray(answers)) return undefined;

  const record: Record<string, string | string[]> = {};
  for (const item of answers) {
    if (!item || typeof item !== "object") continue;
    const entry = item as { questionId?: string; answer?: string | string[] };
    if (!entry.questionId) continue;
    record[entry.questionId] = entry.answer ?? "";
  }
  return Object.keys(record).length > 0 ? record : undefined;
}

export function discoveryQuestionsWereSkipped(
  submitted?: Record<string, unknown>,
): boolean {
  return submitted?.skipped === true;
}

export function isActionButtonSelected(
  action: AgentClientActionButton,
  submitted?: Record<string, unknown>,
): boolean {
  if (!submitted) return false;
  const label = action.label ?? "";
  if (typeof submitted.action === "string" && submitted.action === label) {
    return true;
  }
  if (submitted.value !== undefined && action.value !== undefined) {
    return JSON.stringify(submitted.value) === JSON.stringify(action.value);
  }
  return false;
}

export function textInputAnswerFromSubmitted(
  submitted?: Record<string, unknown>,
): string | undefined {
  const answer = String(
    submitted?.answer ?? submitted?.userResponse ?? "",
  ).trim();
  return answer || undefined;
}
