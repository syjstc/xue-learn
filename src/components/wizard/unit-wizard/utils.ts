import { STREAM_ACTION_CONTEXT, OPERATION_CONTEXT } from "./constants.ts";
import type {
  ContextGenState,
  GenStreamContext,
  QuizAnswerValue,
  QuizExplainItemState,
  RecallProgress,
  StructuredSubStep,
  StructuredTab,
} from "./types.ts";

export function genContextFromOperation(
  operation: string,
): GenStreamContext | null {
  const mapped = OPERATION_CONTEXT[operation];
  if (mapped) return mapped;
  const action = operation.startsWith("unit.") ? operation.slice(5) : operation;
  return STREAM_ACTION_CONTEXT[action] ?? null;
}

export function emptyContextGenState(): ContextGenState {
  return {
    status: "",
    preview: "",
    progress: null,
    placeholderBlockCount: 0,
    materialContentReady: false,
    partialCount: 0,
  };
}

export function unitOperationForAction(action: string): string {
  return `unit.${action}`;
}

export function structuredSubStepToTab(sub: StructuredSubStep): StructuredTab {
  if (sub === "material" || sub === "theater") return "material";
  if (sub === "questions") return "questions";
  if (sub === "cornell" || sub === "done") return "notes";
  return "sq";
}

export function normalizeSelectedIndices(
  value: QuizAnswerValue | undefined,
): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number");
}

export function parseRecallProgress(value: unknown): RecallProgress | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.completedBatches !== "number" ||
    typeof candidate.totalAnswers !== "number"
  ) {
    return null;
  }
  if (
    candidate.recommendation !== "continue_now" &&
    candidate.recommendation !== "review_later"
  ) {
    return null;
  }
  return candidate as RecallProgress;
}

export function quizExplainStateFromExplanations(
  explanations?: Record<number, string>,
): Record<number, QuizExplainItemState> {
  if (!explanations) return {};
  return Object.fromEntries(
    Object.entries(explanations).map(([key, text]) => [
      Number(key),
      { text, loading: false },
    ]),
  );
}
