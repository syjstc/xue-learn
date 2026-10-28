import { UNIT_QUIZ_BATCH_SIZE } from "../learning-systems/capabilities/assessment-runtime/quiz-prompt.js";
import { normalizeStreamQuizQuestion } from "./normalize-quiz.js";

export type QuizCompactStreamPartial = {
  questions: Record<string, unknown>[];
  completeQuestionCount: number;
  placeholderQuestionCount: number;
};

function findQuestionsArrayStart(text: string): number | null {
  for (const key of ["qs", "questions"] as const) {
    const wrapped = text.match(new RegExp(`"${key}"\\s*:\\s*\\[`));
    if (wrapped?.index != null) {
      return wrapped.index + wrapped[0].length;
    }
  }

  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "[") return i + 1;
  }
  return null;
}

function isRootArrayClosed(text: string, arrayStart: number): boolean {
  let objectDepth = 0;
  let nestedArrayDepth = 0;
  let inString = false;
  let escape = false;

  for (let i = arrayStart; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      objectDepth += 1;
    } else if (ch === "}") {
      objectDepth = Math.max(0, objectDepth - 1);
    } else if (ch === "[") {
      nestedArrayDepth += 1;
    } else if (ch === "]") {
      if (objectDepth === 0 && nestedArrayDepth === 0) return true;
      nestedArrayDepth = Math.max(0, nestedArrayDepth - 1);
    }
  }
  return false;
}

function extractCompleteArrayObjects(
  text: string,
  start: number,
): {
  objects: unknown[];
  nextIndex: number;
} {
  const objects: unknown[] = [];
  let i = start;

  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i]!)) i += 1;
    if (i >= text.length || text[i] === "]") break;
    if (text[i] !== "{") break;

    const objectStart = i;
    let depth = 0;
    let inString = false;
    let escape = false;
    let closed = false;

    for (; i < text.length; i += 1) {
      const ch = text[i]!;
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const objectText = text.slice(objectStart, i + 1);
          try {
            objects.push(JSON.parse(objectText));
            closed = true;
          } catch {
            return { objects, nextIndex: objectStart };
          }
          i += 1;
          break;
        }
      }
    }

    if (!closed) break;
  }

  return { objects, nextIndex: i };
}

export class QuizCompactStreamAccumulator {
  private buffer = "";
  private lastSnapshot = "";

  constructor(private readonly targetQuestionCount = UNIT_QUIZ_BATCH_SIZE) {}

  append(delta: string): QuizCompactStreamPartial | null {
    this.buffer += delta;
    const arrayStart = findQuestionsArrayStart(this.buffer);
    if (arrayStart == null) return null;

    const { objects, nextIndex } = extractCompleteArrayObjects(
      this.buffer,
      arrayStart,
    );
    const questions = objects
      .map((item) => normalizeStreamQuizQuestion(item))
      .filter((item): item is Record<string, unknown> => item !== null);

    let scan = nextIndex;
    while (scan < this.buffer.length && /[\s,]/.test(this.buffer[scan]!)) {
      scan += 1;
    }
    const inProgress = scan < this.buffer.length && this.buffer[scan] === "{";

    const completeQuestionCount = questions.length;
    const remaining = Math.max(
      0,
      this.targetQuestionCount - completeQuestionCount,
    );
    const arrayClosed = isRootArrayClosed(this.buffer, arrayStart);
    const placeholderQuestionCount =
      remaining > 0 && (inProgress || !arrayClosed) ? remaining : 0;

    const snapshot = JSON.stringify({
      questions,
      completeQuestionCount,
      placeholderQuestionCount,
    });
    if (snapshot === this.lastSnapshot) return null;
    this.lastSnapshot = snapshot;

    return {
      questions,
      completeQuestionCount,
      placeholderQuestionCount,
    };
  }
}
