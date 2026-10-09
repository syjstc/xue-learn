import { UNIT_QUIZ_BATCH_MIN } from "../learning-systems/capabilities/assessment-runtime/quiz-prompt.js";

const QUIZ_COMPACT_KEYS: Record<string, string> = {
  qs: "questions",
  il: "interleaved",
  t: "type",
  q: "question",
  opt: "options",
  ci: "correctIndex",
  cis: "correctIndices",
  lti: "learningTargetIds",
  pti: "primaryLearningTargetId",
  pce: "primaryCognitiveEntityId",
  ed: "evidenceDimension",
  cr: "criterionRef",
  cd: "contextDistance",
};

function expandQuizCompact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expandQuizCompact);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [
      QUIZ_COMPACT_KEYS[key] ?? key,
      expandQuizCompact(child),
    ]),
  );
}

/** Minimum count for the main `questions` array after normalization. */
export const MIN_QUIZ_QUESTIONS = UNIT_QUIZ_BATCH_MIN;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    const record = asRecord(item);
    const text = record?.text ?? record?.label ?? record?.value;
    return typeof text === "string" ? [text] : [];
  });
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "number" ? item : Number(item)))
    .filter((item) => Number.isFinite(item));
}

function isStandaloneIntegerOption(option: string): boolean {
  return /^\d+$/.test(option.trim());
}

function hasOptionLabel(option: string): boolean {
  return /^[A-Z][.)、．]\s*/i.test(option.trim());
}

function normalizeOptions(options: string[]): {
  options: string[];
} {
  const trimmed = options
    .map((option) => option.trim())
    .filter((option) => option.length > 0);
  const textOptionCount = trimmed.filter(
    (option) => !isStandaloneIntegerOption(option),
  ).length;
  const hasLabeledTextOptions = trimmed.some(
    (option) => !isStandaloneIntegerOption(option) && hasOptionLabel(option),
  );
  const shouldDropNumberArtifacts =
    textOptionCount >= 2 && (trimmed.length > 3 || hasLabeledTextOptions);
  const cleaned: string[] = [];

  trimmed.forEach((option) => {
    if (shouldDropNumberArtifacts && isStandaloneIntegerOption(option)) {
      return;
    }
    cleaned.push(option);
  });

  return { options: cleaned };
}

function normalizeQuestionType(
  raw: unknown,
): "mcq" | "mcq_multi" | "true_false" | null {
  if (raw === "mcq" || raw === "multiple_choice" || raw === "single")
    return "mcq";
  if (
    raw === "mcq_multi" ||
    raw === "multiple" ||
    raw === "multi" ||
    raw === "select_all"
  ) {
    return "mcq_multi";
  }
  if (
    raw === "true_false" ||
    raw === "true-false" ||
    raw === "boolean" ||
    raw === "tf"
  ) {
    return "true_false";
  }
  return null;
}

function normalizeLearningTargetIds(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;]/)
      : [];
  const ids = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^lt_\d+$/.test(item));
  return [...new Set(ids)];
}

function normalizeQuestionItem(item: unknown): Record<string, unknown> | null {
  const q = asRecord(item);
  if (!q) return null;

  const type = normalizeQuestionType(q.type);
  const question =
    typeof q.question === "string"
      ? q.question.trim()
      : typeof q.prompt === "string"
        ? q.prompt.trim()
        : typeof q.stem === "string"
          ? q.stem.trim()
          : "";
  if (!type || !question) return null;

  const learningTargetIds = normalizeLearningTargetIds(q.learningTargetIds);
  const requestedPrimary =
    typeof q.primaryLearningTargetId === "string"
      ? q.primaryLearningTargetId.trim().toLowerCase()
      : typeof q.primary_learning_target_id === "string"
        ? q.primary_learning_target_id.trim().toLowerCase()
        : "";
  const primaryLearningTargetId =
    /^lt_\d+$/.test(requestedPrimary) &&
    learningTargetIds.includes(requestedPrimary)
      ? requestedPrimary
      : "";
  const primaryCognitiveEntityId =
    typeof q.primaryCognitiveEntityId === "string"
      ? q.primaryCognitiveEntityId.trim()
      : typeof q.primary_cognitive_entity_id === "string"
        ? q.primary_cognitive_entity_id.trim()
        : "";
  const evidenceDimension =
    q.evidenceDimension === "memory"
      ? "memory"
      : q.evidenceDimension === "understanding" ||
          q.evidenceDimension === "application" ||
          q.evidenceDimension === "transfer"
        ? // A selected response can only support understanding at most. Lower
          // over-claimed model output to that server-authoritative ceiling.
          "understanding"
        : "";
  const contextDistance =
    q.contextDistance === "same" ||
    q.contextDistance === "near" ||
    q.contextDistance === "far"
      ? q.contextDistance
      : "";
  const criterionRef =
    typeof q.criterionRef === "string" ? q.criterionRef.trim() : "";

  if (type === "true_false") {
    const rawAnswer = q.correctAnswer ?? q.answer;
    const correctAnswer =
      rawAnswer === true ||
      rawAnswer === "true" ||
      rawAnswer === 1 ||
      rawAnswer === "1";
    return {
      type,
      question,
      correctAnswer,
      primaryLearningTargetId,
      learningTargetIds,
      ...(primaryCognitiveEntityId ? { primaryCognitiveEntityId } : {}),
      evidenceDimension,
      criterionRef,
      contextDistance,
    };
  }

  const { options } = normalizeOptions(asStringArray(q.options));
  if (options.length < 2) return null;

  if (type === "mcq") {
    const rawIndex = q.correctIndex ?? q.correct_index ?? q.answer ?? 0;
    const index = typeof rawIndex === "number" ? rawIndex : Number(rawIndex);
    const correctIndex = Number.isFinite(index)
      ? Math.min(Math.max(0, index), options.length - 1)
      : 0;
    return {
      type,
      question,
      options,
      correctIndex,
      primaryLearningTargetId,
      learningTargetIds,
      ...(primaryCognitiveEntityId ? { primaryCognitiveEntityId } : {}),
      evidenceDimension,
      criterionRef,
      contextDistance,
    };
  }

  const rawIndices =
    q.correctIndices ??
    q.correct_indices ??
    (Array.isArray(q.answer) ? q.answer : null);
  let correctIndices = asNumberArray(rawIndices)
    .map((index) => Math.min(Math.max(0, index), options.length - 1))
    .filter((index, pos, arr) => arr.indexOf(index) === pos)
    .sort((a, b) => a - b);

  if (correctIndices.length < 2) {
    const fallback = asNumberArray([q.correctIndex ?? q.correct_index ?? 0]);
    correctIndices = fallback.length >= 2 ? fallback : [0, 1];
  }

  return {
    type,
    question,
    options,
    correctIndices,
    primaryLearningTargetId,
    learningTargetIds,
    ...(primaryCognitiveEntityId ? { primaryCognitiveEntityId } : {}),
    evidenceDimension,
    criterionRef,
    contextDistance,
  };
}

function normalizeQuestionList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeQuestionItem(item))
    .filter((item): item is Record<string, unknown> => item !== null);
}

/** Normalize one streamed quiz question object (compact or expanded keys). */
export function normalizeStreamQuizQuestion(
  item: unknown,
): Record<string, unknown> | null {
  return normalizeQuestionItem(expandQuizCompact(item));
}

/** Coerce LLM quiz JSON: fix shapes and ensure enough items in `questions`. */
export function normalizeQuizPayload(data: unknown): Record<string, unknown> {
  const expanded = expandQuizCompact(data);
  if (Array.isArray(expanded)) {
    return {
      questions: normalizeQuestionList(expanded),
      interleaved: [],
    };
  }
  const root = asRecord(expanded) ?? {};

  const questions = normalizeQuestionList(
    root.questions ?? root.qs ?? root.Questions,
  );
  const interleaved = normalizeQuestionList(
    root.interleaved ?? root.il ?? root.Interleaved,
  );

  while (questions.length < MIN_QUIZ_QUESTIONS && interleaved.length > 0) {
    questions.push(interleaved.shift()!);
  }

  return { questions, interleaved };
}
